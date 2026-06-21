// Shared message + state contracts across SW / bridge / inject / UI.

export type StrictnessLevel = 'off' | 'balanced' | 'strict';

export interface Settings {
  level: StrictnessLevel;
  /** Origins where spoofing is fully disabled. */
  allowlist: string[];
  /**
   * Per-site tracker exceptions: for each site host, the list of tracker
   * domains the user chose to UNBLOCK (re-enable) because blocking broke the
   * site. Compiled into dynamic declarativeNetRequest "allow" rules.
   */
  perSiteAllow: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  level: 'balanced',
  allowlist: [],
  perSiteAllow: {},
};

/** Fingerprint surfaces we count attempts against. */
export type FpSurface =
  | 'canvas'
  | 'webgl'
  | 'audio'
  | 'navigator'
  | 'screen'
  | 'fonts';

/** Config the MAIN-world inject script needs to run. */
export interface InjectConfig {
  enabled: boolean;
  level: StrictnessLevel;
  origin: string;
  sessionSalt: string;
}

/** Per-tab accumulated signals, kept in the SW and surfaced in the popup. */
export interface TabSignals {
  url: string;
  origin: string;
  isHttps: boolean;
  fpAttempts: Record<FpSurface, number>;
  trackersBlocked: number;
  /** Blocked third-party tracker domains → how many requests each. */
  blocked: Record<string, number>;
}

export function emptyFpAttempts(): Record<FpSurface, number> {
  return { canvas: 0, webgl: 0, audio: 0, navigator: 0, screen: 0, fonts: 0 };
}

// ---- wire messages -------------------------------------------------------

/** inject (MAIN) → bridge (ISOLATED), via window.postMessage. */
export interface FpEventMessage {
  source: 'pg-inject';
  type: 'fp-attempt';
  surface: FpSurface;
  count: number;
}

/** bridge (ISOLATED) → inject (MAIN), via window.postMessage. */
export interface ConfigMessage {
  source: 'pg-bridge';
  type: 'config';
  config: InjectConfig;
}

/** bridge → SW, via chrome.runtime.sendMessage. */
export type RuntimeMessage =
  | { type: 'get-config'; origin: string; url: string }
  | { type: 'fp-attempt'; surface: FpSurface; count: number }
  | { type: 'get-tab-state'; tabId?: number }
  | { type: 'get-settings' }
  | { type: 'set-settings'; settings: Settings }
  | { type: 'get-history' }
  | { type: 'clear-history' }
  | { type: 'set-tracker-exception'; siteHost: string; domain: string; allow: boolean };
