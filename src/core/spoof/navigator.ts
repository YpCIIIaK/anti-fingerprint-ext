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

  const nav = Navigator.prototype;
  wrapAccessor(nav, 'hardwareConcurrency', cores);
  wrapAccessor(nav, 'deviceMemory', memory);

  // languages: pin to a stable common pair; reading it counts as a probe.
  defineValue(navigator, 'languages', Object.freeze(['en-US', 'en']));

  function wrapAccessor(proto: object, prop: string, value: number) {
    try {
      Object.defineProperty(proto, prop, {
        get() {
          ctx.report('navigator');
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
