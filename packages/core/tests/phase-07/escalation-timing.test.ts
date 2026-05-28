// Phase 07 — Escalation Chain: timing evaluator (`evaluateChainSteps`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §5.4 (chain steps + offsets per profile),
//                                §5.5 (one-way escalation;
//                                      fresh-late-drop semantics),
//                                §6.6 #7 (force-trigger decline chain
//                                         resumption rules);
//   ARCHITECTURE.md §4.1 (block_step_status, "not yet processed",
//                          rolled_back semantics),
//                   §4.2 (chain step implementations),
//                   §4.4 (no-ack rollback at T-15m → only HMOD remains).
//
// Pinned decisions exercised (see tests/PHASE_07/TEST_PLAN.md):
//   #1  — "offset reached" is inclusive at exactly the offset
//   #2  — rolled_back row + offset in past = skip; in future = fires normally
//   #3  — fresh-late-drop: strictly-later step's reached offset triggers skip;
//          same-offset peers do NOT skip
//   #4  — trigger='on_float_failure' is included by the evaluator; handler
//          enforces the trigger condition
//   #5  — stale block (now >= blockStartAt) → evaluator returns empty
//   #18 — winter profile chain handled like any other chain
//   #19 — multiple-due-step return order is chain order
//   #20 — `fired` and `completed_via_force_trigger` block re-fire identically

import { describe, expect, it } from 'vitest';

import { evaluateChainSteps } from '../../src/orchestrator/evaluate.js';

import {
  SHORT_BREAK_PROFILE_CHAIN,
  WINTER_PROFILE_CHAIN,
  evaluatedStepNames,
  forceTriggerPreMark,
  forceTriggerRolledBack,
  makeEvaluateInput,
  noStatus,
  plusHours,
  plusMilliseconds,
  plusMinutes,
  thursdayAt,
  withStatus,
} from './fixtures.js';

// Convention used throughout this file:
//
//   block_start = Thursday 19:00 EDT (a weekday evening block).
//   T-3h = 16:00; T-2h = 17:00. T-15m = 18:45 (no-ack trigger anchor).
//
// We pick 19:00 specifically so routing concerns (HM hours boundary)
// are out of scope — that's a separate test file.

const BLOCK_START = thursdayAt(19, 0);
const T_MINUS_3H = thursdayAt(16, 0);
const T_MINUS_2H = thursdayAt(17, 0);

// ---------------------------------------------------------------------
// 1. Offset reached — inclusive boundary at exactly the offset
//    (pinned decision #1)
// ---------------------------------------------------------------------

describe('offset reached — inclusive boundary at exactly the offset (pinned #1)', () => {
  it('at exactly T-3h (broadcast offset), broadcast fires', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({ blockStartAt: BLOCK_START, now: T_MINUS_3H }),
    );

    expect(evaluatedStepNames(result)).toEqual(['broadcast']);
  });

  it('at exactly T-2h (float_lookup offset), float_lookup fires', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: withStatus(['broadcast', 'fired']),
      }),
    );

    // float_lookup AND hmod_notify_allied are both at -2h; both included.
    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });

  it('1 millisecond before T-3h, broadcast does NOT fire', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMilliseconds(T_MINUS_3H, -1),
      }),
    );

    expect(result).toEqual([]);
  });

  it('1 millisecond after T-2h, float_lookup is included', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMilliseconds(T_MINUS_2H, 1),
        stepStatus: withStatus(['broadcast', 'fired']),
      }),
    );

    expect(evaluatedStepNames(result)).toContain('float_lookup');
  });
});

// ---------------------------------------------------------------------
// 2. Future offsets — evaluator returns empty when nothing due
// ---------------------------------------------------------------------

describe('future offsets — evaluator returns empty when nothing due', () => {
  it('at T-4h (before any step offset), evaluator returns empty', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusHours(BLOCK_START, -4),
      }),
    );

    expect(result).toEqual([]);
  });

  it('at T-3h-1m (broadcast offset NOT yet reached), evaluator returns empty', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_3H, -1),
      }),
    );

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 3. Empty inputs — sanity
// ---------------------------------------------------------------------

describe('empty inputs — sanity', () => {
  it('empty chain → empty result regardless of time', () => {
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: T_MINUS_2H,
      chain: [],
      stepStatus: noStatus(),
    });

    expect(result).toEqual([]);
  });

  it('empty stepStatus is treated as "no rows" — chain advances normally', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: noStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['broadcast']);
  });
});

// ---------------------------------------------------------------------
// 4. `fired` row blocks re-fire (pinned decision #20)
// ---------------------------------------------------------------------

