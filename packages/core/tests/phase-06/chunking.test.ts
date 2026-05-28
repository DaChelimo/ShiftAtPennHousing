// Phase 06 — Float Lookup Algorithm: multi-floater chunking (§6.2).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §6.2 (gap split into 30-min blocks;
//     largest consecutive run wins; after assigning, remove covered
//     blocks and repeat within the same source; one float_assignment
//     record per floater);
//   ARCHITECTURE.md §5.2 step 3b–3d (per-worker largest-consecutive
//     coverage; tentative counter; repeat until no run ≥ 2 blocks).
//
// This file tests the chunking BEHAVIOR (which blocks get assigned to
// whom and in what count). The minimum-chunk-size rule lives in its
// own file (minimum-chunk.test.ts); the candidate-set narrowing
// tiebreaker chain lives in tiebreaker.test.ts; the partial-coverage
// fallback (no worker covers the full uncovered run) lives in
// partial-coverage.test.ts.

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  ANCHOR_19_00_EDT,
  HARNWELL,
  HOUSE_05,
  QUAD,
  assignmentByWorker,
  assignedBlockIds,
  makeCandidate,
  makeGap,
  makeInput,
  makeSourceRoster,
  uncoveredBlockIds,
} from './fixtures.js';

const GAP_HOUSE = HOUSE_05;

// ---------------------------------------------------------------------
// Single-floater scenarios
// ---------------------------------------------------------------------

describe('single-floater chunking', () => {
  it('one Quad worker covering the entire gap is assigned the entire span', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-full-cover',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
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
    expect(result[0]!.workerId).toBe('quad-full-cover');
    expect(result[0]!.blocks).toHaveLength(4);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });

  it('the worker with the LONGEST consecutive coverage wins over a shorter-coverage worker', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);

    // Worker A covers a 4-block run, Worker B covers a 2-block run.
    const a = makeCandidate({
      userId: 'quad-long',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'quad-short',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [4, 5],
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

    // Both eligible candidates get assigned — A to [0..3], B to [4..5].
    expect(result).toHaveLength(2);
    expect(assignmentByWorker(result, 'quad-long')!.blocks).toHaveLength(4);
    expect(assignmentByWorker(result, 'quad-short')!.blocks).toHaveLength(2);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });

  it('a candidate whose schedule includes blocks OUTSIDE the gap covers only the gap-overlap', () => {
    // A worker's source-shift extends past the gap end; their float
    // assignment is bounded by the gap. The remaining source time
    // (after the float window) is the "planned handoff" of §6.5 and
    // is NOT the algorithm's concern — it just doesn't appear in the
    // assigned blocks.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-overhangs-gap',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
      // Shift bounds 19:00 – 24:00 (10 blocks); float covers 19:00 – 21:00.
      shiftStartAt: gap.blocks[0]!.blockStartAt,
      shiftEndAt: new Date(gap.blocks[0]!.blockStartAt.getTime() + 10 * 30 * 60 * 1000),
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
    expect(result[0]!.blocks).toHaveLength(4);
    // The assigned blocks are EXACTLY the gap blocks, not extras.
    for (const blockId of result[0]!.blocks) {
      expect(gap.blocks.map((b) => b.blockId)).toContain(blockId);
    }
  });
});

// ---------------------------------------------------------------------
// Multi-floater scenarios — different topologies of coverage.
// ---------------------------------------------------------------------

