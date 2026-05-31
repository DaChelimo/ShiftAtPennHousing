// Phase 10 — Permanent Drop & Permanent Pickup: shared test types and builders.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §8.4.1 (permanent drop — bulk-vacate every FUTURE occurrence of a
//            recurring slot the dropping worker currently owns, within the
//            current semester; exclusions: mid-shift / past-this-week /
//            not-currently-owned / break dates / float-committed seats),
//     §8.4.2 (SM/HM-initiated permanent removal — same scope, worker notified),
//     §8.4.3 (permanent pickup — per-week time-conflict + hours-cap checks,
//            soft cap ALSO skips the week, re-check at transaction time),
//     §8.4.4 (boundary cases), §9.2/§9.3 (the calendar week + the cap);
//   ARCHITECTURE.md §7.1 (permanent drop procedure — `scheduling_periods.end_date`
//            point lookup; reject if no row; the bulk-update predicate;
//            the float-commitment UI warning), §7.2 (permanent pickup procedure —
//            per-week skip-conflict / skip-cap; race-safe submit predicate);
//   AGENTS.md hard invariants #1 (Harnwell training), #3 (no-takeback),
//            #4 (hours cap is NOT checked on float — float-out seats are
//            hours-neutral), #5 (30-minute blocks), #6 (NY timestamptz).
//
// Functions under test (TDD — NOT yet implemented; see
// tests/PHASE_10/TEST_PLAN.md for the full contract):
//
//   packages/core/src/permanent-ops/drop-scope.ts
//     export function scopePermanentDrop(input): PermanentDropScopeResult
//     export function findFloatCommitmentWarnings(input): FloatCommitmentWarning[]
//
//   packages/core/src/permanent-ops/pickup-per-week.ts
//     export function evaluatePermanentPickup(input): PermanentPickupResult
//
// All three are PURE FUNCTIONS — zero Supabase imports, deterministic for a
// given input. The permanent-drop / permanent-pickup Edge Functions snapshot DB
// state, call these to compute the affected/skipped partition and the
// confirmation-popup summary, then invoke the atomic SQL RPCs
// `permanent_drop_slot` / `permanent_pickup_slot`
// (supabase/tests/phase-10-bulk-ops.sql). `evaluatePermanentPickup` is re-run
// against a FRESH snapshot at transaction time (§8.4.3 stale-popup defense) —
// the same re-run discipline phase-09's `evaluateSwapEligibility` uses for its
// acceptance-time backstop.
//
// Re-exporting the contract types from `../../src/permanent-ops/types.js`
// (rather than redefining them here) guarantees that any drift between the
// implementation and the tests surfaces as a TypeScript error — the same
// discipline the phase-06/07/08/09 fixtures use.

import type {
  DropFloatStatus,
  DropOccurrence,
  DropOccurrenceProfile,
  DropSkippedWeek,
  DroppedWeek,
  FloatCommitmentRef,
  FloatCommitmentStatus,
  FloatCommitmentWarning,
  PermanentDropScopeInput,
  PermanentDropScopeResult,
  PermanentDropSkipReason,
  PermanentPickupInput,
  PermanentPickupResult,
  PickupBlock,
  PickupSkipReason,
  PickupWeek,
  PickupWeekOutcome,
  PickupWeekStatus,
} from '../../src/permanent-ops/types.js';

export type {
  DropFloatStatus,
  DropOccurrence,
  DropOccurrenceProfile,
  DropSkippedWeek,
  DroppedWeek,
  FloatCommitmentRef,
  FloatCommitmentStatus,
  FloatCommitmentWarning,
  PermanentDropScopeInput,
  PermanentDropScopeResult,
  PermanentDropSkipReason,
  PermanentPickupInput,
  PermanentPickupResult,
  PickupBlock,
  PickupSkipReason,
  PickupWeek,
  PickupWeekOutcome,
  PickupWeekStatus,
};

// ---------------------------------------------------------------------
// Worker identities. The dropping/picking worker and the owner who took a week
// away (swap / temporary claim). The pure drop/pickup decision functions are
// HOUSE-AGNOSTIC — the Harnwell-training gate and cross-house field-setting live
// at the pickup write point and are exercised in supabase/tests/phase-10-bulk-ops.sql.
// ---------------------------------------------------------------------

export const DROPPER = 'user-dropper';
export const OTHER_OWNER = 'user-other';

// ---------------------------------------------------------------------
// Time anchors. Times are timestamptz in America/New_York (invariant #6).
// The drop fixtures anchor at NOON EDT so each occurrence's UTC-slice date
// equals its NY-local calendar date (16:00Z is mid-day in both EDT and EST),
// keeping `occurrenceDate` derivation DST-robust — the same noon-anchor trick
// the phase-09 fixtures use.
// ---------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// Thursday 2026-10-15 noon EDT — the canonical permanent-drop "dropInitiatedAt".
export const DROP_INITIATED_AT = new Date('2026-10-15T12:00:00-04:00');

// The current semester's last regular_school_year date (scheduling_periods
// .end_date). 2026-12-11 ≈ end of fall term. Occurrences past it are next
// semester and out of scope (§8.4.1).
export const SEMESTER_END_DATE = '2026-12-11';

