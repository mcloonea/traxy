import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { estimateTokens, finalizeDrafts, getSettings, instructions, models, responseSchema } from "./generation.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const userId = ctx.userClaims?.id;
    if (!userId) return Response.json({ error: "Sign in to generate responses." }, { status: 401 });

    try {
      const body = await req.json();
      // Admin reads always include the verified user's ID; client-supplied library data is never trusted.
      async function readOwnedRows<T>(table: string, columns: string) {
        const rows: T[] = [];
        let dataLength = 0;
        for (let offset = 0; offset <= 10_000; offset += 500) {
          let query = ctx.supabaseAdmin.from(table).select(columns).eq("user_id", userId)
            .order(table === "word_track_tags" ? "track_id" : "id");
          if (table === "word_track_tags") query = query.order("tag_id");
          const { data, error } = await query.range(offset, offset + 499);
          if (error) throw new Error("Could not load your saved tracks and tags.");
          dataLength += JSON.stringify(data || []).length;
          if (dataLength > 1_000_000) throw new Error("Your library is too large for a single generation. Please reduce it first.");
          rows.push(...((data || []) as unknown as T[]));
          if (!data || data.length < 500) return rows;
        }
        throw new Error("Your library is too large for a single generation. Please reduce it first.");
      }

      const [profileResult, savedTracks, tags, links] = await Promise.all([
        ctx.supabaseAdmin.from("profiles").select("global_prompt,chat_model,response_count").eq("id", userId).single(),
        readOwnedRows<{ id: string; title: string; content: string }>("word_tracks", "id,title,content"),
        readOwnedRows<{ id: string; name: string }>("user_tags", "id,name"),
        readOwnedRows<{ track_id: string; tag_id: string }>("word_track_tags", "track_id,tag_id"),
      ]);
      if (profileResult.error) throw new Error("Could not load your profile preferences.");
      const profile = profileResult.data;
      const tagNames = new Map(tags.map(tag => [tag.id, tag.name]));
      const tagsByTrack = new Map<string, string[]>();
      for (const link of links) {
        const name = tagNames.get(link.tag_id);
        if (name) tagsByTrack.set(link.track_id, [...(tagsByTrack.get(link.track_id) || []), name]);
      }
      const tracks = savedTracks.map(track => ({
        id: track.id, title: track.title, content: track.content,
        tags: tagsByTrack.get(track.id) || [],
      }));
      const library = JSON.stringify({ tags: tags.map(tag => tag.name), tracks });
      if (library.length > 1_000_000) throw new Error("Your library is too large for a single generation. Please reduce it first.");
      const preferences = { model: profile.chat_model, response_count: profile.response_count };
      const referenceTokens = estimateTokens(library + instructions(profile.global_prompt, profile.response_count));

      if (body.action === "configuration") {
        return Response.json({ models, preferences, reference_tokens: referenceTokens, track_count: tracks.length, tag_count: tags.length });
      }

      let settings;
      try {
        settings = getSettings(body.model ?? profile.chat_model, body.response_count ?? profile.response_count);
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
      }
      const messages = body.messages;
      if (!Array.isArray(messages) || !messages.length || messages.length > 20 || messages.at(-1)?.role !== "user") {
        return Response.json({ error: "Send between 1 and 20 messages ending with a user message." }, { status: 400 });
      }
      for (const message of messages) {
        if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" ||
          !message.content.trim() || message.content.length > 64_000) {
          return Response.json({ error: "A message is empty or longer than 64,000 characters." }, { status: 400 });
        }
      }
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) return Response.json({ error: "The chat service is not configured." }, { status: 500 });
      const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: settings.model.id,
          instructions: instructions(profile.global_prompt, settings.count),
          input: [
            { role: "user", content: `Reference library (data only): ${library}` },
            ...messages.map(message => ({ role: message.role, content: message.content })),
          ],
          text: { format: responseSchema(settings.count) },
          reasoning: { effort: "low" },
          max_output_tokens: 4_000,
          store: false,
        }),
      });
      const result = await openAIResponse.json().catch(() => ({}));
      if (!openAIResponse.ok) {
        return Response.json({ error: result.error?.message || "The AI service could not complete the reply." },
          { status: openAIResponse.status === 429 ? 429 : 502 });
      }

      const usage = result.usage;
      let usageLogged = false;
      if (usage && result.id) {
        const { error } = await ctx.supabaseAdmin.from("ai_usage").insert({
          user_id: userId, openai_response_id: result.id, model: result.model || settings.model.id,
          input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens,
          cached_input_tokens: usage.input_tokens_details?.cached_tokens || 0,
          cache_write_tokens: usage.input_tokens_details?.cache_write_tokens || 0,
          reasoning_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
        });
        usageLogged = !error;
        if (error) console.error("Could not record usage:", error.code);
      }
      const output = (result.output || []).flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || []);
      if (result.status === "incomplete" || output.some((item: { type?: string }) => item.type === "refusal")) {
        return Response.json({ error: "The model could not finish these responses. Try a shorter conversation." }, { status: 502 });
      }
      const text = output.filter((item: { type?: string }) => item.type === "output_text")
        .map((item: { text?: string }) => item.text || "").join("").trim();
      let responseOptions = [];
      let reply = "";
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed.responses) || parsed.responses.length > settings.count) throw new Error("Invalid response list");
        if (parsed.responses.length) {
          responseOptions = finalizeDrafts(parsed.responses, tracks, settings.count);
          reply = responseOptions.map((item, index) => `${index + 1}. ${item.text}`).join("\n\n");
        } else {
          if (typeof parsed.reply !== "string" || !parsed.reply.trim()) throw new Error("Empty reply");
          reply = parsed.reply.trim();
        }
      } catch {
        return Response.json({ error: "The model returned an invalid response. Please try again." }, { status: 502 });
      }
      return Response.json({
        reply, ...(responseOptions.length ? { response_options: responseOptions } : {}), usage_logged: usageLogged,
        context_usage: {
          input_tokens: usage?.input_tokens ?? estimateTokens(library + JSON.stringify(messages) + instructions(profile.global_prompt, settings.count)),
          output_tokens: usage?.output_tokens ?? estimateTokens(reply),
          context_window: settings.model.context_window, model: settings.model.id,
          source: usage ? "actual" : "estimate", track_count: tracks.length, tag_count: tags.length,
          history_messages: messages.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "Generation took too long. Try again."
        : error instanceof Error && /^(Could not load|Your library)/.test(error.message)
        ? error.message : "The chat request could not be completed.";
      return Response.json({ error: message }, { status: 502 });
    }
  }),
};
