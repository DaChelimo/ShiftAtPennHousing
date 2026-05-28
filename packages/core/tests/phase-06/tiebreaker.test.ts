// Phase 06 — Float Lookup Algorithm: tiebreaker chain (§6.3).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.3:
//     "Each check operates on an active **candidate set** that begins
//      as all eligible workers covering the same largest-consecutive
//      span... If a check produces multiple satisfiers rather than
//      one, the algorithm narrows the candidate set to those
//      satisfiers and advances to the next check on the narrowed set."
//
//     Check 1: shift starts at exactly the span START.
//     Check 2: shift ends at exactly the span END (in narrowed set).
//     Check 3: arbitrary from current candidate set.
//
//   ARCHITECTURE.md §5.3 confirms the same narrowing chain and
//   re-affirms the 2-block minimum as a PRECONDITION (sub-minimum
//   coverers never enter the candidate set).
//
// THE TIEBREAKER IS NOT THREE INDEPENDENT CHECKS. It is a CANDIDATE-SET
// NARROWING CHAIN — each check operates on the set the previous check
// left behind. This file's tests lock down that semantic exactly: it
// is easy to misread the spec as "apply each check; if any check
// uniquely identifies a worker, pick them" — that reading is WRONG.
// The spec's chain semantics mean Check 1 may eliminate a Check-2
// satisfier early (if Check 1 narrows to a set that excludes them).

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  ANCHOR_19_00_EDT,
  HARNWELL,
  HOUSE_05,
  makeCandidate,
  makeGap,
  makeInput,
  makeSourceRoster,
  plusBlocks,
  plusMinutes,
} from './fixtures.js';

const GAP_HOUSE = HOUSE_05;
// 4-block gap 19:00 – 21:00. All tiebreaker tests use this span unless
// stated otherwise.
const GAP = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
const SPAN_START = GAP.blocks[0]!.blockStartAt;
const SPAN_END = plusBlocks(GAP.blocks[3]!.blockStartAt, 1);

// Headcount well above the floor for every tiebreaker test — these
// scenarios are about selection logic, not the floor.
function rosterOf(candidates: ReturnType<typeof makeCandidate>[]) {
  return makeSourceRoster({
    sourceHouseId: HARNWELL,
    precedenceOrder: 1,
    candidates,
    gap: GAP,
    homogeneousHeadcount: 10,
  });
}

function harnCandidate(opts: {
  userId: string;
  coversBlockIndices?: number[];
  shiftStartAt: Date;
  shiftEndAt: Date;
}) {
  return makeCandidate({
    userId: opts.userId,
    homeHouseId: HARNWELL,
    gap: GAP,
    coversBlockIndices: opts.coversBlockIndices ?? [0, 1, 2, 3],
    shiftStartAt: opts.shiftStartAt,
    shiftEndAt: opts.shiftEndAt,
  });
}

// ---------------------------------------------------------------------
// Check 1 — shift start aligned with span start
// ---------------------------------------------------------------------

describe('Check 1 — alignment at span start', () => {
  it('exactly one Check-1 satisfier is selected (no need to advance to Check 2)', () => {
    const a = harnCandidate({
      userId: 'A-aligned-start',
      shiftStartAt: SPAN_START, // ✓ Check 1
      shiftEndAt: plusBlocks(SPAN_END, 2), // ✗ Check 2 (shift ends after span)
    });
    const b = harnCandidate({
      userId: 'B-early-start',
      shiftStartAt: plusMinutes(SPAN_START, -60), // ✗ Check 1 (shift started 1h before)
      shiftEndAt: SPAN_END, // ✓ Check 2 — but Check 1 already selected A
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-aligned-start');
  });

  it('Check 1 takes effect even when a different worker uniquely satisfies Check 2 (chain semantics — NOT independent checks)', () => {
    // This is the trap: a naive "apply each check independently and
    // pick whoever uniquely matches" would have to break the tie
    // between A (uniquely satisfies Check 1) and B (uniquely satisfies
    // Check 2) some other way. The spec's CHAIN semantics make A
    // the unambiguous winner — Check 1 short-circuits.
    const a = harnCandidate({
      userId: 'A-only-c1',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });
    const b = harnCandidate({
      userId: 'B-only-c2',
      shiftStartAt: plusMinutes(SPAN_START, -120),
      shiftEndAt: SPAN_END,
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-only-c1');
  });

  it('multiple Check-1 satisfiers narrow the candidate set; Check 2 then breaks the tie', () => {
    // A and B both start at span start (Check 1 ✓ ✓), but only A's
    // shift also ends at the span end (Check 2). C does not satisfy
    // Check 1 — so even though C also satisfies Check 2, the chain
    // has already excluded C from the narrowed set.
    const a = harnCandidate({
      userId: 'A-c1-c2',
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });
    const b = harnCandidate({
      userId: 'B-c1-only',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });
    const c = harnCandidate({
      userId: 'C-c2-only',
      shiftStartAt: plusMinutes(SPAN_START, -60),
      shiftEndAt: SPAN_END,
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b, c])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-c1-c2');
  });

  it('zero Check-1 satisfiers leaves the candidate set UNNARROWED; Check 2 then runs on the full set', () => {
    // Trap: a naive implementation might narrow to the empty set and
    // crash. The spec is implicit but unambiguous: "if a check
    // produces multiple satisfiers... narrow" — narrowing to zero is
    // not a meaningful narrowing. The natural reading is "set
    // unchanged, advance."
    const a = harnCandidate({
      userId: 'A-c2-only',
      shiftStartAt: plusMinutes(SPAN_START, -60),
      shiftEndAt: SPAN_END, // ✓ Check 2
    });
    const b = harnCandidate({
      userId: 'B-neither',
      shiftStartAt: plusMinutes(SPAN_START, -60),
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-c2-only');
  });
});

// ---------------------------------------------------------------------
// Check 2 — shift end aligned with span end
// ---------------------------------------------------------------------

describe('Check 2 — alignment at span end (within Check-1 narrowed set)', () => {
  it('among Check-1 satisfiers, exactly one Check-2 satisfier wins', () => {
    const a = harnCandidate({
      userId: 'A-c1-c2',
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });
    const b = harnCandidate({
      userId: 'B-c1-only',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 2),
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-c1-c2');
  });

  it('multiple Check-2 satisfiers within the narrowed set → narrow further and Check 3 (arbitrary) picks from THOSE', () => {
    // Both A and B satisfy Check 1 AND Check 2 with identical bounds.
    // Worker C satisfies Check 1 only. Worker D satisfies neither.
    // Narrowing trace:
    //   Check 1 satisfiers: {A, B, C}            (D excluded)
    //   Check 2 satisfiers within {A, B, C}: {A, B}  (C excluded)
    //   Check 3: arbitrary among {A, B} (D is NOT in scope at all).
    const a = harnCandidate({
      userId: 'A-c1-c2',
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });
    const b = harnCandidate({
      userId: 'B-c1-c2',
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });
    const c = harnCandidate({
      userId: 'C-c1-only',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });
    const d = harnCandidate({
      userId: 'D-neither',
      shiftStartAt: plusMinutes(SPAN_START, -120),
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b, c, d])]));

    expect(result).toHaveLength(1);
    expect(['A-c1-c2', 'B-c1-c2']).toContain(result[0]!.workerId);
    expect(['C-c1-only', 'D-neither']).not.toContain(result[0]!.workerId);
  });

  it('zero Check-2 satisfiers in the narrowed set leaves the set unchanged; Check 3 picks arbitrarily from the Check-1 narrowed set', () => {
    // A and B both satisfy Check 1 but neither satisfies Check 2.
    // Narrowed-by-Check-1 set is {A, B}; Check 2 narrows to {} which
    // is not a meaningful narrowing; we proceed to Check 3 on {A, B}.
    const a = harnCandidate({
      userId: 'A-c1-only',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 2),
    });
    const b = harnCandidate({
      userId: 'B-c1-only',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b])]));

    expect(result).toHaveLength(1);
    expect(['A-c1-only', 'B-c1-only']).toContain(result[0]!.workerId);
  });
});