describe('`fired` row blocks re-fire (pinned #20)', () => {
  it('broadcast fired → not included on later tick at same offset', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_3H, 1),
        stepStatus: withStatus(['broadcast', 'fired']),
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
  });

  it('all chain steps fired → empty result at T-2h+', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_2H, 5),
        stepStatus: withStatus(
          ['broadcast', 'fired'],
          ['float_lookup', 'fired'],
          ['hmod_notify_allied', 'fired'],
        ),
      }),
    );

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 5. `completed_via_force_trigger` row blocks re-fire (pinned #20)
// ---------------------------------------------------------------------

describe('`completed_via_force_trigger` row blocks re-fire (pinned #20)', () => {
  it('broadcast completed_via_force_trigger → not included even at offset', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: withStatus(['broadcast', 'completed_via_force_trigger']),
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
  });

  it('force-trigger pre-mark on broadcast + float_lookup → no chain steps fire pre-rollback', () => {
    // Force-triggered float is acknowledged & active; chain steps stay
    // completed_via_force_trigger. At T-2h, no orchestrator-driven step
    // should fire because both pre-marked steps are "done."
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: forceTriggerPreMark(),
      }),
    );

    // hmod_notify_allied has no row but its trigger is on_float_failure;
    // pinned #4 says the evaluator includes it whenever its offset is
    // reached and no row exists. The handler will suppress the actual
    // write since float_lookup is "successful" (force-triggered active).
    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 6. `rolled_back` row + offset in future → fires at offset (pinned #2)
//
//    Case: force-trigger applied early (e.g., at T-5h), floater declines
//    immediately (at T-4.5h). At T-4.5h, broadcast(-3h) and
//    float_lookup(-2h) offsets are both in the future. They will fire
//    normally when their offsets are reached.
// ---------------------------------------------------------------------

describe('`rolled_back` row + offset in future → fires at offset (pinned #2)', () => {
  it('rollback at T-4.5h, scan at T-4.5h → empty (offsets all future)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusHours(BLOCK_START, -4.5),
        stepStatus: forceTriggerRolledBack(),
      }),
    );

    expect(result).toEqual([]);
  });

  it('rollback at T-4.5h, scan at T-3h → broadcast fires (rolled_back offset reached normally)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_3H,
        stepStatus: forceTriggerRolledBack(),
      }),
    );

    expect(evaluatedStepNames(result)).toContain('broadcast');
  });
});

// ---------------------------------------------------------------------
// 7. `rolled_back` row + offset in past → skipped (pinned #2)
//
//    Case: force-trigger no-ack at T-15m. Both broadcast and float_lookup
//    were force-completed; both rolled back. Both offsets are in the past.
//    Per spec §6.6 #7 third bullet, neither re-fires; only hmod_notify_allied
//    fires.
// ---------------------------------------------------------------------

