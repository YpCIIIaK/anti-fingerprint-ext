// Deterministic, fast, dependency-free PRNG primitives.
// xfnv1a turns a string into a 32-bit seed; mulberry32 turns that seed into a
// stable stream of pseudo-random numbers. Same seed → identical sequence, which
// is exactly what we need so the spoof is consistent within an origin+session.

/** xfnv1a string hash → 32-bit unsigned seed. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast PRNG. Returns a function yielding [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a PRNG keyed by an arbitrary label so different fingerprint surfaces
 * (canvas vs audio vs webgl) draw from independent-but-stable streams derived
 * from the same origin seed.
 */
export function streamFor(originSeed: number, label: string): () => number {
  return mulberry32((originSeed ^ hashSeed(label)) >>> 0);
}
