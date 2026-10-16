const SUPABASE_URL = 'https://vkzdifzdripyloijoxmt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jMR4S2AsDNOYYd55bTspPw_Kq2b3Oo4';
const DEFAULT_TRAXY_APP_URL = 'https://mcloonea.github.io/traxy';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ensure-content') {
    ensureContent(message.tabId).then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'open-traxy') {
    openTraxy(message.appUrl, message.draft || '').then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message || 'Could not open Traxy.' }));
    return true;
  }
  if (message?.type !== 'load-references') return;
  (async () => {
    try {
      const session = await getSession();
      if (!session?.access_token) throw new Error('Connect your Traxy account in the extension popup first.');
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` }
      });
      if (!response.ok) throw new Error('Your Traxy session expired. Reconnect your account in the extension popup.');
      const user = await response.json();
      const [tracks, tags] = await Promise.all([
        readTable('word_tracks', 'id,title,content', user.id, session.access_token),
        readTable('user_tags', 'id,name', user.id, session.access_token)
      ]);
      sendResponse({ ok: true, tracks, tags: tags.map(tag => ({ id: tag.id, name: tag.name })) });
    } catch (error) { sendResponse({ ok: false, error: error.message || 'Could not load your Traxy library.' }); }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && /^https?:/.test(tab.url || '')) {
    ensureContent(tabId).catch(() => {});
  }
});

async function ensureContent(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  const siteKey = `site:${url.hostname}`;
  const saved = await chrome.storage.local.get(siteKey);
  if (!saved[siteKey]) return;
  const origin = `*://${url.hostname}/*`;
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) return;
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function openTraxy(appUrl, draft) {
  if (!appUrl) {
    const saved = await chrome.storage.local.get('traxy_app_url');
    appUrl = saved.traxy_app_url || DEFAULT_TRAXY_APP_URL;
  }
  let base;
  try { base = new URL(appUrl); } catch { throw new Error('Set your Traxy app URL in the extension popup first.'); }
  const local = ['localhost', '127.0.0.1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) {
    throw new Error('Use an HTTPS Traxy app URL.');
  }
  const path = `${base.pathname.replace(/\/+$/, '')}/pages/chat.html`.replace(/^\/\//, '/');
  const chatUrl = new URL(path, base.origin);
  if (draft) {
    const session = await getSession();
    if (!session?.access_token) throw new Error('Connect your Traxy account in the extension popup first.');
    chatUrl.hash = new URLSearchParams({
      draft,
      submit: '1',
      access_token: session.access_token,
      refresh_token: session.refresh_token
    }).toString();
  }
  await chrome.tabs.create({ url: chatUrl.href });
}

async function getSession() {
  const saved = await chrome.storage.local.get('traxy_session');
  const session = saved.traxy_session;
  if (!session?.access_token || !session?.refresh_token) return null;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const result = await response.json();
  if (!response.ok) {
    await chrome.storage.local.remove('traxy_session');
    throw new Error('Your Traxy session expired. Reconnect your account in the extension popup.');
  }
  const next = {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
    email: result.user?.email || session.email || ''
  };
  await chrome.storage.local.set({ traxy_session: next });
  return next;
}

async function readTable(table, columns, userId, token) {
  const query = new URLSearchParams({ select: columns, user_id: `eq.${userId}`, order: table === 'word_tracks' ? 'title.asc' : 'name.asc' });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Could not load your Traxy library. Check your connection and try again.');
  return response.json();
}
