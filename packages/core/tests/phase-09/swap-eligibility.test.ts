// Phase 09 — Swaps: symmetric eligibility guard (`evaluateSwapEligibility`)
// and the pending-swap conflict guard (`findConflictingPendingSwaps`).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §8.1 (temporary shift swap — pre-creation guard + acceptance guard,
//           symmetric; conflicts: no shared block across a worker's pending
//           swaps),
//     §8.2 (temporary float swap — same symmetric constraints; at least one
//           span must include an active float),
//     §1.2 (float direction rules — single-staff houses can NEVER be float
//           sources; Quad may not float to Harnwell; Harnwell may float
//           anywhere),
//     §5.3 (cross-house pickup — more permissive than floating; the ONLY
//           carried-over invariant is Harnwell training);
//   ARCHITECTURE.md §3.5 (swap_requests);
//   AGENTS.md hard invariant #1 (Harnwell training — enforced in code at
//     every assignment write point, symmetrically) and #2 (float direction).
//
// THE CORE MODEL (pinned in tests/PHASE_09/TEST_PLAN.md): a swap transfers
// each party's span to the OTHER party. The guard therefore asks, for every
// transferred assignment, whether the RECEIVER is eligible to staff that
// assignment's destination house — symmetrically, in both directions. The
// governing rule depends on the assignment KIND:
//   - Any destination == Harnwell  → receiver MUST be Harnwell-home
//     (invariant #1, absolute, regardless of kind).
//   - A 'float' to a non-Harnwell house → receiver becomes a float SOURCE,
//     so a single-staff-home receiver is rejected (§1.2 / invariant #2).
//   - A 'shift' or 'cross_house_pickup' to a non-Harnwell house → governed
//     by the permissive §5.3 pickup rule → always eligible.
// This float-vs-pickup asymmetry is the crux: a single-staff worker MAY
// receive a cross-house pickup but MAY NOT receive a float.
//
// `evaluateSwapEligibility` is PURE: no I/O, no clock, no DB. The swap Edge
// Functions call it TWICE — once as the §8.1 pre-creation guard, once as the
// §8.1 acceptance-time backstop — each time against a freshly snapshotted
// input. Re-running the same pure function on a changed snapshot IS the
// acceptance guard (see the "acceptance guard" block below).

import { describe, expect, it } from 'vitest';

import { evaluateSwapEligibility, findConflictingPendingSwaps } from '../../src/swaps/index.js';

import {
  HARNWELL,
  HOUSE_A,
  HOUSE_B,
  QUAD,
  makeAssignment,
  makeEligibilityInput,
  makeParticipant,
} from './fixtures.js';

// ---------------------------------------------------------------------
// Happy paths — eligible swaps are accepted.
// ---------------------------------------------------------------------

