// Desk Assistant — temporal validity of knowledge items (INTAKE_PLAN section 4a).
// Pure, no clock: the caller passes the as-of date. Date-only comparison, so it is
// DST-safe by construction (no wall-clock interval arithmetic; project invariant #6).
//
// `effectiveFrom` / `effectiveUntil` are inclusive NY-local calendar dates (YYYY-MM-DD)
// or null for an open bound. The caller must supply an as-of value already in the
// America/New_York frame; comparison is lexicographic on the leading date, which is
// correct for zero-padded ISO dates.

export type Temporality = 'durable' | 'until_superseded' | 'expires';

export interface EffectiveWindow {
  temporality: Temporality;
  /** Inclusive start (YYYY-MM-DD), or null for no lower bound. */
  effectiveFrom: string | null;
  /** Inclusive end (YYYY-MM-DD), or null for open-ended. */
  effectiveUntil: string | null;
}

/** A timeless rule: always in effect. */
export const DURABLE_WINDOW: EffectiveWindow = {
  temporality: 'durable',
  effectiveFrom: null,
  effectiveUntil: null,
};

function asDate(isoDateOrTimestamp: string): string {
  return isoDateOrTimestamp.slice(0, 10);
}

/**
 * Is the item in effect as of `asOf` (a NY-local ISO date or timestamp)? Durable and
 * until-superseded items with open bounds are always in effect; an `expires` window is
 * gated on both bounds. A window with only a lower bound is in effect from that date on.
 */
export function isInEffect(window: EffectiveWindow, asOf: string): boolean {
  const day = asDate(asOf);
  if (window.effectiveFrom !== null && day < window.effectiveFrom) return false;
  if (window.effectiveUntil !== null && day > window.effectiveUntil) return false;
  return true;
}

/** Has this window fully expired as of `asOf`? (past its end bound). */
export function isExpired(window: EffectiveWindow, asOf: string): boolean {
  return window.effectiveUntil !== null && asDate(asOf) > window.effectiveUntil;
}

/**
 * Validate a proposed window: bounds must be YYYY-MM-DD and ordered, and an `expires`
 * item must carry at least an end bound (otherwise it can never expire and should be
 * `durable` / `until_superseded`). Returns the violations, empty if valid.
 */
export function validateWindow(window: EffectiveWindow): string[] {
  const violations: string[] = [];
  const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const { effectiveFrom: from, effectiveUntil: until, temporality } = window;
  if (from !== null && !isDate(from)) violations.push('effectiveFrom not YYYY-MM-DD');
  if (until !== null && !isDate(until)) violations.push('effectiveUntil not YYYY-MM-DD');
  if (from !== null && until !== null && isDate(from) && isDate(until) && until < from) {
    violations.push('effectiveUntil before effectiveFrom');
  }
  if (temporality === 'expires' && until === null) {
    violations.push('expires window needs an effectiveUntil');
  }
  if (temporality === 'durable' && (from !== null || until !== null)) {
    violations.push('durable window must have no bounds');
  }
  return violations;
}
