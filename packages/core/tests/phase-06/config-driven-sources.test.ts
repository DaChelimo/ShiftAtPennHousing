// Config-driven float sources (stakeholder decision 2026-07-02; amends the old
// class-based invariant #2). The pure algorithm no longer hardcodes "only Quad and
// Harnwell may source." Instead the orchestrator snapshots the admin-authored
// float_routing matrix into `sources`, and the algorithm applies TWO hard guards:
//   * a source must retain >= 1 worker after lending (headcount floor), and
//   * Harnwell can never be a destination (short-circuit to Allied).
// This file proves the NEW capability (a double-staffed non-Quad house can source)
// and that the guards still bind. School-year invariance is covered by the existing
// phase-06 suite, which still passes unchanged.

import { describe, expect, it } from 'vitest';

import { runFloatLookup } from '../../src/float-lookup/index.js';

import {
  HARNWELL,
  HOUSE_05,
  HOUSE_07,
  makeCandidate,
  makeGap,
  makeInput,
  makeSourceRoster,
  ANCHOR_19_00_EDT,
} from './fixtures.js';

describe('config-driven float sources', () => {
  it('a double-staffed non-Quad house CAN source a floater when routing permits it', () => {
    // Summer: house-05 is double-staffed and routed to cover house-07.
    const gap = makeGap(HOUSE_07, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'h05-floater',
      homeHouseId: HOUSE_05,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HOUSE_05,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 2, // double-staffed this phase
        }),
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.workerId).toBe('h05-floater');
    expect(result[0]!.blocks).toEqual(['b00', 'b01', 'b02', 'b03']);
  });

  it('the same house at headcount 1 CANNOT source (floor guard holds)', () => {
    // First half of summer: house-05 single-staffed. Even with a routing row, the
    // floor guard blocks it — the desk would be left empty.
    const gap = makeGap(HOUSE_07, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'h05-single',
      homeHouseId: HOUSE_05,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HOUSE_05,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 1,
        }),
      ]),
    );

    expect(result).toHaveLength(0);
  });

  it('a double-staffed source only lends down to one remaining worker', () => {
    // Two candidates at a headcount-2 house: exactly one may float; the other must
    // stay to keep the desk covered.
    const gap = makeGap(HOUSE_07, ANCHOR_19_00_EDT, 4);
    const c1 = makeCandidate({
      userId: 'h05-a',
      homeHouseId: HOUSE_05,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });
    const c2 = makeCandidate({
      userId: 'h05-b',
      homeHouseId: HOUSE_05,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HOUSE_05,
          precedenceOrder: 1,
          candidates: [c1, c2],
          gap,
          homogeneousHeadcount: 2,
        }),
      ]),
    );

    expect(result).toHaveLength(1); // only one of the two may leave
  });

  it('Harnwell as a destination still short-circuits to Allied even with a routed source', () => {
    const gap = makeGap(HARNWELL, ANCHOR_19_00_EDT, 4);
    const candidate = makeCandidate({
      userId: 'h05-to-harnwell',
      homeHouseId: HOUSE_05,
      gap,
      coversBlockIndices: [0, 1, 2, 3],
    });

    const result = runFloatLookup(
      makeInput(gap, [
        makeSourceRoster({
          sourceHouseId: HOUSE_05,
          precedenceOrder: 1,
          candidates: [candidate],
          gap,
          homogeneousHeadcount: 3,
        }),
      ]),
    );

    expect(result).toHaveLength(0); // no float ever targets Harnwell
  });
});
