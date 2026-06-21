import { makeNativeLike, type SpoofCtx } from './common';

/**
 * Font-enumeration spoof: sites detect installed fonts by measuring text widths
 * (measureText / offsetWidth) across many font-family fallbacks and diffing the
 * results. We add a deterministic sub-pixel jitter to measureText width and to
 * getClientRects geometry, keyed by the origin seed, so the per-font deltas no
 * longer reveal a stable installed-font set. Jitter is < 0.1px — invisible to
 * real layout but enough to defeat exact-width comparison.
 */
// Genuine font-enumeration fingerprinting cycles through MANY distinct
// font-families (libraries probe 50+). Ordinary layout uses a handful of
// families across various sizes/weights. We only flag a *probe* once enough
// DISTINCT families have been measured, so benign measureText/getClientRects
// for layout no longer counts as a fingerprint attempt. Jitter is applied
// regardless — protection never depends on detection.
const ENUM_FAMILY_THRESHOLD = 8;

/** Extract the first font-family from a CSS font shorthand, normalised. */
function familyOf(font: string): string {
  const m = font.match(/(?:\d*\.?\d+)(?:px|pt|em|rem|%)\s+(.*)$/);
  return (m ? m[1] : font)
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();
}

export function installFonts(ctx: SpoofCtx): void {
  const families = new Set<string>();
  let reported = false;
  function noteFamily(font: string): void {
    if (reported) return;
    families.add(familyOf(font));
    if (families.size >= ENUM_FAMILY_THRESHOLD) {
      reported = true;
      ctx.report('fonts'); // enumeration detected — count it once
    }
  }

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
    noteFamily(this.font);
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
    // No probe count here: getClientRects fires constantly for normal layout and
    // would be a huge false-positive source. We still jitter the geometry so the
    // offsetWidth-based enumeration variant is defeated.
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