describe('multi-floater chunking — within a single source', () => {
  it('5-hour gap covered by two Harnwell workers (2h + 3h)', () => {
    // Per BSpec §6.2 worked example:
    //   "Each floater receives their own float assignment. A 19:00 to
    //    24:00 destination gap covered by worker B (19:00 to 21:00 from
    //    Harnwell) and worker D (21:00 to 24:00 from Harnwell) results
    //    in two distinct float assignment records."
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 10);
    const b = makeCandidate({
      userId: 'harn-B',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const d = makeCandidate({
      userId: 'harn-D',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6, 7, 8, 9],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [b, d],
          gap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(assignmentByWorker(result, 'harn-B')!.blocks).toHaveLength(4);
    expect(assignmentByWorker(result, 'harn-D')!.blocks).toHaveLength(6);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });

  it('after the first floater is assigned, remaining UNCOVERED blocks drive the next iteration within the same source', () => {
    // Gap = 6 blocks. Worker A covers the middle [2,3]. Worker B covers
    // leading [0,1]. Worker C covers trailing [4,5]. Each pair is 2
    // blocks. The algorithm should produce three assignments because
    // chunking iterates until no eligible worker covers a remaining
    // consecutive run of ≥ 2 blocks.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);
    const a = makeCandidate({
      userId: 'harn-A',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [2, 3],
    });
    const b = makeCandidate({
      userId: 'harn-B',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });
    const c = makeCandidate({
      userId: 'harn-C',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5],
    });

    // Harnwell has 4 workers on shift (large enough that floor never
    // binds — we're testing chunking, not the floor).
    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b, c],
          gap,
          homogeneousHeadcount: 4,
        }),
      ]),
    );

    expect(result).toHaveLength(3);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });

  it('cross-source: Quad exhausts first, Harnwell covers the remaining tail (combined coverage)', () => {
    // Per §6.2 #3: "Once Quad is exhausted, the algorithm runs the same
    // chunking process at Harnwell for the remaining uncovered blocks."
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 8);
    const quad = makeCandidate({
      userId: 'quad-half',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const harn = makeCandidate({
      userId: 'harn-rest',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6, 7],
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
    expect(assignmentByWorker(result, 'quad-half')!.blocks).toHaveLength(4);
    expect(assignmentByWorker(result, 'harn-rest')!.blocks).toHaveLength(4);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Tentative counter: ensures within-iteration headcount accounting
// (§6.2 implicitly via §3.5; ARCH §5.2 step 3d explicit example).
// ---------------------------------------------------------------------

describe('global tentative-floater counter (per source)', () => {
  // PINNED DECISION: the in-pass tentative counter is GLOBAL per
  // source — not per-block. See TEST_PLAN §pinned-decisions for the
  // full rationale; the short version is that the spec's worked
  // example (Quad headcount 3 → max 2 floats per pass) only holds
  // under global accounting. Per-block accounting would admit a 3rd
  // disjoint-span floater, which contradicts the worked example.

  it('Quad with 3 workers, gap split into 3 disjoint 2-block runs → only 2 are selected; 3rd rejected by global counter', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);
    const a = makeCandidate({
      userId: 'quad-a',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1],
    });
    const b = makeCandidate({
      userId: 'quad-b',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [2, 3],
    });
    const c = makeCandidate({
      userId: 'quad-c',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [4, 5],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [a, b, c],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(assignedBlockIds(result)).toHaveLength(4);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(2);
  });

  it('tentative counter is per-source: Quad uses up its quota of 2; Harnwell still has its own quota of 1', () => {
    // Quad: 3 workers, two get floated (global counter halts third).
    // Harnwell: 2 workers, one gets floated (global counter halts second).
    // Gap needs 3 distinct sub-spans; the third Quad worker is rejected
    // by the Quad-side counter but Harnwell's floater picks up the third.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);
    const quadA = makeCandidate({
      userId: 'quad-a',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1],
    });
    const quadB = makeCandidate({
      userId: 'quad-b',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [2, 3],
    });
    const quadC = makeCandidate({
      userId: 'quad-c',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [4, 5],
    });
    // Harnwell candidate covers the same trailing pair Quad-C does;
    // Quad-C is rejected by the Quad counter → Harnwell picks up [4,5].
    const harn = makeCandidate({
      userId: 'harn-pickup',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [quadA, quadB, quadC],
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

    expect(result).toHaveLength(3);
    const ids = result.map((r) => r.workerId).sort();
    const quadAssignedCount = ids.filter((id) => id.startsWith('quad-')).length;
    const harnAssignedCount = ids.filter((id) => id.startsWith('harn-')).length;
    expect(quadAssignedCount).toBe(2);
    expect(harnAssignedCount).toBe(1);
    expect(ids).toContain('harn-pickup');
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });

  it('disjoint sub-spans at Harnwell (headcount 2) still bind the global counter — only 1 floater is selected', () => {
    // Under per-block accounting, both floaters would pass (disjoint
    // blocks → no per-block conflict). Under global accounting, the
    // 2-worker source can spare exactly 1; the 2nd is rejected even
    // when their span shares no blocks with the 1st.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'harn-a',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1],
    });
    const b = makeCandidate({
      userId: 'harn-b',
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
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------
// Edge cases of chunking
// ---------------------------------------------------------------------

describe('chunking edge cases', () => {
  it('returns empty when no candidates exist at any source', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [],
          gap,
          homogeneousHeadcount: 3,
        }),
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 2,
          candidates: [],
          gap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });

  it('returns empty when no source houses are supplied at all', () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const result = runFloatLookup(makeInput(gap, [], []));

    expect(result).toHaveLength(0);
  });

  it('a per-block headcount that varies across the gap is respected on a per-block basis', () => {
    // Gap = 4 blocks. Source has headcount 3 at blocks 0/1, headcount
    // 2 at blocks 2/3. The candidate's span covers all 4 blocks. The
    // floor must hold for EVERY block in the span; blocks 2/3 have
    // headcount 2, so removing the candidate leaves 1 there (= floor).
    // OK — selection proceeds.
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-varying',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          effectiveHeadcountByBlockId: {
            [gap.blocks[0]!.blockId]: 3,
            [gap.blocks[1]!.blockId]: 3,
            [gap.blocks[2]!.blockId]: 2,
            [gap.blocks[3]!.blockId]: 2,
          },
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.blocks).toHaveLength(4);
  });

  it("a per-block headcount of 1 on ANY block in the candidate's span rejects the candidate (would drop that block to 0)", () => {
    const gap = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-blocked-by-low-block',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          effectiveHeadcountByBlockId: {
            [gap.blocks[0]!.blockId]: 3,
            [gap.blocks[1]!.blockId]: 3,
            // The 21:00 block has only 1 worker — floating this
            // candidate through it would drop the desk to 0.
            [gap.blocks[2]!.blockId]: 1,
            [gap.blocks[3]!.blockId]: 3,
          },
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });
});
