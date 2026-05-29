// Phase 08 — Force-Trigger Pathway: block_step_status state machine.
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.6 #2 (force-trigger bypasses the
//                                broadcast step and the wait-for-T-2h
//                                check — invokes float lookup immediately),
//                                §6.6 #8 (no-takeback: a pending
//                                force-triggered float is firm; the
//                                automated system may not recall it),
//                                §6.6 #9 (no-floater fallback → HMOD-for-
//                                Allied; the standard chain does NOT
//                                re-fire);
//   ARCHITECTURE.md §4.5 (on SUCCESS the handler inserts, in the same
//                          transaction as the float assignment, exactly
//                          two block_step_status rows:
//                            (block_id, 'broadcast',
//                             'completed_via_force_trigger')
//                            (block_id, 'float_lookup',
//                             'completed_via_force_trigger')
//                          and the `hmod_notify_allied` step is NOT
//                          pre-marked, preserving the orchestrator's
//                          ability to fire it if the chain rolls back),
//                   §4.5 "Rollback procedure" (on decline/no-ack those
//                          two rows flip to `rolled_back`);
//   AGENTS.md hard invariant #3 (no-takeback rule).
//
// Two pure-function contracts are pinned here:
//
//   forceTriggerSuccessMarks(): ForceTriggerStepMark[]
//     The exact block_step_status rows a SUCCESSFUL force-trigger writes
//     per destination block.
//   forceTriggerRollbackSteps(): ChainStepName[]
//     The exact step names rolled back on decline/no-ack — the mirror of
//     phase-07 pinned decision #14 (`['broadcast', 'float_lookup']`).
//
// The lifecycle itself is driven through the DEPLOYED evaluator
// (`evaluateChainSteps`, phase 07) so the marks force-trigger writes are
// validated against the real orchestrator tick logic — no second copy
// of the chain-progression rules. This pins how the marks behave at each
// stage: pre-mark (active) → rolled_back (re-escalating).

import { describe, expect, it } from 'vitest';

import {
  forceTriggerRollbackSteps,
  forceTriggerSuccessMarks,
} from '../../src/force-trigger/index.js';
import { evaluateChainSteps } from '../../src/orchestrator/evaluate.js';
import {
  REGULAR_PROFILE_CHAIN,
  evaluatedStepNames,
  makeEvaluateInput,
  plusMilliseconds,
  plusMinutes,
  thursdayAt,
} from '../phase-07/fixtures.js';

import { marksToStepStatus, rolledBackFrom } from './fixtures.js';

// Same anchor convention as phase-07's escalation-timing tests:
//   block_start = Thursday 19:00 EDT; T-3h = 16:00; T-2h = 17:00.
const BLOCK_START = thursdayAt(19, 0);
const T_MINUS_3H = thursdayAt(16, 0);
const T_MINUS_2H = thursdayAt(17, 0);

// ---------------------------------------------------------------------
// 1. Success marks — exactly broadcast + float_lookup, both
//    completed_via_force_trigger (ARCH §4.5).
// ---------------------------------------------------------------------

describe('success marks — the rows a successful force-trigger writes (ARCH §4.5)', () => {
  it('marks broadcast and float_lookup as completed_via_force_trigger', () => {
    expect(forceTriggerSuccessMarks()).toEqual([
      { stepName: 'broadcast', status: 'completed_via_force_trigger' },
      { stepName: 'float_lookup', status: 'completed_via_force_trigger' },
    ]);
  });

  it('does NOT pre-mark hmod_notify_allied (must remain fireable on rollback)', () => {
    const markedSteps = forceTriggerSuccessMarks().map((mark) => mark.stepName);
    expect(markedSteps).not.toContain('hmod_notify_allied');
  });

  it('writes exactly two marks (broadcast + float_lookup, no more)', () => {
    expect(forceTriggerSuccessMarks()).toHaveLength(2);
  });

  it('every success mark uses the completed_via_force_trigger status (never plain fired)', () => {
    for (const mark of forceTriggerSuccessMarks()) {
      expect(mark.status).toBe('completed_via_force_trigger');
    }
  });
});

// ---------------------------------------------------------------------
// 2. Rollback step set — the mirror of phase-07 pinned #14.
// ---------------------------------------------------------------------

describe('rollback step set — what decline/no-ack rolls back', () => {
  it('rolls back exactly [broadcast, float_lookup] in that order', () => {
    expect(forceTriggerRollbackSteps()).toEqual(['broadcast', 'float_lookup']);
  });

  it('does NOT roll back hmod_notify_allied (it was never pre-marked)', () => {
    expect(forceTriggerRollbackSteps()).not.toContain('hmod_notify_allied');
  });

  it('the rolled-back steps are exactly the steps that were pre-marked on success', () => {
    const preMarked = forceTriggerSuccessMarks().map((mark) => mark.stepName);
    expect(forceTriggerRollbackSteps()).toEqual(preMarked);
  });
});

// ---------------------------------------------------------------------
// 3. Active pre-mark stage — the standard chain is suppressed while the
//    force-triggered float is live (pending or acknowledged).
//
//    This is the observable face of the bypass (§6.6 #2): with both
//    broadcast and float_lookup marked completed_via_force_trigger, the
//    evaluator will not re-fire them. Only hmod_notify_allied (no row,
//    trigger=on_float_failure) is returned at T-2h — and the handler
//    suppresses even that while the float is active, per phase-07
//    pinned #4.
// ---------------------------------------------------------------------

