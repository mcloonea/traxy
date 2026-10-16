import { supabase } from './supabase.js';

const username = document.getElementById('profile-username');
const email = document.getElementById('profile-email');
const globalPrompt = document.getElementById('profile-global-prompt');
const message = document.getElementById('profile-message');
const tagForm = document.getElementById('tag-form');
const tagInput = document.getElementById('new-tag');
const tagMessage = document.getElementById('tag-message');
const tagList = document.getElementById('profile-tag-list');
let saveTimer;
let saveVersion = 0;
let saveInFlight = Promise.resolve();
let currentUserId;

function showMessage(text, error = false) {
  if (!message) return;
  message.textContent = text;
  message.dataset.state = error ? 'error' : 'success';
}

const { data: { user }, error: userError } = await supabase.auth.getUser();
if (userError || !user) {
  location.replace('auth.html');
} else {
  currentUserId = user.id;
  if (email && username && globalPrompt) {
    email.value = user.email || '';
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('display_name,global_prompt')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      showMessage('Could not load your profile.', true);
    } else {
      username.value = profile?.display_name || user.user_metadata?.name || '';
      globalPrompt.value = profile?.global_prompt || '';
      username.disabled = false;
      globalPrompt.disabled = false;
    }
  }
  if (tagForm) await loadTags();
}

async function loadTags() {
  if (!tagMessage || !tagList) return;
  const { data, error } = await supabase
    .from('user_tags')
    .select('id,name')
    .eq('user_id', currentUserId)
    .order('name');

  if (error) {
    tagMessage.textContent = 'Could not load tags.';
    return;
  }

  tagList.replaceChildren();
  for (const tag of data || []) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'track-tag';
    name.textContent = `#${tag.name}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'profile-tag-remove';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove tag ${tag.name}`);
    remove.addEventListener('click', () => removeTag(tag));
    item.append(name, remove);
    tagList.append(item);
  }
}

tagForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const name = tagInput.value.trim().replace(/^#+/, '').trim();
  if (!name) {
    tagMessage.textContent = 'Enter a tag name.';
    return;
  }

  const { error } = await supabase.from('user_tags').insert({ name });
  if (error) {
    tagMessage.textContent = error.code === '23505' ? 'That tag already exists.' : 'Could not add this tag.';
    return;
  }

  tagInput.value = '';
  tagMessage.textContent = 'Tag added.';
  await loadTags();
});

async function removeTag(tag) {
  if (!confirm(`Remove #${tag.name}? It will also be removed from any tracks using it.`)) return;
  const { error } = await supabase.from('user_tags').delete().eq('id', tag.id);
  tagMessage.textContent = error ? 'Could not remove this tag.' : 'Tag removed.';
  if (!error) await loadTags();
}

function scheduleProfileSave() {
  if (!message || !username || !globalPrompt) return;
  clearTimeout(saveTimer);
  const version = ++saveVersion;
  message.textContent = 'Unsaved changes';
  message.dataset.state = '';
  saveTimer = setTimeout(() => saveProfile(version), 600);
}

username?.addEventListener('input', scheduleProfileSave);
globalPrompt?.addEventListener('input', scheduleProfileSave);

async function saveProfile(version) {
  if (!message || !username || !globalPrompt) return;
  message.textContent = 'Saving…';
  const values = { display_name: username.value.trim() || null, global_prompt: globalPrompt.value.trim() };
  saveInFlight = saveInFlight.then(async () => {
    if (version !== saveVersion) return;
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return location.replace('auth.html');

    const { error } = await supabase
      .from('profiles')
      .update(values)
      .eq('id', user.id);

    if (version === saveVersion) {
      showMessage(error ? 'Could not save your profile.' : 'Changes saved.', Boolean(error));
    }
  }).catch(() => {
    if (version === saveVersion) showMessage('Could not save your profile.', true);
  });
  await saveInFlight;
}

function flushProfileSave() {
  if (message && message.textContent === 'Unsaved changes') {
    clearTimeout(saveTimer);
    saveProfile(++saveVersion);
  }
}

username?.addEventListener('blur', flushProfileSave);
globalPrompt?.addEventListener('blur', flushProfileSave);

/* Keep auth-bound fields read-only; edits go through Supabase under the signed-in user. */
document.getElementById('sign-out')?.addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) {
    event.currentTarget.disabled = false;
    showMessage('Could not sign out. Please try again.', true);
    return;
  }
  location.replace('auth.html');
});
