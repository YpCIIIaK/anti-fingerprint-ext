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
  const probe = <T>(v: T): T => {
    ctx.report('screen');
    return v;
  };

  try {
    const s = window.screen;
    defineValue(s, 'width', probe(round(s.width)));
    defineValue(s, 'height', probe(round(s.height)));
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
