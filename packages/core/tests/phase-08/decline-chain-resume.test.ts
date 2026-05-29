// Phase 08 — Force-Trigger Pathway: standard-chain resumption after a
// force-triggered float is declined (BSpec §6.6 #7).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.6 #7:
//     "If the floater declines, the float assignment is voided and the
//      destination block returns to `vacant` status... The standard
//      escalation chain then resumes from the beginning:
//        - if T-3h has not yet been reached, the broadcast fires at T-3h
//          normally;
//        - if T-3h has already passed but T-2h has not, the broadcast is
//          skipped and float lookup fires at T-2h (with the decliner
//          excluded);
//        - if T-2h has already passed, the gap goes directly to
//          HMOD-for-Allied.";
//   ARCHITECTURE.md §4.5 "Rollback procedure" (decline flips the
//                          force-trigger pre-marks broadcast + float_lookup
//                          to `rolled_back` in the same transaction as the
//                          void; the orchestrator then re-evaluates the
//                          chain offsets against the current time).
//
// THIS FILE IS GREEN AGAINST CURRENT CODE. The chain-resume DECISION is
// the deployed evaluator `evaluateChainSteps` (phase 07) reading the
// rolled-back marks the decline writes. We test the three §6.6 #7 bands
// from a phase-08 decline lens, reusing the canonical phase-07 evaluator
// fixtures so the phase-08 framing cannot diverge from the phase-07
// interpretation of the same rules.
//
// What is NOT modeled here (covered in supabase/tests/phase-08-force-
// trigger.sql, pgTAP):
//   - the float void + destination→vacant write,
//   - the decliner's `float_exclusions` row (so the T-2h float_lookup
//     that fires below runs WITH the decliner excluded),
//   - source-side reconciliation (restore vs displace).
// The evaluator's job is purely "which step fires on this tick"; the
// exclusion is a separate DB write the float lookup algorithm reads.

import { describe, expect, it } from 'vitest';

import { evaluateChainSteps } from '../../src/orchestrator/evaluate.js';
import {
  evaluatedStepNames,
  forceTriggerRolledBack,
  makeEvaluateInput,
  plusHours,
  plusMilliseconds,
  plusMinutes,
  thursdayAt,
} from '../phase-07/fixtures.js';

// Anchor convention (identical to phase-07 escalation-timing tests):
//   block_start = Thursday 19:00 EDT; T-3h = 16:00; T-2h = 17:00.
// We pick 19:00 so HM-hours routing is out of scope.
const BLOCK_START = thursdayAt(19, 0);
const T_MINUS_3H = thursdayAt(16, 0);
const T_MINUS_2H = thursdayAt(17, 0);

// After a decline, both pre-marked steps are `rolled_back`. This is the
// exact post-rollback block_step_status snapshot decline_float writes for
// a force-triggered float (ARCH §4.5; see phase-07 fixtures).
const POST_DECLINE_STATUS = forceTriggerRolledBack();

// ---------------------------------------------------------------------
// Scenario A — T-3h has NOT yet been reached at decline time.
//   "the broadcast fires at T-3h normally" (§6.6 #7 first bullet).
//
//   Decline lands early (e.g., the SM force-triggered at T-5h and the
//   floater declined at T-4.5h). Both chain offsets are still in the
//   future, so the chain runs from the top: broadcast at T-3h, then
//   float_lookup at T-2h.
// ---------------------------------------------------------------------

describe('Scenario A — decline before T-3h: broadcast fires at T-3h normally (§6.6 #7)', () => {
  it('immediately after the decline (T-4.5h), nothing fires yet — both offsets future', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusHours(BLOCK_START, -4.5),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(result).toEqual([]);
  });

  it('at T-3h-1m, broadcast has not fired yet', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_3H, -1),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(result).toEqual([]);
  });

  it('at exactly T-3h, broadcast fires (chain resumed from the beginning)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['broadcast']);
  });

  it('then at T-2h, float_lookup fires (with hmod_notify_allied peer at the same offset)', () => {
    // After broadcast re-fired (its row now `fired`), the next tick at
    // T-2h advances to float_lookup. We model that follow-on tick with a
    // `fired` broadcast row.
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: { broadcast: 'fired' },
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// Scenario A (boundary) — "Chain resumes after decline at T-3h boundary
//   exactly → broadcast step fires at T-3h, not immediately."
//
//   This is the explicit edge case from the phase-08 brief. The decline
//   happened earlier; the resumed chain must wait for the T-3h offset
//   rather than firing broadcast the instant the rollback is observed.
// ---------------------------------------------------------------------

describe('Scenario A boundary — resumed broadcast waits for T-3h, not immediate', () => {
  it('1ms before T-3h → broadcast does NOT fire', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMilliseconds(T_MINUS_3H, -1),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(result).toEqual([]);
  });

  it('at exactly T-3h → broadcast fires (inclusive offset boundary, phase-07 pinned #1)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['broadcast']);
  });

  it('within the same minute as T-3h (cron jitter) → broadcast still fires', () => {
    // Orchestrator is pg_cron-driven on a minute cadence; the resumed
    // broadcast must tolerate sub-minute jitter at the offset boundary
    // (phase-07 audit finding C-2).
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMilliseconds(T_MINUS_3H, 30_000),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toContain('broadcast');
  });
});

