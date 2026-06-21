// Popup: render the active tab's Privacy Score + breakdown and expose the
// per-site level / allowlist controls.
import type { ScoreResult } from '../../core/score';
import type { Settings, TabSignals } from '../../types';

interface TabState extends ScoreResult {
  signals: TabSignals;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function originOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').origin;
  } catch {
    return '';
  }
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}

// Render the blocked-tracker list with a per-domain protection toggle. ON =
// blocked (protected); turning it OFF allows that tracker *only on this site*.
function renderBlocked(
  signals: TabSignals,
  siteHost: string,
  allowed: string[]
): void {
  const list = $('blocked');
  list.innerHTML = '';
  const allowedSet = new Set(allowed);
  // Combine currently-blocked domains with already-allowed ones (the latter no
  // longer appear in `blocked`, but the user must be able to re-block them).
  const domains = new Set<string>([...Object.keys(signals.blocked), ...allowed]);
  if (domains.size === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nothing blocked on this page.';
    list.appendChild(li);
    return;
  }
  for (const domain of [...domains].sort()) {
    const count = signals.blocked[domain] ?? 0;
    const isAllowed = allowedSet.has(domain);
    const li = document.createElement('li');

    const left = document.createElement('span');
    left.innerHTML = `<span class="bd-name" title="${domain}">${domain}</span>${count ? ` <span class="bd-count">×${count}</span>` : ' <span class="bd-count">(allowed)</span>'}`;

    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !isAllowed; // checked = blocked/protected
    input.addEventListener('change', async () => {
      await chrome.runtime.sendMessage({
        type: 'set-tracker-exception',
        siteHost,
        domain,
        allow: !input.checked, // unchecked → allow the tracker
      });
      await chrome.tabs.reload();
      window.close();
    });
    const slider = document.createElement('span');
    slider.className = 'slider';
    label.append(input, slider);

    li.append(left, label);
    list.appendChild(li);
  }
}

async function render(): Promise<void> {
  const tab = await activeTab();
  const origin = originOf(tab?.url);
  $('origin').textContent = origin || '—';

  const [state, settings] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'get-tab-state', tabId: tab?.id }) as Promise<
      TabState | null
    >,
    chrome.runtime.sendMessage({ type: 'get-settings' }) as Promise<Settings>,
  ]);

  // Score panel
  const grade = $('grade');
  if (state) {
    grade.textContent = state.grade;
    grade.className = `grade grade--${state.grade}`;
    $('scoreNum').textContent = `${state.score}/100`;
  } else {
    grade.textContent = '–';
    grade.className = 'grade grade--na';
    $('scoreNum').textContent = '—';
  }

  // Controls
  ($('level') as HTMLSelectElement).value = settings.level;
  const allowed = origin ? settings.allowlist.includes(origin) : false;
  const allowBtn = $('allowToggle') as HTMLButtonElement;
  allowBtn.textContent = allowed ? 'Allowlisted ✓' : 'Allowlist this site';
  allowBtn.classList.toggle('active', allowed);
  allowBtn.disabled = !origin;

  // Breakdown
  const list = $('breakdown');
  list.innerHTML = '';
  const items = state?.breakdown ?? [];
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = state ? 'No privacy issues detected yet.' : 'No data for this page.';
    list.appendChild(li);
  } else {
    for (const item of items) {
      const li = document.createElement('li');
      li.innerHTML = `<span><span class="bi-label">${item.label}</span><br><span class="bi-detail">${item.detail}</span></span><span class="bi-pen ${item.penalty === 0 ? 'zero' : ''}">${item.penalty === 0 ? '✓' : '−' + item.penalty}</span>`;
      list.appendChild(li);
    }
  }

  // Blocked-tracker list with per-domain re-enable toggles
  const siteHost = hostOf(tab?.url);
  const allowedHere = settings.perSiteAllow[siteHost] ?? [];
  if (state) renderBlocked(state.signals, siteHost, allowedHere);
  else $('blocked').innerHTML = '<li class="empty">No data for this page.</li>';
}

// ---- wiring --------------------------------------------------------------

$('level').addEventListener('change', async (e) => {
  const level = (e.target as HTMLSelectElement).value as Settings['level'];
  const settings = (await chrome.runtime.sendMessage({
    type: 'get-settings',
  })) as Settings;
  settings.level = level;
  await chrome.runtime.sendMessage({ type: 'set-settings', settings });
  await chrome.tabs.reload();
  window.close();
});

$('allowToggle').addEventListener('click', async () => {
  const tab = await activeTab();
  const origin = originOf(tab?.url);
  if (!origin) return;
  const settings = (await chrome.runtime.sendMessage({
    type: 'get-settings',
  })) as Settings;
  const i = settings.allowlist.indexOf(origin);
  if (i >= 0) settings.allowlist.splice(i, 1);
  else settings.allowlist.push(origin);
  await chrome.runtime.sendMessage({ type: 'set-settings', settings });
  await chrome.tabs.reload();
  window.close();
});

$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