export function plusWeeks(base: Date, weeks: number): Date {
  return new Date(base.getTime() + weeks * WEEK_MS);
}

export function plusDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

// YYYY-MM-DD calendar date of a timestamp. Noon-EDT anchoring (see above) makes
// the UTC slice equal the NY-local date for every fixture timestamp.
export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

// The Monday-anchored week label used in the confirmation popup. The fixtures
// keep one occurrence per week, so the occurrence date doubles as a stable,
// unique week key for assertions.
export function weekLabel(at: Date): string {
  return isoDate(at);
}

// ---------------------------------------------------------------------
// Permanent-drop occurrence builder.
//
// Default: a FUTURE (one week out) regular-school-year occurrence currently
// owned by the dropping worker, not float-committed — i.e., an AFFECTED week.
// Each test overrides exactly the one facet it exercises.
// ---------------------------------------------------------------------

export type BuildDropOccurrenceOpts = {
  assignmentId?: string;
  occurrenceStartAt?: Date;
  currentOwnerUserId?: string | null;
  profile?: DropOccurrenceProfile;
  floatStatus?: DropFloatStatus;
};

let dropOccurrenceCounter = 0;

export function makeDropOccurrence(opts: BuildDropOccurrenceOpts = {}): DropOccurrence {
  dropOccurrenceCounter += 1;
  const startAt = opts.occurrenceStartAt ?? plusWeeks(DROP_INITIATED_AT, 1);
  return {
    assignmentId: opts.assignmentId ?? `drop-asg-${dropOccurrenceCounter}`,
    weekStartDate: weekLabel(startAt),
    occurrenceStartAt: startAt,
    occurrenceDate: isoDate(startAt),
    currentOwnerUserId: opts.currentOwnerUserId === undefined ? DROPPER : opts.currentOwnerUserId,
    profile: opts.profile ?? 'regular_school_year',
    floatStatus: opts.floatStatus ?? 'none',
  };
}

export type BuildDropInputOpts = {
  droppingUserId?: string;
  dropInitiatedAt?: Date;
  semesterEndDate?: string | null;
  occurrences?: DropOccurrence[];
};

export function makeDropInput(opts: BuildDropInputOpts = {}): PermanentDropScopeInput {
  return {
    droppingUserId: opts.droppingUserId ?? DROPPER,
    dropInitiatedAt: opts.dropInitiatedAt ?? DROP_INITIATED_AT,
    semesterEndDate: opts.semesterEndDate === undefined ? SEMESTER_END_DATE : opts.semesterEndDate,
    occurrences: opts.occurrences ?? [makeDropOccurrence()],
  };
}

// ---------------------------------------------------------------------
// Float-commitment reference builder (§8.4.1 / ARCH §7.1 UI warning).
//
// Default: a PENDING float whose source side touches the slot — i.e., a float
// that must be FLAGGED (but never cancelled) before the drop is confirmed.
// ---------------------------------------------------------------------

export type BuildFloatCommitmentOpts = {
  floatId?: string;
  status?: FloatCommitmentStatus;
  sourceAssignmentIds?: string[];
};

let floatCommitmentCounter = 0;

export function makeFloatCommitment(opts: BuildFloatCommitmentOpts = {}): FloatCommitmentRef {
  floatCommitmentCounter += 1;
  return {
    floatId: opts.floatId ?? `float-${floatCommitmentCounter}`,
    status: opts.status ?? 'pending',
    sourceAssignmentIds: opts.sourceAssignmentIds ?? ['drop-asg-1'],
  };
}

// ---------------------------------------------------------------------
// Permanent-pickup builders (§8.4.3 / ARCH §7.2).
//
// `makePickupWeek` default: a single non-conflicting block, the worker well
// under a 20-hour soft cap — i.e., a FULLY-ASSIGNED week.
// ---------------------------------------------------------------------

export type BuildPickupBlockOpts = {
  blockId?: string;
  conflictsWithExisting?: boolean;
};

let pickupBlockCounter = 0;

export function makePickupBlock(opts: BuildPickupBlockOpts = {}): PickupBlock {
  pickupBlockCounter += 1;
  return {
    blockId: opts.blockId ?? `pickup-block-${pickupBlockCounter}`,
    conflictsWithExisting: opts.conflictsWithExisting ?? false,
  };
}

export type BuildPickupWeekOpts = {
  weekStartDate?: string;
  blocks?: PickupBlock[];
  currentWeeklyHours?: number;
  capHours?: number;
  capEnforcement?: 'soft' | 'hard';
};

let pickupWeekCounter = 0;

export function makePickupWeek(opts: BuildPickupWeekOpts = {}): PickupWeek {
  pickupWeekCounter += 1;
  return {
    weekStartDate: opts.weekStartDate ?? `2026-11-0${pickupWeekCounter}`,
    blocks: opts.blocks ?? [makePickupBlock()],
    currentWeeklyHours: opts.currentWeeklyHours ?? 0,
    capHours: opts.capHours ?? 20,
    capEnforcement: opts.capEnforcement ?? 'soft',
  };
}

export function makePickupInput(opts: { weeks?: PickupWeek[] } = {}): PermanentPickupInput {
  return {
    weeks: opts.weeks ?? [makePickupWeek()],
  };
}
