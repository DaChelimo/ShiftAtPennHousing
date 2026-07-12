// Phase 08 — Force-Trigger Pathway: shared test types and fixture builders.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.6 (force-triggered float — all 9 sub-rules),
//                                §7.2 (declining a float),
//                                §7.3 (no-ack trigger);
//   ARCHITECTURE.md §4.5 (force-trigger pathway — destination + source-side
//                          rows, block_step_status pre-marking, rollback
//                          procedure, source-side reconciliation),
//                   §6   (force-trigger endpoint — request, validation,
//                          execution, visibility);
//   AGENTS.md hard invariant #3 (no-takeback rule).
//
// Functions under test (TDD — not yet implemented; see
// tests/PHASE_08/TEST_PLAN.md for the full contract):
//
//   packages/core/src/force-trigger/validation.ts
//     export function validateForceTrigger(input): ForceTriggerValidationResult
//
//   packages/core/src/force-trigger/block-step-status.ts
//     export function forceTriggerSuccessMarks(): ForceTriggerStepMark[]
//     export function forceTriggerRollbackSteps(): ChainStepName[]
//
// Both are PURE FUNCTIONS. The force-trigger Edge Function (ARCH §6)
// snapshots DB state, calls validateForceTrigger as a pre-flight gate,
// runs the float lookup algorithm (packages/core/src/float-lookup), then
// invokes the atomic SQL execution RPC (tested in
// supabase/tests/phase-08-force-trigger.sql). The block-step-status
// helpers pin the exact pre-mark / rollback step sets the execution RPC
// must write.
//
// Re-exporting the contract types from `../../src/force-trigger/types.js`
// (rather than redefining them here) guarantees that any drift between
// the implementation and the tests surfaces as a TypeScript error —
// the same discipline phase-07 fixtures use for the orchestrator types.

import type {
  ForceTriggerBlockSnapshot,
  ForceTriggerBlockStatus,
  ForceTriggerInitiator,
  ForceTriggerRejectionReason,
  ForceTriggerRole,
  ForceTriggerStepMark,
  ForceTriggerValidationInput,
  ForceTriggerValidationResult,
} from '../../src/force-trigger/types.js';
import type {
  BlockStepStatusValue,
  ChainStep,
  ChainStepEvaluation,
  ChainStepName,
} from '../../src/orchestrator/types.js';

export type {
  BlockStepStatusValue,
  ChainStep,
  ChainStepEvaluation,
  ChainStepName,
  ForceTriggerBlockSnapshot,
  ForceTriggerBlockStatus,
  ForceTriggerInitiator,
  ForceTriggerRejectionReason,
  ForceTriggerRole,
  ForceTriggerStepMark,
  ForceTriggerValidationInput,
  ForceTriggerValidationResult,
};

// ---------------------------------------------------------------------
// Time anchors. May 28, 2026 is a Thursday (weekday) in EDT (-04:00).
// The force-trigger validator does no wall-clock routing math; it only
// compares (earliestStart - now) against the 2-hour window. We anchor
// `now` at a fixed wall-clock moment and place blocks relative to it.
// ---------------------------------------------------------------------

export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const BLOCK_MS = 30 * MINUTE_MS;

