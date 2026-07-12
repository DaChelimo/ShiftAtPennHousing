// Phase 06 — Float Lookup Algorithm: 1-block minimum chunk rule
// (§6.2 point 4).
//
// The minimum float chunk size was lowered from 2 blocks (1 hour) to 1
// block (30 minutes) so single-block gaps are absorbed by floats
// instead of routed to Allied. The goal is to minimize how often paid
// Allied coverage is procured (BSpec §6.2 #4).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.2 #4:
//     "Any individual floater's assigned span MUST be at least 1
//      30-minute block. A worker whose largest consecutive coverage is
//      a single 30-minute block IS assigned that block rather than
//      leaving it for Allied."
//   ARCHITECTURE.md §5.2 step 3c / §5.3:
//     the minimum-chunk precondition is now 1 block, so a 1-block
//     coverer is a valid candidate at every selection step.
//
// The rule still applies at EVERY selection step — it is just that the
// floor is now 1, so nothing coverable is dropped for being "too small":
//   (a) The initial largest-consecutive selection.
//   (b) Subsequent iterations within the same source.
//   (c) Cross-source iterations.
//   (d) Tier ordering (full coverage still outranks partial coverage).
//   (e) The partial-coverage fallback (a 1-block leading portion is now
//       taken).
//
// A block is left to Allied ONLY when no eligible worker can cover it at
// all — never merely because a worker's coverable span is a single block.

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
// (a) Initial-selection: 1-block coverage is now ACCEPTED.
// ---------------------------------------------------------------------

describe('initial selection — 1-block coverage is assigned', () => {
  it('a sole candidate whose largest consecutive coverage is 1 block IS assigned that block', () => {
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

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-one-block');
    expect(result[0]!.blocks).toEqual([gap.blocks[1]!.blockId]);
    // Blocks 0, 2, 3 have no coverage → Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });

  it('two single-block-coverage candidates are BOTH assigned their blocks', () => {
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

    expect(result).toHaveLength(2);
    expect(assignedBlockIds(result)).toEqual([gap.blocks[0]!.blockId, gap.blocks[3]!.blockId]);
    // The interior blocks 1, 2 have no coverage → Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[1]!.blockId,
      gap.blocks[2]!.blockId,
    ]);
  });

  it('a candidate with non-contiguous 1-block coverage covers its leading block (largest consecutive run is 1)', () => {
    // The candidate is scheduled at source for blocks 0 and 2 (not 1).
    // Their largest CONSECUTIVE run within the gap is a single block.
    // Under the 1-block floor the leading block is taken.
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

    // One worker can be selected once, so only their leading block is
    // covered; block 2 is stranded (same worker cannot be reselected).
    expect(result).toHaveLength(1);
    expect(result[0]!.blocks).toEqual([gap.blocks[0]!.blockId]);
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[1]!.blockId,
      gap.blocks[2]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });

  it('a candidate with EXACTLY 2 consecutive blocks of coverage IS assigned both blocks', () => {
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
    // Blocks 0 and 3 have no coverage → Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[0]!.blockId,
      gap.blocks[3]!.blockId,
    ]);
  });
});

// ---------------------------------------------------------------------
// (b) Subsequent iterations: after the first floater is assigned, a
// worker whose remaining coverable slice is a single block IS now
// selected for it (previously rejected).
// ---------------------------------------------------------------------

describe('iterative selection — a trailing single block is absorbed', () => {
  it('after worker A takes the long run, worker B covering the last block IS assigned it', () => {
    // Gap = 5 blocks. A covers [0,1,2,3] (4-block run). B covers [3,4]
    // — after A grabs [0..3], B's remaining coverage is only [4], a
    // single block, which is now assigned to B.
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

    expect(result).toHaveLength(2);
    expect(result[0]!.workerId).toBe('harn-A');
    expect(result[0]!.blocks).toHaveLength(4);
    const bAssignment = result.find((assignment) => assignment.workerId === 'harn-B');
    expect(bAssignment!.blocks).toEqual([gap.blocks[4]!.blockId]);
    // Every block is now covered.
    expect(uncoveredBlockIds(gap, result)).toEqual([]);
  });

  it('iteration halts when no uncovered blocks remain', () => {
    // Gap = 4 blocks. Worker A covers [0,1,2,3]. Worker B covers [0].
    // After A fully covers the gap, no uncovered blocks remain, so B is
    // never reached.
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
// (c) Cross-source iterations: a Harnwell candidate covering a single
// leftover block for a Quad gap IS now selected.
// ---------------------------------------------------------------------

describe('cross-source selection — a 1-block Harnwell candidate covers a Quad leftover', () => {
  it('Quad covers [0..3] of a 5-block gap; a Harnwell candidate covers [4] and IS assigned it', () => {
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

    expect(result).toHaveLength(2);
    expect(result[0]!.workerId).toBe('quad-quad');
    const harnAssignment = result.find((assignment) => assignment.workerId === 'harn-tail-one');
    expect(harnAssignment!.blocks).toEqual([gap.blocks[4]!.blockId]);
    expect(uncoveredBlockIds(gap, result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// (d) Tier ordering: full coverage still outranks partial coverage, so
// a full-gap coverer is preferred over a 1-block partial coverer.
// ---------------------------------------------------------------------

describe('tier ordering — full coverage is preferred over a 1-block partial (ARCH §5.3)', () => {
  it('a full-gap coverer is selected over a 1-block-only worker', () => {
    // Gap = 2 blocks. Worker A covers both [0,1] (full coverage).
    // Worker B covers only [0]. Tier 1 (full coverage) selects A, and
    // no uncovered blocks remain for B.
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
// (e) Partial-coverage fallback: a 1-block longest leading portion is
// now taken (previously it was below the floor and skipped).
// ---------------------------------------------------------------------

describe('partial-coverage fallback takes a 1-block leading portion', () => {
  it('when no worker covers a full run, a worker covering the leading block IS selected', () => {
    // Gap = 3 blocks. Worker A covers only block 0. The partial-coverage
    // fallback takes the longest leading portion — now 1 block is enough.
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

    expect(result).toHaveLength(1);
    expect(result[0]!.blocks).toEqual([gap.blocks[0]!.blockId]);
    // Blocks 1 and 2 have no coverage → Allied.
    expect(uncoveredBlockIds(gap, result)).toEqual([
      gap.blocks[1]!.blockId,
      gap.blocks[2]!.blockId,
    ]);
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
// Composite: a block that NO worker can cover still goes to Allied. The
// floor is not the reason a block is stranded — lack of any coverer is.
// ---------------------------------------------------------------------

describe('composite — a block no worker can cover goes to Allied', () => {
  it('worker A covers blocks [0,1,2], worker B covers [4,5,6]; block [3] has no coverer and goes to Allied', () => {
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
