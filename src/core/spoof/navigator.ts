import { streamFor } from '../prng';
import { defineValue, type SpoofCtx } from './common';

/**
 * navigator spoof: normalise the high-entropy hardware/locale signals to
 * common-but-seed-stable values. Reading any of these is treated as a probe.
 * We keep the values plausible (real-world common configurations) so sites
 * don't trip anti-bot heuristics.
 */
export function installNavigator(ctx: SpoofCtx): void {
  const rng = streamFor(ctx.originSeed, 'navigator');
  if (!ctx.isEnabled()) return;

  const cores = [4, 8, 12, 16][Math.floor(rng() * 4)];
  const memory = [4, 8, 16][Math.floor(rng() * 3)];

  // Count the navigator surface at most once: these properties are read
  // routinely (e.g. to size worker pools), so per-access counting inflates the
  // score with false positives.
  let reported = false;
  const probe = () => {
    if (!reported) {
      reported = true;
      ctx.report('navigator');
    }
  };

  const nav = Navigator.prototype;
  wrapAccessor(nav, 'hardwareConcurrency', cores);
  wrapAccessor(nav, 'deviceMemory', memory);

  // languages: pin to a stable common pair (spoofed silently).
  defineValue(navigator, 'languages', Object.freeze(['en-US', 'en']));

  function wrapAccessor(proto: object, prop: string, value: number) {
    try {
      Object.defineProperty(proto, prop, {
        get() {
          probe();
          return value;
        },
        configurable: true,
        enumerable: true,
      });
    } catch {
      /* non-configurable on some props */
    }
  }
}
