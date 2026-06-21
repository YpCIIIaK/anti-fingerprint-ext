// Options page: default protection level + allowlist management.
import type { Settings } from '../../types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<Settings> {
  return (await chrome.runtime.sendMessage({ type: 'get-settings' })) as Settings;
}

async function save(settings: Settings): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'set-settings', settings });
}

function normalizeOrigin(raw: string): string | null {
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

async function render(): Promise<void> {
  const settings = await load();
  ($('level') as HTMLSelectElement).value = settings.level;

  const list = $('allowlist');
  list.innerHTML = '';
  if (settings.allowlist.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No sites allowlisted.';
    list.appendChild(li);
  }
  for (const origin of settings.allowlist) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = origin;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      const s = await load();
      s.allowlist = s.allowlist.filter((o) => o !== origin);
      await save(s);
      render();
    });
    li.append(span, btn);
    list.appendChild(li);
  }
}

interface HistoryEntry {
  origin: string;
  score: number;
  grade: string;
  trackersBlocked: number;
  fpTotal: number;
  visits: number;
}

async function renderHistory(): Promise<void> {
  const history = (await chrome.runtime.sendMessage({
    type: 'get-history',
  })) as HistoryEntry[];
  const body = $('history');
  body.innerHTML = '';
  if (!history || history.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No history yet.</td></tr>';
    return;
  }
  for (const h of history) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="origin" title="${h.origin}">${h.origin.replace(/^https?:\/\//, '')}</td>` +
      `<td><span class="g ${h.grade}">${h.grade}</span></td>` +
      `<td>${h.score}</td><td>${h.trackersBlocked}</td><td>${h.fpTotal}</td><td>${h.visits}</td>`;
    body.appendChild(tr);
  }
}

interface Stats {
  trackersBlockedTotal: number;
  fpProbesTotal: number;
  topTrackers: Record<string, number>;
  sitesProtected: number;
  since: number;
}

async function renderStats(): Promise<void> {
  const s = (await chrome.runtime.sendMessage({ type: 'get-stats' })) as Stats;
  $('stTrackers').textContent = s.trackersBlockedTotal.toLocaleString();
  $('stProbes').textContent = s.fpProbesTotal.toLocaleString();
  $('stSites').textContent = s.sitesProtected.toLocaleString();
  $('stSince').textContent = `Since ${new Date(s.since).toLocaleDateString()}`;

  const top = Object.entries(s.topTrackers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const max = top[0]?.[1] ?? 1;
  const list = $('topTrackers');
  list.innerHTML = '';
  if (top.length === 0) {
    list.innerHTML = '<li class="empty">No trackers blocked yet.</li>';
    return;
  }
  for (const [domain, count] of top) {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="row"><span class="name" title="${domain}">${domain}</span><span>${count}</span></div>` +
      `<div class="track"><div class="fill" style="width:${Math.round((count / max) * 100)}%"></div></div>`;
    list.appendChild(li);
  }
}

$('clearStats').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear-stats' });
  renderStats();
});

$('clearHistory').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear-history' });
  renderHistory();
});

$('level').addEventListener('change', async (e) => {
  const s = await load();
  s.level = (e.target as HTMLSelectElement).value as Settings['level'];
  await save(s);
});

$('add').addEventListener('click', async () => {
  const input = $('newOrigin') as HTMLInputElement;
  const origin = normalizeOrigin(input.value.trim());
  if (!origin) {
    input.focus();
    return;
  }
  const s = await load();
  if (!s.allowlist.includes(origin)) s.allowlist.push(origin);
  await save(s);
  input.value = '';
  render();
});

render();
renderHistory();
renderStats();
