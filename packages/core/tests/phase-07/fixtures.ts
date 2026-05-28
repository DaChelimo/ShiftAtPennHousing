// Phase 07 — Orchestrator and Escalation Chain: shared test types and
// fixture builders.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §5.2 (drop escalation timing),
//                                §5.4 (escalation chain — regular vs winter),
//                                §5.5 (one-way; fresh-late-drop semantics),
//                                §6.6 #7 (force-trigger decline chain resumption),
//                                §7.1 (acknowledgment cadence),
//                                §7.2 (declining a float),
//                                §7.3 (no-ack trigger at T-15m),
//                                §10.1 (notification routing rules),
//                                §10.2 (specific routing cases — worked examples);
//   ARCHITECTURE.md §4.1 (orchestrator scan loop, block_step_status, rollback),
//                   §4.2 (chain step implementations),
//                   §4.4 (no-ack trigger logic),
//                   §4.5 (force-trigger pathway, source-side reconciliation),
//                   §4.6 (notification routing — HM hours boundary).
//
// Functions under test (TDD — not yet implemented):
//
//   packages/core/src/orchestrator/evaluate.ts
//     export function evaluateChainSteps(input): ChainStepEvaluation[]
//
//   packages/core/src/orchestrator/routing.ts
//     export function resolveNotificationRecipient(input): 'hm' | 'hmod'
//
//   packages/core/src/orchestrator/no-ack.ts
//     export function decideNoAckAction(input): NoAckOutcome
//
// All three are PURE FUNCTIONS. The orchestrator (DB-side pg_cron tick
// + SQL handlers in phase-08) snapshots DB state, calls these pure
// functions, and writes the resulting actions inside a transaction.
//
// This file defines the types the implementation MUST satisfy and the
// small helper factories the test files use to build inputs.
// Re-exporting types from `../../src/orchestrator/types.js` rather
// than defining them locally guarantees a type drift between
// implementation and tests will surface as a TypeScript error.

import type {
  BlockStepStatusValue,
  ChainStep,
  ChainStepEvaluation,
  ChainStepName,
  DecideNoAckActionInput,
  EvaluateChainStepsInput,
  NoAckOutcome,
  NotificationRecipient,
  ResolveNotificationRecipientInput,
  SourceSideAction,
  SourceSideAtTriggerTime,
} from '../../src/orchestrator/types.js';

export type {
  BlockStepStatusValue,
  ChainStep,
  ChainStepEvaluation,
  ChainStepName,
  DecideNoAckActionInput,
  EvaluateChainStepsInput,
  NoAckOutcome,
  NotificationRecipient,
  ResolveNotificationRecipientInput,
  SourceSideAction,
  SourceSideAtTriggerTime,
};

// ---------------------------------------------------------------------
// Time anchors. May 28, 2026 is a Thursday (weekday) in EDT.
// May 30, 2026 is a Saturday; May 31, 2026 is a Sunday.
// All anchors are pinned to America/New_York wall-clock semantics —
// the routing function is tested against the local clock per ARCH §4.6.
// ---------------------------------------------------------------------

export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const BLOCK_MS = 30 * MINUTE_MS;

// Thursday 2026-05-28 at the named hour (EDT is -04:00).
export function thursdayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-05-28T${h}:${m}:00-04:00`);
}

// Friday 2026-05-29.
export function fridayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-05-29T${h}:${m}:00-04:00`);
}

// Saturday 2026-05-30.
export function saturdayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-05-30T${h}:${m}:00-04:00`);
}

// Sunday 2026-05-31.
export function sundayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-05-31T${h}:${m}:00-04:00`);
}

// Monday 2026-06-01.
export function mondayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-06-01T${h}:${m}:00-04:00`);
}

// Tuesday 2026-06-02 — used for §10.2 worked example.
export function tuesdayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-06-02T${h}:${m}:00-04:00`);
}

