import { supabase } from './supabase.js';

const period = document.getElementById('usage-period');
const status = document.getElementById('usage-status');
const metrics = document.getElementById('usage-metrics');
const trendCard = document.getElementById('usage-trend-card');
const breakdowns = document.getElementById('usage-breakdowns');
const onboardingCard = document.getElementById('onboarding-card');

const modelNames = {
  'gpt-6-luna': 'GPT-6 Luna',
  'gpt-6.1-sol': 'GPT-6.1 Sol',
  'gpt-6-astra': 'GPT-6 Astra'
};
const formatNumber = value => Number(value || 0).toLocaleString();
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const localDate = value => new Date(`${value}T12:00:00`);

function showEmpty(message) {
  status.textContent = message;
  metrics.hidden = true;
  trendCard.hidden = true;
  breakdowns.hidden = true;
}

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.append(cell);
}

function addEmptyRow(body, columns, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columns;
  cell.className = 'usage-table-empty';
  cell.textContent = message;
  row.append(cell);
  body.replaceChildren(row);
}

function renderUsage(rows) {
  const totals = rows.reduce((sum, row) => {
    sum.responses += 1;
    sum.input += row.input_tokens;
    sum.output += row.output_tokens;
    sum.total += row.total_tokens;
    return sum;
  }, { responses: 0, input: 0, output: 0, total: 0 });

  document.getElementById('usage-responses').textContent = formatNumber(totals.responses);
  document.getElementById('usage-total-tokens').textContent = formatNumber(totals.total);
  document.getElementById('usage-input-tokens').textContent = formatNumber(totals.input);
  document.getElementById('usage-output-tokens').textContent = formatNumber(totals.output);
  metrics.hidden = false;

  const days = Number(period.value);
  const daily = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    daily.set(dateKey(date), { responses: 0, input: 0, output: 0 });
  }
  const byModel = new Map();
  for (const row of rows) {
    const key = dateKey(new Date(row.created_at));
    const day = daily.get(key);
    if (day) {
      day.responses += 1;
      day.input += row.input_tokens;
      day.output += row.output_tokens;
    }
    const model = byModel.get(row.model) || { responses: 0, total: 0 };
    model.responses += 1;
    model.total += row.total_tokens;
    byModel.set(row.model, model);
  }

  const max = Math.max(1, ...[...daily.values()].map(day => day.responses));
  const chart = document.getElementById('usage-trend');
  chart.replaceChildren(...[...daily.entries()].map(([date, day]) => {
    const column = document.createElement('div');
    column.className = 'usage-day';
    const labelDate = localDate(date);
    column.title = `${labelDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${day.responses} ${day.responses === 1 ? 'response' : 'responses'}`;

    const bar = document.createElement('span');
    bar.className = 'usage-day-bar';
    bar.style.height = `${day.responses ? Math.max(8, (day.responses / max) * 100) : 2}%`;
    bar.setAttribute('aria-hidden', 'true');

    const label = document.createElement('small');
    label.textContent = days <= 7 || date.endsWith('-01') || date === [...daily.keys()].at(-1)
      ? labelDate.toLocaleDateString(undefined, { month: 'short', day: days <= 7 ? 'numeric' : undefined })
      : '';
    column.append(bar, label);
    return column;
  }));
  trendCard.hidden = false;

  const dailyRows = document.getElementById('usage-daily-rows');
  const activeDays = [...daily.entries()].filter(([, day]) => day.responses > 0).reverse();
  if (!activeDays.length) {
    addEmptyRow(dailyRows, 4, 'No activity in this period.');
  } else {
    dailyRows.replaceChildren(...activeDays.map(([date, day]) => {
      const row = document.createElement('tr');
      addCell(row, localDate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
      addCell(row, formatNumber(day.responses));
      addCell(row, formatNumber(day.input));
      addCell(row, formatNumber(day.output));
      return row;
    }));
  }

  const modelRows = document.getElementById('usage-model-rows');
  const modelEntries = [...byModel.entries()].sort((a, b) => b[1].total - a[1].total);
  if (!modelEntries.length) {
    addEmptyRow(modelRows, 3, 'No model usage in this period.');
  } else {
    modelRows.replaceChildren(...modelEntries.map(([model, usage]) => {
      const row = document.createElement('tr');
      addCell(row, modelNames[model] || model);
      addCell(row, formatNumber(usage.responses));
      addCell(row, formatNumber(usage.total));
      return row;
    }));
  }
  breakdowns.hidden = false;
  status.textContent = totals.responses ? '' : `No AI activity in the last ${days} days.`;
}

async function loadOnboarding(user) {
  const [profileResult, tracksResult, usageResult] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase.from('word_tracks').select('id', { count: 'exact', head: true }),
    supabase.from('ai_usage').select('id', { count: 'exact', head: true })
  ]);
  if (profileResult.error || tracksResult.error || usageResult.error) {
    onboardingCard.hidden = true;
    return;
  }

  const metadataName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name.trim() : '';
  const hasName = Boolean(profileResult.data?.display_name?.trim() || metadataName);
  const hasTracks = (tracksResult.count || 0) >= 3;
  const hasReply = (usageResult.count || 0) > 0;
  const steps = [
    ['onboarding-profile', hasName],
    ['onboarding-tracks', hasTracks],
    ['onboarding-reply', hasReply]
  ];
  const completed = steps.filter(([, done]) => done).length;
  document.getElementById('onboarding-progress').textContent = `${completed} of ${steps.length} steps complete`;
  for (const [id, done] of steps) {
    const item = document.getElementById(id);
    item.dataset.complete = String(done);
    item.setAttribute('aria-label', `${item.querySelector('strong').textContent}${done ? ', complete' : ', not complete'}`);
  }
  onboardingCard.hidden = completed === steps.length;
}

async function loadUsage() {
  status.textContent = 'Loading your usage…';
  metrics.hidden = true;
  trendCard.hidden = true;
  breakdowns.hidden = true;

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    showEmpty('Sign in to see your usage.');
    document.getElementById('usage-person').textContent = 'Usage is private to your account.';
    onboardingCard.hidden = true;
    return;
  }

  const { data: profile } = await supabase.from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  const name = profile?.display_name || user.user_metadata?.name || user.email?.split('@')[0] || 'You';
  document.getElementById('usage-person').textContent = `${name} · ${user.email || 'Signed-in account'}`;
  await loadOnboarding(user);

  const start = new Date();
  start.setDate(start.getDate() - Number(period.value) + 1);
  start.setHours(0, 0, 0, 0);
  const rows = [];
  let complete = false;
  for (let offset = 0; offset <= 50_000; offset += 1_000) {
    const { data, error } = await supabase.from('ai_usage')
      .select('id,created_at,model,input_tokens,output_tokens,total_tokens')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) {
      showEmpty('Could not load usage right now. Please refresh and try again.');
      return;
    }
    rows.push(...(data || []));
    if (!data || data.length < 1_000) {
      complete = true;
      break;
    }
  }
  if (!complete) {
    showEmpty('There is too much activity in this period to display. Choose a shorter period.');
    return;
  }
  renderUsage(rows);
}

period.addEventListener('change', () => loadUsage().catch(() => showEmpty('Could not load usage right now. Please refresh and try again.')));
loadUsage().catch(() => showEmpty('Could not load usage right now. Please refresh and try again.'));
