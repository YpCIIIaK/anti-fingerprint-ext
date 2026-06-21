import { streamFor } from '../prng';
import { makeNativeLike, type SpoofCtx } from './common';

// A small pool of plausible GPU strings to rotate through, chosen per-origin so
// the reported renderer is stable for a site but not globally unique.
const RENDERERS = [
  'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
];
const VENDORS = ['Google Inc. (Intel)', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)'];

/**
 * WebGL spoof: lie about UNMASKED_RENDERER/UNMASKED_VENDOR (the high-entropy
 * bits the WEBGL_debug_renderer_info extension exposes), chosen deterministically
 * from the origin seed. Other parameters are passed through untouched so we don't
 * break feature detection.
 */
export function installWebGL(ctx: SpoofCtx): void {
  const rng = streamFor(ctx.originSeed, 'webgl');
  const renderer = RENDERERS[Math.floor(rng() * RENDERERS.length)];
  const vendor = VENDORS[Math.floor(rng() * VENDORS.length)];

  const UNMASKED_RENDERER = 0x9246;
  const UNMASKED_VENDOR = 0x9245;

  function patch(proto: WebGLRenderingContext | WebGL2RenderingContext) {
    const orig = proto.getParameter;
    proto.getParameter = makeNativeLike(function (
      this: WebGLRenderingContext,
      pname: number
    ) {
      if (ctx.isEnabled() && (pname === UNMASKED_RENDERER || pname === UNMASKED_VENDOR)) {
        ctx.report('webgl');
        return pname === UNMASKED_RENDERER ? renderer : vendor;
      }
      return orig.call(this, pname);
    },
    'getParameter') as typeof orig;
  }

  patch(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patch(WebGL2RenderingContext.prototype as any);
  }
}