// Thursday 2026-05-28 at the named NY-local hour.
export function thursdayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-05-28T${h}:${m}:00-04:00`);
}

export function plusMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * MINUTE_MS);
}

export function plusHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * HOUR_MS);
}

export function plusMilliseconds(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

// Canonical "now" for validation fixtures: Thursday noon EDT.
export const NOW = thursdayAt(12, 0);

// Houses used throughout. Destination is the house WITH the gap.
// 'house-05' is a single-staff placeholder house; 'quad' / 'harnwell'
// have special float rules but are valid destinations here. The
// validator is agnostic to house identity — direction/eligibility rules
// live in the float lookup algorithm (phase 06), not the endpoint gate.
export const DESTINATION_HOUSE = 'house-05';

// ---------------------------------------------------------------------
// Block snapshot builder
// ---------------------------------------------------------------------

export type BuildBlockOpts = {
  blockId?: string;
  status?: ForceTriggerBlockStatus;
  // Block start expressed as an offset (minutes) from NOW. Default +180
  // (T-3h, i.e., 3 hours in the future) so a single default block is
  // comfortably outside the 2-hour rejection window.
  startOffsetMinutesFromNow?: number;
  hasPendingFloatIn?: boolean;
};

export function makeBlock(opts: BuildBlockOpts = {}): ForceTriggerBlockSnapshot {
  return {
    blockId: opts.blockId ?? 'blk-1',
    status: opts.status ?? 'vacant',
    blockStartAt: plusMinutes(NOW, opts.startOffsetMinutesFromNow ?? 180),
    hasPendingFloatIn: opts.hasPendingFloatIn ?? false,
  };
}

// ---------------------------------------------------------------------
// Validation-input convenience constructor
//
// Defaults describe a fully VALID force-trigger request:
//   - initiator is the SM scoped to the destination house,
//   - two contiguous vacant blocks starting 3 hours out (well past T-2h),
//   - neither block already targeted by a pending float-in,
//   - the date's profile has floating enabled.
//
// Each test overrides exactly the one facet it exercises so the failing
// reason is unambiguous.
// ---------------------------------------------------------------------

export type BuildValidationInputOpts = {
  initiator?: Partial<ForceTriggerInitiator>;
  destinationHouseId?: string;
  blocks?: ForceTriggerBlockSnapshot[];
  now?: Date;
  floatEnabled?: boolean;
};

export function makeValidationInput(
  opts: BuildValidationInputOpts = {},
): ForceTriggerValidationInput {
  const initiator: ForceTriggerInitiator = {
    rolesAtDestinationHouse: opts.initiator?.rolesAtDestinationHouse ?? ['sm'],
    isCurrentHmod: opts.initiator?.isCurrentHmod ?? false,
    ...(opts.initiator?.isScheduleAdmin !== undefined
      ? { isScheduleAdmin: opts.initiator.isScheduleAdmin }
      : {}),
  };

  return {
    initiator,
    destinationHouseId: opts.destinationHouseId ?? DESTINATION_HOUSE,
    blocks: opts.blocks ?? [
      makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: 180 }),
      makeBlock({ blockId: 'blk-2', startOffsetMinutesFromNow: 210 }),
    ],
    now: opts.now ?? NOW,
    floatEnabled: opts.floatEnabled ?? true,
  };
}

// Role presets for authorization tests.
export const ROLE_SM: ForceTriggerRole[] = ['sm'];
export const ROLE_HM: ForceTriggerRole[] = ['hm'];
export const ROLE_BM: ForceTriggerRole[] = ['bm'];
export const ROLE_SW: ForceTriggerRole[] = ['sw'];
export const ROLE_NONE: ForceTriggerRole[] = [];

// ---------------------------------------------------------------------
// Block-step-status lifecycle helpers
//
// The evaluator (phase 07 — `evaluateChainSteps`) consumes a
// step_name -> status map. These helpers translate the force-trigger
// step-mark sets into that map so the block-step-status lifecycle test
// can drive the real evaluator with the marks force-trigger writes.
// ---------------------------------------------------------------------

export type StepStatusMap = Record<ChainStepName, BlockStepStatusValue>;

export function marksToStepStatus(marks: ForceTriggerStepMark[]): StepStatusMap {
  return Object.fromEntries(marks.map((mark) => [mark.stepName, mark.status]));
}

// The same step set after a decline/no-ack rollback: every pre-marked
// step flips from `completed_via_force_trigger` to `rolled_back`.
export function rolledBackFrom(marks: ForceTriggerStepMark[]): StepStatusMap {
  return Object.fromEntries(marks.map((mark) => [mark.stepName, 'rolled_back' as const]));
}

// Helper: extract just the step names from an evaluator result.
export function evaluatedStepNames(result: ChainStepEvaluation[]): ChainStepName[] {
  return result.map((evaluation) => evaluation.stepName);
}
