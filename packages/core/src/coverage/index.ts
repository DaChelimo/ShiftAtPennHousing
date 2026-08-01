// Allied coverage-request lifecycle — PURE: no I/O, no Supabase, no implicit clock
// (the caller threads `nowIso` in, per the packages/core purity rule).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION §5.4 (escalation to Allied procurement), §10.1 (routing).
//   ARCHITECTURE §4.2 / §4.6.
//   Plan: docs/allied-coverage-alerting/PLAN.md
//   Migration: supabase/migrations/20260729000010_allied_coverage_ladder.sql
//
// WHAT CHANGED, AND WHY IT MATTERS
// --------------------------------
// The predecessor model lives next door in `../inbox/index.ts`. There, an Allied alert
// was derived from a NOTIFICATION row, and `alliedLifecycle` archived it once the
// coverage window ended "resolved or NOT", then discarded it 24 hours later. So a desk
// that actually went unstaffed produced an inbox that looked clean the next morning,
// and no record survived anywhere that it had happened.
//
// This module derives state from the REQUEST row instead, and the central rule is:
//
//     AN OPEN REQUEST NEVER AUTO-CLEARS.
//
// Once the window passes without a close-out the request becomes `overdue` and stays
// on screen until a human records an outcome. `closed` is reachable only through
// close_allied_coverage_request. There is no `discarded`.
//
//   awaiting_ack -> acknowledged -> closed     (the healthy path)
//   awaiting_ack -> overdue                    (window passed, nobody acknowledged)
//   acknowledged -> overdue                    (acknowledged, window passed, not closed)
//
// `acknowledged` and `closed` are deliberately distinct. Acknowledging means "I am
// handling this" and stops the escalation ladder; closing means "here is what actually
// happened" and requires an outcome. Collapsing them back into one control is exactly
// what lost the audit trail before.

export type CoverageOutcome =
  | 'allied_secured'
  | 'covered_internally'
  | 'desk_unstaffed'
  | 'no_longer_needed';

export type CoverageRung = 'rsm' | 'hm' | 'hmod' | 'admin';

export type CoverageRequestState = 'awaiting_ack' | 'acknowledged' | 'overdue' | 'closed';

export type CoverageRequestInput = {
  windowStartIso: string;
  windowEndIso: string;
  acknowledgedAtIso: string | null;
  closedAtIso: string | null;
  outcome: CoverageOutcome | null;
  currentRung: CoverageRung;
  rungFiredAtIso: string;
};

// Compare AS DATES, never as strings: offset-bearing ISO timestamps (a "-05:00" vs a
// "Z" suffix) do not order correctly lexically. This bit the predecessor module and
// the comment there says so; it applies identically here.
function ms(iso: string): number {
  return new Date(iso).getTime();
}

// Where a request sits right now.
//
// Note the ordering of the checks: `closed` wins over everything (a closed request is
// finished, even if its window is long past), and `overdue` wins over `acknowledged`
// (an acknowledged request whose window elapsed without a close-out is precisely the
// case that must stay visible).
export function coverageRequestState(
  input: CoverageRequestInput,
  nowIso: string,
): CoverageRequestState {
  if (input.closedAtIso !== null) return 'closed';
  if (ms(nowIso) >= ms(input.windowEndIso)) return 'overdue';
  if (input.acknowledgedAtIso !== null) return 'acknowledged';
  return 'awaiting_ack';
}

// Is this request still demanding someone's attention? Drives the app-wide banner,
// the red bell count, and the "action required" grouping. An acknowledged request is
// deliberately NOT action-required: somebody has said they are handling it.
export function isActionRequired(input: CoverageRequestInput, nowIso: string): boolean {
  const state = coverageRequestState(input, nowIso);
  return state === 'awaiting_ack' || state === 'overdue';
}

// A missed-coverage INCIDENT: either a desk that went unstaffed, or a request nobody
// ever closed. Both mean the process failed, and both belong in the report.
export function isMissedCoverageIncident(input: CoverageRequestInput, nowIso: string): boolean {
  if (input.closedAtIso !== null) {
    return input.outcome === 'desk_unstaffed';
  }
  return coverageRequestState(input, nowIso) === 'overdue';
}

// When the current rung escalates, given the configured timeout. Drives the countdown
// on the card. Null once the request is acknowledged or closed (the ladder has stopped)
// or on the terminal rung (there is nobody above the HMOD).
export function rungDeadlineIso(
  input: CoverageRequestInput,
  timeoutMinutes: number,
): string | null {
  if (input.acknowledgedAtIso !== null || input.closedAtIso !== null) return null;
  if (input.currentRung === 'hmod' || input.currentRung === 'admin') return null;
  return new Date(ms(input.rungFiredAtIso) + timeoutMinutes * 60_000).toISOString();
}

// Sort key for the Coverage list: overdue first (most overdue at the top), then the
// soonest window. A manager scanning this list needs the thing that has already gone
// wrong before the thing that is about to.
export function coverageSortKey(input: CoverageRequestInput, nowIso: string): number {
  const overdue = coverageRequestState(input, nowIso) === 'overdue';
  return overdue ? ms(input.windowEndIso) - Number.MAX_SAFE_INTEGER : ms(input.windowStartIso);
}

const RUNG_LABEL: Record<CoverageRung, string> = {
  rsm: 'Residential Services Manager',
  hm: 'Housing Manager',
  hmod: 'Housing Manager on duty',
  admin: 'Project administrator',
};

export function rungLabel(rung: CoverageRung): string {
  return RUNG_LABEL[rung];
}

const OUTCOME_LABEL: Record<CoverageOutcome, string> = {
  allied_secured: 'Allied secured',
  covered_internally: 'Covered internally',
  desk_unstaffed: 'Desk went unstaffed',
  no_longer_needed: 'No longer needed',
};

export function outcomeLabel(outcome: CoverageOutcome): string {
  return OUTCOME_LABEL[outcome];
}

// A note is mandatory when reporting that a desk went empty. Mirrors the RPC's
// `note_required` guard so the UI can block before the round trip, but the RPC stays
// authoritative. An unexplained `desk_unstaffed` is the row nobody can act on later.
export function requiresCloseNote(outcome: CoverageOutcome): boolean {
  return outcome === 'desk_unstaffed';
}
