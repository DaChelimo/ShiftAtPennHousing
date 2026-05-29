// Phase 06 — Float Lookup Algorithm: partial-coverage fallback
// (§6.2 #5; ARCH §5.2 step 3e).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.2 #5:
//     "If, within a source, no eligible worker can cover the full gap
//      (or the current uncovered run), the algorithm accepts partial
//      coverage: select the worker who can cover the *longest leading
//      portion* of the gap starting from the gap's start, provided
//      that portion is at least 2 blocks. If multiple workers tie on
//      that portion, apply the tiebreaker chain (Section 6.3) to
//      break the tie. Allied is procured for the uncovered tail. This
//      is a fallback, not a tiebreaker — it only applies when no
//      worker can cover the full largest-consecutive run."
//
//   ARCHITECTURE.md §5.2 step 3e:
//     "If no worker can cover the full largest-consecutive run, fall
//      back to selecting the worker who covers the *longest leading
//      portion* of the gap from the gap start, provided that portion
//      is at least 2 blocks. Ties broken by §5.3. Allied procures
//      the remaining tail."
//
// Key semantic distinctions tested here:
//
// 1. FALLBACK FIRES only when no eligible worker covers the FULL
//    largest-consecutive run. When some worker covers it fully,
//    regular chunking (§6.2 #2) applies and there is no fallback.
//
// 2. FALLBACK SELECTION CRITERION is "longest leading portion from
//    the run's start" — which differs from regular chunking's
//    "largest consecutive coverage anywhere." A worker with a
//    longer NON-LEADING run can lose to a worker with a shorter
//    LEADING run when the fallback is active.
//
// 3. The 2-BLOCK MINIMUM applies — verified here and in
//    minimum-chunk.test.ts.
//
// 4. TIEBREAKER ON LEADING-PORTION TIES uses the §6.3 chain
//    (Check 1 / Check 2 / Check 3), applied to the candidate set of
//    workers with the SAME leading-portion length.
//
// 5. ALLIED FILLS THE UNCOVERED TAIL (the algorithm signals this
//    via blocks not appearing in any assignment; the caller derives
//    Allied requests by subtraction).

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  ANCHOR_19_00_EDT,
  HARNWELL,
  HOUSE_05,
  QUAD,
  assignmentByWorker,
  makeCandidate,
  makeGap,
  makeInput,
  makeSourceRoster,
  plusBlocks,
  uncoveredBlockIds,
} from './fixtures.js';

const GAP_HOUSE = HOUSE_05;

// ---------------------------------------------------------------------
// (1) Fallback TRIGGER conditions
// ---------------------------------------------------------------------

