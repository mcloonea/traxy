(() => {
  if (window.top !== window || window.__traxyExtensionLoaded) return;
  window.__traxyExtensionLoaded = true;
  const siteKey = `site:${location.hostname}`;
  const panel = document.createElement('section');
  panel.id = 'traxy-extension-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Traxy writing assistant');
  panel.innerHTML = `
    <div class="traxy-panel-head"><span class="traxy-panel-mark">✦</span><span class="traxy-panel-title">Traxy</span><button class="traxy-panel-close" type="button" aria-label="Close">×</button></div>
    <textarea class="traxy-panel-prompt" placeholder="What would you like help writing?" aria-label="Instructions"></textarea>
    <label class="traxy-panel-track-label" for="traxy-word-tracks">Word tracks (select any that apply)</label>
    <select class="traxy-panel-track" id="traxy-word-tracks" aria-label="Word tracks (select any that apply)" multiple size="4"></select>
    <button class="traxy-panel-submit" type="button">Generate with Traxy</button>
    <div class="traxy-panel-tags" aria-label="Available tags"></div>
    <p class="traxy-panel-help">Selected text or the field’s recent text is included as context. Choose specific tracks and tags if useful.</p>
    <p class="traxy-panel-status" role="status" aria-live="polite"></p>`;
  document.documentElement.append(panel);

  const promptField = panel.querySelector('.traxy-panel-prompt');
  const trackSelect = panel.querySelector('.traxy-panel-track');
  const tagList = panel.querySelector('.traxy-panel-tags');
  const status = panel.querySelector('.traxy-panel-status');
  let activeField;
  let siteEnabled = false;
  let tracks = [];
  let tags = [];
  let referencesLoaded = false;
  const selectedTags = new Set();
  let lastSlashAt = 0;
  let lastSlashField = null;
  let contextAtOpen = '';

  chrome.storage.local.get(siteKey, saved => { siteEnabled = Boolean(saved[siteKey]); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[siteKey]) {
      siteEnabled = Boolean(changes[siteKey].newValue);
      if (!siteEnabled) panel.hidden = true;
    }
  });

  function readField(field) {
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) return field.value;
    if (field?.isContentEditable) return field.innerText || field.textContent || '';
    return '';
  }

  function cursorRect(field) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const rect = field.getBoundingClientRect();
      const style = getComputedStyle(field);
      const mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      Object.assign(mirror.style, {
        position: 'fixed', visibility: 'hidden', pointerEvents: 'none', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, boxSizing: style.boxSizing, padding: style.padding, border: style.border,
        font: style.font, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, textIndent: style.textIndent,
        textTransform: style.textTransform, whiteSpace: field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre',
        overflowWrap: field instanceof HTMLTextAreaElement ? 'break-word' : 'normal', wordBreak: style.wordBreak
      });
      mirror.textContent = field.value.slice(0, field.selectionStart ?? field.value.length);
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      mirror.append(marker);
      document.body.append(mirror);
      const markerRect = marker.getBoundingClientRect();
      mirror.remove();
      const top = markerRect.top - field.scrollTop;
      const left = markerRect.left - field.scrollLeft;
      return { left: Math.min(innerWidth - 12, Math.max(12, left)), top, bottom: top + Math.max(18, parseFloat(style.lineHeight) || 18) };
    }
    const selection = getSelection();
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : field.getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  }

  function placePanel(field) {
    const rect = cursorRect(field);
    const width = Math.min(340, innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, innerWidth - width - 12));
    panel.style.left = `${left}px`;
    panel.hidden = false;
    const height = panel.getBoundingClientRect().height;
    let top = rect.top - height - 10;
    if (top < 12) top = Math.min(innerHeight - height - 12, rect.bottom + 10);
    panel.style.top = `${Math.max(12, top)}px`;
  }

  function selectionText() {
    if (activeField && contextAtOpen) return contextAtOpen;
    if (activeField instanceof HTMLInputElement || activeField instanceof HTMLTextAreaElement) {
      const start = activeField.selectionStart ?? 0;
      const end = activeField.selectionEnd ?? start;
      const selection = activeField.value.slice(start, end).trim();
      return selection || readField(activeField).trim().slice(-5000);
    }
    const selection = getSelection()?.toString().trim();
    if (selection) return selection;
    return readField(activeField).trim().slice(-5000);
  }

  function openPanel(field) {
    activeField = field;
    contextAtOpen = selectionText();
    promptField.value = '';
    [...trackSelect.options].forEach(option => { option.selected = false; });
    selectedTags.clear();
    renderTags();
    status.textContent = '';
    status.dataset.error = 'false';
    placePanel(field);
    promptField.focus();
    loadReferences();
  }

  function renderTags() {
    tagList.replaceChildren(...tags.map(tag => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'traxy-panel-tag';
      button.textContent = `#${tag.name}`;
      button.setAttribute('aria-pressed', String(selectedTags.has(tag.name)));
      button.addEventListener('click', () => {
        if (selectedTags.has(tag.name)) selectedTags.delete(tag.name);
        else selectedTags.add(tag.name);
        button.setAttribute('aria-pressed', String(selectedTags.has(tag.name)));
      });
      return button;
    }));
  }

  function closePanel() {
    panel.hidden = true;
    if (activeField?.isConnected) activeField.focus({ preventScroll: true });
    activeField = null;
    contextAtOpen = '';
  }

  function slashTrigger(event) {
    if (!siteEnabled || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const field = event.target;
    const editable = field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLInputElement && /^(text|search|email|url|tel)$/i.test(field.type)) ||
      (field?.isContentEditable && field.getAttribute('contenteditable') !== 'false');
    if (!editable || panel.contains(field)) return;
    const now = Date.now();
    if (now - lastSlashAt > 900 || lastSlashField !== field) {
      lastSlashAt = now;
      lastSlashField = field;
      return;
    }
    lastSlashAt = 0;
    lastSlashField = null;
    event.preventDefault();
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      field.setRangeText('', Math.max(0, start - 1), end, 'end');
    } else {
      const selection = getSelection();
      if (selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
          range.setStart(range.startContainer, range.startOffset - 1);
          range.deleteContents();
        }
      }
    }
    openPanel(field);
  }

  document.addEventListener('keydown', slashTrigger, true);
  panel.querySelector('.traxy-panel-close').addEventListener('click', closePanel);
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && event.target !== activeField) closePanel();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); closePanel(); }
  }, true);

  async function loadReferences() {
    if (referencesLoaded) return;
    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'load-references' }, response => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else if (!response?.ok) reject(new Error(response?.error || 'Could not load your Traxy library.'));
          else resolve(response);
        });
      });
      tracks = result.tracks || [];
      tags = result.tags || [];
      referencesLoaded = true;
      trackSelect.replaceChildren();
      for (const track of tracks) trackSelect.add(new Option(track.title, track.id));
      renderTags();
      status.textContent = '';
      if (!panel.hidden && activeField) placePanel(activeField);
    } catch (error) {
      status.textContent = error.message || 'Could not connect to Traxy.';
      status.dataset.error = 'true';
      if (!panel.hidden && activeField) placePanel(activeField);
    }
  }

  trackSelect.addEventListener('focus', loadReferences);
  panel.querySelector('.traxy-panel-submit').addEventListener('click', async () => {
    const button = panel.querySelector('.traxy-panel-submit');
    button.disabled = true;
    try {
      await loadReferences();
      const chosenTracks = [...trackSelect.selectedOptions].map(option => tracks.find(item => item.id === option.value)).filter(Boolean);
      const chosenTagNames = [...selectedTags];
      const request = [
        'Help with this request. Decide whether I am asking for a customer-facing response or asking you something conversationally, and respond in the appropriate way.',
        `Website: ${location.hostname}`,
        `Text at the cursor or selected in the field: ${selectionText() || '(empty)'}`,
        promptField.value.trim() ? `My instructions: ${promptField.value.trim()}` : '',
        chosenTracks.length ? `Use these selected word tracks as references:\n${chosenTracks.map(track => `Track: ${track.title}\n${track.content}`).join('\n\n')}` : '',
        chosenTagNames.length ? `Use these selected tags when finding relevant saved word tracks: ${chosenTagNames.map(tag => `#${tag}`).join(' ')}` : ''
      ].filter(Boolean).join('\n\n');
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'open-traxy', draft: request }, response => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else if (!response?.ok) reject(new Error(response?.error || 'Could not open Traxy.'));
          else resolve();
        });
      });
      closePanel();
    } catch (error) {
      status.textContent = error.message || 'Could not prepare the Traxy request.';
      status.dataset.error = 'true';
    } finally { button.disabled = false; }
  });
})();
