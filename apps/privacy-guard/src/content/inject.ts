// MAIN-world entry, injected at document_start (before page scripts run).
//
// Two-phase design solves the document_start timing problem: the per-origin
// salt lives in the service worker (async, via chrome.storage) and cannot be
// read synchronously here. So we INSTALL all hooks immediately (synchronously,
// before any page script), but the hooks read a *mutable* config that the bridge
// fills in a tick later over window.postMessage. Real fingerprinting calls fire
// well after load, by which point the seed is in place. Until config arrives the
// hooks no-op (isEnabled() === false), so we never break or noise the page using
// a wrong seed.
import { originSeed } from '../core/seed';
import type { ConfigMessage, FpEventMessage, FpSurface, InjectConfig } from '../types';
import type { SpoofCtx } from '../core/spoof/common';
import { installCanvas } from '../core/spoof/canvas';
import { installWebGL } from '../core/spoof/webgl';
import { installAudio } from '../core/spoof/audio';
import { installNavigator } from '../core/spoof/navigator';
import { installScreen } from '../core/spoof/screen';
import { installFonts } from '../core/spoof/fonts';

const state = {
  config: null as InjectConfig | null,
  seed: 0,
  counts: { canvas: 0, webgl: 0, audio: 0, navigator: 0, screen: 0, fonts: 0 } as Record<
    FpSurface,
    number
  >,
};

function isEnabled(): boolean {
  return !!state.config && state.config.enabled && state.config.level !== 'off';
}

// Throttle outbound signal posts so a canvas-heavy page can't flood the bridge.
const pending = new Set<FpSurface>();
let flushScheduled = false;
function report(surface: FpSurface): void {
  state.counts[surface]++;
  pending.add(surface);
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    for (const s of pending) {
      const msg: FpEventMessage = {
        source: 'pg-inject',
        type: 'fp-attempt',
        surface: s,
        count: state.counts[s],
      };
      window.postMessage(msg, '*');
    }
    pending.clear();
  }, 250);
}

const ctx: SpoofCtx = {
  get originSeed() {
    return state.seed;
  },
  get level() {
    return state.config?.level ?? 'balanced';
  },
  report,
  isEnabled,
};

// Install hooks NOW. They sit dormant until config + seed arrive.
// navigator/screen rewrite property descriptors and must run before page reads;
// they internally bail when isEnabled() is false, and we re-run the value-based
// ones once enabled below.
installCanvas(ctx);
installWebGL(ctx);
installAudio(ctx);
installFonts(ctx);

// Receive config (seed material + level) from the ISOLATED-world bridge.
window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const data = ev.data as ConfigMessage;
  if (!data || data.source !== 'pg-bridge' || data.type !== 'config') return;
  state.config = data.config;
  state.seed = originSeed(data.config.origin, data.config.sessionSalt);
  if (isEnabled()) {
    // These two rewrite descriptors using the now-known seed; safe to apply once.
    installNavigator(ctx);
    installScreen(ctx);
  }
});
