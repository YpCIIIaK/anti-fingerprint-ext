// MV3 service worker. Stateless by design: the worker can be killed at any time,
// so all state lives in chrome.storage.session (per-session, in-memory, fast) and
// chrome.storage.local (durable settings). Per-tab signals are keyed by tabId.
import {
  DEFAULT_SETTINGS,
  emptyFpAttempts,
  type FpSurface,
  type InjectConfig,
  type RuntimeMessage,
  type Settings,
  type TabSignals,
} from '../types';
import { computeScore } from '../core/score';

const SALT_KEY = 'pg_session_salt';
const SETTINGS_KEY = 'pg_settings';
const HISTORY_KEY = 'pg_history';
const STATS_KEY = 'pg_stats';
const tabKey = (id: number) => `pg_tab_${id}`;

/** Lifetime aggregate metrics shown on the dashboard. */
interface GlobalStats {
  trackersBlockedTotal: number;
  fpProbesTotal: number;
  topTrackers: Record<string, number>;
  since: number;
}

function emptyStats(): GlobalStats {
  return { trackersBlockedTotal: 0, fpProbesTotal: 0, topTrackers: {}, since: Date.now() };
}

async function getStats(): Promise<GlobalStats> {
  const got = await chrome.storage.local.get(STATS_KEY);
  return { ...emptyStats(), ...(got[STATS_KEY] as GlobalStats | undefined) };
}

async function updateStats(fn: (s: GlobalStats) => void): Promise<void> {
  const stats = await getStats();
  fn(stats);
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

/** Per-origin history record shown in Options. */
interface HistoryEntry {
  origin: string;
  score: number;
  grade: string;
  trackersBlocked: number;
  fpTotal: number;
  ts: number;
  visits: number;
}

// ---- session salt --------------------------------------------------------

async function getSessionSalt(): Promise<string> {
  const got = await chrome.storage.session.get(SALT_KEY);
  if (got[SALT_KEY]) return got[SALT_KEY] as string;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await chrome.storage.session.set({ [SALT_KEY]: salt });
  return salt;
}

// ---- settings ------------------------------------------------------------

async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(got[SETTINGS_KEY] as Settings | undefined) };
}

async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

// Enable/disable the static tracker ruleset to honour the global master switch.
async function applyTrackerBlocking(settings: Settings): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      settings.enabled
        ? { enableRulesetIds: ['trackers'] }
        : { disableRulesetIds: ['trackers'] }
    );
  } catch {
    /* ruleset already in desired state */
  }
}

function isAllowlisted(settings: Settings, origin: string): boolean {
  return settings.allowlist.includes(origin);
}

// ---- per-site tracker exceptions → dynamic "allow" rules -----------------
// Re-enabling a blocked tracker on a site means letting requests through *only*
// for that site. We model each exception as a dynamic dNR allow rule with a
// higher priority than the static block rules.
const DYNAMIC_BASE_ID = 10000;

async function syncDynamicRules(settings: Settings): Promise<void> {
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = DYNAMIC_BASE_ID;
  for (const [siteHost, domains] of Object.entries(settings.perSiteAllow)) {
    for (const domain of domains) {
      rules.push({
        id: id++,
        priority: 2, // beats the static block rules (priority 1)
        action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
        condition: {
          requestDomains: [domain],
          initiatorDomains: [siteHost],
        },
      });
    }
  }
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

// Keep dynamic rules in sync with settings across SW restarts.
async function applyGlobalState(): Promise<void> {
  const settings = await getSettings();
  await syncDynamicRules(settings);
  await applyTrackerBlocking(settings);
}
chrome.runtime.onStartup.addListener(applyGlobalState);
chrome.runtime.onInstalled.addListener(applyGlobalState);

// ---- per-tab signal state -----------------------------------------------

async function getTab(tabId: number): Promise<TabSignals | undefined> {
  const got = await chrome.storage.session.get(tabKey(tabId));
  return got[tabKey(tabId)] as TabSignals | undefined;
}

async function setTab(tabId: number, signals: TabSignals): Promise<void> {
  await chrome.storage.session.set({ [tabKey(tabId)]: signals });
}

function freshSignals(url: string): TabSignals {
  let origin = '';
  let isHttps = false;
  try {
    const u = new URL(url);
    origin = u.origin;
    isHttps = u.protocol === 'https:';
  } catch {
    /* about:, chrome:, etc. */
  }
  return {
    url,
    origin,
    isHttps,
    fpAttempts: emptyFpAttempts(),
    trackersBlocked: 0,
    blocked: {},
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ---- per-site history (durable) -----------------------------------------

async function recordHistory(signals: TabSignals): Promise<void> {
  if (!signals.origin) return;
  const { score, grade } = computeScore(signals);
  const fp = signals.fpAttempts;
  const fpTotal = fp.canvas + fp.webgl + fp.audio + fp.navigator + fp.screen + fp.fonts;

  const got = await chrome.storage.local.get(HISTORY_KEY);
  const history: Record<string, HistoryEntry> = got[HISTORY_KEY] ?? {};
  const prev = history[signals.origin];
  history[signals.origin] = {
    origin: signals.origin,
    score,
    grade,
    trackersBlocked: signals.trackersBlocked,
    fpTotal,
    ts: Date.now(),
    visits: prev?.visits ?? 1, // bumped on navigation, see onCommitted
  };
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

async function bumpVisit(origin: string): Promise<void> {
  if (!origin) return;
  const got = await chrome.storage.local.get(HISTORY_KEY);
  const history: Record<string, HistoryEntry> = got[HISTORY_KEY] ?? {};
  if (history[origin]) {
    history[origin].visits += 1;
    history[origin].ts = Date.now();
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  }
}

// ---- badge ---------------------------------------------------------------

async function refreshBadge(tabId: number): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#6e7781' });
    await chrome.action.setBadgeText({ tabId, text: 'off' });
    await chrome.action.setTitle({ tabId, title: 'Privacy Guard — protection paused' });
    return;
  }
  const signals = await getTab(tabId);
  if (!signals || !signals.origin) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const { score, grade } = computeScore(signals);
  const color = score >= 75 ? '#1a7f37' : score >= 50 ? '#bf8700' : '#cf222e';
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text: grade });
  await chrome.action.setTitle({
    tabId,
    title: `Privacy Guard — ${grade} (${score}/100)`,
  });
}

