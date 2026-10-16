const SUPABASE_URL = 'https://vkzdifzdripyloijoxmt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jMR4S2AsDNOYYd55bTspPw_Kq2b3Oo4';
const enabledInput = document.getElementById('site-enabled');
const siteName = document.getElementById('site-name');
const status = document.getElementById('status');
const accountStatus = document.getElementById('account-status');
const signinForm = document.getElementById('signin-form');
const signinButton = document.getElementById('signin-button');
const signoutButton = document.getElementById('signout-button');
const appUrlInput = document.getElementById('app-url');
const appUrlStatus = document.getElementById('app-url-status');
const openButton = document.getElementById('open-traxy');
let currentTab;
let siteKey;
let originPattern;

function setStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function validAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}

function renderAccount(session) {
  const connected = Boolean(session?.access_token && session?.refresh_token);
  accountStatus.textContent = connected ? `Connected as ${session.email || 'your Traxy account'}` : 'Not connected';
  signinForm.hidden = connected;
  signoutButton.hidden = !connected;
}

async function loadPopup() {
  const [tabs, saved] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get(['traxy_session', 'traxy_app_url'])
  ]);
  currentTab = tabs[0];
  const session = saved.traxy_session;
  renderAccount(session);
  appUrlInput.value = saved.traxy_app_url || 'https://mcloonea.github.io/traxy';
  openButton.disabled = !validAppUrl(appUrlInput.value);

  try {
    const url = new URL(currentTab.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('This page cannot run extensions.');
    siteKey = `site:${url.hostname}`;
    originPattern = `*://${url.hostname}/*`;
    siteName.textContent = url.hostname;
    const granted = await chrome.permissions.contains({ origins: [originPattern] });
    enabledInput.checked = Boolean(saved[siteKey]) && granted;
    enabledInput.disabled = false;
    if (saved[siteKey] && !granted) {
      await chrome.storage.local.set({ [siteKey]: false });
      setStatus('Site access was removed. Enable Traxy again to grant access.');
    }
    if (enabledInput.checked) ensureContentScript();
  } catch (error) {
    siteName.textContent = error.message || 'This page cannot run extensions.';
    enabledInput.disabled = true;
    enabledInput.checked = false;
  }
}

enabledInput.addEventListener('change', async () => {
  if (!siteKey || !originPattern) return;
  if (enabledInput.checked) {
    // Call request directly from the user's toggle action so Chrome keeps its gesture authorization.
    const permissionRequest = chrome.permissions.request({ origins: [originPattern] });
    const granted = await permissionRequest;
    if (!granted) {
      enabledInput.checked = false;
      setStatus('Allow site access to enable Traxy here.', true);
      return;
    }
  }
  await chrome.storage.local.set({ [siteKey]: enabledInput.checked });
  if (!enabledInput.checked) await chrome.permissions.remove({ origins: [originPattern] });
  setStatus(enabledInput.checked ? 'Enabled for this site.' : 'Disabled for this site.');
  if (enabledInput.checked) ensureContentScript();
});

function ensureContentScript() {
  if (!currentTab?.id) return;
  chrome.runtime.sendMessage({ type: 'ensure-content', tabId: currentTab.id }, () => {
    if (chrome.runtime.lastError) setStatus('Could not activate Traxy on this page. Reload and try again.', true);
  });
}

signinForm.addEventListener('submit', async event => {
  event.preventDefault();
  signinButton.disabled = true;
  accountStatus.textContent = 'Connecting…';
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'Could not connect. Check your email and password.');
    const session = {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
      email: result.user?.email || ''
    };
    await chrome.storage.local.set({ traxy_session: session });
    signinForm.reset();
    renderAccount(session);
  } catch (error) {
    accountStatus.textContent = error.message || 'Could not connect to Traxy.';
  } finally { signinButton.disabled = false; }
});

signoutButton.addEventListener('click', async () => {
  await chrome.storage.local.remove(['traxy_session', 'traxy_access_token']);
  renderAccount(null);
});

document.getElementById('save-app-url').addEventListener('click', async () => {
  const value = appUrlInput.value.trim().replace(/\/+$/, '');
  if (!validAppUrl(value)) {
    appUrlStatus.textContent = 'Enter a valid HTTPS app URL (or localhost for development).';
    openButton.disabled = true;
    return;
  }
  await chrome.storage.local.set({ traxy_app_url: value });
  appUrlInput.value = value;
  openButton.disabled = false;
  appUrlStatus.textContent = 'Saved.';
});

appUrlInput.addEventListener('input', () => { openButton.disabled = !validAppUrl(appUrlInput.value.trim()); });

openButton.addEventListener('click', () => {
  if (!validAppUrl(appUrlInput.value.trim())) return;
  chrome.runtime.sendMessage({ type: 'open-traxy', appUrl: appUrlInput.value.trim() }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      appUrlStatus.textContent = response?.error || 'Could not open Traxy. Check the app URL.';
    }
  });
});

loadPopup().catch(() => setStatus('Could not load extension settings.', true));
