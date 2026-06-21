import { streamFor } from '../prng';
import { makeNativeLike, type SpoofCtx } from './common';

/**
 * Canvas spoof: inject a tiny, *deterministic* sub-pixel perturbation into pixel
 * data the page tries to read back (toDataURL / getImageData / toBlob). The
 * perturbation is keyed by the origin seed so it is stable for this site this
 * session — re-running the same draw yields the same bytes — but differs from
 * every other origin. ±1 on a sparse set of channels is invisible to humans yet
 * breaks hash-based canvas fingerprints.
 */
export function installCanvas(ctx: SpoofCtx): void {
  const rng = streamFor(ctx.originSeed, 'canvas');

  // Precompute a stable noise table; index into it by pixel position so the same
  // canvas always gets the same noise (deterministic) without per-call cost.
  const TABLE = 4096;
  const noise = new Int8Array(TABLE);
  for (let i = 0; i < TABLE; i++) {
    // strict perturbs more channels than balanced
    const amp = ctx.level === 'strict' ? 2 : 1;
    noise[i] = Math.round((rng() * 2 - 1) * amp);
  }

  function perturb(data: Uint8ClampedArray): void {
    // Only nudge a sparse subset (every ~17th pixel) to stay cheap on big canvases.
    for (let i = 0, p = 0; i < data.length; i += 4 * 17, p++) {
      const n = noise[p & (TABLE - 1)];
      data[i] = clamp(data[i] + n); // R
      data[i + 1] = clamp(data[i + 1] - n); // G
      data[i + 2] = clamp(data[i + 2] + n); // B
    }
  }

  const proto = CanvasRenderingContext2D.prototype;
  const origGetImageData = proto.getImageData;
  proto.getImageData = makeNativeLike(function (
    this: CanvasRenderingContext2D,
    ...args: [number, number, number, number]
  ) {
    const img = origGetImageData.apply(this, args);
    if (ctx.isEnabled()) {
      ctx.report('canvas');
      perturb(img.data);
    }
    return img;
  },
  'getImageData') as typeof origGetImageData;

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = makeNativeLike(function (
    this: HTMLCanvasElement,
    ...args: [type?: string, quality?: any]
  ) {
    if (ctx.isEnabled()) {
      ctx.report('canvas');
      noisifyCanvas(this);
    }
    return origToDataURL.apply(this, args);
  },
  'toDataURL') as typeof origToDataURL;

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = makeNativeLike(function (
    this: HTMLCanvasElement,
    ...args: [callback: BlobCallback, type?: string, quality?: any]
  ) {
    if (ctx.isEnabled()) {
      ctx.report('canvas');
      noisifyCanvas(this);
    }
    return origToBlob.apply(this, args);
  },
  'toBlob') as typeof origToBlob;

  // Draw the perturbed pixels back so toDataURL/toBlob serialise the noisy buffer.
  function noisifyCanvas(canvas: HTMLCanvasElement): void {
    try {
      const c2d = canvas.getContext('2d');
      if (!c2d || canvas.width === 0 || canvas.height === 0) return;
      const img = origGetImageData.call(c2d, 0, 0, canvas.width, canvas.height);
      perturb(img.data);
      c2d.putImageData(img, 0, 0);
    } catch {
      /* tainted/oversized canvas — leave as-is */
    }
  }

  function clamp(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }
}