describe('eligible swaps', () => {
  it('two single-staff workers swap plain desk shifts at non-Harnwell houses → eligible', () => {
    expect(evaluateSwapEligibility(makeEligibilityInput())).toEqual({ eligible: true });
  });

  it('an intra-house shift swap (both workers home at the same house) → eligible', () => {
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'a1', houseId: HOUSE_A, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'b1', houseId: HOUSE_A, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });

  it('both workers are Harnwell-home → a Harnwell↔Harnwell shift swap is eligible', () => {
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HARNWELL,
        span: [makeAssignment({ assignmentId: 'a-harn', houseId: HARNWELL, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HARNWELL,
        span: [makeAssignment({ assignmentId: 'b-harn', houseId: HARNWELL, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });

  it('a single-staff worker RECEIVES a cross-house pickup at a non-Harnwell house → eligible (§5.3 permissive)', () => {
    // Worker A (home HOUSE_A, single-staff) receives B's cross-house pickup
    // at HOUSE_B. Pickup eligibility carries over only the Harnwell training
    // constraint — a single-staff worker may pick up at any non-Harnwell
    // house. This is the PERMISSIVE half of the float-vs-pickup asymmetry.
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'a-shift', houseId: HOUSE_A, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_A,
        span: [
          makeAssignment({
            assignmentId: 'b-pickup',
            houseId: HOUSE_B,
            kind: 'cross_house_pickup',
          }),
        ],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });

  it('a shift swap MAY involve a float (§8.1) — no float-presence precondition for shift_swap', () => {
    // §8.1: "A temporary shift swap may involve float assignments." The
    // float-presence requirement is float_swap-ONLY (§8.2). A Quad worker
    // receiving a float into a non-Harnwell house is a valid source.
    const input = makeEligibilityInput({
      swapType: 'shift_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'a-float', houseId: HOUSE_A, kind: 'float' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'b-shift', houseId: QUAD, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });
});

// ---------------------------------------------------------------------
// Harnwell training constraint — symmetric, absolute (invariant #1).
// ---------------------------------------------------------------------

describe('Harnwell training constraint (symmetric, invariant #1)', () => {
  it("non-Harnwell worker would receive the OTHER party's Harnwell shift → rejected", () => {
    // A is Harnwell-home and offers a Harnwell desk shift; B is HOUSE_A.
    // Accepting would place B (untrained) at the Harnwell desk.
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HARNWELL,
        span: [makeAssignment({ assignmentId: 'a-harn', houseId: HARNWELL, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_A, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-harn',
          destinationHouseId: HARNWELL,
          reason: 'harnwell_training_required',
        },
      ],
    });
  });

  it('a Harnwell FLOAT transferred to a Quad worker → harnwell_training_required (training dominates float-direction)', () => {
    // A Quad worker may not float to Harnwell (§1.2) AND lacks Harnwell
    // training (§1.2/invariant #1). The training reason is the one reported:
    // it is the absolute, mechanism-independent invariant.
    const input = makeEligibilityInput({
      swapType: 'float_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HARNWELL,
        span: [makeAssignment({ assignmentId: 'a-harn-float', houseId: HARNWELL, kind: 'float' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'b-float', houseId: HOUSE_A, kind: 'float' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-harn-float',
          destinationHouseId: HARNWELL,
          reason: 'harnwell_training_required',
        },
      ],
    });
  });

  it("a Harnwell worker MAY receive the counterparty's non-Harnwell span (training only gates the Harnwell desk)", () => {
    // The Harnwell worker A absorbs B's HOUSE_B shift — fine. The reverse
    // (B at Harnwell) is the failure; this test isolates the eligible
    // direction by making BOTH parties Harnwell-home.
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HARNWELL,
        span: [makeAssignment({ assignmentId: 'a-harn', houseId: HARNWELL, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HARNWELL,
        span: [
          makeAssignment({
            assignmentId: 'b-pickup',
            houseId: HOUSE_B,
            kind: 'cross_house_pickup',
          }),
        ],
      }),
    });

    expect(evaluateSwapEligibility(input).eligible).toBe(true);
  });

  it('BOTH parties ineligible at the other Harnwell destination → two violations (symmetric collection)', () => {
    // A offers a Harnwell shift (B can't receive it) and B offers a Harnwell
    // float (A — Quad — can't receive it). Both directions fail; the guard
    // collects BOTH violations, initiator-span direction first.
    const input = makeEligibilityInput({
      swapType: 'float_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'a-harn', houseId: HARNWELL, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'b-harn-float', houseId: HARNWELL, kind: 'float' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-harn',
          destinationHouseId: HARNWELL,
          reason: 'harnwell_training_required',
        },
        {
          receiverUserId: 'user-a',
          assignmentId: 'b-harn-float',
          destinationHouseId: HARNWELL,
          reason: 'harnwell_training_required',
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------
// Float direction — single-staff houses can never be float SOURCES
// (§1.2 / invariant #2). The float-vs-pickup asymmetry.
// ---------------------------------------------------------------------

describe('float direction — receiving a float makes you a source (§1.2)', () => {
  it('a single-staff worker would receive a FLOAT into a non-Harnwell house → single_staff_cannot_float', () => {
    // B (home HOUSE_B, single-staff) receives A's float into HOUSE_A.
    // Accepting makes B a float source — forbidden for single-staff houses,
    // whose departure leaves their own single-staff desk unattended.
    const input = makeEligibilityInput({
      swapType: 'float_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'a-float', houseId: HOUSE_A, kind: 'float' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_B,
        span: [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_B, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-float',
          destinationHouseId: HOUSE_A,
          reason: 'single_staff_cannot_float',
        },
      ],
    });
  });

  it('a Quad worker receiving a float into a non-Harnwell house → eligible (Quad is a valid source)', () => {
    const input = makeEligibilityInput({
      swapType: 'float_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'a-float', houseId: HOUSE_A, kind: 'float' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'b-float', houseId: HOUSE_B, kind: 'float' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });

  it('float-vs-pickup asymmetry: the SAME single-staff receiver passes a pickup but fails a float at the same house', () => {
    const single = (kind: 'float' | 'cross_house_pickup') =>
      makeEligibilityInput({
        swapType: kind === 'float' ? 'float_swap' : 'shift_swap',
        initiator: makeParticipant({
          userId: 'user-a',
          homeHouseId: QUAD,
          span: [makeAssignment({ assignmentId: 'a-asg', houseId: HOUSE_A, kind })],
        }),
        counterparty: makeParticipant({
          userId: 'user-b',
          homeHouseId: HOUSE_B,
          span: [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_B, kind: 'shift' })],
        }),
      });

    expect(evaluateSwapEligibility(single('cross_house_pickup'))).toEqual({ eligible: true });
    expect(evaluateSwapEligibility(single('float'))).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-asg',
          destinationHouseId: HOUSE_A,
          reason: 'single_staff_cannot_float',
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------
// Float-swap presence precondition (§8.2): at least one span must include
// an active float; otherwise the workers should use a shift swap (§8.1).
// ---------------------------------------------------------------------

describe('float swap requires at least one float span (§8.2)', () => {
  it('float_swap where NEITHER span includes a float → float_swap_requires_a_float', () => {
    const input = makeEligibilityInput({
      swapType: 'float_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'a-shift', houseId: HOUSE_A, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_B,
        span: [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_B, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: null,
          assignmentId: null,
          destinationHouseId: null,
          reason: 'float_swap_requires_a_float',
        },
      ],
    });
  });

  it('float_swap satisfied when EITHER span includes a float (counterparty side)', () => {
    const input = makeEligibilityInput({
      swapType: 'float_swap',
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'a-shift', houseId: QUAD, kind: 'shift' })],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: QUAD,
        span: [makeAssignment({ assignmentId: 'b-float', houseId: HOUSE_A, kind: 'float' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });

  it('a shift_swap with NO float is NOT subject to the float-presence precondition', () => {
    const input = makeEligibilityInput({ swapType: 'shift_swap' });
    expect(evaluateSwapEligibility(input)).toEqual({ eligible: true });
  });
});

// ---------------------------------------------------------------------
// Block already involved in a pending float (the force-trigger edge):
// a block whose seat sits in a pending float-in/out is not swappable.
// ---------------------------------------------------------------------

describe('block involved in a pending float is not swappable', () => {
  it("initiator's span block sits in a pending (force-triggered) float → block_in_pending_float", () => {
    // EDGE CASE (brief): "Worker tries to swap a block involved in a
    // force-triggered pending float → pre-creation guard should catch/flag."
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HOUSE_A,
        span: [
          makeAssignment({
            assignmentId: 'a-pending',
            houseId: HOUSE_A,
            kind: 'shift',
            inPendingFloat: true,
          }),
        ],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-pending',
          destinationHouseId: HOUSE_A,
          reason: 'block_in_pending_float',
        },
      ],
    });
  });

  it('pending-float guard outranks the destination eligibility checks for the same assignment', () => {
    // A Harnwell shift that is ALSO in a pending float: the pending-float
    // reason is reported (the block is not in a clean, transferable state to
    // begin with), not harnwell_training_required.
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HARNWELL,
        span: [
          makeAssignment({
            assignmentId: 'a-harn-pending',
            houseId: HARNWELL,
            kind: 'shift',
            inPendingFloat: true,
          }),
        ],
      }),
      counterparty: makeParticipant({
        userId: 'user-b',
        homeHouseId: HOUSE_A,
        span: [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_A, kind: 'shift' })],
      }),
    });

    expect(evaluateSwapEligibility(input)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-harn-pending',
          destinationHouseId: HARNWELL,
          reason: 'block_in_pending_float',
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------
// Acceptance guard (§8.1) — the SAME pure function re-run at acceptance
// against a fresh snapshot is the backstop. A swap that passed at creation
// can fail at acceptance if eligibility changed in between.
// ---------------------------------------------------------------------

describe('acceptance-time guard re-runs the same symmetric check (§8.1)', () => {
  it('eligible at creation, then the counterparty is reassigned away from Harnwell → fails at acceptance', () => {
    // At creation, B is Harnwell-home and may receive A's Harnwell shift.
    const aHarnwellShift = [
      makeAssignment({ assignmentId: 'a-harn', houseId: HARNWELL, kind: 'shift' }),
    ];
    const bShift = [makeAssignment({ assignmentId: 'b-shift', houseId: HOUSE_B, kind: 'shift' })];

    const atCreation = makeEligibilityInput({
      initiator: makeParticipant({ userId: 'user-a', homeHouseId: HARNWELL, span: aHarnwellShift }),
      counterparty: makeParticipant({ userId: 'user-b', homeHouseId: HARNWELL, span: bShift }),
    });
    expect(evaluateSwapEligibility(atCreation).eligible).toBe(true);

    // Between creation and acceptance, B's home house changed to HOUSE_A
    // (single-staff). The backstop re-snapshot now rejects the acceptance.
    const atAcceptance = makeEligibilityInput({
      initiator: makeParticipant({ userId: 'user-a', homeHouseId: HARNWELL, span: aHarnwellShift }),
      counterparty: makeParticipant({ userId: 'user-b', homeHouseId: HOUSE_A, span: bShift }),
    });
    expect(evaluateSwapEligibility(atAcceptance)).toEqual({
      eligible: false,
      violations: [
        {
          receiverUserId: 'user-b',
          assignmentId: 'a-harn',
          destinationHouseId: HARNWELL,
          reason: 'harnwell_training_required',
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------
// Conflict guard (§8.1): a worker cannot CREATE or ACCEPT a swap that
// touches a block already involved in another pending swap of theirs.
// ---------------------------------------------------------------------

describe('pending-swap conflict guard (§8.1 conflicts)', () => {
  it('the new swap shares a block with one pending swap → that swap is reported as conflicting', () => {
    const conflicting = findConflictingPendingSwaps({
      newAssignmentIds: ['asg-1', 'asg-2'],
      pendingSwaps: [
        { swapId: 'swap-x', assignmentIds: ['asg-2', 'asg-9'] },
        { swapId: 'swap-y', assignmentIds: ['asg-7', 'asg-8'] },
      ],
    });

    expect(conflicting).toEqual(['swap-x']);
  });

  it('no shared block → no conflict (empty list)', () => {
    const conflicting = findConflictingPendingSwaps({
      newAssignmentIds: ['asg-1', 'asg-2'],
      pendingSwaps: [{ swapId: 'swap-x', assignmentIds: ['asg-3', 'asg-4'] }],
    });

    expect(conflicting).toEqual([]);
  });

  it('the new swap collides with MULTIPLE pending swaps → all reported in input order', () => {
    const conflicting = findConflictingPendingSwaps({
      newAssignmentIds: ['asg-5'],
      pendingSwaps: [
        { swapId: 'swap-x', assignmentIds: ['asg-5'] },
        { swapId: 'swap-y', assignmentIds: ['asg-6'] },
        { swapId: 'swap-z', assignmentIds: ['asg-5', 'asg-6'] },
      ],
    });

    expect(conflicting).toEqual(['swap-x', 'swap-z']);
  });

  it('no pending swaps at all → no conflict', () => {
    expect(findConflictingPendingSwaps({ newAssignmentIds: ['asg-1'], pendingSwaps: [] })).toEqual(
      [],
    );
  });

  it('a swap conflicting on EITHER side of its span is reported (initiator or counterparty block)', () => {
    // The new swap touches both its own initiator block (asg-1) and the
    // counterparty block (asg-2). A pending swap touching either is a
    // conflict — the guard is over the union of touched blocks.
    const conflicting = findConflictingPendingSwaps({
      newAssignmentIds: ['asg-1', 'asg-2'],
      pendingSwaps: [{ swapId: 'swap-counterparty-side', assignmentIds: ['asg-2'] }],
    });

    expect(conflicting).toEqual(['swap-counterparty-side']);
  });
});

// ---------------------------------------------------------------------
// Purity — same input → same output; no input mutation.
// ---------------------------------------------------------------------

describe('purity', () => {
  it('evaluateSwapEligibility: same input → same output across repeated calls', () => {
    const input = makeEligibilityInput();
    expect(evaluateSwapEligibility(input)).toEqual(evaluateSwapEligibility(input));
  });

  it('evaluateSwapEligibility does not mutate the input', () => {
    const input = makeEligibilityInput({
      initiator: makeParticipant({
        userId: 'user-a',
        homeHouseId: HARNWELL,
        span: [makeAssignment({ assignmentId: 'a-harn', houseId: HARNWELL, kind: 'shift' })],
      }),
      counterparty: makeParticipant({ userId: 'user-b', homeHouseId: HOUSE_A }),
    });
    const snapshot = JSON.parse(JSON.stringify(input));

    evaluateSwapEligibility(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('findConflictingPendingSwaps does not mutate its inputs', () => {
    const pendingSwaps = [{ swapId: 'swap-x', assignmentIds: ['asg-2'] }];
    const newAssignmentIds = ['asg-1', 'asg-2'];
    const pendingSnapshot = JSON.parse(JSON.stringify(pendingSwaps));
    const newSnapshot = [...newAssignmentIds];

    findConflictingPendingSwaps({ newAssignmentIds, pendingSwaps });

    expect(pendingSwaps).toEqual(pendingSnapshot);
    expect(newAssignmentIds).toEqual(newSnapshot);
  });
});
