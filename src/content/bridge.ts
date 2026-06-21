// ISOLATED-world content script. The trust broker between the page (MAIN world,
// no chrome.* access) and the service worker. It:
//   1. asks the SW for this origin's config (level + session salt + enabled),
//   2. forwards that config to inject.ts over window.postMessage,
//   3. relays fingerprint-attempt signals from inject.ts up to the SW.
import type {
  ConfigMessage,
  FpEventMessage,
  InjectConfig,
  RuntimeMessage,
} from '../types';

const origin = location.origin;

function send<T = unknown>(msg: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

// 1 + 2: fetch config and push it to the MAIN world.
send<InjectConfig>({ type: 'get-config', origin, url: location.href })
  .then((config) => {
    const msg: ConfigMessage = { source: 'pg-bridge', type: 'config', config };
    window.postMessage(msg, '*');
  })
  .catch(() => {
    // SW not ready / extension reloading — fall back to a safe default so the
    // page world still gets a seed and basic protection.
    const fallback: InjectConfig = {
      enabled: true,
      level: 'balanced',
      origin,
      sessionSalt: 'fallback-salt',
    };
    window.postMessage(
      { source: 'pg-bridge', type: 'config', config: fallback } as ConfigMessage,
      '*'
    );
  });

// 3: relay fingerprint signals from inject → SW.
window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const data = ev.data as FpEventMessage;
  if (!data || data.source !== 'pg-inject' || data.type !== 'fp-attempt') return;
  send({ type: 'fp-attempt', surface: data.surface, count: data.count }).catch(
    () => {}
  );
});
