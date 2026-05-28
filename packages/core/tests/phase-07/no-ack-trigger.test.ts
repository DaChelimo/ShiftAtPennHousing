// Phase 07 — No-Ack Trigger: state-machine decider (`decideNoAckAction`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §7.1 (acknowledgment cadence —
//                                      deadline at float_start - 10m),
//                                §7.2 (declining a float — voids,
//                                      excludes, returns destination
//                                      to vacant, resumes chain),
//                                §7.3 (no-ack trigger at float_start - 15m
//                                      — applies decline-equivalent
//                                      behavior; T-2h always past at
//                                      trigger → directly to HMOD-for-Allied);
//   ARCHITECTURE.md §4.4 (no-ack trigger — rollback for force-triggered,
//                          T-15m semantics, "always HMOD"),
//                   §4.5 (force-trigger pathway — pre-marking of
//                          broadcast + float_lookup;
//                          source-side reconciliation outcomes).
//
// Pinned decisions exercised (see tests/PHASE_07/TEST_PLAN.md):
//   #11 — acknowledgedAt and declinedAt skip the action; both-set → ack wins
//   #12 — escalationNextStep is always 'hmod_notify_allied' in void cases
//   #13 — rolledBackSteps is [] for automated floats
//   #14 — rolledBackSteps is ['broadcast','float_lookup'] (in that order)
//          for force-triggered floats
//   #15 — source-side outcomes: still_vacant → restore; claimed_by_other
//          or covered_by_allied → mark_displaced; automated → none
//
// The function under test (TDD — not yet implemented):
//
//   packages/core/src/orchestrator/no-ack.ts
//     export function decideNoAckAction(
//       input: DecideNoAckActionInput
//     ): NoAckOutcome
//
// The function is PURE. The orchestrator's no-ack handler:
//   1. SELECT FOR UPDATE the float_assignments row (locks the float).
//   2. Snapshot acknowledgedAt, declinedAt, and source-side state.
//   3. Call decideNoAckAction with the snapshot.
//   4. Apply the returned actions inside the same transaction.
// This ensures the snapshot at decision time and the write-time state
// are identical (TOCTOU-safe).

import { describe, expect, it } from 'vitest';

import { decideNoAckAction } from '../../src/orchestrator/no-ack.js';

import { makeNoAckInput, plusMinutes, thursdayAt } from './fixtures.js';

// Convention used throughout this file:
//
//   float_start = Thursday 19:00 EDT.
//   trigger     = float_start - 15min = 18:45 EDT.
//   ack at      = 18:30 EDT (15 min before trigger; well before T-15m).
//   decline at  = 18:35 EDT (10 min before trigger).
//
// The decider is time-agnostic for the ack/decline cases — it just
// checks non-null timestamps. The trigger/floatStart times are
// captured in case the implementation needs them for cross-checks.

const FLOAT_START = thursdayAt(19, 0);
const TRIGGER_AT = plusMinutes(FLOAT_START, -15); // 18:45
const ACK_AT = thursdayAt(18, 30);
const DECLINE_AT = thursdayAt(18, 35);

// ---------------------------------------------------------------------
// 1. Acknowledged before trigger → skip (pinned #11)
// ---------------------------------------------------------------------

describe('acknowledged before trigger → skip (pinned #11)', () => {
  it('automated float + acknowledgedAt non-null → skip(reason: acknowledged)', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        acknowledgedAt: ACK_AT,
        initiatedBy: 'automated',
      }),
    );

    expect(outcome).toEqual({ kind: 'skip', reason: 'acknowledged' });
  });

  it('force-triggered float + acknowledgedAt non-null → skip(reason: acknowledged)', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        acknowledgedAt: ACK_AT,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_still_vacant' },
      }),
    );

    expect(outcome).toEqual({ kind: 'skip', reason: 'acknowledged' });
  });
});

// ---------------------------------------------------------------------
// 2. Declined before trigger → skip (pinned #11)
// ---------------------------------------------------------------------

describe('declined before trigger → skip (pinned #11)', () => {
  it('automated float + declinedAt non-null → skip(reason: declined)', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        declinedAt: DECLINE_AT,
        initiatedBy: 'automated',
      }),
    );

    expect(outcome).toEqual({ kind: 'skip', reason: 'declined' });
  });

  it('force-triggered float + declinedAt non-null → skip(reason: declined)', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        declinedAt: DECLINE_AT,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_claimed_by_other' },
      }),
    );

    expect(outcome).toEqual({ kind: 'skip', reason: 'declined' });
  });
});

// ---------------------------------------------------------------------
// 3. Both ack and decline non-null → acknowledged wins (pinned #11)
//
//    Pathological — the explicit-decline handler should have already
//    voided the float — but if both are set, ack takes precedence.
// ---------------------------------------------------------------------

describe('both ack and decline set → acknowledged wins (pinned #11)', () => {
  it('both timestamps non-null → skip(reason: acknowledged)', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        acknowledgedAt: ACK_AT,
        declinedAt: DECLINE_AT,
        initiatedBy: 'force_triggered',
      }),
    );

    expect(outcome).toEqual({ kind: 'skip', reason: 'acknowledged' });
  });
});

// ---------------------------------------------------------------------
// 4. Automated + neither set → void, exclude, vacant, [] rollback,
//    no source-side action, HMOD next (pinned #12, #13, #15)
// ---------------------------------------------------------------------

