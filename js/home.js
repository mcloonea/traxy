import { supabase } from './supabase.js';

const period = document.getElementById('usage-period');
const status = document.getElementById('usage-status');
const metrics = document.getElementById('usage-metrics');
const trendCard = document.getElementById('usage-trend-card');

const formatNumber = value => Number(value || 0).toLocaleString();
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function showEmpty(message) {
  status.textContent = message;
  metrics.hidden = true;
  trendCard.hidden = true;
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
    daily.set(dateKey(date), 0);
  }
  for (const row of rows) {
    const key = dateKey(new Date(row.created_at));
    if (daily.has(key)) daily.set(key, daily.get(key) + 1);
  }

  const max = Math.max(1, ...daily.values());
  const chart = document.getElementById('usage-trend');
  chart.replaceChildren(...[...daily.entries()].map(([date, count]) => {
    const column = document.createElement('div');
    column.className = 'usage-day';
    const localDate = new Date(`${date}T12:00:00`);
    column.title = `${localDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${count} ${count === 1 ? 'response' : 'responses'}`;

    const bar = document.createElement('span');
    bar.className = 'usage-day-bar';
    bar.style.height = `${count ? Math.max(8, (count / max) * 100) : 2}%`;
    bar.setAttribute('aria-hidden', 'true');

    const label = document.createElement('small');
    label.textContent = days <= 7 || date.endsWith('-01') || date === [...daily.keys()].at(-1)
      ? localDate.toLocaleDateString(undefined, { month: 'short', day: days <= 7 ? 'numeric' : undefined })
      : '';
    column.append(bar, label);
    return column;
  }));
  trendCard.hidden = false;
  status.textContent = totals.responses ? '' : `No AI activity in the last ${days} days.`;
}

async function loadUsage() {
  status.textContent = 'Loading your usage…';
  metrics.hidden = true;
  trendCard.hidden = true;

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    showEmpty('Sign in to see your usage.');
    const person = document.getElementById('usage-person');
    person.textContent = 'Usage is private to your account.';
    return;
  }

  const { data: profile } = await supabase.from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  const name = profile?.display_name || user.user_metadata?.name || user.email?.split('@')[0] || 'You';
  document.getElementById('usage-person').textContent = `${name} · ${user.email || 'Signed-in account'}`;

  const start = new Date();
  start.setDate(start.getDate() - Number(period.value) + 1);
  start.setHours(0, 0, 0, 0);
  const { data, error } = await supabase.from('ai_usage')
    .select('created_at,input_tokens,output_tokens,total_tokens')
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    showEmpty('Could not load usage right now. Please refresh and try again.');
    return;
  }
  renderUsage(data || []);
}

period.addEventListener('change', loadUsage);
loadUsage().catch(() => showEmpty('Could not load usage right now. Please refresh and try again.'));