describe('`rolled_back` row + offset in past → skipped (pinned #2)', () => {
  it('rollback at T-15m → only hmod_notify_allied is returned', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -15),
        stepStatus: forceTriggerRolledBack(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });

  it('rollback at T-1h → only hmod_notify_allied is returned (T-2h is past)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusHours(BLOCK_START, -1),
        stepStatus: forceTriggerRolledBack(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });

  it('rollback with broadcast rolled_back at T-2.5h (between -3h and -2h) — broadcast offset is past, skip', () => {
    // Force-trigger decline arrives between -3h and -2h: only broadcast
    // is past its offset, float_lookup is still in the future.
    // Per BSpec §6.6 #7 second bullet: broadcast skipped (it was
    // logically attempted via force-trigger); float_lookup fires at T-2h.
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_3H, 30), // -2.5h
        stepStatus: forceTriggerRolledBack(),
      }),
    );

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(evaluatedStepNames(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 8. Fresh-late drop within 2h: broadcast skipped, float_lookup fires
//    (pinned decisions #3, #4)
//
//    BSpec §5.5: "if the gap is within 2 hours of start, float lookup
//    fires immediately." A gap at T-1h has no block_step_status rows.
//    broadcast (-3h) is in the past, float_lookup (-2h) is also in the
//    past. Per pinned #3, broadcast is skipped because a STRICTLY LATER
//    step (float_lookup at a strictly later offset) is also reached.
//    float_lookup fires; hmod_notify_allied at the SAME offset is also
//    included.
// ---------------------------------------------------------------------

describe('fresh-late drop within 2h — broadcast skipped, float_lookup fires (pinned #3, #4)', () => {
  it('fresh drop at T-1h → float_lookup + hmod_notify_allied; broadcast skipped', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusHours(BLOCK_START, -1),
        stepStatus: noStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });

  it('fresh drop at T-90m → float_lookup + hmod_notify_allied; broadcast skipped', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -90),
        stepStatus: noStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });

  it('fresh drop at exactly T-2h → float_lookup + hmod_notify_allied; broadcast skipped', () => {
    // At T-2h sharp, broadcast(-3h) is past and float_lookup(-2h) is
    // exactly at offset. Strictly-later-offset step is at its offset
    // (inclusive boundary, pinned #1) → broadcast is skipped.
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: noStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 9. Fresh-late drop within 30m — same as 1h case (still only HMOD-or-float-lookup)
//    (pinned #3 — same-offset peers don't skip)
// ---------------------------------------------------------------------

describe('fresh-late drop within 30m — float_lookup still fires (pinned #3)', () => {
  it('fresh drop at T-30m → float_lookup + hmod_notify_allied', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -30),
        stepStatus: noStatus(),
      }),
    );

    // hmod_notify_allied is at the SAME offset as float_lookup (-2h);
    // by pinned #3, same-offset peers do NOT trigger skip — float_lookup
    // is returned alongside hmod_notify_allied.
    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });

  it('fresh drop at T-5m → float_lookup + hmod_notify_allied', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -5),
        stepStatus: noStatus(),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 10. Missed tick — multiple steps eligible (pinned decision #19)
//
//    The orchestrator missed several ticks; broadcast was never fired.
//    At T-30m, we expect chain order to govern.
// ---------------------------------------------------------------------

describe('missed tick — multiple steps eligible, returned in chain order (pinned #19)', () => {
  it('no rows + late scan at T-30m → returned in chain order [float_lookup, hmod_notify_allied]', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, -30),
        stepStatus: noStatus(),
      }),
    );

    // Even after skipping broadcast (pinned #3), the remaining steps
    // come back in chain order (their declaration order in the chain).
    expect(result).toEqual([
      { stepName: 'float_lookup' },
      { stepName: 'hmod_notify_allied', trigger: 'on_float_failure' },
    ]);
  });

  it('multiple steps preserve their original ChainStep shape (incl. trigger field)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: withStatus(['broadcast', 'fired']),
      }),
    );

    const hmod = result.find((s) => s.stepName === 'hmod_notify_allied');
    expect(hmod).toBeDefined();
    expect(hmod!.trigger).toBe('on_float_failure');
  });
});

// ---------------------------------------------------------------------
// 11. Winter profile chain — broadcast → HMOD, no float_lookup (pinned #18)
// ---------------------------------------------------------------------

describe('winter profile chain — broadcast → HMOD, no float_lookup (pinned #18)', () => {
  it('at T-3h on winter profile → broadcast only', () => {
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: T_MINUS_3H,
      chain: WINTER_PROFILE_CHAIN,
      stepStatus: noStatus(),
    });

    expect(evaluatedStepNames(result)).toEqual(['broadcast']);
  });

  it('at T-2h on winter profile → hmod_notify_allied (no trigger field)', () => {
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: T_MINUS_2H,
      chain: WINTER_PROFILE_CHAIN,
      stepStatus: withStatus(['broadcast', 'fired']),
    });

    // Winter chain's hmod_notify_allied has NO trigger field; evaluator
    // returns it without a trigger marker.
    expect(result).toEqual([{ stepName: 'hmod_notify_allied' }]);
  });

  it('winter profile, fresh drop at T-1h → hmod_notify_allied (broadcast skipped via strictly-later offset)', () => {
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: plusHours(BLOCK_START, -1),
      chain: WINTER_PROFILE_CHAIN,
      stepStatus: noStatus(),
    });

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 12. Trigger='on_float_failure' is included by evaluator regardless of prior outcomes
//     (pinned #4)
//
//     The evaluator does not inspect what float_lookup did. It always
//     returns hmod_notify_allied when its offset is reached and it has
//     no row. The handler decides whether to actually fire.
// ---------------------------------------------------------------------

