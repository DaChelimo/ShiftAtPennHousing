// S1 — Admin override: shared test types and builders for the pure validators.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §4.3 (Phase-3 post-publish override — "same card UI": an HM/SM may
//          assign / reassign / remove on a published block),
//     §11.1 (live-calendar manager surface), §1.2/§1.5 (Harnwell training +
//          float-direction invariants — the absolute backstops), §9.3 (the
//          weekly hours cap: 20-soft overridable, 40-hard absolute),
//     §4.5 (the people-management edges the override feeds);
//   ARCHITECTURE.md §3.x (shift_block_assignments status / vacancy_origin),
//     §9.3 (effective_weekly_cap — soft vs hard);
//   AGENTS.md hard invariants #1 (Harnwell training — absolute), #2 (float
//     direction), #3 (no-takeback — float-committed seats deferred, not broken),
//     #4 (hours cap is NOT checked on float; soft cap on claim/assign),
//     #5 (30-minute blocks), #6 (NY timestamptz).
//   docs/web-remediation/sessions/S1/TEST_PLAN.md (the behavior contract + the
//     pinned decisions D1–D8 this suite encodes).
//
// Functions under test (TDD — NOT yet implemented; see TEST_PLAN §3/§4a):
//
//   packages/core/src/admin-override/index.ts
//     export function evaluateAdminAssignment(input): AdminAssignmentResult
//     export function evaluateAdminRemoval(input):   AdminRemovalResult
//
// Both are PURE FUNCTIONS — zero Supabase imports, deterministic for a given
// input, the clock injected as `now: Date`. The override server action /
// admin_assign_worker RPC snapshots DB state, calls these to compute the
// hard-block / advisory partition (and to gate the soft-confirm step), then the
// SQL RPC re-checks the same predicates authoritatively (the Vitest surface is
// the analogue of phase-10's pure drop/pickup partition feeding the SQL RPC).
//
// Re-exporting the contract types from `../../src/admin-override/types.js`
// (rather than redefining them) guarantees that any drift between the
// implementation and the tests surfaces as a TypeScript error — the same
// discipline the phase-06/07/08/09/10 fixtures use. The import is unresolved
// until the implementer writes the module: that is the intended RED.

import type {
  AdminAdvisory,
  AdminAdvisoryKind,
  AdminAssignmentInput,
  AdminAssignmentResult,
  AdminHardBlock,
  AdminHardBlockReason,
  AdminOverrideScope,
  AdminRemovalInput,
  AdminRemovalResult,
  AdminSeatFloatState,
  AdminSeatStatus,
  AdminWorkerPreference,
} from '../../src/admin-override/types.js';

export type {
  AdminAdvisory,
  AdminAdvisoryKind,
  AdminAssignmentInput,
  AdminAssignmentResult,
  AdminHardBlock,
  AdminHardBlockReason,
  AdminOverrideScope,
  AdminRemovalInput,
  AdminRemovalResult,
  AdminSeatFloatState,
  AdminSeatStatus,
  AdminWorkerPreference,
};

// ---------------------------------------------------------------------
// Identities + house. Same-house is the only IN-scope placement (TEST_PLAN §1):
// the picker is the block-house roster, so a Harnwell block only ever offers a
// Harnwell-home worker. The cross-house case is a hard block, not a success.
// ---------------------------------------------------------------------

export const OPERATOR = 'user-operator';
export const TARGET_WORKER = 'user-target';
export const INCUMBENT = 'user-incumbent';
export const BLOCK_HOUSE = 'house-05';
export const OTHER_HOUSE = 'house-07';

// ---------------------------------------------------------------------
// Time anchors. Times are timestamptz in America/New_York (invariant #6). The
// fixtures anchor at NOON EDT so each block's UTC-slice date equals its NY-local
// calendar date — the same noon-anchor trick the phase-09/10 fixtures use.
// `NOW` is the injected clock; the canonical block is one hour out (future), so a
// default assignment is NOT `block_started`.
// ---------------------------------------------------------------------

export const HOUR_MS = 60 * 60 * 1000;

// Thursday 2026-10-15 12:00 EDT — the canonical "now" the validator is given.
export const NOW = new Date('2026-10-15T12:00:00-04:00');

// A future block start: one hour after `now`.
export const FUTURE_BLOCK_START = new Date(NOW.getTime() + HOUR_MS);

export function plusHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * HOUR_MS);
}

