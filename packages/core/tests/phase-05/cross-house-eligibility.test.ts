// Phase 05 — Cross-house pickup eligibility matrix
//
// Spec sources: BEHAVIORAL_SPECIFICATION.md §1.1 (houses), §1.2 (float
//               direction rules — NOT this matrix, but referenced for
//               contrast), §5.3 (cross-house pickup matrix and table),
//               §5.6 (Tab 3 resolved sets);
//               ARCHITECTURE.md §1.5 (algorithmic invariants — Harnwell
//               training constraint), §2.4 (float_routing vs cross-house
//               pickup scope).
//
// The cross-house pickup matrix from BEH §5.3:
//
// | Worker's home house | Pick up at Harnwell? | Pick up at Quad? | Pick up at 11-single-staff? |
// | Harnwell SW         | YES (their home)     | YES              | YES                         |
// | Quad SW             | NO (no Harn training)| YES (their home) | YES                         |
// | 11-single-staff SW  | NO (no Harn training)| YES              | YES (own + other 10)        |
//
// The only structural rule enforced algorithmically is the Harnwell
// training constraint (ARCH §1.5): only Harnwell-trained workers may
// staff Harnwell. All other cross-house pickups are permitted.
//
// This matrix is intentionally more permissive than the float direction
// rules (§1.2): floating restricts 11-single-staff workers as sources
// because their departure leaves a single-staff desk unattended; pickup
// imposes no such restriction because the worker is acquiring an
// additional shift on top of their home schedule.
//
// Function contract (to be implemented in
// packages/core/src/scheduling/crossHousePickup.ts):
//
//   type HouseId = 'harnwell' | 'quad' | string;  // 11 single-staff use 'house-03'..'house-13'
//
//   function isEligibleForCrossHousePickup(
//     homeHouseId: HouseId,
//     destinationHouseId: HouseId,
//   ): { eligible: boolean; reason?: string };
//
//   function listEligibleCrossHouseDestinations(
//     homeHouseId: HouseId,
//     allHouseIds: HouseId[],
//   ): HouseId[];  // destinations excluding home; resolves Tab-3 set
//
// Eligibility semantics:
//   - In-house "pickup" (homeHouseId === destinationHouseId) is eligible
//     but is NOT a cross-house pickup. The function returns eligible=true
//     and reason='in_house' so callers can distinguish, but for matrix
//     correctness they're treated identically to "allowed."
//   - Harnwell as destination + non-Harnwell home → NOT eligible,
//     reason='harnwell_training_required'.
//   - Every other (home, destination) pair → eligible.
//
// `listEligibleCrossHouseDestinations` returns all destinations except
// the worker's home (Tab 3 only shows non-home houses), filtered by the
// matrix. For a Harnwell worker, this returns Quad + all 11 single-staff
// houses. For a Quad worker, this returns the 11 single-staff houses.
// For an 11-single-staff worker, this returns Quad + the other 10
// single-staff houses (Harnwell excluded).
//
// TDD-first: the implementation does not yet exist. The tests import
// from `../../src/scheduling/crossHousePickup.js`; that path will fail
// at compile time until the implementation lands.

import { describe, expect, it } from 'vitest';

import {
  isEligibleForCrossHousePickup,
  listEligibleCrossHouseDestinations,
} from '../../src/scheduling/crossHousePickup.js';

// ----- shared fixtures -----------------------------------------------

const HARNWELL = 'harnwell';
const QUAD = 'quad';
const SINGLE_STAFF_HOUSES = [
  'house-03',
  'house-04',
  'house-05',
  'house-06',
  'house-07',
  'house-08',
  'house-09',
  'house-10',
  'house-11',
  'house-12',
  'house-13',
];

const ALL_HOUSES = [HARNWELL, QUAD, ...SINGLE_STAFF_HOUSES];

// ----- isEligibleForCrossHousePickup ---------------------------------