describe("trigger='on_float_failure' is included by evaluator regardless of prior outcomes (pinned #4)", () => {
  it('float_lookup not yet fired this tick — hmod_notify_allied still included', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: withStatus(['broadcast', 'fired']),
      }),
    );

    expect(evaluatedStepNames(result)).toContain('hmod_notify_allied');
  });

  it('float_lookup already fired (previous tick) — hmod_notify_allied with no row STILL included', () => {
    // If float_lookup ran but the orchestrator died before writing hmod_notify_allied,
    // a re-scan must include hmod_notify_allied so the handler can fire Allied if
    // float_lookup had failed.
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_2H, 1),
        stepStatus: withStatus(['broadcast', 'fired'], ['float_lookup', 'fired']),
      }),
    );

    expect(evaluatedStepNames(result)).toEqual(['hmod_notify_allied']);
  });

  it('hmod_notify_allied already fired → not re-included', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(T_MINUS_2H, 1),
        stepStatus: withStatus(
          ['broadcast', 'fired'],
          ['float_lookup', 'fired'],
          ['hmod_notify_allied', 'fired'],
        ),
      }),
    );

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 13. Stale block — evaluator returns empty (pinned decision #5)
//
//    The orchestrator should not process blocks whose start time has
//    passed. The evaluator guards this; the orchestrator's scan query
//    is the primary defense (it uses `blockStartAt > now`).
// ---------------------------------------------------------------------

describe('stale block — evaluator returns empty (pinned #5)', () => {
  it('block in the past (now > blockStartAt) → empty result', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, 5),
        stepStatus: noStatus(),
      }),
    );

    expect(result).toEqual([]);
  });

  it('block start exactly equals now → empty result', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: BLOCK_START,
        stepStatus: noStatus(),
      }),
    );

    expect(result).toEqual([]);
  });

  it('block 30 minutes in the past, fully rolled_back chain → still empty', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: plusMinutes(BLOCK_START, 30),
        stepStatus: forceTriggerRolledBack(),
      }),
    );

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// 14. Same-offset peers don't trigger skip (pinned #3)
//
//    float_lookup(-2h) and hmod_notify_allied(-2h) share an offset.
//    hmod_notify_allied's reached offset must NOT cause float_lookup
//    to be skipped (they're peers, not predecessor/successor by offset).
// ---------------------------------------------------------------------

describe('same-offset peers do not trigger skip (pinned #3)', () => {
  it('at T-2h with broadcast fired → float_lookup is returned (not skipped by HMOD peer)', () => {
    const result = evaluateChainSteps(
      makeEvaluateInput({
        blockStartAt: BLOCK_START,
        now: T_MINUS_2H,
        stepStatus: withStatus(['broadcast', 'fired']),
      }),
    );

    expect(evaluatedStepNames(result)).toContain('float_lookup');
  });

  it('short_break profile (also has float_lookup + hmod at -2h) — same behavior', () => {
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: T_MINUS_2H,
      chain: SHORT_BREAK_PROFILE_CHAIN,
      stepStatus: withStatus(['broadcast', 'fired']),
    });

    expect(evaluatedStepNames(result)).toEqual(['float_lookup', 'hmod_notify_allied']);
  });
});

// ---------------------------------------------------------------------
// 15. Strictly-later offset triggers skip (pinned #3)
// ---------------------------------------------------------------------

describe('strictly-later offset triggers skip (pinned #3)', () => {
  it('hypothetical 4-step chain: broadcast(-3h), pre_lookup(-2h30m), float_lookup(-2h), hmod(-2h) — at T-2.5h, broadcast skipped', () => {
    // Pre-lookup is strictly later than broadcast and its offset is
    // reached: broadcast should be skipped.
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: plusMinutes(BLOCK_START, -150), // T-2h30m
      chain: [
        { stepName: 'broadcast', offsetMinutes: -180 },
        { stepName: 'pre_lookup', offsetMinutes: -150 },
        { stepName: 'float_lookup', offsetMinutes: -120 },
        {
          stepName: 'hmod_notify_allied',
          offsetMinutes: -120,
          trigger: 'on_float_failure',
        },
      ],
      stepStatus: noStatus(),
    });

    expect(evaluatedStepNames(result)).not.toContain('broadcast');
    expect(evaluatedStepNames(result)).toContain('pre_lookup');
  });

  it('hypothetical chain with reached strictly-later step but earlier step has fired row — earlier step is fired, not "skipped"', () => {
    // The "skip" rule is for NO-ROW + offset-past. A fired row is
    // already done — it's not skipped, it's complete.
    const result = evaluateChainSteps({
      blockStartAt: BLOCK_START,
      now: plusMinutes(BLOCK_START, -150),
      chain: [
        { stepName: 'broadcast', offsetMinutes: -180 },
        { stepName: 'pre_lookup', offsetMinutes: -150 },
      ],
      stepStatus: withStatus(['broadcast', 'fired']),
    });

    expect(evaluatedStepNames(result)).toEqual(['pre_lookup']);
  });
});