// ---------------------------------------------------------------------
// Cap shape (§9.3 / D2). The effective weekly cap is soft-20 by default; a hard
// cap is 40. `projectedWeeklyHours` is the worker's hours for the week the span
// falls in, INCLUDING the span being assigned (the caller computes the projection
// — the validator only compares it to the cap; AGENTS invariant #4: float hours
// are out of scope, this is a claim/assign cap).
// ---------------------------------------------------------------------

export type CapEnforcement = 'soft' | 'hard';

// ---------------------------------------------------------------------
// Assignment-input builder.
//
// Default: a vacant, future, same-house seat; an ACTIVE target worker with no
// preference for the span, comfortably under both target and the soft cap, and
// `overrideAdvisories=false`. That is the clean `{ ok: true, advisories: [] }`
// case. Each test overrides exactly the one facet it exercises.
// ---------------------------------------------------------------------

export type BuildAssignmentOpts = {
  scope?: AdminOverrideScope;
  overrideAdvisories?: boolean;
  now?: Date;
  // worker
  workerUserId?: string;
  workerIsActive?: boolean;
  workerHomeHouseId?: string;
  // seat / block
  blockHouseId?: string;
  blockStartAt?: Date;
  seatStatus?: AdminSeatStatus; // 'vacant' | 'occupied'
  seatFloatState?: AdminSeatFloatState; // 'none' | 'floated_in' | 'floated_out' | 'pending_float_in' | 'pending_float_out'
  seatOccupantUserId?: string | null; // present when seatStatus === 'occupied'
  // preference (for the span)
  preference?: AdminWorkerPreference; // 'preferred' | 'available' | 'cannot' | 'none'
  optedOut?: boolean;
  // hours (§9.3)
  spanHours?: number;
  projectedWeeklyHours?: number; // weekly total INCLUDING the span
  targetHours?: number;
  capHours?: number;
  capEnforcement?: CapEnforcement;
};

export function makeAssignmentInput(opts: BuildAssignmentOpts = {}): AdminAssignmentInput {
  const blockStartAt = opts.blockStartAt ?? FUTURE_BLOCK_START;
  return {
    scope: opts.scope ?? 'this_week',
    overrideAdvisories: opts.overrideAdvisories ?? false,
    now: opts.now ?? NOW,
    worker: {
      userId: opts.workerUserId ?? TARGET_WORKER,
      isActive: opts.workerIsActive ?? true,
      homeHouseId: opts.workerHomeHouseId ?? BLOCK_HOUSE,
    },
    seat: {
      blockHouseId: opts.blockHouseId ?? BLOCK_HOUSE,
      blockStartAt,
      status: opts.seatStatus ?? 'vacant',
      floatState: opts.seatFloatState ?? 'none',
      occupantUserId:
        opts.seatOccupantUserId === undefined
          ? opts.seatStatus === 'occupied'
            ? INCUMBENT
            : null
          : opts.seatOccupantUserId,
    },
    preference: opts.preference ?? 'none',
    optedOut: opts.optedOut ?? false,
    hours: {
      spanHours: opts.spanHours ?? 2,
      projectedWeeklyHours: opts.projectedWeeklyHours ?? 4,
      targetHours: opts.targetHours ?? 20,
      capHours: opts.capHours ?? 20,
      capEnforcement: opts.capEnforcement ?? 'soft',
    },
  };
}

// ---------------------------------------------------------------------
// Removal-input builder.
//
// Default: a future, same-house seat currently occupied by the named worker,
// not float-committed — i.e., a clean `{ ok: true }` removal. Each test overrides
// the one facet it exercises.
// ---------------------------------------------------------------------

export type BuildRemovalOpts = {
  scope?: AdminOverrideScope;
  now?: Date;
  workerUserId?: string;
  blockHouseId?: string;
  blockStartAt?: Date;
  seatStatus?: AdminSeatStatus;
  seatFloatState?: AdminSeatFloatState;
  seatOccupantUserId?: string | null;
};

export function makeRemovalInput(opts: BuildRemovalOpts = {}): AdminRemovalInput {
  const blockStartAt = opts.blockStartAt ?? FUTURE_BLOCK_START;
  const occupant =
    opts.seatOccupantUserId === undefined
      ? (opts.workerUserId ?? TARGET_WORKER)
      : opts.seatOccupantUserId;
  return {
    scope: opts.scope ?? 'this_week',
    now: opts.now ?? NOW,
    worker: { userId: opts.workerUserId ?? TARGET_WORKER },
    seat: {
      blockHouseId: opts.blockHouseId ?? BLOCK_HOUSE,
      blockStartAt,
      status: opts.seatStatus ?? 'occupied',
      floatState: opts.seatFloatState ?? 'none',
      occupantUserId: occupant,
    },
  };
}
