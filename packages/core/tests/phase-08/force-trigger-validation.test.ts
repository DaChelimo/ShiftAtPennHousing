// Phase 08 — Force-Trigger Pathway: endpoint validation (`validateForceTrigger`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.6 #1 (initiation window + profile gate);
//   ARCHITECTURE.md §6.2 (the five validation checks):
//     1. initiator authorized for the destination house (SM/HM/BM scoped
//        there, OR the currently-on-duty HMOD);
//     2. every target block is currently `vacant`;
//     3. the earliest block's start is MORE than 2 hours in the future;
//     4. no block already has a `pending_float_in` assignment;
//     5. the block's date belongs to a profile with `float_enabled = true`.
//   "If any check fails, the request is rejected with a descriptive
//    error." (ARCH §6.2) — there is NO partial execution.
//
// Pinned decisions exercised (see tests/PHASE_08/TEST_PLAN.md):
//   #1 — authorization is satisfied by EITHER the role-scope check OR
//        the HMOD check (not both). HMOD authority spans all 13 houses.
//   #2 — the 2-hour window is STRICT: a force-trigger is valid iff
//        (earliestStart - now) > 2h. At exactly T-2h it is rejected
//        (the standard chain's float_lookup fires AT T-2h per phase-07
//        pinned #1; force-trigger there is redundant).
//   #3 — a block already targeted by a pending float-in is reported with
//        the specific reason `block_has_pending_float_in`, which takes
//        precedence over the generic `block_not_vacant`.
//   #4 — rejection precedence is deterministic (see TEST_PLAN): empty →
//        unauthorized → pending_float_in → not_vacant → within_two_hours
//        → float_not_enabled. The first failing check names the reason.
//   #5 — the earliest start is computed across ALL blocks; a single
//        too-soon block rejects the whole request.
//
// `validateForceTrigger` is PURE: no I/O, no clock, no DB. The caller
// (force-trigger Edge Function, ARCH §6) assembles the snapshot from DB
// reads — resolving the initiator's roles, each block's current status,
// pending-float-in presence, and the date's `float_enabled` flag — then
// passes it here as a pre-flight gate before invoking the atomic
// execution RPC.

import { describe, expect, it } from 'vitest';

import { validateForceTrigger } from '../../src/force-trigger/index.js';

import {
  ROLE_BM,
  ROLE_HM,
  ROLE_NONE,
  ROLE_SM,
  ROLE_SW,
  makeBlock,
  makeValidationInput,
} from './fixtures.js';

// ---------------------------------------------------------------------
// Happy path — a fully valid request is accepted.
// ---------------------------------------------------------------------

