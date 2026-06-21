import { defineValue, type SpoofCtx } from './common';

/**
 * screen spoof: round screen dimensions to coarse buckets and zero out the
 * window chrome offsets (availTop/availLeft) that leak OS taskbar geometry.
 * Rounding shrinks the entropy of the screen surface without breaking layout
 * (pages use innerWidth/innerHeight for that, which we leave alone).
 */
export function installScreen(ctx: SpoofCtx): void {
  if (!ctx.isEnabled()) return;

  const round = (v: number) => Math.round(v / 100) * 100;
  let reported = false;

  try {
    const s = window.screen;
    // width/height are the high-entropy reads → count a probe lazily, once, only
    // if the page actually accesses them (reading screen size is near-universal,
    // so eager/repeated counting would be a false positive).
    for (const prop of ['width', 'height'] as const) {
      const value = round(s[prop]);
      Object.defineProperty(s, prop, {
        get() {
          if (!reported) {
            reported = true;
            ctx.report('screen');
          }
          return value;
        },
        configurable: true,
        enumerable: true,
      });
    }
    // The rest are normalised silently (low entropy, not worth flagging).
    defineValue(s, 'availWidth', round(s.availWidth));
    defineValue(s, 'availHeight', round(s.availHeight));
    defineValue(s, 'availLeft', 0);
    defineValue(s, 'availTop', 0);
    defineValue(s, 'colorDepth', 24);
    defineValue(s, 'pixelDepth', 24);
  } catch {
    /* ignore */
  }
}
