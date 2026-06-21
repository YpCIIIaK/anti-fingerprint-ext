import type { TabSignals } from '../types';

export interface ScoreBreakdownItem {
  label: string;
  penalty: number;
  detail: string;
}

export interface ScoreResult {
  score: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: ScoreBreakdownItem[];
}

// Per-surface penalty model. Each surface scores on *presence* (a base hit the
// first time it's probed) plus a small diminishing bump for repeated probes
// (log2, so 50 calls ≈ 5×). Each surface is capped, so a single chatty-but-benign
// surface (e.g. fonts/screen) can't tank the score the way raw per-call counting
// did. High-entropy surfaces (canvas/webgl/audio) carry the real weight.
interface SurfaceWeight {
  base: number;
  slope: number;
  cap: number;
}
const SURFACE: Record<string, SurfaceWeight> = {
  canvas: { base: 12, slope: 4, cap: 22 },
  webgl: { base: 12, slope: 2, cap: 18 },
  audio: { base: 10, slope: 3, cap: 18 },
  navigator: { base: 3, slope: 1, cap: 6 },
  screen: { base: 2, slope: 0, cap: 2 },
  fonts: { base: 8, slope: 2, cap: 14 },
};
const WEIGHTS = {
  fingerprintCap: 60, // total fingerprint penalty is capped
  noHttps: 20,
};

function surfacePenalty(surface: string, count: number): number {
  if (count <= 0) return 0;
  const w = SURFACE[surface];
  return Math.min(w.cap, w.base + w.slope * Math.log2(count + 1));
}

function gradeFor(score: number): ScoreResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Privacy Score: start at 100 and subtract weighted penalties. Fingerprinting
 * attempts dominate (capped so a single abusive script can't drive everything
 * negative); lack of HTTPS is a flat hit. Blocked trackers are surfaced as a
 * positive signal in the breakdown rather than a penalty.
 */
export function computeScore(s: TabSignals): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  let score = 100;

  const fp = s.fpAttempts;
  const parts = [
    ['canvas', fp.canvas],
    ['webgl', fp.webgl],
    ['audio', fp.audio],
    ['navigator', fp.navigator],
    ['screen', fp.screen],
    ['fonts', fp.fonts],
  ] as const;

  let fpPenalty = 0;
  for (const [surface, count] of parts) fpPenalty += surfacePenalty(surface, count);
  fpPenalty = Math.min(Math.round(fpPenalty), WEIGHTS.fingerprintCap);

  const totalFp = parts.reduce((n, [, c]) => n + c, 0);
  if (fpPenalty > 0) {
    score -= fpPenalty;
    // Spell out every surface so "other" is never a mystery.
    const detail = parts
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    breakdown.push({
      label: 'Fingerprinting attempts',
      penalty: fpPenalty,
      detail: `${totalFp} probe(s): ${detail}`,
    });
  }

  if (!s.isHttps) {
    score -= WEIGHTS.noHttps;
    breakdown.push({
      label: 'No HTTPS',
      penalty: WEIGHTS.noHttps,
      detail: 'Connection is not encrypted',
    });
  }

  if (s.trackersBlocked > 0) {
    breakdown.push({
      label: 'Trackers blocked',
      penalty: 0,
      detail: `${s.trackersBlocked} request(s) blocked (no penalty)`,
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: gradeFor(score), breakdown };
}
