import { streamFor } from '../prng';
import { makeNativeLike, type SpoofCtx } from './common';

/**
 * Audio spoof: AudioContext fingerprinting reads the precise floating-point
 * output of an oscillator/analyser. We add a deterministic, inaudible noise
 * floor (~1e-7) to getChannelData / getFloatFrequencyData samples, keyed by the
 * origin seed, breaking the hash without affecting real playback.
 */
export function installAudio(ctx: SpoofCtx): void {
  const rng = streamFor(ctx.originSeed, 'audio');
  const amp = ctx.level === 'strict' ? 2e-7 : 1e-7;

  // Stable noise table indexed by sample position.
  const TABLE = 8192;
  const noise = new Float32Array(TABLE);
  for (let i = 0; i < TABLE; i++) noise[i] = (rng() * 2 - 1) * amp;

  if (typeof AudioBuffer !== 'undefined') {
    const orig = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = makeNativeLike(function (
      this: AudioBuffer,
      channel: number
    ) {
      const data = orig.call(this, channel);
      if (ctx.isEnabled()) {
        ctx.report('audio');
        for (let i = 0; i < data.length; i++) data[i] += noise[i & (TABLE - 1)];
      }
      return data;
    },
    'getChannelData') as typeof orig;
  }

  if (typeof AnalyserNode !== 'undefined') {
    const orig = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = makeNativeLike(function (
      this: AnalyserNode,
      array: any
    ) {
      orig.call(this, array);
      if (ctx.isEnabled()) {
        ctx.report('audio');
        for (let i = 0; i < array.length; i++) array[i] += noise[i & (TABLE - 1)];
      }
    },
    'getFloatFrequencyData') as typeof orig;
  }
}