describe('automated no-ack — full outcome (pinned #12, #13, #15)', () => {
  it('automated no-ack → void_and_reescalate with [] rollback and source-side: none', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'automated',
      }),
    );

    expect(outcome).toEqual({
      kind: 'void_and_reescalate',
      voidFloat: true,
      addToFloatExclusions: true,
      destinationToVacant: true,
      rolledBackSteps: [],
      sourceSideAction: { type: 'none' },
      escalationNextStep: 'hmod_notify_allied',
    });
  });

  it('automated no-ack — rolledBackSteps is explicitly empty array (not undefined)', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'automated',
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.rolledBackSteps).toEqual([]);
    expect(Array.isArray(outcome.rolledBackSteps)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// 5. Force-trigger + source still vacant → restore floater (pinned #15)
// ---------------------------------------------------------------------

describe('force-triggered no-ack + source still vacant → restore (pinned #15)', () => {
  it('source-side seat untouched → restore_floater_original_assignment', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_still_vacant' },
      }),
    );

    expect(outcome).toEqual({
      kind: 'void_and_reescalate',
      voidFloat: true,
      addToFloatExclusions: true,
      destinationToVacant: true,
      rolledBackSteps: ['broadcast', 'float_lookup'],
      sourceSideAction: { type: 'restore_floater_original_assignment' },
      escalationNextStep: 'hmod_notify_allied',
    });
  });
});

// ---------------------------------------------------------------------
// 6. Force-trigger + source claimed_by_other → displace (pinned #15)
// ---------------------------------------------------------------------

describe('force-triggered no-ack + source claimed_by_other → displace (pinned #15)', () => {
  it('source-side seat claimed by another worker → mark_floater_displaced', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_claimed_by_other' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.sourceSideAction).toEqual({ type: 'mark_floater_displaced' });
  });
});

// ---------------------------------------------------------------------
// 7. Force-trigger + source covered_by_allied → displace (pinned #15)
// ---------------------------------------------------------------------

describe('force-triggered no-ack + source covered_by_allied → displace (pinned #15)', () => {
  it('source-side seat covered by Allied → mark_floater_displaced', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_covered_by_allied' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.sourceSideAction).toEqual({ type: 'mark_floater_displaced' });
  });
});

// ---------------------------------------------------------------------
// 8. rolledBackSteps for force-triggered is exactly
//    ['broadcast', 'float_lookup'] in that order (pinned #14)
// ---------------------------------------------------------------------

describe('rolledBackSteps for force-triggered (pinned #14)', () => {
  it('force-trigger + still_vacant — rolledBackSteps is exactly [broadcast, float_lookup]', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_still_vacant' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.rolledBackSteps).toEqual(['broadcast', 'float_lookup']);
  });

  it('force-trigger + claimed_by_other — rolledBackSteps unchanged regardless of source-side', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_claimed_by_other' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.rolledBackSteps).toEqual(['broadcast', 'float_lookup']);
  });

  it('force-trigger + covered_by_allied — rolledBackSteps unchanged', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_covered_by_allied' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.rolledBackSteps).toEqual(['broadcast', 'float_lookup']);
  });
});

// ---------------------------------------------------------------------
// 9. escalationNextStep is always 'hmod_notify_allied' for void cases
//    (pinned #12)
// ---------------------------------------------------------------------

describe('escalationNextStep is always hmod_notify_allied for void cases (pinned #12)', () => {
  it('automated no-ack', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'automated',
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.escalationNextStep).toBe('hmod_notify_allied');
  });

  it('force-trigger + still_vacant', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_still_vacant' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.escalationNextStep).toBe('hmod_notify_allied');
  });

  it('force-trigger + claimed_by_other', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_claimed_by_other' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.escalationNextStep).toBe('hmod_notify_allied');
  });

  it('force-trigger + covered_by_allied', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        initiatedBy: 'force_triggered',
        sourceSideAtTriggerTime: { kind: 'force_triggered_covered_by_allied' },
      }),
    );

    if (outcome.kind !== 'void_and_reescalate') {
      throw new Error('expected void_and_reescalate');
    }
    expect(outcome.escalationNextStep).toBe('hmod_notify_allied');
  });
});

// ---------------------------------------------------------------------
// 10. Pure-function determinism — same input → same output
// ---------------------------------------------------------------------

describe('pure-function determinism', () => {
  it('two calls with identical input return structurally-identical output', () => {
    const input = makeNoAckInput({
      floatStartAt: FLOAT_START,
      initiatedBy: 'force_triggered',
      sourceSideAtTriggerTime: { kind: 'force_triggered_still_vacant' },
    });

    const a = decideNoAckAction(input);
    const b = decideNoAckAction(input);

    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------
// 11. Input mutation safety — function does not mutate its input
// ---------------------------------------------------------------------

describe('input mutation safety', () => {
  it('decideNoAckAction does not mutate the input object', () => {
    const input = makeNoAckInput({
      floatStartAt: FLOAT_START,
      initiatedBy: 'force_triggered',
      sourceSideAtTriggerTime: { kind: 'force_triggered_still_vacant' },
    });
    const snapshot = JSON.stringify(input);

    decideNoAckAction(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------
// 12. Boundary: triggerAt before floatStartAt (sanity — the decider does
//     not validate timing relationships; it trusts the caller's snapshot)
// ---------------------------------------------------------------------

describe('boundary sanity — triggerAt before floatStartAt', () => {
  it('triggerAt = floatStart - 15min is the conventional value; decider still returns valid outcome', () => {
    const outcome = decideNoAckAction(
      makeNoAckInput({
        floatStartAt: FLOAT_START,
        triggerAt: TRIGGER_AT,
        initiatedBy: 'automated',
      }),
    );

    expect(outcome.kind).toBe('void_and_reescalate');
  });
});
