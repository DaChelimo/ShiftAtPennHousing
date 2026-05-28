// Phase 06 — Float Lookup Algorithm: 2-block minimum chunk rule
// (§6.2 point 4 — "NON-NEGOTIABLE").
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.2 #4:
//     "Any individual floater's assigned span MUST be at least 2
//      consecutive 30-minute blocks (a full hour). If the largest
//      consecutive coverage a worker can provide is only one
//      30-minute block, that block is not assigned to them and is
//      left for Allied. This minimum applies to every selection,
//      including those resulting from the tiebreaker rules in
//      Section 6.3 and the partial-coverage fallback below."
//
//   ARCHITECTURE.md §5.2 step 3c:
//     "Always enforce the 2-block minimum at this step — a worker
//      whose largest span is 1 block is not selected at all."
//   ARCHITECTURE.md §5.3:
//     "The 2-block minimum from §5.2 step 4 is a precondition for
//      being in the candidate set — a worker who cannot meet it is
//      excluded before the tiebreaker chain runs."
//
// The minimum applies at EVERY SELECTION STEP:
//   (a) The initial largest-consecutive selection.
//   (b) Subsequent iterations within the same source.
//   (c) Cross-source iterations.
//   (d) Tiebreaker-resolved selections (the candidate set never
//       contains a sub-minimum worker).
//   (e) The partial-coverage fallback (the "longest leading portion"
//       must still be ≥ 2 blocks; otherwise the worker is skipped).
//
// A 1-block uncovered block is NEVER assigned to a floater, EVEN IF
// no other worker can cover it. It goes to Allied.

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  ANCHOR_19_00_EDT,
  HARNWELL,
  HOUSE_05,
  QUAD,
  assignedBlockIds,
  makeCandidate,
  makeGap,
  makeInput,
  makeSourceRoster,
  uncoveredBlockIds,
} from './fixtures.js';

const GAP_HOUSE = HOUSE_05;

// ---------------------------------------------------------------------
// (a) Initial-selection rejection.
// ---------------------------------------------------------------------

