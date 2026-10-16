import { deepEqual, equal, throws } from "node:assert/strict";
import { finalizeDrafts, getSettings, type Track } from "./generation.ts";

const tracks: Track[] = [{
  id: "track-1", title: "Appointment", tags: ["Initial"],
  content: "Hi [Name], is {{Time}} good to see the <<Vehicle>>? Ask for [Salesperson].",
}];

Deno.test("exact matches preserve saved wording and replace only recognized placeholders", () => {
  const options = finalizeDrafts([{
    text: "The model tried to rewrite everything.", title: "Ignored title", description: "The track fits this customer.",
    match_type: "exact", track_id: "track-1",
    fills: [
      { placeholder: "[Name]", value: "Taylor" },
      { placeholder: "{{Time}}", value: "3 PM" },
      { placeholder: "<<Vehicle>>", value: "Civic" },
      { placeholder: "[Salesperson]", value: "" },
      { placeholder: "Hi", value: "IGNORE" },
    ],
  }], tracks, 1);
  equal(options[0].text, "Hi Taylor, is 3 PM good to see the Civic? Ask for [Salesperson].");
  deepEqual(options[0].source, { id: "track-1", title: "Appointment", tags: ["Initial"] });
});

Deno.test("reject invalid models, response counts, and unknown source tracks", () => {
  throws(() => getSettings("not-a-model", 3));
  for (const count of [0, 4, 1.5, "2"]) throws(() => getSettings("gpt-6-luna", count));
  equal(getSettings("gpt-6-luna", 2).count, 2);
  throws(() => finalizeDrafts([], tracks, 3));
  throws(() => finalizeDrafts([{
    text: "Unknown source", title: "Adapted", description: "A reason.",
    match_type: "adapted", track_id: "other-user-track", fills: [],
  }], tracks, 1));
});

Deno.test("adapted replies keep their generated wording; original replies never claim a saved source", () => {
  const options = finalizeDrafts([
    { text: "An adapted reply", title: "Adapted", description: "Adjusted to fit.", match_type: "adapted", track_id: "track-1", fills: [] },
    { text: "An original reply", title: "Reassurance", description: "Offers reassurance.", match_type: "new", track_id: "track-1", fills: [] },
  ], tracks, 2);
  equal(options[0].text, "An adapted reply");
  equal(options[1].source, null);
});
