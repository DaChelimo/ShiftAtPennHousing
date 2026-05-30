// Phase 09 — Swaps: shared test types and fixture builders.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §8.1 (temporary shift swap),
//                                §8.2 (temporary float swap),
//                                §8.3 (permanent shift swap),
//                                §1.2 (float direction rules),
//                                §5.3 (cross-house pickup eligibility);
//   ARCHITECTURE.md §3.5 (swap_requests schema);
//   AGENTS.md hard invariants #1 (Harnwell training) and #2 (float direction).
//
// Functions under test (TDD — not yet implemented; see
// tests/PHASE_09/TEST_PLAN.md for the full contract):
//
//   packages/core/src/swaps/eligibility.ts
//     export function evaluateSwapEligibility(input): SwapEligibilityResult
//     export function findConflictingPendingSwaps(input): string[]
//
//   packages/core/src/swaps/permanent-scope.ts
//     export function scopePermanentSwapWeeks(input): ScopePermanentSwapResult
//
// All three are PURE FUNCTIONS — zero Supabase imports, deterministic for a
// given input. The swap Edge Functions (creation + acceptance) snapshot DB
// state, call `evaluateSwapEligibility` as the symmetric pre-creation guard
// (§8.1) AND again as the acceptance-time backstop (§8.1 "Acceptance guard"),
// then invoke the atomic SQL acceptance RPC `accept_swap`
// (supabase/tests/phase-09-swaps.sql). `scopePermanentSwapWeeks` computes the
// confirmation-popup scope (affected vs skipped weeks) the permanent-swap
// acceptance RPC bulk-applies (§8.3).
//
// Re-exporting the contract types from `../../src/swaps/types.js` (rather than
// redefining them here) guarantees that any drift between the implementation
// and the tests surfaces as a TypeScript error — the same discipline the
// phase-06/07/08 fixtures use.

import type {
  PendingSwapRef,
  RecurringOccurrence,
  RecurringOccurrenceProfile,
  ScopePermanentSwapInput,
  ScopePermanentSwapResult,
  SwapAssignmentKind,
  SwapEligibilityInput,
  SwapEligibilityResult,
  SwapEligibilityViolation,
  SwapIneligibilityReason,
  SwapParticipant,
  SwapSpanAssignment,
  SwapType,
} from '../../src/swaps/types.js';

export type {
  PendingSwapRef,
  RecurringOccurrence,
  RecurringOccurrenceProfile,
  ScopePermanentSwapInput,
  ScopePermanentSwapResult,
  SwapAssignmentKind,
  SwapEligibilityInput,
  SwapEligibilityResult,
  SwapEligibilityViolation,
  SwapIneligibilityReason,
  SwapParticipant,
  SwapSpanAssignment,
  SwapType,
};

// ---------------------------------------------------------------------
// House constants. Harnwell is training-gated (invariant #1); Quad is the
// multi-staff training-equivalent house (may float to any house EXCEPT
// Harnwell, invariant #2); house-05 / house-07 stand in for the 11
// single-staff houses (cannot be float SOURCES, but MAY take a cross-house
// pickup at any non-Harnwell house — the §5.3-vs-§1.2 asymmetry).
// ---------------------------------------------------------------------

export const HARNWELL = 'harnwell';
export const QUAD = 'quad';
export const HOUSE_A = 'house-05';
export const HOUSE_B = 'house-07';

// ---------------------------------------------------------------------
// Time anchors. Times are timestamptz in America/New_York (AGENTS
// invariant #6). October 2026 is EDT (-04:00); the permanent-swap fixtures
// place weekly recurring occurrences relative to a fixed acceptance moment.
// ---------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// Thursday 2026-10-15 noon EDT — the canonical permanent-swap "acceptedAt".
export const ACCEPTED_AT = new Date('2026-10-15T12:00:00-04:00');

export function plusWeeks(base: Date, weeks: number): Date {
  return new Date(base.getTime() + weeks * WEEK_MS);
}

export function plusDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