// ---- lifecycle: reset signals on navigation -----------------------------

chrome.webNavigation?.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top frame only
  const signals = freshSignals(details.url);
  await setTab(details.tabId, signals);
  await bumpVisit(signals.origin);
  await refreshBadge(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(tabKey(tabId));
});

// ---- tracker blocking: count dNR matches per tab ------------------------
// onRuleMatchedDebug fires for unpacked extensions (declarativeNetRequestFeedback
// permission). Each match = one blocked third-party tracker request.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (info) => {
  const tabId = info.request.tabId;
  if (typeof tabId !== 'number' || tabId < 0) return;
  const signals = (await getTab(tabId)) ?? freshSignals(info.request.url);
  signals.trackersBlocked += 1;
  const domain = hostOf(info.request.url);
  if (domain) signals.blocked[domain] = (signals.blocked[domain] ?? 0) + 1;
  await updateStats((s) => {
    s.trackersBlockedTotal += 1;
    if (domain) s.topTrackers[domain] = (s.topTrackers[domain] ?? 0) + 1;
  });
  await setTab(tabId, signals);
  await recordHistory(signals);
  await refreshBadge(tabId);
});

// ---- message router ------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse);
  return true; // keep the channel open for the async response
});

async function handle(
  msg: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (msg.type) {
    case 'get-config': {
      const [salt, settings] = await Promise.all([getSessionSalt(), getSettings()]);
      const enabled =
        settings.enabled &&
        !isAllowlisted(settings, msg.origin) &&
        settings.level !== 'off';
      // Seed this tab's signal record if the navigation hook hasn't yet.
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number' && !(await getTab(tabId))) {
        await setTab(tabId, freshSignals(msg.url));
        await refreshBadge(tabId);
      }
      const config: InjectConfig = {
        enabled,
        level: settings.level,
        origin: msg.origin,
        sessionSalt: salt,
      };
      return config;
    }

    case 'fp-attempt': {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return { ok: false };
      const signals = (await getTab(tabId)) ?? freshSignals(sender.tab?.url ?? '');
      // inject sends the absolute per-surface count → store the max we've seen,
      // and add the positive delta to the lifetime probe counter.
      const prev = signals.fpAttempts[msg.surface as FpSurface];
      const next = Math.max(prev, msg.count);
      signals.fpAttempts[msg.surface as FpSurface] = next;
      if (next > prev) await updateStats((s) => (s.fpProbesTotal += next - prev));
      await setTab(tabId, signals);
      await recordHistory(signals);
      await refreshBadge(tabId);
      return { ok: true };
    }

    case 'get-tab-state': {
      const tabId =
        msg.tabId ??
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (typeof tabId !== 'number') return null;
      const signals = await getTab(tabId);
      if (!signals) return null;
      return { signals, ...computeScore(signals) };
    }

    case 'get-settings':
      return getSettings();

    case 'set-settings': {
      await setSettings(msg.settings);
      await applyTrackerBlocking(msg.settings);
      await syncDynamicRules(msg.settings);
      // Reflect the (possibly paused) state on every open tab's badge.
      const tabs = await chrome.tabs.query({});
      await Promise.all(
        tabs.map((t) => (typeof t.id === 'number' ? refreshBadge(t.id) : null))
      );
      return { ok: true };
    }

    case 'get-history': {
      const got = await chrome.storage.local.get(HISTORY_KEY);
      const history: Record<string, HistoryEntry> = got[HISTORY_KEY] ?? {};
      return Object.values(history).sort((a, b) => b.ts - a.ts);
    }

    case 'clear-history':
      await chrome.storage.local.remove(HISTORY_KEY);
      return { ok: true };

    case 'get-stats': {
      const [stats, historyObj] = await Promise.all([
        getStats(),
        chrome.storage.local.get(HISTORY_KEY),
      ]);
      const sitesProtected = Object.keys(historyObj[HISTORY_KEY] ?? {}).length;
      return { ...stats, sitesProtected };
    }

    case 'clear-stats':
      await chrome.storage.local.remove(STATS_KEY);
      return { ok: true };

    case 'set-tracker-exception': {
      const settings = await getSettings();
      const list = new Set(settings.perSiteAllow[msg.siteHost] ?? []);
      if (msg.allow) list.add(msg.domain);
      else list.delete(msg.domain);
      if (list.size) settings.perSiteAllow[msg.siteHost] = [...list];
      else delete settings.perSiteAllow[msg.siteHost];
      await setSettings(settings);
      await syncDynamicRules(settings);
      return { ok: true };
    }
  }
}
