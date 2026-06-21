import type { FpSurface, StrictnessLevel } from '../../types';

/** Shared context handed to every spoof installer. */
export interface SpoofCtx {
  originSeed: number;
  level: StrictnessLevel;
  /** Report a fingerprinting probe so the SW can score it. */
  report: (surface: FpSurface) => void;
  /** Live flag — flipped off for allowlisted origins after config arrives. */
  isEnabled: () => boolean;
}

/** Replace a property's value while keeping the original toString-ish shape. */
export function defineValue(obj: object, prop: string, value: unknown): void {
  try {
    Object.defineProperty(obj, prop, {
      get() {
        return value;
      },
      configurable: true,
      enumerable: true,
    });
  } catch {
    /* some props are non-configurable; skip silently */
  }
}

/**
 * Wrap a method so the patched function masquerades as native to
 * Function.prototype.toString checks (a common spoof-detection trick).
 */
export function makeNativeLike(fn: (...a: any[]) => any, name: string): typeof fn {
  try {
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
    Object.defineProperty(fn, 'toString', {
      value: () => `function ${name}() { [native code] }`,
      configurable: true,
    });
  } catch {
    /* ignore */
  }
  return fn;
}