describe('isEligibleForCrossHousePickup — Harnwell worker as source', () => {
  it('Harnwell worker → Harnwell is eligible (in-house, their home)', () => {
    const result = isEligibleForCrossHousePickup(HARNWELL, HARNWELL);
    expect(result.eligible).toBe(true);
  });

  it('Harnwell worker → Quad is eligible (cross-house)', () => {
    const result = isEligibleForCrossHousePickup(HARNWELL, QUAD);
    expect(result.eligible).toBe(true);
  });

  it('Harnwell worker → every 11 single-staff house is eligible', () => {
    for (const house of SINGLE_STAFF_HOUSES) {
      const result = isEligibleForCrossHousePickup(HARNWELL, house);
      expect(result.eligible).toBe(true);
    }
  });
});

describe('isEligibleForCrossHousePickup — Quad worker as source', () => {
  it('Quad worker → Harnwell is NOT eligible (Harnwell training required)', () => {
    const result = isEligibleForCrossHousePickup(QUAD, HARNWELL);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('harnwell_training_required');
  });

  it('Quad worker → Quad is eligible (in-house, their home)', () => {
    const result = isEligibleForCrossHousePickup(QUAD, QUAD);
    expect(result.eligible).toBe(true);
  });

  it('Quad worker → every 11 single-staff house is eligible', () => {
    for (const house of SINGLE_STAFF_HOUSES) {
      const result = isEligibleForCrossHousePickup(QUAD, house);
      expect(result.eligible).toBe(true);
    }
  });
});

describe('isEligibleForCrossHousePickup — 11-single-staff worker as source', () => {
  it('every 11-single-staff worker → Harnwell is NOT eligible', () => {
    for (const home of SINGLE_STAFF_HOUSES) {
      const result = isEligibleForCrossHousePickup(home, HARNWELL);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('harnwell_training_required');
    }
  });

  it('every 11-single-staff worker → Quad is eligible', () => {
    for (const home of SINGLE_STAFF_HOUSES) {
      const result = isEligibleForCrossHousePickup(home, QUAD);
      expect(result.eligible).toBe(true);
    }
  });

  it('every 11-single-staff worker → their own home is eligible (in-house)', () => {
    for (const home of SINGLE_STAFF_HOUSES) {
      const result = isEligibleForCrossHousePickup(home, home);
      expect(result.eligible).toBe(true);
    }
  });

  it('every 11-single-staff worker → every OTHER 11-single-staff house is eligible', () => {
    for (const home of SINGLE_STAFF_HOUSES) {
      for (const dest of SINGLE_STAFF_HOUSES) {
        if (home === dest) continue;
        const result = isEligibleForCrossHousePickup(home, dest);
        expect(result.eligible).toBe(true);
      }
    }
  });
});

describe('isEligibleForCrossHousePickup — Harnwell-destination rule is absolute', () => {
  // BEH §5.3 + ARCH §1.5: only Harnwell-trained workers may staff Harnwell.
  // The only way to be Harnwell-trained is to have homeHouseId='harnwell'.
  // Every non-Harnwell home → Harnwell destination MUST be rejected.

  it('Harnwell as destination accepts only Harnwell home (12 of 13 homes rejected)', () => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const home of ALL_HOUSES) {
      const result = isEligibleForCrossHousePickup(home, HARNWELL);
      (result.eligible ? accepted : rejected).push(home);
    }
    expect(accepted).toEqual([HARNWELL]);
    expect(rejected).toHaveLength(12);
    expect(rejected).not.toContain(HARNWELL);
  });
});

describe('isEligibleForCrossHousePickup — full 13×13 matrix coverage', () => {
  // Cartesian product: every (home, destination) pair across all 13 houses.
  // Total = 169 pairs. The matrix predicts:
  //   - 12 rejections (every non-Harnwell home × Harnwell destination)
  //   - 157 acceptances (everything else)

  it('exactly 157 of 169 pairs are eligible, 12 are rejected', () => {
    let accepts = 0;
    let rejects = 0;
    for (const home of ALL_HOUSES) {
      for (const dest of ALL_HOUSES) {
        const result = isEligibleForCrossHousePickup(home, dest);
        if (result.eligible) {
          accepts += 1;
        } else {
          rejects += 1;
        }
      }
    }
    expect(accepts).toBe(157);
    expect(rejects).toBe(12);
  });

  it('every rejection across the matrix is dest=Harnwell with non-Harnwell home', () => {
    for (const home of ALL_HOUSES) {
      for (const dest of ALL_HOUSES) {
        const result = isEligibleForCrossHousePickup(home, dest);
        if (!result.eligible) {
          expect(dest).toBe(HARNWELL);
          expect(home).not.toBe(HARNWELL);
        }
      }
    }
  });
});

