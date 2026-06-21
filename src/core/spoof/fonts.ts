import { makeNativeLike, type SpoofCtx } from './common';

/**
 * Font-enumeration spoof: sites detect installed fonts by measuring text widths
 * (measureText / offsetWidth) across many font-family fallbacks and diffing the
 * results. We add a deterministic sub-pixel jitter to measureText width and to
 * getClientRects geometry, keyed by the origin seed, so the per-font deltas no
 * longer reveal a stable installed-font set. Jitter is < 0.1px — invisible to
 * real layout but enough to defeat exact-width comparison.
 */
export function installFonts(ctx: SpoofCtx): void {
  // Per-string stable jitter: hash the measured text so the same string always
  // gets the same nudge (deterministic) but different strings differ.
  function jitterFor(key: string): number {
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = (h * 33) ^ key.charCodeAt(i);
    const r = (((h ^ ctx.originSeed) >>> 0) % 1000) / 1000; // [0,1)
    return (r * 2 - 1) * 0.05; // ±0.05px
  }

  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.measureText;
  proto.measureText = makeNativeLike(function (
    this: CanvasRenderingContext2D,
    text: string
  ) {
    const m = orig.call(this, text);
    if (!ctx.isEnabled()) return m;
    ctx.report('fonts');
    const d = jitterFor(`${this.font}|${text}`);
    const base = m.width;
    // Return a proxy so .width is jittered but the rest of TextMetrics is intact.
    return new Proxy(m, {
      get(target, prop, recv) {
        if (prop === 'width') return base + d;
        const val = Reflect.get(target, prop, recv);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  },
  'measureText') as typeof orig;

  // getClientRects jitter — used by the offsetWidth-based variant.
  const origRects = Element.prototype.getClientRects;
  Element.prototype.getClientRects = makeNativeLike(function (this: Element) {
    const list = origRects.call(this);
    if (!ctx.isEnabled() || list.length === 0) return list;
    ctx.report('fonts');
    const d = jitterFor(this.textContent ?? '');
    // DOMRectList is read-only; hand back jittered DOMRects in a proxied list.
    const rects = Array.from(list).map((r) =>
      new DOMRect(r.x, r.y, r.width + d, r.height)
    );
    return makeRectList(rects);
  },
  'getClientRects') as typeof origRects;

  function makeRectList(rects: DOMRect[]): DOMRectList {
    const list: any = { length: rects.length, item: (i: number) => rects[i] ?? null };
    rects.forEach((r, i) => (list[i] = r));
    list[Symbol.iterator] = function* () {
      yield* rects;
    };
    return list as DOMRectList;
  }
}
