// Phase 06 — Float Lookup Algorithm: end-to-end integration scenarios.
//
// These tests combine multiple rules (eligibility, chunking, tiebreaker,
// partial coverage, source priority, exclusions) into realistic
// orchestrator-perspective scenarios. The scenarios are drawn from the
// behavioral spec's worked examples and from the operational topology
// of Penn Housing (Quad's 3-worker headcount, Harnwell's 2-worker
// headcount, 11 single-staff houses as destinations only).
//
// Spec sources: BSpec §6.1, §6.2, §6.3; ARCH §5.2, §5.3.

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  ANCHOR_19_00_EDT,
  HARNWELL,
  HOUSE_05,
  HOUSE_07,
  QUAD,
  assignmentByWorker,
  makeCandidate,
  makeExclusion,
  makeGap,
  makeInput,
  makeSourceRoster,
  plusBlocks,
  plusMinutes,
  uncoveredBlockIds,
} from './fixtures.js';

// ---------------------------------------------------------------------
// Scenario 1: 3-hour gap at House-05. Quad has 3 workers; Harnwell has
// 2. A Quad worker fully covers the gap; selected immediately (Quad
// precedence).
// ---------------------------------------------------------------------

describe('Scenario 1 — 3-hour gap at House-05; Quad covers it (Quad precedence)', () => {
  it('selects one Quad floater whose shift fully covers the gap', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 6);
    const quadCovers = makeCandidate({
      userId: 'quad-full-cover',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3, 4, 5],
    });
    const quadIdle1 = makeCandidate({
      userId: 'quad-idle-1',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3, 4, 5],
    });
    const quadIdle2 = makeCandidate({
      userId: 'quad-idle-2',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3, 4, 5],
    });
    // Harnwell workers exist but Quad is exhausted first, and one
    // Quad worker covers everything — Harnwell never gets consulted.
    const harn = makeCandidate({
      userId: 'harn-1',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3, 4, 5],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [quadCovers, quadIdle1, quadIdle2],
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
    const ids = result.map((r) => r.workerId);
    // The selected worker is one of the Quad candidates — never the
    // Harnwell candidate (Quad is exhausted first).
    expect(ids[0]!.startsWith('quad-')).toBe(true);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Scenario 2: 1-hour gap (2 blocks), the only available worker covers
// only 1 block (30 min). The 1-block minimum absorbs it: the worker is
// floated for that block, and only the uncovered block → Allied.
// ---------------------------------------------------------------------

describe('Scenario 2 — single-block coverage is absorbed by a float', () => {
  it('assigns the one coverable block and leaves only the uncovered block to Allied', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 2);
    const a = makeCandidate({
      userId: 'quad-half-hour',
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
    expect(result[0]!.workerId).toBe('quad-half-hour');
    expect(result[0]!.blocks).toEqual([gap.blocks[0]!.blockId]);
    expect(uncoveredBlockIds(gap, result)).toEqual([gap.blocks[1]!.blockId]);
  });
});

// ---------------------------------------------------------------------
// Scenario 3: 4-hour gap, two workers split the coverage (2h + 2h).
// Two float assignment records, one per floater (§6.2 worked example).
// ---------------------------------------------------------------------

describe('Scenario 3 — multi-floater split coverage (2h + 2h)', () => {
  it('produces two distinct float assignments — one per floater', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 8);
    const a = makeCandidate({
      userId: 'harn-first-half',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'harn-second-half',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6, 7],
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
    expect(assignmentByWorker(result, 'harn-first-half')!.blocks).toHaveLength(4);
    expect(assignmentByWorker(result, 'harn-second-half')!.blocks).toHaveLength(4);
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Scenario 4: Worker has an exclusion that overlaps the gap by a single
// block — excluded per §3.8 "any block-level intersection."
// ---------------------------------------------------------------------

describe('Scenario 4 — partial-overlap float_exclusion excludes the worker', () => {
  it('excludes worker A (exclusion 19:00–21:00) from a 20:00–22:00 gap (overlap = 20:00 block)', () => {
    // Gap starts at 20:00 (= ANCHOR + 2 blocks = ANCHOR + 1 hour).
    const gapStart = plusBlocks(ANCHOR_19_00_EDT, 2);
    const gap = makeGap(HOUSE_05, gapStart, 4); // 20:00 → 22:00

    const a = makeCandidate({
      userId: 'A-prior-decline',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'B-backup',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // A's exclusion window: 19:00 – 21:00. Overlaps the 20:00 – 22:00
    // gap at the 20:00 block (and 20:30 block).
    const exclusion = makeExclusion({
      userId: 'A-prior-decline',
      destinationHouseId: HOUSE_05,
      windowStartAt: ANCHOR_19_00_EDT,
      windowEndAt: plusBlocks(ANCHOR_19_00_EDT, 4), // 21:00
    });

    const result = runFloatLookup(
      makeInput(
        gap,
        [
          makeSourceRoster({
            sourceHouseId: QUAD,
            precedenceOrder: 1,
            candidates: [a, b],
            gap,
            homogeneousHeadcount: 3,
          }),
        ],
        [exclusion],
      ),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('B-backup');
  });
});

// ---------------------------------------------------------------------
// Scenario 5: Worker at 39h weekly (near hard cap) is still eligible —
// hours cap is NOT consulted at float assignment (§6.1, AGENTS #4).
// ---------------------------------------------------------------------

describe('Scenario 5 — hours cap is not consulted on float', () => {
  it('a worker near the 40h hard cap is admitted (the algorithm has no cap field by design)', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 4);
    // No cap parameter on the input contract — assertion is by
    // behavior: the candidate is admitted.
    const a = makeCandidate({
      userId: 'quad-39-hours-this-week',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
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
    expect(result[0]!.workerId).toBe('quad-39-hours-this-week');
  });
});

// ---------------------------------------------------------------------
// Scenario 6: HM role at the source — excluded. The HM has scheduled
// shifts at their home house, but the float lookup never selects them.
// ---------------------------------------------------------------------

describe('Scenario 6 — an HM-role worker at the source is excluded from float lookup', () => {
  it('routes the float to the SW candidate instead of the equally-positioned HM', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 4);
    const hmQuad = makeCandidate({
      userId: 'quad-hm-not-floatable',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['sw', 'hm'],
    });
    const swQuad = makeCandidate({
      userId: 'quad-sw-floatable',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['sw'],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [hmQuad, swQuad],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-sw-floatable');
  });
});

// ---------------------------------------------------------------------
// Scenario 7: Multi-floater scenario with §6.3 tiebreaker. Two Quad
// workers cover the full gap; the one whose shift aligns to the gap
// start is selected.
// ---------------------------------------------------------------------

describe('Scenario 7 — multi-candidate full coverage; §6.3 Check 1 (start alignment) breaks the tie', () => {
  it('selects the candidate whose shift starts at the span start', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 4);
    const SPAN_START = gap.blocks[0]!.blockStartAt;
    const SPAN_END = plusBlocks(gap.blocks[3]!.blockStartAt, 1);

    const a = makeCandidate({
      userId: 'quad-aligned',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
      shiftStartAt: SPAN_START,
      shiftEndAt: plusBlocks(SPAN_END, 4),
    });
    const b = makeCandidate({
      userId: 'quad-early-start',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
      shiftStartAt: plusMinutes(SPAN_START, -60),
      shiftEndAt: SPAN_END,
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

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-aligned');
  });
});

// ---------------------------------------------------------------------
// Scenario 8: Quad source exhausted (no eligible workers); Harnwell
// picks up the entire gap. Tests source precedence + cross-source
// fallthrough.
// ---------------------------------------------------------------------

describe('Scenario 8 — Quad has no eligible candidates; Harnwell covers the entire gap', () => {
  it('skips Quad (no candidates) and the Harnwell worker covers the full gap', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 4);
    const harn = makeCandidate({
      userId: 'harn-full-cover',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

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
          candidates: [harn],
          gap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-full-cover');
    expect(uncoveredBlockIds(gap, result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// Scenario 9: A 1-block hole between two covered runs goes to Allied
// (the 2-block minimum forbids assigning the lone block to a floater).
// ---------------------------------------------------------------------

describe('Scenario 9 — interior 1-block hole goes to Allied', () => {
  it('covers [0..2] and [4..6] from two floaters; [b3] alone goes to Allied', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 7);
    const leading = makeCandidate({
      userId: 'harn-leading-3',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2],
    });
    const trailing = makeCandidate({
      userId: 'harn-trailing-3',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [4, 5, 6],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [leading, trailing],
          gap,
          homogeneousHeadcount: 4,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(uncoveredBlockIds(gap, result)).toEqual([gap.blocks[3]!.blockId]);
  });
});

// ---------------------------------------------------------------------
// Scenario 10: No candidates at any source → entire gap to Allied.
// Tests the "no eligible workers anywhere" edge case (§5.5 ARCH).
// ---------------------------------------------------------------------

describe('Scenario 10 — no candidates anywhere; entire gap goes to Allied', () => {
  it('returns empty when both Quad and Harnwell have empty rosters', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 4);
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
    expect(uncoveredBlockIds(gap, result)).toEqual(gap.blocks.map((b) => b.blockId));
  });
});

// ---------------------------------------------------------------------
// Scenario 11: Combined — float exclusion at a DIFFERENT destination
// house does not interfere with selection for this destination.
// ---------------------------------------------------------------------

describe('Scenario 11 — exclusion at a different destination does not affect this gap', () => {
  it('admits a worker whose only exclusion is for a different destination house', () => {
    const gap = makeGap(HOUSE_05, ANCHOR_19_00_EDT, 4);
    const a = makeCandidate({
      userId: 'A-exclusion-elsewhere',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const exclusion = makeExclusion({
      userId: 'A-exclusion-elsewhere',
      destinationHouseId: HOUSE_07, // different house!
      windowStartAt: gap.blocks[0]!.blockStartAt,
      windowEndAt: plusBlocks(gap.blocks[3]!.blockStartAt, 1),
    });

    const result = runFloatLookup(
      makeInput(
        gap,
        [
          makeSourceRoster({
            sourceHouseId: QUAD,
            precedenceOrder: 1,
            candidates: [a],
            gap,
            homogeneousHeadcount: 3,
          }),
        ],
        [exclusion],
      ),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('A-exclusion-elsewhere');
  });
});

// ---------------------------------------------------------------------
// Scenario 12: Harnwell-as-destination short-circuit — even with a
// large eligible pool, the algorithm returns empty.
// ---------------------------------------------------------------------

describe('Scenario 12 — Harnwell as destination returns empty regardless of pool', () => {
  it('returns empty when destination = Harnwell, with Harnwell + Quad rosters supplied', () => {
    const gap = makeGap(HARNWELL, ANCHOR_19_00_EDT, 4);
    const quad = makeCandidate({
      userId: 'quad-cannot-cover-harn',
      homeHouseId: QUAD,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const harn = makeCandidate({
      userId: 'harn-not-considered-for-harn-dest',
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

    expect(result).toHaveLength(0);
  });
});
