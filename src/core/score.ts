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

// Weights are intentionally in one place so the scoring policy is auditable.
const WEIGHTS = {
  canvasPerAttempt: 8,
  webglPerAttempt: 8,
  audioPerAttempt: 6,
  otherFpPerAttempt: 3,
  fingerprintCap: 45, // total fingerprint penalty is capped
  noHttps: 20,
  trackerCleared: 4, // small credit removed per blocked tracker is *good*, so we
  // instead penalise presence of tracking attempts indirectly via attempts above.
};

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
  let fpPenalty =
    fp.canvas * WEIGHTS.canvasPerAttempt +
    fp.webgl * WEIGHTS.webglPerAttempt +
    fp.audio * WEIGHTS.audioPerAttempt +
    (fp.navigator + fp.screen + fp.fonts) * WEIGHTS.otherFpPerAttempt;
  fpPenalty = Math.min(fpPenalty, WEIGHTS.fingerprintCap);

  const totalFp =
    fp.canvas + fp.webgl + fp.audio + fp.navigator + fp.screen + fp.fonts;
  if (fpPenalty > 0) {
    score -= fpPenalty;
    // Spell out every surface so "other" is never a mystery: e.g. heavy
    // measureText() use shows up explicitly as a high `fonts` count.
    const parts = [
      ['canvas', fp.canvas],
      ['webgl', fp.webgl],
      ['audio', fp.audio],
      ['navigator', fp.navigator],
      ['screen', fp.screen],
      ['fonts', fp.fonts],
    ] as const;
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
