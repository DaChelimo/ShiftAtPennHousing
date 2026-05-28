// Phase 06 — Float Lookup Algorithm: eligibility checks (§6.1).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §1.2 (absolute float direction rules),
//                                §6.1 (eligibility bullets — every check
//                                in this file maps to one bullet),
//                                §3.5 (source-desk floor accounting);
//   ARCHITECTURE.md §1.5 (algorithmic invariants — enforce independent
//                          of config tables to defend against data-entry
//                          errors),
//                   §3.8 (float_exclusions overlap-based exclusion),
//                   §5.2 step 3a (eligibility filter in the algorithm);
//   AGENTS.md hard invariants 1 (Harnwell training), 2 (float direction),
//                              4 (NO hours cap on float).
//
// Every test in this file isolates a single eligibility check. The
// chunking + tiebreaker tests live in their own files; here we set up
// trivially-coverable scenarios so the only thing under test is whether
// runFloatLookup admits or excludes a candidate.

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  ANCHOR_19_00_EDT,
  HARNWELL,
  HOUSE_05,
  HOUSE_07,
  QUAD,
  SINGLE_STAFF_HOUSES,
  makeCandidate,
  makeExclusion,
  makeGap,
  makeInput,
  makeSourceRoster,
  plusBlocks,
  plusMinutes,
} from './fixtures.js';

// ---------------------------------------------------------------------
// Convention used throughout this file:
//   gap = 4-block (2-hour) gap at HOUSE_05, 19:00 – 21:00.
//   A single Quad candidate with full coverage who is ELIGIBLE unless
//   the test specifically violates one §6.1 bullet.
// ---------------------------------------------------------------------

const GAP_HOUSE = HOUSE_05;
const GAP_4_BLOCKS = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 4);
const GAP_BLOCK_IDS = GAP_4_BLOCKS.blocks.map((b) => b.blockId);

// Quad rosters all assume 3 workers on shift unless the test overrides —
// matches Quad's required headcount in the seed staffing patterns.
function quadRosterWith(candidates: ReturnType<typeof makeCandidate>[]) {
  return makeSourceRoster({
    sourceHouseId: QUAD,
    precedenceOrder: 1,
    candidates,
    gap: GAP_4_BLOCKS,
    homogeneousHeadcount: 3,
  });
}

function harnwellRosterWith(candidates: ReturnType<typeof makeCandidate>[]) {
  return makeSourceRoster({
    sourceHouseId: HARNWELL,
    precedenceOrder: 2,
    candidates,
    gap: GAP_4_BLOCKS,
    homogeneousHeadcount: 2,
  });
}

// ---------------------------------------------------------------------
// 1. Source-house direction rules (BSpec §1.2 — ABSOLUTE; enforced
//    algorithmically per ARCH §1.5, never trusted from float_routing
//    alone, per AGENTS hard invariant #2).
// ---------------------------------------------------------------------

