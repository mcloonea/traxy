import { supabase } from './supabase.js';

const searchInput = document.getElementById('track-search');
const tagFilter = document.getElementById('tag-filter');
const grid = document.getElementById('track-grid');
const empty = document.getElementById('library-empty');
const emptyTitle = document.getElementById('empty-title');
const emptyCopy = document.getElementById('empty-copy');
const status = document.getElementById('library-status');
const dialog = document.getElementById('track-dialog');
const form = document.getElementById('track-form');
const titleInput = document.getElementById('track-title');
const contentInput = document.getElementById('track-content');
const tagOptions = document.getElementById('track-tag-options');
const formMessage = document.getElementById('track-form-message');
const saveButton = document.getElementById('save-track');

let tracks = [];
let tags = [];
let trackTags = [];
let searchTimer;
let loadVersion = 0;

function setStatus(text, error = false) {
  status.textContent = text;
  status.dataset.state = error ? 'error' : '';
}

function renderTagOptions() {
  tagOptions.replaceChildren();
  if (!tags.length) {
    const message = document.createElement('p');
    message.textContent = 'No tags yet. Add tags in Profile to organize tracks.';
    tagOptions.append(message);
    return;
  }

  for (const tag of tags) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'tags';
    checkbox.value = tag.id;
    const text = document.createElement('span');
    text.textContent = `#${tag.name}`;
    label.append(checkbox, text);
    tagOptions.append(label);
  }
}

function render() {
  grid.replaceChildren();
  for (const track of tracks) {
    const card = document.createElement('article');
    card.className = 'track-card';
    const heading = document.createElement('h2');
    heading.textContent = track.title;
    const content = document.createElement('p');
    content.className = 'track-preview';
    content.textContent = track.content;
    const badges = document.createElement('div');
    badges.className = 'track-tags';

    for (const link of trackTags.filter(item => item.track_id === track.id)) {
      const tag = tags.find(item => item.id === link.tag_id);
      if (!tag) continue;
      const badge = document.createElement('span');
      badge.className = 'track-tag';
      badge.textContent = `#${tag.name}`;
      badges.append(badge);
    }

    card.append(heading, content, badges);
    grid.append(card);
  }

  const hasFilters = searchInput.value.trim() || tagFilter.value;
  empty.hidden = tracks.length > 0;
  if (tracks.length === 0) {
    emptyTitle.textContent = hasFilters ? 'No matching tracks' : 'No tracks yet';
    emptyCopy.textContent = hasFilters
      ? 'Try a different search or tag filter.'
      : 'Select New Track to add your first one.';
  }
  status.textContent = tracks.length ? `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}` : '';
}

async function loadTags() {
  const { data: tagData, error } = await supabase.from('user_tags').select('id,name').order('name');
  if (error) throw error;
  tags = tagData || [];
  tagFilter.replaceChildren(new Option('All tags', ''));
  for (const tag of tags) tagFilter.add(new Option(`#${tag.name}`, tag.id));
  renderTagOptions();
}

async function loadTracks() {
  const version = ++loadVersion;
  const queryText = searchInput.value.trim();
  const selectedTag = tagFilter.value;
  let matchingTrackIds;

  if (selectedTag) {
    const { data, error } = await supabase.from('word_track_tags').select('track_id').eq('tag_id', selectedTag);
    if (version !== loadVersion) return;
    if (error) {
      setStatus('Could not filter tracks. Please try again.', true);
      return;
    }
    matchingTrackIds = [...new Set((data || []).map(link => link.track_id))];
    if (!matchingTrackIds.length) {
      tracks = [];
      trackTags = [];
      render();
      return;
    }
  }

  let request = supabase
    .from('word_tracks')
    .select('id,title,content,updated_at')
    .order('updated_at', { ascending: false });
  if (queryText) request = request.textSearch('search_document', queryText, { type: 'websearch', config: 'english' });
  if (matchingTrackIds) request = request.in('id', matchingTrackIds);

  const { data, error } = await request;
  if (version !== loadVersion) return;
  if (error) {
    setStatus('Could not load the library. Please try again.', true);
    return;
  }

  tracks = data || [];
  if (tracks.length) {
    const { data: links, error: linkError } = await supabase
      .from('word_track_tags')
      .select('track_id,tag_id')
      .in('track_id', tracks.map(track => track.id));
    if (version !== loadVersion) return;
    if (linkError) {
      setStatus('Could not load track tags. Please try again.', true);
      return;
    }
    trackTags = links || [];
  } else {
    trackTags = [];
  }
  render();
}

async function loadLibrary() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return location.replace('auth.html');

  try {
    await loadTags();
    await loadTracks();
  } catch {
    setStatus('Could not load the library. Please try again.', true);
    empty.hidden = false;
    emptyTitle.textContent = 'Library unavailable';
    emptyCopy.textContent = 'Check your connection and reload this page.';
  }
}

document.getElementById('new-track-button').addEventListener('click', () => {
  form.reset();
  formMessage.textContent = '';
  renderTagOptions();
  dialog.showModal();
});

document.getElementById('close-track-dialog').addEventListener('click', () => dialog.close());
document.getElementById('cancel-track').addEventListener('click', () => dialog.close());
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTracks, 250);
});
tagFilter.addEventListener('change', loadTracks);

form.addEventListener('submit', async event => {
  event.preventDefault();
  saveButton.disabled = true;
  formMessage.textContent = 'Saving…';

  const { data, error } = await supabase
    .from('word_tracks')
    .insert({ title: titleInput.value.trim(), content: contentInput.value.trim() })
    .select('id')
    .single();

  if (error) {
    formMessage.textContent = 'Could not save the track. Please try again.';
    saveButton.disabled = false;
    return;
  }

  const selectedTagIds = [...tagOptions.querySelectorAll('input:checked')].map(input => input.value);
  if (selectedTagIds.length) {
    const { error: tagError } = await supabase.from('word_track_tags').insert(
      selectedTagIds.map(tag_id => ({ track_id: data.id, tag_id }))
    );
    if (tagError) {
      await loadLibrary();
      formMessage.textContent = 'Track saved, but its tags could not be added.';
      saveButton.disabled = false;
      return;
    }
  }

  dialog.close();
  saveButton.disabled = false;
  await loadTracks();
});

loadLibrary();