describe('valid request — accepted', () => {
  it('SM of the destination, two vacant blocks 3h out, float enabled → ok', () => {
    expect(validateForceTrigger(makeValidationInput())).toEqual({ ok: true });
  });

  it('a single vacant block exactly 2h01m out → ok (strictly past T-2h)', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: 121 })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------
// Check 1 — initiator authorization (ARCH §6.2 #1, pinned #1)
// ---------------------------------------------------------------------

describe('check 1 — initiator authorization (pinned #1)', () => {
  it('SM scoped to the destination house → authorized', () => {
    const input = makeValidationInput({ initiator: { rolesAtDestinationHouse: ROLE_SM } });
    expect(validateForceTrigger(input).ok).toBe(true);
  });

  it('HM scoped to the destination house → authorized', () => {
    const input = makeValidationInput({ initiator: { rolesAtDestinationHouse: ROLE_HM } });
    expect(validateForceTrigger(input).ok).toBe(true);
  });

  it('BM scoped to the destination house → authorized (BSpec §2.7: BM == HM admin powers)', () => {
    const input = makeValidationInput({ initiator: { rolesAtDestinationHouse: ROLE_BM } });
    expect(validateForceTrigger(input).ok).toBe(true);
  });

  it('the currently-on-duty HMOD, with NO role at the destination → authorized', () => {
    // EDGE CASE: HMOD initiates a force-trigger for a house that is not
    // their home. Per BSpec §2.5 the HMOD holds HM permissions across all
    // 13 houses while on duty. ARCH §6.2 #1: HMOD check is "in addition
    // to, not in place of" the role-scope check.
    const input = makeValidationInput({
      initiator: { rolesAtDestinationHouse: ROLE_NONE, isCurrentHmod: true },
    });

    expect(validateForceTrigger(input)).toEqual({ ok: true });
  });

  it('an SW with no admin role and not the HMOD → unauthorized_initiator', () => {
    const input = makeValidationInput({
      initiator: { rolesAtDestinationHouse: ROLE_SW, isCurrentHmod: false },
    });

    expect(validateForceTrigger(input)).toEqual({
      ok: false,
      reason: 'unauthorized_initiator',
    });
  });

  it('no role at the destination and not the HMOD → unauthorized_initiator', () => {
    const input = makeValidationInput({
      initiator: { rolesAtDestinationHouse: ROLE_NONE, isCurrentHmod: false },
    });

    expect(validateForceTrigger(input)).toEqual({
      ok: false,
      reason: 'unauthorized_initiator',
    });
  });

  it('an SM scoped to a DIFFERENT house (role list does not include this destination) → unauthorized', () => {
    // The caller resolves `rolesAtDestinationHouse` by filtering the
    // initiator's roles to those scoped to THIS destination. An SM of
    // another house contributes no roles here and is not the HMOD.
    const input = makeValidationInput({
      initiator: { rolesAtDestinationHouse: ROLE_NONE, isCurrentHmod: false },
    });

    expect(validateForceTrigger(input).ok).toBe(false);
  });

  it('HM who is ALSO the current HMOD → authorized (doubly authorized, still ok)', () => {
    const input = makeValidationInput({
      initiator: { rolesAtDestinationHouse: ROLE_HM, isCurrentHmod: true },
    });

    expect(validateForceTrigger(input)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------
// Check 2 — every block must currently be vacant (ARCH §6.2 #2)
// ---------------------------------------------------------------------

describe('check 2 — all target blocks must be vacant', () => {
  it('a single scheduled block → block_not_vacant', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', status: 'scheduled' })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'block_not_vacant' });
  });

  it('a claimed block → block_not_vacant', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', status: 'claimed' })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'block_not_vacant' });
  });

  it('a floated_in block → block_not_vacant', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', status: 'floated_in' })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'block_not_vacant' });
  });

  it('an allied block → block_not_vacant', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', status: 'allied' })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'block_not_vacant' });
  });

  it('multiple blocks, some vacant some scheduled → entire request rejected (no partial) (pinned #4)', () => {
    // EDGE CASE: "Multiple blocks in the request, some vacant some not →
    // entire request rejected (not partial)."
    const input = makeValidationInput({
      blocks: [
        makeBlock({ blockId: 'blk-1', status: 'vacant', startOffsetMinutesFromNow: 180 }),
        makeBlock({ blockId: 'blk-2', status: 'scheduled', startOffsetMinutesFromNow: 210 }),
        makeBlock({ blockId: 'blk-3', status: 'vacant', startOffsetMinutesFromNow: 240 }),
      ],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'block_not_vacant' });
  });

  it('all blocks vacant → passes check 2', () => {
    const input = makeValidationInput({
      blocks: [
        makeBlock({ blockId: 'blk-1', status: 'vacant', startOffsetMinutesFromNow: 180 }),
        makeBlock({ blockId: 'blk-2', status: 'vacant', startOffsetMinutesFromNow: 210 }),
      ],
    });

    expect(validateForceTrigger(input).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Check 3 — earliest block start must be MORE than 2 hours out
//           (ARCH §6.2 #3, pinned #2, pinned #5)
// ---------------------------------------------------------------------

describe('check 3 — earliest block start > 2 hours in the future (pinned #2)', () => {
  it('earliest start exactly T-2h → within_two_hours (must be MORE than 2h)', () => {
    // EDGE CASE: "Force-trigger initiated at T-2h exactly → rejected."
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: 120 })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'within_two_hours' });
  });

  it('earliest start 1 millisecond before T-2h (1h59m59.999s out) → within_two_hours', () => {
    const input = makeValidationInput({
      blocks: [
        {
          blockId: 'blk-1',
          status: 'vacant',
          blockStartAt: new Date(makeValidationInput().now.getTime() + 2 * 60 * 60 * 1000 - 1),
          hasPendingFloatIn: false,
        },
      ],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'within_two_hours' });
  });

  it('earliest start 1 millisecond after T-2h → ok (strictly more than 2h)', () => {
    const input = makeValidationInput({
      blocks: [
        {
          blockId: 'blk-1',
          status: 'vacant',
          blockStartAt: new Date(makeValidationInput().now.getTime() + 2 * 60 * 60 * 1000 + 1),
          hasPendingFloatIn: false,
        },
      ],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: true });
  });

  it('earliest start in the past (negative offset) → within_two_hours', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: -30 })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'within_two_hours' });
  });

  it('the EARLIEST of several blocks governs: one block at T-90m rejects the set (pinned #5)', () => {
    // The first block is comfortably past T-2h, but a later-listed block
    // starts only 90 minutes out. The window check uses min(start) across
    // ALL blocks, so the whole request is rejected.
    const input = makeValidationInput({
      blocks: [
        makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: 180 }),
        makeBlock({ blockId: 'blk-2', startOffsetMinutesFromNow: 90 }),
      ],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'within_two_hours' });
  });

  it('all blocks comfortably past T-2h → passes check 3', () => {
    const input = makeValidationInput({
      blocks: [
        makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: 150 }),
        makeBlock({ blockId: 'blk-2', startOffsetMinutesFromNow: 180 }),
      ],
    });

    expect(validateForceTrigger(input).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Check 4 — no block may already have a pending float-in
//           (ARCH §6.2 #4, pinned #3)
// ---------------------------------------------------------------------

describe('check 4 — no block already targeted by a pending float-in (pinned #3)', () => {
  it('a block already targeted by a pending force-triggered float → block_has_pending_float_in', () => {
    // EDGE CASE: "Force-trigger on a block that already has a
    // force-triggered float pending → rejected (pending_float_in exists)."
    //
    // Such a block's shift_block_assignments status is `pending_float_in`,
    // never `vacant`. We model that as status='pending_float_in' AND
    // hasPendingFloatIn=true; the validator reports the SPECIFIC reason.
    const input = makeValidationInput({
      blocks: [
        makeBlock({
          blockId: 'blk-1',
          status: 'pending_float_in',
          hasPendingFloatIn: true,
        }),
      ],
    });

    expect(validateForceTrigger(input)).toEqual({
      ok: false,
      reason: 'block_has_pending_float_in',
    });
  });

  it('pending_float_in reason takes precedence over generic block_not_vacant (pinned #3)', () => {
    // A pending_float_in block is also "not vacant". The more specific
    // reason must win so the endpoint can return an accurate message.
    const input = makeValidationInput({
      blocks: [
        makeBlock({ blockId: 'blk-1', status: 'vacant' }),
        makeBlock({
          blockId: 'blk-2',
          status: 'pending_float_in',
          hasPendingFloatIn: true,
        }),
      ],
    });

    expect(validateForceTrigger(input)).toEqual({
      ok: false,
      reason: 'block_has_pending_float_in',
    });
  });

  it('no block has a pending float-in → passes check 4', () => {
    const input = makeValidationInput({
      blocks: [
        makeBlock({ blockId: 'blk-1', hasPendingFloatIn: false }),
        makeBlock({ blockId: 'blk-2', hasPendingFloatIn: false }),
      ],
    });

    expect(validateForceTrigger(input).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Check 5 — the block's date must be a float-enabled profile
//           (ARCH §6.2 #5, BSpec §6.6 #1 profile gate)
// ---------------------------------------------------------------------

describe('check 5 — profile must have float_enabled', () => {
  it('float_enabled = false (e.g., winter break) → float_not_enabled', () => {
    // EDGE CASE: "Force-trigger on a winter-break block
    // (float_enabled=false) → rejected." No source pool exists during a
    // non-floating profile; the standard broadcast → HMOD-for-Allied
    // chain is the only available route.
    const input = makeValidationInput({ floatEnabled: false });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'float_not_enabled' });
  });

  it('float_enabled = true → passes check 5', () => {
    const input = makeValidationInput({ floatEnabled: true });
    expect(validateForceTrigger(input).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Rejection precedence — deterministic first-failing-reason (pinned #4)
//
// When several checks would fail, the validator returns ONE reason in a
// fixed precedence so the endpoint's error message is stable and the
// test assertions can use equality. Precedence:
//   empty_block_set → unauthorized_initiator → block_has_pending_float_in
//   → block_not_vacant → within_two_hours → float_not_enabled
// ---------------------------------------------------------------------

describe('rejection precedence — deterministic first-failing reason (pinned #4)', () => {
  it('empty block set → empty_block_set (before any per-block or window check)', () => {
    const input = makeValidationInput({ blocks: [] });
    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'empty_block_set' });
  });

  it('unauthorized initiator outranks a non-vacant block', () => {
    const input = makeValidationInput({
      initiator: { rolesAtDestinationHouse: ROLE_SW, isCurrentHmod: false },
      blocks: [makeBlock({ blockId: 'blk-1', status: 'scheduled' })],
    });

    expect(validateForceTrigger(input)).toEqual({
      ok: false,
      reason: 'unauthorized_initiator',
    });
  });

  it('pending_float_in outranks the within_two_hours window check', () => {
    const input = makeValidationInput({
      blocks: [
        makeBlock({
          blockId: 'blk-1',
          status: 'pending_float_in',
          hasPendingFloatIn: true,
          startOffsetMinutesFromNow: 30, // also within 2h
        }),
      ],
    });

    expect(validateForceTrigger(input)).toEqual({
      ok: false,
      reason: 'block_has_pending_float_in',
    });
  });

  it('block_not_vacant outranks within_two_hours', () => {
    const input = makeValidationInput({
      blocks: [makeBlock({ blockId: 'blk-1', status: 'scheduled', startOffsetMinutesFromNow: 30 })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'block_not_vacant' });
  });

  it('within_two_hours outranks float_not_enabled', () => {
    const input = makeValidationInput({
      floatEnabled: false,
      blocks: [makeBlock({ blockId: 'blk-1', startOffsetMinutesFromNow: 60 })],
    });

    expect(validateForceTrigger(input)).toEqual({ ok: false, reason: 'within_two_hours' });
  });
});

// ---------------------------------------------------------------------
// Purity — same input → same output; input is not mutated.
// ---------------------------------------------------------------------

describe('purity', () => {
  it('same input → same output across repeated calls', () => {
    const input = makeValidationInput();
    const first = validateForceTrigger(input);
    const second = validateForceTrigger(input);

    expect(first).toEqual(second);
  });

  it('does not mutate the input object', () => {
    const input = makeValidationInput();
    const snapshot = JSON.parse(JSON.stringify(input));

    validateForceTrigger(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});