describe('initial selection — 1-block coverage is rejected', () => {
  it('a sole candidate whose largest consecutive coverage is 1 block is NOT assigned (gap → Allied)', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-one-block',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [1], // single 30-min block
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
    expect(uncoveredBlockIds(gap, result)).toEqual(gap.blocks.map((b) => b.blockId));
  });

  it('two single-block-coverage candidates are BOTH rejected (Allied takes everything)', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'quad-a-one',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0],
    });
    const b = makeCandidate({
      userId: 'quad-b-one',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });

  it('a candidate with non-contiguous 1-block coverage at multiple gap positions is rejected (none of the runs is ≥ 2)', () => {
    // The candidate is scheduled at source for blocks 0 and 2 (not 1).
    // Their largest CONSECUTIVE run within the gap is 1 block.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-scattered',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 2],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });

  it('a candidate with EXACTLY 2 consecutive blocks of coverage IS assigned (2-block minimum is inclusive)', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-just-two',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [1, 2],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.blocks).toHaveLength(2);
    // Blocks 0 and 3 are uncovered → Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });
});

// ---------------------------------------------------------------------
// (b) Subsequent-iteration rejection: after the first floater is
// assigned, the remaining UNCOVERED slice may shrink below 2 blocks
// for some workers. Those workers must NOT be selected on the next
// iteration.
// ---------------------------------------------------------------------

describe('iterative selection — sub-minimum coverage is rejected at each step', () => {
  it('after worker A takes the long run, worker B with only 1 remaining uncovered block is rejected (Allied takes it)', () => {
    // Gap = 5 blocks. A covers [0,1,2,3] (4-block run). B covers [3,4]
    // — but after A grabs [0..3], B's remaining coverage is only [4],
    // a single block. B is REJECTED in the second iteration.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 5);
    const a = makeCandidate({
      userId: 'harn-A',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'harn-B',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [3, 4],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-A');
    expect(result[0]!.blocks).toHaveLength(4);
    // The trailing single block is uncovered.
    expect(uncoveredBlockIds(gap, result)).toEqual([gap.blocks[4]!.blockId]);
  });

  it('iteration halts when the remaining uncovered runs are all sub-minimum, even if some workers still cover them', () => {
    // Gap = 4 blocks. Worker A covers [0,1,2,3]. Worker B covers [0]
    // (single block). After A is assigned, no uncovered blocks remain.
    // B is correctly never selected (their span was always sub-minimum
    // anyway, but the algorithm's halt condition is what we're
    // exercising here).
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'harn-full',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'harn-one-block',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-full');
  });
});

// ---------------------------------------------------------------------
// (c) Cross-source rejection: a Harnwell candidate whose coverage of
// the remaining uncovered set is 1 block is rejected even when no
// other coverage exists for that block.
// ---------------------------------------------------------------------

describe('cross-source selection — 1-block-only Harnwell candidate is rejected for a Quad leftover', () => {
  it('Quad covers [0..3] of a 5-block gap; Harnwell candidate covers only [4]; that block is left to Allied', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 5);
    const quad = makeCandidate({
      userId: 'quad-quad',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const harn = makeCandidate({
      userId: 'harn-tail-one',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4],
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
    expect(result[0]!.workerId).toBe('quad-quad');
    expect(uncoveredBlockIds(gap, result)).toEqual([gap.blocks[4]!.blockId]);
  });
});

// ---------------------------------------------------------------------
// (d) Tiebreaker-set integrity: candidates whose span on the selected
// run is below the minimum never enter the candidate set; the
// tiebreaker chain operates only on ≥2-block coverers.
// ---------------------------------------------------------------------

describe('tiebreaker candidate set excludes sub-minimum coverers (ARCH §5.3)', () => {
  it('a 1-block-covering worker is NOT in the candidate set for tiebreaker against 2-block-covering workers', () => {
    // Gap = 2 blocks. Worker A covers both [0,1] (= 2-block span).
    // Worker B covers only [0] (1-block; sub-minimum). The candidate
    // set for the 2-block span is {A} alone — B is excluded.
    // Outcome: A is selected without tiebreaker invocation.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 2);
    const a = makeCandidate({
      userId: 'harn-A-two',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });
    const b = makeCandidate({
      userId: 'harn-B-one',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-A-two');
  });
});

// ---------------------------------------------------------------------
// (e) Partial-coverage fallback respects the minimum: a 1-block
// longest leading portion is NOT selected even in the fallback path.
// ---------------------------------------------------------------------

describe('partial-coverage fallback still respects the 2-block minimum', () => {
  it('when no worker covers a full run AND the longest leading portion is only 1 block, no floater is selected', () => {
    // Gap = 3 blocks. Worker A covers only block 0. No other worker.
    // The partial-coverage fallback would normally take the longest
    // leading portion — but 1 block is below the 2-block floor.
    // Result: empty assignment; whole gap → Allied.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 3);
    const a = makeCandidate({
      userId: 'quad-leading-one',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [a],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
    expect(uncoveredBlockIds(gap, result)).toEqual(gap.blocks.map((b) => b.blockId));
  });

  it('a 2-block longest leading portion IS taken in the partial-coverage fallback', () => {
    // Gap = 4 blocks. Worker A covers [0,1] (leading 2 blocks). No
    // worker covers [2,3]. Fallback takes A; [2,3] → Allied.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'quad-leading-two',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [a],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(assignedBlockIds(result)).toEqual([gap.blocks[0]!.blockId, gap.blocks[1]!.blockId]);
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });
});

// ---------------------------------------------------------------------
// Composite: a chunking iteration that produces leftover 1-block holes
// because no contiguous ≥2-block run is coverable.
// ---------------------------------------------------------------------

describe('composite — chunking leaves 1-block holes for Allied', () => {
  it('worker A covers blocks [0,1,2], worker B covers [4,5,6]; block [3] is alone in the middle and goes to Allied', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 7);
    const a = makeCandidate({
      userId: 'harn-A',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2],
    });
    const b = makeCandidate({
      userId: 'harn-B',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap,
          homogeneousHeadcount: 4,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(uncoveredBlockIds(gap, result)).toEqual([gap.blocks[3]!.blockId]);
  });
});
