import { hashSeed } from './prng';

/**
 * Per-origin seed = hash(origin + sessionSalt).
 *
 * The whole anti-fingerprint scheme hinges on this being *deterministic* within
 * a session+origin yet *different* across origins. If we re-randomised on every
 * API call the noise itself would become a stable fingerprint; if we used the
 * same noise everywhere, a tracker could correlate us across sites. Seeding the
 * PRNG with origin + a per-session salt gives us both properties.
 *
 * The salt is generated once per browser session by the service worker
 * (crypto.getRandomValues) and handed to the page world via the bridge.
 */
export function originSeed(origin: string, sessionSalt: string): number {
  return hashSeed(`${origin}::${sessionSalt}`);
}