// ----- listEligibleCrossHouseDestinations ----------------------------

describe('listEligibleCrossHouseDestinations — Tab 3 resolved sets (BEH §5.6)', () => {
  it('Harnwell SW: Tab 3 shows Quad + all 11 single-staff houses (12 destinations)', () => {
    const destinations = listEligibleCrossHouseDestinations(HARNWELL, ALL_HOUSES);
    expect(destinations).toHaveLength(12);
    expect(destinations).toContain(QUAD);
    for (const single of SINGLE_STAFF_HOUSES) {
      expect(destinations).toContain(single);
    }
    expect(destinations).not.toContain(HARNWELL); // home excluded from Tab 3
  });

  it('Quad SW: Tab 3 shows all 11 single-staff houses (11 destinations, Harnwell excluded)', () => {
    const destinations = listEligibleCrossHouseDestinations(QUAD, ALL_HOUSES);
    expect(destinations).toHaveLength(11);
    expect(destinations).not.toContain(QUAD); // home excluded
    expect(destinations).not.toContain(HARNWELL); // training-excluded
    for (const single of SINGLE_STAFF_HOUSES) {
      expect(destinations).toContain(single);
    }
  });

  it('11-single-staff SW: Tab 3 shows Quad + the OTHER 10 single-staff houses (11 destinations)', () => {
    // Pick house-07 as the home; check that Tab 3 = Quad + 10 other singles.
    const home = 'house-07';
    const destinations = listEligibleCrossHouseDestinations(home, ALL_HOUSES);
    expect(destinations).toHaveLength(11);
    expect(destinations).toContain(QUAD);
    expect(destinations).not.toContain(HARNWELL); // training-excluded
    expect(destinations).not.toContain(home); // home excluded
    for (const single of SINGLE_STAFF_HOUSES) {
      if (single === home) continue;
      expect(destinations).toContain(single);
    }
  });

  it('every 11-single-staff home produces a Tab-3 set of length 11', () => {
    for (const home of SINGLE_STAFF_HOUSES) {
      const destinations = listEligibleCrossHouseDestinations(home, ALL_HOUSES);
      expect(destinations).toHaveLength(11);
      expect(destinations).not.toContain(home);
      expect(destinations).not.toContain(HARNWELL);
    }
  });
});

describe('listEligibleCrossHouseDestinations — input subset semantics', () => {
  // BEH §3 / §5.6 — during winter break, only Harnwell is operational.
  // The Tab-3 resolver consumes the set of currently-operating houses,
  // NOT the full list of 13. Tab 3 for any non-Harnwell worker during
  // winter is empty because no other house operates.

  it('winter break (only Harnwell operates): Tab 3 is empty for Harnwell worker', () => {
    // Harnwell worker during winter: their home is Harnwell, no other
    // houses operate, so no cross-house destinations.
    const destinations = listEligibleCrossHouseDestinations(HARNWELL, [HARNWELL]);
    expect(destinations).toEqual([]);
  });

  it('Quad worker with only Harnwell+Quad operating: Tab 3 is empty (Harnwell training-excluded)', () => {
    const destinations = listEligibleCrossHouseDestinations(QUAD, [HARNWELL, QUAD]);
    expect(destinations).toEqual([]);
  });

  it('single-staff worker with home + 3 others operating: Tab 3 has the 3 others', () => {
    const home = 'house-05';
    const operating = [home, 'house-06', 'house-07', 'house-08'];
    const destinations = listEligibleCrossHouseDestinations(home, operating);
    expect(destinations).toHaveLength(3);
    expect(destinations).toEqual(expect.arrayContaining(['house-06', 'house-07', 'house-08']));
    expect(destinations).not.toContain(home);
  });
});