describe('active pre-mark stage — standard chain suppressed (§6.6 #2)', () => {
  const successStatus = () => marksToStepStatus(forceTriggerSuccessMarks());

  it('at T-3h, broadcast does NOT fire (pre-marked completed_via_force_trigger)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: successStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(result).toEqual([]);
  });

  it('at T-2h, neither broadcast nor float_lookup re-fires; only hmod_notify_allied is returned', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: successStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(evaluatedStepNames(result)).not.toContain('float_lookup');
    // hmod_notify_allied has no row + trigger=on_float_failure → the
    // evaluator returns it (phase-07 pinned #4); the handler suppresses
    // the actual write because the force-triggered float is still active.
    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 4. No-takeback — while pending, the automated system creates no
//    competing float lookup (§6.6 #8, AGENTS invariant #3).
//
//    The only way the chain re-fires float_lookup is via a rollback
//    (decline/no-ack), which is driven by the WORKER's action, not the
//    automated tick. As long as the marks stay completed_via_force_
//    trigger, no tick — at any time before block start — re-runs
//    float_lookup or broadcast. So no automated process can reassign or
//    recall the pending float.
// ---------------------------------------------------------------------

describe('no-takeback — automated system never recalls a pending force-trigger (§6.6 #8)', () => {
  const successStatus = () => marksToStepStatus(forceTriggerSuccessMarks());

  it('a late tick at T-30m never re-runs float_lookup while marks stand', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -30),
        stepStatus: successStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('float_lookup');
    expect(evaluatedStepNames(result)).not.toContain('broadcast');
  });

  it('at no scan time before block start does broadcast or float_lookup re-fire', () => {
    for (const minutesBefore of [180, 150, 120, 90, 60, 30, 15, 5]) {
      const result = evaluateChainSteps(
        makeEvaluateInput({
          blockStartAt: BLOCK_START,
          now: plusMinutes(BLOCK_START, -minutesBefore),
          stepStatus: successStatus(),
        }),
      );

      expect(evaluatedStepNames(result)).not.toContain('broadcast');
      expect(evaluatedStepNames(result)).not.toContain('float_lookup');
    }
  });
});

// ---------------------------------------------------------------------
// 5. Rollback stage — once decline/no-ack flips the marks to
//    rolled_back, the chain re-evaluates (ARCH §4.5 "Rollback
//    procedure"). The behavior at each time band is pinned in detail in
//    decline-chain-resume.test.ts; here we confirm the marks PRODUCED by
//    forceTriggerSuccessMarks, after being rolled back, drive the
//    evaluator's re-escalation.
// ---------------------------------------------------------------------

describe('rollback stage — rolled-back marks re-open the chain (ARCH §4.5)', () => {
  const rolledBack = () => rolledBackFrom(forceTriggerSuccessMarks());

  it('rolled_back broadcast fires when T-3h is reached after an early decline', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: rolledBack(),
      }),
    );

    expect(evaluatedStepNames(result)).toContain('broadcast');
  });

  it('rolled_back broadcast + float_lookup both in the past → only hmod_notify_allied', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -15),
        stepStatus: rolledBack(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 6. completed_via_force_trigger vs fired — provenance differs, re-fire
//    behavior is identical (phase-07 pinned #20). A force-trigger mark
//    suppresses re-fire exactly like a normal `fired` row.
// ---------------------------------------------------------------------

describe('completed_via_force_trigger suppresses re-fire identically to fired (pinned #20)', () => {
  it('broadcast completed_via_force_trigger at exactly its offset → not returned', () => {
    const successStatus = marksToStepStatus(forceTriggerSuccessMarks());

    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: successStatus,
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
  });

  it('1ms after T-3h, the pre-marked broadcast still does not re-fire', () => {
    const successStatus = marksToStepStatus(forceTriggerSuccessMarks());

    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMilliseconds(T_MINUS_3H, 1),
        stepStatus: successStatus,
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
  });
});

// ---------------------------------------------------------------------
// 7. Purity of the mark-producing helpers.
// ---------------------------------------------------------------------

describe('purity — mark helpers return fresh, stable values', () => {
  it('forceTriggerSuccessMarks returns an equal value on each call', () => {
    expect(forceTriggerSuccessMarks()).toEqual(forceTriggerSuccessMarks());
  });

  it('mutating a returned marks array does not affect the next call', () => {
    const first = forceTriggerSuccessMarks();
    first.pop();
    expect(forceTriggerSuccessMarks()).toHaveLength(2);
  });

  it('forceTriggerRollbackSteps returns an equal value on each call', () => {
    expect(forceTriggerRollbackSteps()).toEqual(forceTriggerRollbackSteps());
  });

  it('the regular profile chain has the broadcast/float_lookup steps the marks reference', () => {
    // Guards against drift: every step the force-trigger pre-marks must
    // exist in the deployed regular-profile chain.
    const chainSteps = REGULAR_PROFILE_CHAIN.map((step) => step.stepName);
    for (const mark of forceTriggerSuccessMarks()) {
      expect(chainSteps).toContain(mark.stepName);
    }
  });
});
