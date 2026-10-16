import { supabase, CHAT_FUNCTION_NAME } from './supabase.js';

(() => {
  const form = document.getElementById('chat-form');
  if (!form) return;

  const conversation = document.getElementById('conversation');
  const input = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const historyDrawer = document.getElementById('history-drawer');
  const historyToggle = document.getElementById('history-toggle');
  const historyClose = document.getElementById('history-close');
  const historyList = document.getElementById('history-list');
  const historyEmpty = document.getElementById('history-empty');
  const historyStatus = document.getElementById('history-status');
  const suggestionList = document.getElementById('chat-suggestions');
  const messages = [];
  let chatTags = [];
  let wordTracks = [];
  let suggestions = [];
  let suggestionContext = null;
  let activeSuggestionIndex = -1;
  let suggestionLoadError = false;
  let currentConversationId = null;
  let currentUserId = null;
  let persistedMessageCount = 0;
  let busy = false;
  let configuration = null;
  let settingsSaving = false;
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsMenu = document.getElementById('chat-settings');
  const settingsMain = document.getElementById('settings-main');
  const modelPanel = document.getElementById('settings-model-panel');
  const countPanel = document.getElementById('settings-count-panel');
  const modelOptions = document.getElementById('model-options');
  const countOptions = document.getElementById('response-count-options');
  const settingsStatus = document.getElementById('settings-status');
  const composerStatus = document.getElementById('composer-status');
  const newChatButton = document.getElementById('new-chat-button');

  function setComposerStatus(text, error = false) {
    composerStatus.textContent = text;
    composerStatus.dataset.state = error ? 'error' : '';
  }

  function showSettingsPanel(panel = 'main') {
    settingsMain.hidden = panel !== 'main';
    modelPanel.hidden = panel !== 'model';
    countPanel.hidden = panel !== 'count';
    const target = panel === 'model' ? modelOptions.querySelector('[aria-pressed="true"]')
      : panel === 'count' ? countOptions.querySelector('[aria-pressed="true"]')
      : document.getElementById('open-model-settings');
    target?.focus();
  }

  function closeSettings() {
    settingsMenu.hidden = true;
    settingsToggle.setAttribute('aria-expanded', 'false');
  }

  settingsToggle.addEventListener('click', () => {
    const open = settingsMenu.hidden;
    settingsMenu.hidden = !open;
    settingsToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      hideSuggestions();
      showSettingsPanel();
      document.getElementById('open-model-settings').focus();
    }
  });
  document.getElementById('open-model-settings').addEventListener('click', () => showSettingsPanel('model'));
  document.getElementById('open-count-settings').addEventListener('click', () => showSettingsPanel('count'));
  settingsMenu.querySelectorAll('.settings-back').forEach(button => button.addEventListener('click', () => showSettingsPanel()));
  document.addEventListener('pointerdown', event => {
    if (!settingsMenu.contains(event.target) && !settingsToggle.contains(event.target)) closeSettings();
    if (!suggestionList.contains(event.target) && event.target !== input) hideSuggestions();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsMenu.hidden) {
      closeSettings();
      settingsToggle.focus();
    }
  });

  function renderSettings() {
    if (!configuration) return;
    const selected = configuration.models.find(model => model.id === configuration.preferences.model);
    document.getElementById('selected-model-label').textContent = selected.name;
    const count = configuration.preferences.response_count;
    document.getElementById('selected-count-label').textContent = `${count} ${count === 1 ? 'response' : 'responses'}`;
    modelOptions.replaceChildren();
    for (const model of configuration.models) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-option';
      button.setAttribute('aria-pressed', String(model.id === selected.id));
      const icon = document.createElement('span');
      icon.className = 'settings-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '◈';
      const label = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = model.name;
      const description = document.createElement('small');
      description.textContent = model.description;
      label.append(name, description);
      button.append(icon, label);
      button.addEventListener('click', () => savePreferences({ chat_model: model.id }));
      modelOptions.append(button);
    }
    countOptions.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.count) === count));
    });
  }

  countOptions.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => savePreferences({ response_count: Number(button.dataset.count) }));
  });

  async function savePreferences(values) {
    if (!configuration || settingsSaving || busy) return;
    settingsSaving = true;
    settingsStatus.textContent = 'Saving…';
    settingsStatus.dataset.state = '';
    settingsMenu.querySelectorAll('button').forEach(button => { button.disabled = true; });
    sendButton.disabled = true;
    try {
      const { error } = await supabase.from('profiles').update(values).eq('id', currentUserId);
      if (error) throw error;
      if (values.chat_model) configuration.preferences.model = values.chat_model;
      if (values.response_count) configuration.preferences.response_count = values.response_count;
      renderSettings();
      updateContext();
      settingsStatus.textContent = 'Saved to your profile.';
    } catch {
      settingsStatus.textContent = 'Could not save. Your previous setting is still selected.';
      settingsStatus.dataset.state = 'error';
    } finally {
      settingsSaving = false;
      settingsMenu.querySelectorAll('button').forEach(button => { button.disabled = false; });
      sendButton.disabled = busy || !configuration;
    }
  }

  function requestMessages(draft = '') {
    const recent = messages.slice(-18).map(({ role, content }) => ({ role, content }));
    if (draft.trim()) recent.push({ role: 'user', content: draft.trim() });
    return recent;
  }

  function updateContext(usage = null) {
    if (!configuration) return;
    const selected = configuration.models.find(model => model.id === configuration.preferences.model);
    const history = requestMessages(input.value);
    const estimated = configuration.reference_tokens + Math.ceil(JSON.stringify(history).length / 4) + 4000;
    const actual = usage?.source === 'actual';
    const used = actual ? usage.input_tokens + usage.output_tokens : estimated;
    const capacity = actual ? usage.context_window : selected.context_window;
    const format = value => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
    document.getElementById('context-progress').value = Math.min(100, used / capacity * 100);
    document.getElementById('context-label').textContent = `${actual ? '' : '~'}${format(used)} / ${format(capacity)} context`;
    document.getElementById('context-meter').title = actual
      ? `Last generation: ${usage.input_tokens.toLocaleString()} input + ${usage.output_tokens.toLocaleString()} output tokens. ${usage.track_count} saved tracks, ${usage.tag_count} tags, global prompt, and ${usage.history_messages} recent messages. Model: ${usage.model}.`
      : `Estimate includes all ${configuration.track_count} saved tracks, ${configuration.tag_count} tags, your global prompt, ${history.length} recent messages, and 4,000 tokens reserved for output. Actual usage is shown after generation.`;
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value || !configuration || settingsSaving;
    settingsToggle.disabled = value || !configuration;
    newChatButton.disabled = value || !configuration;
    input.readOnly = value;
    form.setAttribute('aria-busy', String(value));
    historyList.querySelectorAll('button').forEach(button => { button.disabled = value || !configuration; });
    if (value) { closeSettings(); hideSuggestions(); }
  }


  function setHistoryOpen(open) {
    historyDrawer.classList.toggle('open', open);
    historyDrawer.setAttribute('aria-hidden', String(!open));
    historyToggle.setAttribute('aria-expanded', String(open));
  }

  historyToggle.addEventListener('click', () => {
    setHistoryOpen(!historyDrawer.classList.contains('open'));
  });
  historyClose.addEventListener('click', () => setHistoryOpen(false));

  function addMessage(role, content, messageOptions = {}) {
    const { error = false, response_options = null } = messageOptions;
    const assistant = messageOptions;
    document.getElementById('welcome-message')?.remove();

    const row = document.createElement('article');
    row.className = `message ${role}${error ? ' error' : ''}`;
    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = content;
    if (role === 'assistant' && Array.isArray(response_options) && response_options.length) {
      const grid = document.createElement('div');
      grid.className = 'response-grid';
      response_options.forEach((option, index) => {
        const card = document.createElement('article');
        card.className = 'response-card';
        const header = document.createElement('div');
        header.className = 'response-card-header';
        const heading = document.createElement('strong');
        heading.textContent = option.title || `Response ${index + 1}`;
        const match = document.createElement('span');
        match.className = 'response-match';
        match.textContent = ({ exact: 'Exact match', adapted: 'Adapted', new: 'Original' })[option.match_type] || 'Response';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'response-copy';
        copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(option.text);
            copy.textContent = 'Copied';
          } catch { copy.textContent = 'Copy failed'; }
          setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
        });
        header.append(heading, match, copy);
        const description = document.createElement('p');
        description.className = 'response-description';
        description.textContent = option.description || (option.source
          ? `Selected from “${option.source.title}”${option.source.tags?.length ? ` · ${option.source.tags.map(tag => `#${tag}`).join(' ')}` : ''}.`
          : 'An original response.');
        const text = document.createElement('textarea');
        text.className = 'response-editor';
        text.setAttribute('aria-label', `Edit response: ${heading.textContent}`);
        text.value = option.text;
        text.rows = Math.max(3, Math.min(9, option.text.split('\n').length + 1));
        text.addEventListener('input', () => {
          option.text = text.value;
          text.rows = Math.max(3, Math.min(9, text.value.split('\n').length + 1));
          assistant.content = response_options.map((item, itemIndex) => `${itemIndex + 1}. ${item.text}`).join('\n\n');
          scheduleMessageEditSave(assistant);
        });
        card.append(header, description, text);
        grid.append(card);
      });
      row.append(grid);
    } else {
      row.append(body);
    }
    conversation.append(row);
    conversation.scrollTop = conversation.scrollHeight;
    return row;
  }

  const messageEditTimers = new WeakMap();
  function scheduleMessageEditSave(message) {
    clearTimeout(messageEditTimers.get(message));
    const conversationId = currentConversationId;
    if (!message.sequence || !conversationId) return;
    const timer = setTimeout(async () => {
      const { error } = await supabase.from('conversation_messages')
        .update({ content: message.content, response_options: message.response_options })
        .eq('conversation_id', conversationId)
        .eq('sequence', message.sequence);
      if (error) setComposerStatus('Your edit could not be saved to chat history.', true);
    }, 450);
    messageEditTimers.set(message, timer);
  }

  function showWelcome() {
    conversation.replaceChildren();
    const welcome = document.createElement('div');
    welcome.className = 'welcome-message';
    welcome.id = 'welcome-message';
    const icon = document.createElement('div');
    icon.className = 'welcome-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✦';
    const heading = document.createElement('h2');
    heading.textContent = 'What can I help you with?';
    const description = document.createElement('p');
    description.textContent = 'Paste a customer conversation to find the right words.';
    welcome.append(icon, heading, description);
    conversation.append(welcome);
  }

  function setHistoryMessage(text, error = false) {
    historyStatus.textContent = text;
    historyStatus.dataset.state = error ? 'error' : '';
  }

  async function loadAutocompleteData() {
    const [tagResult, trackResult] = await Promise.all([
      supabase.from('user_tags').select('name').order('name'),
      supabase.from('word_tracks').select('title,content').order('title')
    ]);
    if (tagResult.error) throw tagResult.error;
    if (trackResult.error) throw trackResult.error;
    chatTags = tagResult.data || [];
    wordTracks = trackResult.data || [];
  }

  // The browser extension opens this page with a draft in the URL fragment.
  // Fragments stay local to the browser and are not sent to the web server.
  function acceptExtensionDraft(draft) {
    if (typeof draft !== 'string' || !draft) return;
    input.value = draft.slice(0, 64000);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  chromeExtensionDraft();
  function chromeExtensionDraft() {
    const handoff = new URLSearchParams(location.hash.slice(1));
    const draft = handoff.get('draft');
    const autoSubmit = handoff.get('submit') === '1';
    const accessToken = handoff.get('access_token');
    const refreshToken = handoff.get('refresh_token');
    history.replaceState(null, '', location.pathname + location.search);
    const sessionReady = accessToken && refreshToken
      ? supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
        if (error) throw error;
      })
      : Promise.resolve();
    if (draft) {
      const openDraft = () => {
        acceptExtensionDraft(draft);
        if (autoSubmit) setTimeout(() => form.requestSubmit(), 0);
      };
      if (configuration) openDraft();
      else window.addEventListener('traxy-configuration-ready', openDraft, { once: true });
    }
    return sessionReady;
  }
  const extensionSessionReady = chromeExtensionDraft();

  function hideSuggestions() {
    suggestions = [];
    suggestionContext = null;
    activeSuggestionIndex = -1;
    suggestionList.hidden = true;
    suggestionList.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActiveSuggestion(index) {
    if (!suggestions.length) return;
    activeSuggestionIndex = (index + suggestions.length) % suggestions.length;
    const options = suggestionList.querySelectorAll('.chat-suggestion');
    options.forEach((option, optionIndex) => {
      option.setAttribute('aria-selected', String(optionIndex === activeSuggestionIndex));
    });
    const activeOption = options[activeSuggestionIndex];
    input.setAttribute('aria-activedescendant', activeOption.id);
    activeOption.scrollIntoView({ block: 'nearest' });
  }

  function renderSuggestions() {
    suggestionList.replaceChildren();
    if (!suggestions.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-suggestions-empty';
      empty.textContent = suggestionLoadError
        ? 'Could not load tags or word tracks.'
        : `No matching ${suggestionContext.type === 'tag' ? 'tags' : 'titles'}.`;
      suggestionList.append(empty);
      suggestionList.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
      return;
    }

    suggestions.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `chat-suggestion-${index}`;
      option.className = `chat-suggestion${item.type === 'title' && suggestions.length === 1 ? ' only-match' : ''}`;
      option.dataset.index = String(index);
      option.dataset.type = item.type;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const label = document.createElement('span');
      label.textContent = item.type === 'tag' ? `#${item.value}` : item.value;
      option.append(label);
      if (item.type === 'title') {
        const preview = document.createElement('span');
        preview.className = 'chat-suggestion-preview';
        preview.textContent = item.preview;
        option.append(preview);
      }
      option.addEventListener('mouseenter', () => setActiveSuggestion(index));
      option.addEventListener('click', () => selectSuggestion(index));
      suggestionList.append(option);
    });

    suggestionList.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeSuggestionIndex >= 0) setActiveSuggestion(activeSuggestionIndex);
  }

  function updateSuggestions() {
    const beforeCursor = input.value.slice(0, input.selectionStart);
    const match = /(?:^|\s)\/(tag|title)(?:\s+([^\n]*))?$/i.exec(beforeCursor);
    if (!match || busy || !settingsMenu.hidden) {
      hideSuggestions();
      return;
    }

    const type = match[1].toLowerCase();
    const query = (match[2] || '').trim().toLowerCase();
    const source = type === 'tag' ? chatTags : wordTracks;
    suggestions = source
      .filter(item => (type === 'tag' ? item.name : item.title).toLowerCase().includes(query))
      .map(item => type === 'tag'
        ? { type, value: item.name }
        : { type, value: item.title, preview: item.content });
    suggestionContext = {
      type,
      start: beforeCursor.length - match[0].length + match[0].lastIndexOf('/')
    };
    activeSuggestionIndex = suggestions.length === 1 ? 0 : -1;
    renderSuggestions();
  }

  function selectSuggestion(index) {
    const item = suggestions[index];
    if (!item || !suggestionContext) return;
    const start = suggestionContext.start;
    const cursor = input.selectionStart;
    const insertion = `${item.type === 'tag' ? `#${item.value}` : item.value} `;
    input.value = input.value.slice(0, start) + insertion + input.value.slice(cursor);
    const nextCursor = start + insertion.length;
    hideSuggestions();
    input.focus();
    input.setSelectionRange(nextCursor, nextCursor);
    updateContext();
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }

  async function loadConversations() {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;

    historyList.replaceChildren();
    historyEmpty.hidden = (data || []).length > 0;
    for (const item of data || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.disabled = busy || !configuration;
      button.dataset.conversationId = item.id;
      button.textContent = item.title;
      button.setAttribute('aria-current', String(item.id === currentConversationId));
      historyList.append(button);
    }
  }

  async function openConversation(id) {
    if (busy || !configuration) return;
    setBusy(true);
    setHistoryMessage('Loading…');
    historyList.querySelectorAll('.history-item').forEach(button => { button.disabled = true; });
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('role,content,response_options,context_usage,sequence')
      .eq('conversation_id', id)
      .order('sequence', { ascending: true });
    historyList.querySelectorAll('.history-item').forEach(button => { button.disabled = false; });
    if (error) {
      setHistoryMessage('Could not load this conversation.', true);
      setBusy(false);
      return;
    }

    currentConversationId = id;
    messages.splice(0, messages.length, ...(data || []));
    persistedMessageCount = messages.length;
    showWelcome();
    for (const message of messages) addMessage(message.role, message.content, message);
    try {
      await loadConversations();
      setHistoryMessage('');
      setHistoryOpen(false);
      updateContext(messages.at(-1)?.context_usage);
    } catch { setHistoryMessage('Could not refresh chat history.', true); }
    finally { setBusy(false); }
  }

  historyList.addEventListener('click', event => {
    const button = event.target.closest('[data-conversation-id]');
    if (button) openConversation(button.dataset.conversationId);
  });

  newChatButton.addEventListener('click', () => {
    if (busy || !configuration) return;
    currentConversationId = null;
    messages.length = 0;
    persistedMessageCount = 0;
    hideSuggestions();
    updateContext();
    setComposerStatus('');
    showWelcome();
    historyList.querySelectorAll('.history-item').forEach(button => {
      button.setAttribute('aria-current', 'false');
    });
    setHistoryMessage('');
    setHistoryOpen(false);
    input.focus();
  });

  async function callFunction(payload) {
    const { data, error } = await supabase.functions.invoke(CHAT_FUNCTION_NAME, { body: payload });
    if (error) {
      let details;
      try { details = await error.context?.json(); } catch { /* Fall back to the SDK error. */ }
      throw new Error(details?.error || error.message || 'Generation failed.');
    }
    return data || {};
  }

  async function saveExchange(userMessage) {
    if (!currentConversationId) {
      const firstUserMessage = messages.find(message => message.role === 'user')?.content || userMessage;
      const title = firstUserMessage.length > 120 ? `${firstUserMessage.slice(0, 117)}…` : firstUserMessage;
      const { data, error } = await supabase
        .from('conversations')
        .insert({ user_id: currentUserId, title })
        .select('id')
        .single();
      if (error) throw error;
      currentConversationId = data.id;
    }

    const pendingMessages = messages.slice(persistedMessageCount);
    if (pendingMessages.length) {
      const { data: insertedMessages, error: messageError } = await supabase.from('conversation_messages').insert(
        pendingMessages.map(({ role, content, response_options, context_usage }) => ({
          role, content, response_options, context_usage, conversation_id: currentConversationId
        }))
      ).select('sequence');
      if (messageError) throw messageError;
      pendingMessages.forEach((message, index) => {
        message.sequence = insertedMessages[index].sequence;
        if (message.response_options) scheduleMessageEditSave(message);
      });
      persistedMessageCount = messages.length;
    }

    const { error: updateError } = await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', currentConversationId);
    if (updateError) throw updateError;
    await loadConversations();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || busy || settingsSaving || !configuration) return;
    const pendingMessages = requestMessages(message);
    setBusy(true);
    setComposerStatus('Thinking…');
    let pendingRow;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in before starting a chat.');
      pendingRow = addMessage('user', message);
      input.value = '';
      input.style.height = 'auto';
      const result = await callFunction({
        messages: pendingMessages,
        model: configuration.preferences.model,
        response_count: configuration.preferences.response_count
      });
      if (typeof result.reply !== 'string') {
        throw new Error('The generator returned an invalid response. Please try again.');
      }
      const assistantMessage = {
        role: 'assistant', content: result.reply,
        ...(Array.isArray(result.response_options) && result.response_options.length ? { response_options: result.response_options } : {}),
        context_usage: result.context_usage
      };
      messages.push({ role: 'user', content: message }, assistantMessage);
      addMessage('assistant', result.reply, assistantMessage);
      updateContext(result.context_usage);
      try {
        await saveExchange(message);
        setComposerStatus(result.usage_logged === false ? 'Responses saved, but token usage could not be recorded.' : '');
        setHistoryMessage('');
      } catch {
        setComposerStatus('Responses generated, but this chat could not be saved. Please check your connection.', true);
      }
    } catch (error) {
      pendingRow?.remove();
      input.value = message;
      input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
      setComposerStatus(error.message, true);
    } finally {
      setBusy(false);
      input.focus();
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
    updateSuggestions();
    updateContext();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !suggestionList.hidden) {
      event.preventDefault();
      hideSuggestions();
      return;
    }
    if (event.key === 'ArrowDown' && !suggestionList.hidden && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion(activeSuggestionIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp' && !suggestionList.hidden && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion(activeSuggestionIndex < 0 ? suggestions.length - 1 : activeSuggestionIndex - 1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!suggestionList.hidden && suggestions.length) {
        selectSuggestion(activeSuggestionIndex < 0 ? 0 : activeSuggestionIndex);
        return;
      }
      form.requestSubmit();
    }
  });

  async function initialize() {
    await extensionSessionReady;
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      location.replace('auth.html');
      return;
    }
    currentUserId = user.id;
    await Promise.allSettled([
      loadConversations().catch(() => setHistoryMessage('Could not load chat history.', true)),
      loadAutocompleteData().then(updateSuggestions).catch(() => { suggestionLoadError = true; }),
      callFunction({ action: 'configuration' }).then(data => {
        if (!data.models?.length || !data.preferences) throw new Error('Could not load generator settings.');
        configuration = data;
        renderSettings();
        setBusy(false);
        updateContext();
        window.dispatchEvent(new Event('traxy-configuration-ready'));
      }).catch(error => setComposerStatus(error.message, true))
    ]);
  }

  initialize();
})();