describe('partial-coverage fallback — trigger conditions', () => {
  it('does NOT fire when a worker covers the full gap (regular chunking succeeds)', () => {
    // A covers the full 4-block gap; no fallback needed.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'A-full',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'B-partial-leading',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-full');
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });

  it('FIRES when no worker covers the full gap; selects the longest leading-portion worker', () => {
    // A covers [b0,b1] (leading 2); B covers [b2,b3] (trailing 2).
    // No worker covers all 4. Fallback fires. Among workers with a
    // leading portion from b0, A has 2 blocks, B has 0. A wins for the
    // FIRST iteration. After A, uncovered = [b2,b3]; that's the next
    // iteration's largest run and B covers it fully — regular chunking
    // selects B.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'A-leading',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });
    const b = makeCandidate({
      userId: 'B-trailing',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(assignmentByWorker(result, 'A-leading')!.blocks).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[1]!.blockId,
    ]);
    expect(assignmentByWorker(result, 'B-trailing')!.blocks).toEqual([
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// (2) Fallback selection criterion is DISTINCT from regular chunking
// ---------------------------------------------------------------------

describe('fallback selection — longest LEADING portion, not largest coverage anywhere', () => {
  it('a worker with longer NON-leading coverage loses to a worker with shorter LEADING coverage when fallback fires', () => {
    // Gap = 5 blocks. No worker covers all 5.
    //   A covers [b2..b4] — 3 blocks, but NOT leading (starts at b2).
    //   B covers [b0..b1] — 2 blocks, LEADING.
    // Regular chunking (interpreted as "largest coverage anywhere")
    // would pick A first. The partial-coverage fallback REPLACES that
    // criterion with "longest leading portion from gap start," which
    // selects B for [b0..b1]. After B, uncovered = [b2..b4]; A covers
    // it fully and is selected in iteration 2.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 5);
    const a = makeCandidate({
      userId: 'A-mid',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [2, 3, 4],
    });
    const b = makeCandidate({
      userId: 'B-leading',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(assignmentByWorker(result, 'B-leading')!.blocks).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[1]!.blockId,
    ]);
    expect(assignmentByWorker(result, 'A-mid')!.blocks).toEqual([
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
      gap.blocks[4]!.blockId,
    ]);
  });

  it('among multiple leading-portion-coverers, the one with the LONGEST leading run wins', () => {
    // No worker covers the full 6-block gap.
    //   A: 2-block leading [b0..b1]
    //   B: 4-block leading [b0..b3]
    //   C: 3-block leading [b0..b2]
    // Longest leading portion wins → B.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);
    const a = makeCandidate({
      userId: 'A-lead-2',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });
    const b = makeCandidate({
      userId: 'B-lead-4',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const c = makeCandidate({
      userId: 'C-lead-3',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b, c],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    // First iteration: B wins for [b0..b3].
    expect(assignmentByWorker(result, 'B-lead-4')).toBeDefined();
    expect(assignmentByWorker(result, 'B-lead-4')!.blocks).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[1]!.blockId,
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
    // After B, uncovered = [b4, b5]. Neither A nor C covers them;
    // their coverage is in the already-claimed region. So the tail
    // goes to Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[4]!.blockId,
      gap.blocks[5]!.blockId,
    ]);
  });
});

// ---------------------------------------------------------------------
// (3) Fallback + tiebreaker on leading-portion length ties
// ---------------------------------------------------------------------

describe('fallback — §6.3 tiebreaker on leading-portion ties', () => {
  it('two workers tie on leading-portion length → §6.3 tiebreaker applies (Check 1: shift starts at span start)', () => {
    // Both A and B cover the leading 2 blocks. Neither covers the
    // full gap. Tiebreaker on the (b0..b1) leading span:
    //   A's shift starts at SPAN_START → Check 1 ✓
    //   B's shift starts an hour earlier → Check 1 ✗
    //   → A is selected.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const SPAN_START = gap.blocks[0]!.blockStartAt;
    const SPAN_END = plusBlocks(gap.blocks[1]!.blockStartAt, 1); // end of b1

    const a = makeCandidate({
      userId: 'A-aligned',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
      shiftStartAt: SPAN_START,
      shiftEndAt: SPAN_END,
    });
    const b = makeCandidate({
      userId: 'B-early',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
      shiftStartAt: new Date(SPAN_START.getTime() - 60 * 60 * 1000),
      shiftEndAt: SPAN_END,
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    // Only A is admitted by the leading-portion tiebreaker for the
    // fallback. The trailing [b2, b3] is uncovered → Allied.
    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-aligned');
    expect(result[0]!.blocks).toEqual([gap.blocks[0]!.blockId, gap.blocks[1]!.blockId]);
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });
});

// ---------------------------------------------------------------------
// (4) Fallback respects the 2-block minimum
// ---------------------------------------------------------------------

describe('fallback — 2-block minimum (cross-reference minimum-chunk.test.ts)', () => {
  it('a worker whose leading-portion length is only 1 block is NOT selected by fallback', () => {
    // Gap = 3 blocks; A covers [b0] only. Fallback would consider
    // "longest leading portion" — but the only candidate has a 1-block
    // leading portion (sub-minimum). Algorithm halts with no
    // selection; whole gap → Allied.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 3);
    const a = makeCandidate({
      userId: 'A-lead-1',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// (5) Cross-source fallback: Quad fallback fails, Harnwell takes the
// remaining run.
// ---------------------------------------------------------------------

describe('fallback across sources — Quad fallback yields partial coverage; Harnwell picks up the rest', () => {
  it('Quad worker has no leading coverage; Harnwell worker has 4-block leading coverage → fallback exhausts Quad with empty, Harnwell selected', () => {
    // Gap = 4 blocks.
    //   Quad's only candidate covers [b2,b3] (trailing only — no
    //   leading coverage).
    //   Harnwell's only candidate covers [b0..b3] (full coverage).
    //
    // Quad iteration: no worker covers full gap. Fallback: leading
    // portion from b0. Quad's worker has 0 leading → no selection.
    // Quad exhausted (no more eligible candidates with valid spans).
    //
    // Move to Harnwell. Iteration: full gap is still uncovered.
    // Harn's candidate covers all 4. Regular chunking selects.
    //
    // Note: Quad's candidate could in principle have been selected
    // for the trailing [b2, b3] via regular chunking (their max
    // consecutive coverage within uncovered is 2 blocks). But the
    // fallback's "longest leading portion" criterion REPLACES the
    // largest-coverage selection when fallback fires — so Quad's
    // trailing-only candidate is NOT selected in this iteration. See
    // §6.2 #5: "select the worker who can cover the *longest leading
    // portion*"; this is a criterion change, not a tiebreaker.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const quad = makeCandidate({
      userId: 'quad-trailing-only',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [2, 3],
    });
    const harn = makeCandidate({
      userId: 'harn-full',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [quad],
          gap,
          homogeneousHeadcount: 3,
        }),
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 2,
          candidates: [harn],
          gap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-full');
    expect(result[0]!.blocks).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------
// (6) Fallback on subsequent iterations (uncovered run shifts forward)
// ---------------------------------------------------------------------

describe('fallback on subsequent iterations — "current uncovered run" shifts', () => {
  it("after iteration 1 leaves an interior uncovered run, fallback in iteration 2 uses THAT run's start as the leading reference", () => {
    // Gap = 8 blocks.
    //   A covers [b0..b3] (full leading 4 of original gap).
    //   B covers [b4..b6] (3 blocks of trailing region).
    //   C covers [b6..b7] (last 2 blocks).
    //
    // Iteration 1: B's max is 3, C's max is 2, A's max is 4. None
    // covers the full 8. Fallback fires. Leading from b0: A=4, B=0,
    // C=0. A selected for [b0..b3].
    //
    // Iteration 2: uncovered = [b4..b7]. Largest contiguous run = 4
    // blocks. B's coverage of uncovered = [b4..b6] (3 blocks). C's
    // coverage of uncovered = [b6..b7] (2 blocks). No worker covers
    // the full 4-block run. Fallback fires AGAIN. Leading from b4: B=3,
    // C=0. B selected for [b4..b6].
    //
    // Iteration 3: uncovered = [b7]. C's coverage of uncovered = [b7]
    // (1 block — sub-minimum). C NOT selected. b7 → Allied.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 8);
    const a = makeCandidate({
      userId: 'A-lead-4',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'B-mid-3',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6],
    });
    const c = makeCandidate({
      userId: 'C-tail-2',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [6, 7],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b, c],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(assignmentByWorker(result, 'A-lead-4')!.blocks).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[1]!.blockId,
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
    expect(assignmentByWorker(result, 'B-mid-3')!.blocks).toEqual([
      gap.blocks[4]!.blockId,
      gap.blocks[5]!.blockId,
      gap.blocks[6]!.blockId,
    ]);
    expect(uncoveredBlockIds(gap, result)).toEqual([gap.blocks[7]!.blockId]);
  });
});

// ---------------------------------------------------------------------
// (7) F-06-001 regression — a source must try EVERY uncovered run >= 2
// before being abandoned, not just the largest.
// ---------------------------------------------------------------------

describe('multi-run termination (F-06-001)', () => {
  it('covers a smaller uncovered run when the largest run has no eligible coverer', () => {
    // Gap = 9 blocks. X covers the interior [b4,b5,b6]; Y covers the
    // trailing [b7,b8] only. After X is floated, remaining uncovered =
    // [b0..b3] (run of 4) and [b7,b8] (run of 2). The largest run
    // ([b0..b3]) has no eligible coverer (Y covers none of it). The buggy
    // behaviour broke out of the source and sent [b7,b8] to Allied; the
    // fix tries the next-largest run and floats Y for [b7,b8].
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 9);
    const x = makeCandidate({
      userId: 'X-interior',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6],
    });
    const y = makeCandidate({
      userId: 'Y-trailing',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [7, 8],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [x, y],
          gap,
          homogeneousHeadcount: 5,
        }),
      ]),
    );

    expect(assignmentByWorker(result, 'X-interior')!.blocks).toEqual([
      gap.blocks[4]!.blockId,
      gap.blocks[5]!.blockId,
      gap.blocks[6]!.blockId,
    ]);
    expect(assignmentByWorker(result, 'Y-trailing')!.blocks).toEqual([
      gap.blocks[7]!.blockId,
      gap.blocks[8]!.blockId,
    ]);
    // [b0..b3] has no coverer → Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[1]!.blockId,
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });
});