// ---------------------------------------------------------------------
// Check 3 — arbitrary from current candidate set
// ---------------------------------------------------------------------

describe('Check 3 — arbitrary from the surviving candidate set', () => {
  it('zero Check-1 AND zero Check-2 satisfiers → arbitrary from the full eligible set covering the span', () => {
    const a = harnCandidate({
      userId: 'A-neither',
      shiftStartAt: plusMinutes(SPAN_START, -60),
      shiftEndAt: plusBlocks(SPAN_END, 2),
    });
    const b = harnCandidate({
      userId: 'B-neither',
      shiftStartAt: plusMinutes(SPAN_START, -120),
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b])]));

    expect(result).toHaveLength(1);
    expect(['A-neither', 'B-neither']).toContain(result[0]!.workerId);
  });

  it('the algorithm makes SOME deterministic choice (calling it twice with the same input returns the same worker)', () => {
    // The spec calls Check 3 "arbitrary" but the algorithm must be
    // pure and deterministic — calling it twice on the same input
    // must produce the same output. ("Arbitrary" means "no spec
    // guarantee about which one"; it does NOT mean "non-deterministic.")
    const a = harnCandidate({
      userId: 'A-arbitrary',
      shiftStartAt: plusMinutes(SPAN_START, -60),
      shiftEndAt: plusBlocks(SPAN_END, 2),
    });
    const b = harnCandidate({
      userId: 'B-arbitrary',
      shiftStartAt: plusMinutes(SPAN_START, -120),
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });

    const input = makeInput(GAP, [rosterOf([a, b])]);
    const first = runFloatLookup(input);
    const second = runFloatLookup(input);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.workerId).toBe(second[0]!.workerId);
  });
});

// ---------------------------------------------------------------------
// The "exactly-spans-gap" lone candidate — Check 1 + Check 2 both
// satisfy, but there's no tie. Test that the algorithm still selects
// the worker correctly (no edge-case failure when a single candidate
// trivially passes the checks).
// ---------------------------------------------------------------------

describe('single candidate whose shift exactly spans the gap', () => {
  it('is selected — both checks satisfy trivially, no narrowing needed', () => {
    const sole = harnCandidate({
      userId: 'sole-exact-span',
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([sole])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('sole-exact-span');
    expect(result[0]!.blocks).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------
// Tiebreaker scope: workers covering DIFFERENT spans are NEVER in the
// same candidate set together (the chain operates per-span).
// ---------------------------------------------------------------------

describe('tiebreaker scope — operates per same-span candidate set', () => {
  it('a worker covering a SHORTER consecutive span is NOT in the tiebreaker candidate set against full-coverage workers', () => {
    // A and B both cover the full 4-block span. C only covers the
    // last 2 blocks. The candidate set for the 4-block span is {A, B}
    // — C is not in it. C's only chance is the partial-coverage
    // fallback or a separate iteration; neither applies here because
    // A or B fully covers the gap.
    const a = harnCandidate({
      userId: 'A-full',
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });
    const b = harnCandidate({
      userId: 'B-full',
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 2),
    });
    const c = harnCandidate({
      userId: 'C-tail-only',
      coversBlockIndices: [2, 3],
      shiftStartAt: GAP.blocks[2]!.blockStartAt,
      shiftEndAt: SPAN_END,
    });

    const result = runFloatLookup(makeInput(GAP, [rosterOf([a, b, c])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-full');
  });
});