describe('source-house direction rules (§1.2 absolute)', () => {
  it('a Quad worker is an eligible source for a non-Harnwell destination', () => {
    const candidate = makeCandidate({
      userId: 'quad-worker-1',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-worker-1');
  });

  it('a Harnwell worker is an eligible source for any non-Harnwell destination', () => {
    const candidate = makeCandidate({
      userId: 'harn-worker-1',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [harnwellRosterWith([candidate])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-worker-1');
  });

  it('a Harnwell worker is an eligible source for Quad as destination', () => {
    const gap = makeGap(QUAD, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'harn-worker-quad-dest',
      homeHouseId: HARNWELL,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-worker-quad-dest');
  });

  it.each(SINGLE_STAFF_HOUSES.map((h) => [h]))(
    'a worker from %s (single-staff) is NEVER eligible as a float source',
    (singleStaffHouseId) => {
      const candidate = makeCandidate({
        userId: `single-staff-${singleStaffHouseId}`,
        homeHouseId: singleStaffHouseId,
        gap: GAP_4_BLOCKS,
        coversBlockIndices: [0, 1, 2, 3],
      });

      // Even if the caller mis-built a roster naming a single-staff
      // house as a source, the algorithm MUST reject it (ARCH §1.5).
      const erroneousRoster = makeSourceRoster({
        sourceHouseId: singleStaffHouseId,
        precedenceOrder: 1,
        candidates: [candidate],
        gap: GAP_4_BLOCKS,
        homogeneousHeadcount: 1,
      });

      const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [erroneousRoster]));

      expect(result).toHaveLength(0);
    },
  );

  it('Quad workers MAY NOT float to Harnwell (destination invariant)', () => {
    const harnGap = makeGap(HARNWELL, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'quad-blocked-from-harn',
      homeHouseId: QUAD,
      gap: harnGap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(harnGap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap: harnGap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    // Quad-to-Harnwell is forbidden by §1.2; the algorithm rejects
    // even when float_routing erroneously named it as a route.
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// 2. Harnwell-as-destination short-circuit (§6.1, §6.2; ARCH §5.2 step 1).
//    The algorithm returns empty IMMEDIATELY — no candidates evaluated.
// ---------------------------------------------------------------------

describe('Harnwell as destination — short-circuit to empty', () => {
  it('returns empty even when a Harnwell candidate could cover the gap (no candidates are EVER returned for Harnwell)', () => {
    // Per BSpec §6.1: "the float lookup for a Harnwell vacancy returns
    // no candidates. Harnwell coverage gaps therefore bypass the float
    // lookup result and proceed directly to HMOD-for-Allied at T-2h."
    // An off-duty Harnwell worker would claim via the weekly feed,
    // not via the float pipeline.
    const harnGap = makeGap(HARNWELL, ANCHOR_19_00_EDT, 4);
    const harnCandidate = makeCandidate({
      userId: 'harn-could-cover-but-irrelevant',
      homeHouseId: HARNWELL,
      gap: harnGap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(harnGap, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [harnCandidate],
          gap: harnGap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });

  it('returns empty for Harnwell destination even with Quad + Harnwell rosters supplied', () => {
    const harnGap = makeGap(HARNWELL, ANCHOR_19_00_EDT, 4);
    const quadCandidate = makeCandidate({
      userId: 'quad-blocked-by-destination',
      homeHouseId: QUAD,
      gap: harnGap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const harnCandidate = makeCandidate({
      userId: 'harn-blocked-by-destination',
      homeHouseId: HARNWELL,
      gap: harnGap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(harnGap, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [quadCandidate],
          gap: harnGap,
          homogeneousHeadcount: 3,
        }),
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 2,
          candidates: [harnCandidate],
          gap: harnGap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// 3. Source-desk floor (§6.1, §3.5; ARCH §5.2 step 3a/3d).
//    Floor = 1 worker remaining after the float. NOT the staffing
//    pattern's required headcount (the absolute floor is 1).
// ---------------------------------------------------------------------

describe('source-desk floor — at least 1 worker MUST remain after the float', () => {
  it('rejects the sole eligible candidate when the source has only 1 worker on shift (would leave 0)', () => {
    const candidate = makeCandidate({
      userId: 'sole-quad-worker',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [candidate],
          gap: GAP_4_BLOCKS,
          homogeneousHeadcount: 1,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });

  it('admits the candidate when the source has 2 workers on shift (would leave 1, which equals the floor)', () => {
    const a = makeCandidate({
      userId: 'harn-a',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a],
          gap: GAP_4_BLOCKS,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-a');
  });

  it('Harnwell with 2 workers on shift admits exactly 1 floater (the second worker is ineligible because floor would drop to 0)', () => {
    const a = makeCandidate({
      userId: 'harn-a',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const b = makeCandidate({
      userId: 'harn-b',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 1,
          candidates: [a, b],
          gap: GAP_4_BLOCKS,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1);
  });

  it('Quad with 3 workers, gap requires 3 disjoint floaters → only 2 selected; the 3rd is rejected by the source-wide tentative counter', () => {
    // PINNED DECISION (see TEST_PLAN §pinned-decisions / decision #1):
    // the tentative counter is GLOBAL per source, NOT per-block. The
    // architecture text uses "per-block" language but the spec's
    // worked example (BSpec §6.2 referenced; ARCH §5.2 step 3d
    // worked example) describes a single counter that increments
    // once per selection regardless of which blocks the floater
    // covers. Under GLOBAL accounting, Quad (headcount 3) can spare
    // at most 2 workers per lookup invocation; the 3rd candidate is
    // rejected even when their span shares no blocks with the prior
    // selections.
    //
    // Trace:
    //   start: globalCount = 0, floor = 3 − 0 = 3 ≥ 2 → admit floater 1
    //   after 1: globalCount = 1, floor = 3 − 1 = 2 ≥ 2 → admit floater 2
    //   after 2: globalCount = 2, floor = 3 − 2 = 1 < 2 → REJECT floater 3
    const gap6 = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);
    const a = makeCandidate({
      userId: 'quad-3-a',
      homeHouseId: QUAD,
      gap: gap6,
      coversBlockIndices: [0, 1],
    });
    const b = makeCandidate({
      userId: 'quad-3-b',
      homeHouseId: QUAD,
      gap: gap6,
      coversBlockIndices: [2, 3],
    });
    const c = makeCandidate({
      userId: 'quad-3-c',
      homeHouseId: QUAD,
      gap: gap6,
      coversBlockIndices: [4, 5],
    });

    const result = runFloatLookup(
      makeInput(gap6, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [a, b, c],
          gap: gap6,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    const assignedIds = result.map((r) => r.workerId).sort();
    // Any two of the three may be selected, depending on iteration
    // order. The contract is "exactly two," not "specifically A and B."
    expect(assignedIds).toHaveLength(2);
    expect(new Set(assignedIds).size).toBe(2);
    for (const id of assignedIds) {
      expect(['quad-3-a', 'quad-3-b', 'quad-3-c']).toContain(id);
    }
  });

  it('Harnwell with 2 workers and a 4-block gap covered by disjoint pairs → only 1 floater selected (global counter binds at headcount−1)', () => {
    // Same pinned-decision logic at Harnwell's 2-worker pool.
    //   start: globalCount = 0, floor = 2 − 0 = 2 ≥ 2 → admit floater 1
    //   after 1: globalCount = 1, floor = 2 − 1 = 1 < 2 → REJECT floater 2
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
  });
});

// ---------------------------------------------------------------------
// 4. Worker already in pending/acknowledged float overlapping the gap
//    window (§6.1; ARCH §5.2 step 3a).
// ---------------------------------------------------------------------

describe('conflicting float assignment', () => {
  it('excludes a candidate already in a pending or acknowledged float overlapping the gap', () => {
    const blocked = makeCandidate({
      userId: 'quad-already-floating',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      hasConflictingFloat: true,
    });
    const open = makeCandidate({
      userId: 'quad-open',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([blocked, open])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-open');
  });

  it('returns empty when ALL otherwise-eligible candidates have a conflicting float', () => {
    const a = makeCandidate({
      userId: 'quad-a',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      hasConflictingFloat: true,
    });
    const b = makeCandidate({
      userId: 'quad-b',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      hasConflictingFloat: true,
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([a, b])]));

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// 5. Worker in a cross-house pickup overlapping the gap window (§6.1).
//    "A worker on a cross-house pickup at house X is treated as a
//    worker at house X for headcount purposes but is NOT floatable
//    from there." — §6.1.
// ---------------------------------------------------------------------

describe('conflicting cross-house pickup', () => {
  it('excludes a candidate with an overlapping cross-house pickup', () => {
    const blocked = makeCandidate({
      userId: 'harn-on-pickup',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      hasConflictingCrossHousePickup: true,
    });
    const open = makeCandidate({
      userId: 'harn-open',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [harnwellRosterWith([blocked, open])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('harn-open');
  });
});

// ---------------------------------------------------------------------
// 6. is_active = true (§6.1; AGENTS hard invariant: every pipeline
//    that selects users MUST filter on is_active).
// ---------------------------------------------------------------------

describe('is_active = false', () => {
  it('excludes an inactive (deactivated/fired) candidate', () => {
    const fired = makeCandidate({
      userId: 'quad-fired',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      isActive: false,
    });
    const open = makeCandidate({
      userId: 'quad-open',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([fired, open])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-open');
  });
});

// ---------------------------------------------------------------------
// 7. HM and BM role exclusion (§6.1; ARCH §3.1 / §5.2 step 1).
//    "HMs may work scheduled shifts but are never selected as floaters;
//     BMs hold no shift assignments at all." — ARCH §5.2 step 1.
// ---------------------------------------------------------------------

describe('HM/BM role exclusion', () => {
  it('excludes a candidate who holds the hm role (even if otherwise SW-eligible)', () => {
    const hm = makeCandidate({
      userId: 'quad-hm',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['sw', 'hm'],
    });
    const sw = makeCandidate({
      userId: 'quad-sw',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['sw'],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([hm, sw])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-sw');
  });

  it('excludes a candidate who holds the bm role', () => {
    const bm = makeCandidate({
      userId: 'quad-bm',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['bm'],
    });
    const sw = makeCandidate({
      userId: 'quad-sw',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['sw'],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([bm, sw])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-sw');
  });

  it('an SM (not HM/BM) is eligible — SMs are workers and may be floated', () => {
    const sm = makeCandidate({
      userId: 'quad-sm',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
      roles: ['sw', 'sm'],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([sm])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-sm');
  });
});

// ---------------------------------------------------------------------
// 8. Float exclusion overlap semantics (§6.1, ARCH §3.8).
//    Exclusion = (user_id, destination_house_id, window_start, window_end).
//    A candidate is excluded if EITHER window overlaps the gap window
//    at the SAME destination — "any block-level intersection, however
//    small; full overlap is not required."
// ---------------------------------------------------------------------

describe('float_exclusions — overlap semantics (§3.8)', () => {
  // GAP_4_BLOCKS = 19:00 → 21:00 at HOUSE_05.
  const GAP_START = GAP_4_BLOCKS.blocks[0]!.blockStartAt;
  const GAP_END = plusBlocks(GAP_4_BLOCKS.blocks[3]!.blockStartAt, 1);

  it('an excluded worker with a window that contains the gap entirely is excluded', () => {
    const candidate = makeCandidate({
      userId: 'quad-fully-excluded',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const exclusion = makeExclusion({
      userId: 'quad-fully-excluded',
      destinationHouseId: GAP_HOUSE,
      windowStartAt: plusMinutes(GAP_START, -120),
      windowEndAt: plusMinutes(GAP_END, 120),
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(0);
  });

  it('an excluded worker with a 30-min partial overlap at the gap start IS excluded (one block intersection is enough)', () => {
    const candidate = makeCandidate({
      userId: 'quad-partial-overlap',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // Exclusion window: 17:30 – 19:30. Gap: 19:00 – 21:00.
    // Block-level intersection: the 19:00-block.
    const exclusion = makeExclusion({
      userId: 'quad-partial-overlap',
      destinationHouseId: GAP_HOUSE,
      windowStartAt: plusMinutes(GAP_START, -90),
      windowEndAt: plusMinutes(GAP_START, 30),
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(0);
  });

  it('an excluded worker with a 30-min partial overlap at the gap end IS excluded', () => {
    const candidate = makeCandidate({
      userId: 'quad-tail-overlap',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // Exclusion window: 20:30 – 22:30. Gap: 19:00 – 21:00.
    // Block-level intersection: the 20:30-block.
    const exclusion = makeExclusion({
      userId: 'quad-tail-overlap',
      destinationHouseId: GAP_HOUSE,
      windowStartAt: plusMinutes(GAP_END, -30),
      windowEndAt: plusMinutes(GAP_END, 90),
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(0);
  });

  it('a NON-OVERLAPPING exclusion window (entirely before the gap) does NOT exclude', () => {
    const candidate = makeCandidate({
      userId: 'quad-pre-gap-decline',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // Exclusion window: 14:00 – 17:00, well before the 19:00 – 21:00 gap.
    const exclusion = makeExclusion({
      userId: 'quad-pre-gap-decline',
      destinationHouseId: GAP_HOUSE,
      windowStartAt: plusMinutes(GAP_START, -300),
      windowEndAt: plusMinutes(GAP_START, -120),
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-pre-gap-decline');
  });

  it('an exclusion that ABUTS the gap end (windowEnd == gapStart) does NOT overlap', () => {
    // BSpec §6.1: "any block-level intersection." Abutting windows
    // share no block, so they do not intersect.
    const candidate = makeCandidate({
      userId: 'quad-abut-decline',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // Exclusion 17:00 – 19:00 (ends EXACTLY at gap start).
    const exclusion = makeExclusion({
      userId: 'quad-abut-decline',
      destinationHouseId: GAP_HOUSE,
      windowStartAt: plusMinutes(GAP_START, -120),
      windowEndAt: GAP_START,
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-abut-decline');
  });

  it('an exclusion at a DIFFERENT destination house does NOT exclude', () => {
    const candidate = makeCandidate({
      userId: 'quad-decline-elsewhere',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // Same time window, but the exclusion was created for a DIFFERENT
    // destination house — §6.1 explicit: "Exclusions for declines at
    // *different* destination houses or non-overlapping windows do not
    // apply."
    const exclusion = makeExclusion({
      userId: 'quad-decline-elsewhere',
      destinationHouseId: HOUSE_07,
      windowStartAt: GAP_START,
      windowEndAt: GAP_END,
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-decline-elsewhere');
  });

  it('an exclusion for a DIFFERENT user does NOT exclude this candidate', () => {
    const candidate = makeCandidate({
      userId: 'quad-not-decliner',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const exclusion = makeExclusion({
      userId: 'someone-else-entirely',
      destinationHouseId: GAP_HOUSE,
      windowStartAt: GAP_START,
      windowEndAt: GAP_END,
    });

    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])], [exclusion]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-not-decliner');
  });
});

// ---------------------------------------------------------------------
// 9. Hours cap is NOT checked (§6.1 explicit; AGENTS hard invariant #4).
//    A floater works the same total hours; the float relocates them.
// ---------------------------------------------------------------------

describe('hours cap is NOT checked at float assignment (§6.1, AGENTS #4)', () => {
  // The fixture does not even carry weekly-hours data — the function
  // signature has no field for it. These tests document the invariant
  // by demonstrating that a candidate near either cap is still
  // assigned. If a future implementer adds a cap parameter, these
  // tests should be re-pointed at the new field and continue to assert
  // that the algorithm IGNORES it.

  it('a candidate near the 40h hard cap (e.g., currently at 39h) IS still eligible to float', () => {
    // No cap field is part of the input contract. We assert via
    // behavior: the candidate is admitted, full stop.
    const candidate = makeCandidate({
      userId: 'quad-39h',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-39h');
  });

  it('a candidate near the 20h soft cap (e.g., currently at 19h) IS still eligible to float', () => {
    const candidate = makeCandidate({
      userId: 'quad-19h',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-19h');
  });
});

// ---------------------------------------------------------------------
// 10. Source priority — Quad before Harnwell (§6.2 point 1; ARCH §5.2
//     step 2). Quad must be FULLY EXHAUSTED before Harnwell is
//     considered.
// ---------------------------------------------------------------------

describe('source priority — Quad before Harnwell', () => {
  it('Quad is exhausted FIRST: a Quad candidate is preferred over an equally-eligible Harnwell candidate', () => {
    const quad = makeCandidate({
      userId: 'quad-pref',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const harn = makeCandidate({
      userId: 'harn-also-could',
      homeHouseId: HARNWELL,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    // Even when the caller passes Harnwell first in the array, the
    // algorithm sorts by precedenceOrder ASC.
    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [harnwellRosterWith([harn]), quadRosterWith([quad])]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('quad-pref');
  });

  it('Harnwell is consulted only AFTER Quad cannot cover the remaining uncovered blocks', () => {
    const gap6 = makeGap(GAP_HOUSE, ANCHOR_19_00_EDT, 6);

    // Quad worker covers only blocks [0,1,2,3] (4-block leading run).
    // Harnwell worker covers the remaining tail [4,5].
    const quad = makeCandidate({
      userId: 'quad-partial',
      homeHouseId: QUAD,
      gap: gap6,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const harn = makeCandidate({
      userId: 'harn-tail',
      homeHouseId: HARNWELL,
      gap: gap6,
      coversBlockIndices: [4, 5],
    });

    const result = runFloatLookup(
      makeInput(gap6, [
        makeSourceRoster({
          sourceHouseId: QUAD,
          precedenceOrder: 1,
          candidates: [quad],
          gap: gap6,
          homogeneousHeadcount: 3,
        }),
        makeSourceRoster({
          sourceHouseId: HARNWELL,
          precedenceOrder: 2,
          candidates: [harn],
          gap: gap6,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.workerId).sort()).toEqual(['harn-tail', 'quad-partial']);
  });

  it('returns empty when neither source has an eligible candidate', () => {
    const result = runFloatLookup(
      makeInput(GAP_4_BLOCKS, [quadRosterWith([]), harnwellRosterWith([])]),
    );

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// 11. The gap-block-id list returned must be a contiguous, in-order
//     subset of gap.blocks (the chunking algorithm assigns runs, not
//     scattered single blocks).
// ---------------------------------------------------------------------

describe('output shape — assigned blocks are a contiguous run', () => {
  it('the assigned blocks for a single floater are returned in chronological order, matching the gap order', () => {
    const candidate = makeCandidate({
      userId: 'quad-order-check',
      homeHouseId: QUAD,
      gap: GAP_4_BLOCKS,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(makeInput(GAP_4_BLOCKS, [quadRosterWith([candidate])]));

    expect(result).toHaveLength(1);
    expect(result[0]!.blocks).toEqual(GAP_BLOCK_IDS);
  });
});