// ---------------------------------------------------------------------
// Scenario B — T-3h has passed but T-2h has NOT, at decline time.
//   "the broadcast is skipped and float lookup fires at T-2h (with the
//    decliner excluded)" (§6.6 #7 second bullet).
//
//   broadcast(-3h) is in the past → rolled_back + past → SKIPPED
//   (phase-07 pinned #2). float_lookup(-2h) is still in the future →
//   fires when its offset is reached.
// ---------------------------------------------------------------------

describe('Scenario B — decline between T-3h and T-2h: broadcast skipped, float_lookup at T-2h (§6.6 #7)', () => {
  it('at decline time T-2.5h, nothing fires — broadcast skipped, float_lookup still future', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_3H, 30), // -2h30m
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(result).toEqual([]);
  });

  it('at exactly T-2h, float_lookup fires; broadcast stays skipped', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });

  it('1ms after T-2h, float_lookup is still included (broadcast remains skipped)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMilliseconds(T_MINUS_2H, 1),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toContain('float_lookup');
    expect(evaluatedStepNames(result)).not.toContain('broadcast');
  });
});

// ---------------------------------------------------------------------
// Scenario C — T-2h has already passed at decline time.
//   "the gap goes directly to HMOD-for-Allied" (§6.6 #7 third bullet).
//
//   Both offsets are in the past → both rolled_back steps are SKIPPED;
//   only hmod_notify_allied (no row) remains live.
// ---------------------------------------------------------------------

describe('Scenario C — decline after T-2h: straight to HMOD-for-Allied (§6.6 #7)', () => {
  it('decline at T-1h → only hmod_notify_allied', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusHours(BLOCK_START, -1),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });

  it('decline at T-30m → only hmod_notify_allied (no broadcast, no float_lookup)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -30),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });

  it('decline exactly at T-2h → already HMOD territory: float_lookup at its offset + HMOD', () => {
    // At exactly T-2h the float_lookup offset is reached (inclusive),
    // so the resumed chain still fires float_lookup once with the
    // decliner excluded; hmod_notify_allied accompanies it. One tick
    // later (Scenario C above) only HMOD remains.
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// No re-fire once the resumed chain has completed.
//
//   After the resumed chain runs to completion (broadcast fired,
//   float_lookup fired, hmod fired), no further step is returned — the
//   chain is one-way (BSpec §5.5).
// ---------------------------------------------------------------------

describe('resumed chain is one-way — no re-fire after completion', () => {
  it('all steps fired after resume → empty result', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_2H, 5),
        stepStatus: {
          broadcast: 'fired',
          float_lookup: 'fired',
          hmod_notify_allied: 'fired',
        },
      }),
    );

    expect(result).toEqual([]);
  });

  it('a second decline after re-escalation does not resurrect a passed offset', () => {
    // If a re-assigned (automated) float is itself declined after T-2h,
    // the chain still only has hmod_notify_allied live — the passed
    // offsets never re-open. (broadcast/float_lookup here are `fired`
    // from the resumed run, not rolled_back again.)
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -45),
        stepStatus: { broadcast: 'fired', float_lookup: 'fired' },
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// Stale-gap guard — a decline that lands after the block has started
// produces no chain action (phase-07 pinned #5).
// ---------------------------------------------------------------------

describe('stale gap — decline after block start fires nothing', () => {
  it('now == block start → empty', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: BLOCK_START,
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(result).toEqual([]);
  });

  it('now 5m past block start → empty', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, 5),
        stepStatus: POST_DECLINE_STATUS,
      }),
    );

    expect(result).toEqual([]);
  });
});