// Wednesday 2026-06-03 — used for §10.2 worked example.
export function wednesdayAt(hour: number, minute = 0): Date {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return new Date(`2026-06-03T${h}:${m}:00-04:00`);
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

// ---------------------------------------------------------------------
// Chain step builders
//
// Match the seed.sql escalation_chain JSON: offsets are negative minutes.
// ---------------------------------------------------------------------

export const REGULAR_PROFILE_CHAIN: ChainStep[] = [
  { stepName: 'broadcast', offsetMinutes: -180 },
  { stepName: 'float_lookup', offsetMinutes: -120 },
  {
    stepName: 'hmod_notify_allied',
    offsetMinutes: -120,
    trigger: 'on_float_failure',
  },
];

export const WINTER_PROFILE_CHAIN: ChainStep[] = [
  { stepName: 'broadcast', offsetMinutes: -180 },
  { stepName: 'hmod_notify_allied', offsetMinutes: -120 },
];

export const SHORT_BREAK_PROFILE_CHAIN: ChainStep[] = [
  { stepName: 'broadcast', offsetMinutes: -180 },
  { stepName: 'float_lookup', offsetMinutes: -120 },
  {
    stepName: 'hmod_notify_allied',
    offsetMinutes: -120,
    trigger: 'on_float_failure',
  },
];

// ---------------------------------------------------------------------
// Step-status snapshot builders
//
// The orchestrator reads existing block_step_status rows as a map from
// step_name → status. Empty map = no rows; matches the fresh-gap case.
// ---------------------------------------------------------------------

export type StepStatusMap = Record<ChainStepName, BlockStepStatusValue>;

export function noStatus(): StepStatusMap {
  return {};
}

export function withStatus(
  ...entries: Array<[ChainStepName, BlockStepStatusValue]>
): StepStatusMap {
  return Object.fromEntries(entries);
}

// Force-trigger pre-mark snapshot: broadcast + float_lookup completed_via_force_trigger.
export function forceTriggerPreMark(): StepStatusMap {
  return {
    broadcast: 'completed_via_force_trigger',
    float_lookup: 'completed_via_force_trigger',
  };
}

// Force-trigger rollback snapshot: both pre-marked rows rolled back.
export function forceTriggerRolledBack(): StepStatusMap {
  return {
    broadcast: 'rolled_back',
    float_lookup: 'rolled_back',
  };
}

// ---------------------------------------------------------------------
// Evaluator-input convenience constructor
// ---------------------------------------------------------------------

export type BuildEvaluateInputOpts = {
  blockStartAt: Date;
  now: Date;
  chain?: ChainStep[];
  stepStatus?: StepStatusMap;
};

export function makeEvaluateInput(opts: BuildEvaluateInputOpts): EvaluateChainStepsInput {
  return {
    blockStartAt: opts.blockStartAt,
    now: opts.now,
    chain: opts.chain ?? REGULAR_PROFILE_CHAIN,
    stepStatus: opts.stepStatus ?? noStatus(),
  };
}

// Helper: extract just the step names from an evaluator result.
export function evaluatedStepNames(result: ChainStepEvaluation[]): ChainStepName[] {
  return result.map((e) => e.stepName);
}

// ---------------------------------------------------------------------
// No-ack decider builders
// ---------------------------------------------------------------------

export type BuildNoAckInputOpts = {
  floatStartAt: Date;
  triggerAt?: Date; // defaults to floatStartAt - 15min
  acknowledgedAt?: Date | null;
  declinedAt?: Date | null;
  initiatedBy?: 'automated' | 'force_triggered';
  sourceSideAtTriggerTime?: SourceSideAtTriggerTime;
};

export function makeNoAckInput(opts: BuildNoAckInputOpts): DecideNoAckActionInput {
  const triggerAt = opts.triggerAt ?? plusMinutes(opts.floatStartAt, -15);
  const initiatedBy = opts.initiatedBy ?? 'automated';
  const sourceSideAtTriggerTime: SourceSideAtTriggerTime =
    opts.sourceSideAtTriggerTime ??
    (initiatedBy === 'automated'
      ? { kind: 'automated' }
      : { kind: 'force_triggered_still_vacant' });

  return {
    triggerAt,
    floatStartAt: opts.floatStartAt,
    acknowledgedAt: opts.acknowledgedAt ?? null,
    declinedAt: opts.declinedAt ?? null,
    initiatedBy,
    sourceSideAtTriggerTime,
  };
}

// ---------------------------------------------------------------------
// Routing-input convenience constructor
// ---------------------------------------------------------------------

export function makeRoutingInput(now: Date, blockStartAt: Date): ResolveNotificationRecipientInput {
  return { now, blockStartAt };
}