// ISO date (YYYY-MM-DD) used as the human-facing week label in the
// confirmation popup. Derived from the occurrence start in NY-local terms.
export function weekLabel(occurrenceStartAt: Date): string {
  return occurrenceStartAt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Span-assignment builder. Default: a plain in-house desk shift at HOUSE_A.
// ---------------------------------------------------------------------

export type BuildAssignmentOpts = {
  assignmentId?: string;
  houseId?: string;
  kind?: SwapAssignmentKind;
  inPendingFloat?: boolean;
};

let assignmentCounter = 0;

export function makeAssignment(opts: BuildAssignmentOpts = {}): SwapSpanAssignment {
  assignmentCounter += 1;
  return {
    assignmentId: opts.assignmentId ?? `asg-${assignmentCounter}`,
    houseId: opts.houseId ?? HOUSE_A,
    kind: opts.kind ?? 'shift',
    inPendingFloat: opts.inPendingFloat ?? false,
  };
}

// ---------------------------------------------------------------------
// Participant builder. A worker offering a span. `homeHouseId` governs the
// symmetric eligibility result for whatever span they RECEIVE.
// ---------------------------------------------------------------------

export type BuildParticipantOpts = {
  userId?: string;
  homeHouseId?: string;
  span?: SwapSpanAssignment[];
};

export function makeParticipant(opts: BuildParticipantOpts = {}): SwapParticipant {
  return {
    userId: opts.userId ?? 'user-initiator',
    homeHouseId: opts.homeHouseId ?? HOUSE_A,
    span: opts.span ?? [makeAssignment({ houseId: opts.homeHouseId ?? HOUSE_A })],
  };
}

// ---------------------------------------------------------------------
// Eligibility-input convenience constructor.
//
// Defaults describe a fully ELIGIBLE temporary shift swap: two single-staff
// home workers swapping plain desk shifts at their respective non-Harnwell
// houses. Each test overrides exactly the one facet it exercises.
// ---------------------------------------------------------------------

export type BuildEligibilityInputOpts = {
  swapType?: 'shift_swap' | 'float_swap';
  initiator?: SwapParticipant;
  counterparty?: SwapParticipant;
};

export function makeEligibilityInput(opts: BuildEligibilityInputOpts = {}): SwapEligibilityInput {
  return {
    swapType: opts.swapType ?? 'shift_swap',
    initiator:
      opts.initiator ??
      makeParticipant({
        userId: 'user-a',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'a-shift', houseId: HOUSE_A, kind: 'shift' })],
      }),
    counterparty:
      opts.counterparty ??
      makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_B,
        span: [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_B, kind: 'shift' })],
      }),
  };
}

// ---------------------------------------------------------------------
// Recurring-occurrence builder for permanent-swap scoping (§8.3).
//
// Default: a FUTURE (one week out) regular-school-year occurrence currently
// owned by Worker A — i.e., an AFFECTED week.
// ---------------------------------------------------------------------

export const WORKER_A = 'user-a';
export const WORKER_B = 'user-b';
export const OTHER_OWNER = 'user-c';

export type BuildOccurrenceOpts = {
  occurrenceId?: string;
  occurrenceStartAt?: Date;
  currentOwnerUserId?: string | null;
  profile?: RecurringOccurrenceProfile;
};

let occurrenceCounter = 0;

export function makeOccurrence(opts: BuildOccurrenceOpts = {}): RecurringOccurrence {
  occurrenceCounter += 1;
  const startAt = opts.occurrenceStartAt ?? plusWeeks(ACCEPTED_AT, 1);
  return {
    occurrenceId: opts.occurrenceId ?? `occ-${occurrenceCounter}`,
    weekStartDate: weekLabel(startAt),
    occurrenceStartAt: startAt,
    currentOwnerUserId: opts.currentOwnerUserId === undefined ? WORKER_A : opts.currentOwnerUserId,
    profile: opts.profile ?? 'regular_school_year',
  };
}

export type BuildScopeInputOpts = {
  workerAUserId?: string;
  acceptedAt?: Date;
  occurrences?: RecurringOccurrence[];
};

export function makeScopeInput(opts: BuildScopeInputOpts = {}): ScopePermanentSwapInput {
  return {
    workerAUserId: opts.workerAUserId ?? WORKER_A,
    acceptedAt: opts.acceptedAt ?? ACCEPTED_AT,
    occurrences: opts.occurrences ?? [makeOccurrence()],
  };
}
