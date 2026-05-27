// Phase 05 — Weekly hours calculation and cap enforcement
//
// Spec sources: BEHAVIORAL_SPECIFICATION.md §1.5 (block atomicity —
//               1 block = 30 min, 1 hour = 2 blocks), §5.3 (claim
//               eligibility — hard cap blocks, soft cap warns), §9.1
//               (hours attribution — hours count at home house regardless
//               of where worked), §9.2 (Monday 00:00 – Sunday 23:59
//               weekly window, strict calendar week), §9.3 (cap defaults
//               + soft/hard semantics);
//               ARCHITECTURE.md §1.6 (America/New_York time zone),
//                                §1.7 (block-based shift model).
//
// Function contract (to be implemented in
// packages/core/src/scheduling/hours.ts):
//
//   type WeekRef = { weekStartAt: Date };   // Monday 00:00 NY; from
//                                             core/time.weekStart
//
//   type HoursDecomposition = {
//     totalHours: number;       // count of assignments × 0.5
//     atHomeHours: number;      // is_float=false AND is_cross_house_pickup=false
//     floatOutHours: number;    // is_float=true (worker is the floater)
//     crossHousePickupHours: number;  // is_cross_house_pickup=true
//   };
//
//   type AssignmentForHours = {
//     blockStartAt: Date;       // timezone-aware
//     isFloat: boolean;         // floated-out from home
//     isCrossHousePickup: boolean;
//   };
//
//   function computeWeeklyHours(
//     assignments: AssignmentForHours[],
//     week: WeekRef,
//   ): HoursDecomposition;
//
//   type CapCheckInput = {
//     currentWeeklyHours: number;  // pre-claim total
//     proposedClaimBlocks: number; // count of blocks being claimed
//     hoursCap: number;            // 20 or 40
//     capEnforcement: 'soft' | 'hard';
//   };
//
//   type CapCheckResult =
//     | { ok: true }
//     | { ok: true; warning: 'soft_cap_exceeded' }
//     | { ok: false; reason: 'hard_cap_exceeded' };
//
//   function checkClaimAgainstCap(input: CapCheckInput): CapCheckResult;
//
// Hours-attribution semantics (BEH §9.1):
//   - Every assignment counts 0.5h toward the worker's weekly total.
//   - `isFloat=true` rows count as "floated out" hours — still count
//     toward weekly total at home house (BEH §9.1: "those 2 hours are
//     counted at Quad, with a category indicator showing they were
//     worked while floated").
//   - `isCrossHousePickup=true` rows count as "cross-house pickup" hours
//     — also count toward weekly total at home house (BEH §9.1:
//     "treated identically for attribution purposes").
//   - `isFloat=false AND isCrossHousePickup=false` rows count as
//     "at home" hours.
//
// Window semantics (BEH §9.2):
//   - Weekly window is strict calendar week Monday 00:00 NY through
//     Sunday 23:59 NY. A block whose blockStartAt is Monday 00:00
//     belongs to the new week (BEH §1.4 date attribution).
//   - Assignments outside the requested week are filtered out.
//
// Cap semantics (BEH §9.3, §5.3):
//   - Soft cap: `currentWeeklyHours + proposedClaimHours > cap` returns
//     `{ok: true, warning: 'soft_cap_exceeded'}`. The claim proceeds.
//   - Hard cap: same overflow → `{ok: false, reason: 'hard_cap_exceeded'}`.
//   - Exactly at cap (`current + proposed === cap`) is fine — no warning,
//     no rejection. The cap is "no more than 20/40", not "less than."
//
// TDD-first: the implementation does not yet exist. The tests import
// from `../../src/scheduling/hours.js`.

import { describe, expect, it } from 'vitest';

import {
  checkClaimAgainstCap,
  computeWeeklyHours,
  type AssignmentForHours,
} from '../../src/scheduling/hours.js';
import { weekStart } from '../../src/time/index.js';

// ----- helpers -------------------------------------------------------

// Week starting Monday 2026-02-02 00:00 NY. All test dates use NY-anchored ISO strings.
const MONDAY_NY = new Date('2026-02-02T00:00:00-05:00');
const TUESDAY_NY = new Date('2026-02-03T10:00:00-05:00');
const SUNDAY_LATE_NY = new Date('2026-02-08T23:30:00-05:00');
const PRIOR_SUNDAY_NY = new Date('2026-02-01T23:30:00-05:00');
const NEXT_MONDAY_NY = new Date('2026-02-09T00:00:00-05:00');

const at = (iso: string): AssignmentForHours => ({
  blockStartAt: new Date(iso),
  isFloat: false,
  isCrossHousePickup: false,
});

const floatedOut = (iso: string): AssignmentForHours => ({
  blockStartAt: new Date(iso),
  isFloat: true,
  isCrossHousePickup: false,
});

const crossHouse = (iso: string): AssignmentForHours => ({
  blockStartAt: new Date(iso),
  isFloat: false,
  isCrossHousePickup: true,
});

// ----- computeWeeklyHours --------------------------------------------

describe('computeWeeklyHours — basic counting (BEH §1.5, §9.1)', () => {
  it('zero assignments → 0 hours', () => {
    const result = computeWeeklyHours([], { weekStartAt: MONDAY_NY });
    expect(result.totalHours).toBe(0);
    expect(result.atHomeHours).toBe(0);
    expect(result.floatOutHours).toBe(0);
    expect(result.crossHousePickupHours).toBe(0);
  });

  it('1 block = 0.5h', () => {
    const result = computeWeeklyHours([at('2026-02-03T10:00:00-05:00')], {
      weekStartAt: MONDAY_NY,
    });
    expect(result.totalHours).toBe(0.5);
    expect(result.atHomeHours).toBe(0.5);
  });

  it('2 blocks = 1h', () => {
    const result = computeWeeklyHours(
      [at('2026-02-03T10:00:00-05:00'), at('2026-02-03T10:30:00-05:00')],
      { weekStartAt: MONDAY_NY },
    );
    expect(result.totalHours).toBe(1.0);
    expect(result.atHomeHours).toBe(1.0);
  });

  it('40 blocks = 20.0 hours (the soft cap exact threshold)', () => {
    const assignments: AssignmentForHours[] = [];
    for (let i = 0; i < 40; i += 1) {
      const minutes = i * 30;
      const hh = String(Math.floor(minutes / 60) + 10).padStart(2, '0');
      const mm = String(minutes % 60).padStart(2, '0');
      const day = String(3 + Math.floor(i / 28)).padStart(2, '0'); // spread across days
      assignments.push(at(`2026-02-${day}T${hh}:${mm}:00-05:00`));
    }
    // Use unique blocks to avoid duplicates — actually rebuild with stable scheme.
    const flat: AssignmentForHours[] = Array.from({ length: 40 }, (_, i) => {
      const minutesFromMonday = i * 30 + 10 * 60; // start each "day" at 10:00, distinct minute offsets
      return at(new Date(MONDAY_NY.getTime() + minutesFromMonday * 60_000).toISOString());
    });
    const r2 = computeWeeklyHours(flat, { weekStartAt: MONDAY_NY });
    expect(r2.totalHours).toBe(20.0);

    // Drop the manually-built `assignments` array — kept the construction
    // path for code review but use the timestamp-stepped version.
    expect(assignments).toHaveLength(40);
  });
});

describe('computeWeeklyHours — decomposition by category (BEH §9.1)', () => {
  it('mixed at-home + float-out + cross-house pickup decomposes correctly', () => {
    const assignments: AssignmentForHours[] = [
      at('2026-02-03T10:00:00-05:00'),
      at('2026-02-03T10:30:00-05:00'),
      floatedOut('2026-02-04T15:00:00-05:00'),
      floatedOut('2026-02-04T15:30:00-05:00'),
      crossHouse('2026-02-05T18:00:00-05:00'),
    ];
    const result = computeWeeklyHours(assignments, { weekStartAt: MONDAY_NY });
    expect(result.totalHours).toBe(2.5);
    expect(result.atHomeHours).toBe(1.0);
    expect(result.floatOutHours).toBe(1.0);
    expect(result.crossHousePickupHours).toBe(0.5);
  });

  it('float-out hours count toward total (BEH §9.1)', () => {
    const result = computeWeeklyHours(
      [floatedOut('2026-02-03T10:00:00-05:00'), floatedOut('2026-02-03T10:30:00-05:00')],
      { weekStartAt: MONDAY_NY },
    );
    expect(result.totalHours).toBe(1.0);
    expect(result.atHomeHours).toBe(0.0);
    expect(result.floatOutHours).toBe(1.0);
  });

  it('cross-house pickup hours count toward total at home house (BEH §9.1)', () => {
    const result = computeWeeklyHours(
      [crossHouse('2026-02-03T10:00:00-05:00'), crossHouse('2026-02-03T10:30:00-05:00')],
      { weekStartAt: MONDAY_NY },
    );
    expect(result.totalHours).toBe(1.0);
    expect(result.atHomeHours).toBe(0.0);
    expect(result.crossHousePickupHours).toBe(1.0);
  });
});

describe('computeWeeklyHours — weekly window boundaries (BEH §9.2, §1.4)', () => {
  it('block at Monday 00:00 belongs to the NEW week (BEH §1.4 date attribution)', () => {
    const result = computeWeeklyHours([at(MONDAY_NY.toISOString())], {
      weekStartAt: MONDAY_NY,
    });
    expect(result.totalHours).toBe(0.5);
  });

  it('block at Sunday 23:30 of the same week IS included (window is inclusive)', () => {
    const result = computeWeeklyHours([at(SUNDAY_LATE_NY.toISOString())], {
      weekStartAt: MONDAY_NY,
    });
    expect(result.totalHours).toBe(0.5);
  });

  it('block at prior Sunday 23:30 is EXCLUDED (belongs to previous week)', () => {
    const result = computeWeeklyHours([at(PRIOR_SUNDAY_NY.toISOString())], {
      weekStartAt: MONDAY_NY,
    });
    expect(result.totalHours).toBe(0);
  });

  it('block at next Monday 00:00 is EXCLUDED (belongs to next week)', () => {
    const result = computeWeeklyHours([at(NEXT_MONDAY_NY.toISOString())], {
      weekStartAt: MONDAY_NY,
    });
    expect(result.totalHours).toBe(0);
  });

  it('mixed in-window and out-of-window assignments: only in-window counted', () => {
    const result = computeWeeklyHours(
      [
        at(PRIOR_SUNDAY_NY.toISOString()), // out (prev week)
        at(TUESDAY_NY.toISOString()), // in
        at(SUNDAY_LATE_NY.toISOString()), // in
        at(NEXT_MONDAY_NY.toISOString()), // out (next week)
      ],
      { weekStartAt: MONDAY_NY },
    );
    expect(result.totalHours).toBe(1.0);
  });

  it('weekStart helper anchors to the Monday containing the input timestamp', () => {
    // Mid-week input → still resolves to Monday 00:00 NY of that week.
    const computed = weekStart(TUESDAY_NY);
    expect(computed.getTime()).toBe(MONDAY_NY.getTime());
  });
});

// ----- checkClaimAgainstCap ------------------------------------------

describe('checkClaimAgainstCap — soft cap (BEH §9.3, §5.3)', () => {
  it('current 0h + claim 2 blocks (1h) against soft 20 → ok, no warning', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 0,
      proposedClaimBlocks: 2,
      hoursCap: 20,
      capEnforcement: 'soft',
    });
    expect(result.ok).toBe(true);
    expect('warning' in result && result.warning).toBeFalsy();
  });

  it('current 19h + claim 1 block (0.5h) → 19.5h, ok, no warning (under cap)', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 19,
      proposedClaimBlocks: 1,
      hoursCap: 20,
      capEnforcement: 'soft',
    });
    expect(result.ok).toBe(true);
    expect('warning' in result && result.warning).toBeFalsy();
  });

  it('current 19.5h + claim 1 block → 20h EXACTLY, ok, no warning (cap is "no more than")', () => {
    // Edge case from prompt: soft cap at 19.5h + claim of 1 block (0.5h)
    // → 20h exactly (no warning — 20h is the cap, not over).
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 19.5,
      proposedClaimBlocks: 1,
      hoursCap: 20,
      capEnforcement: 'soft',
    });
    expect(result.ok).toBe(true);
    expect('warning' in result && result.warning).toBeFalsy();
  });

  it('current 20h + claim 1 block → 20.5h, ok with soft_cap_exceeded warning', () => {
    // Edge case from prompt: soft cap at 20h + claim of 1 block → 20.5h →
    // warning displayed, claim allowed.
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 20,
      proposedClaimBlocks: 1,
      hoursCap: 20,
      capEnforcement: 'soft',
    });
    expect(result.ok).toBe(true);
    expect('warning' in result && result.warning).toBe('soft_cap_exceeded');
  });

  it('current 25h + claim 4 blocks (2h) → 27h, ok with warning (soft cap allows arbitrary excess)', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 25,
      proposedClaimBlocks: 4,
      hoursCap: 20,
      capEnforcement: 'soft',
    });
    expect(result.ok).toBe(true);
    expect('warning' in result && result.warning).toBe('soft_cap_exceeded');
  });
});

describe('checkClaimAgainstCap — hard cap (BEH §9.3, §5.3)', () => {
  it('current 0h + claim 2 blocks against hard 40 → ok', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 0,
      proposedClaimBlocks: 2,
      hoursCap: 40,
      capEnforcement: 'hard',
    });
    expect(result.ok).toBe(true);
  });

  it('current 39.5h + claim 1 block → 40h EXACTLY, ok (cap is "no more than")', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 39.5,
      proposedClaimBlocks: 1,
      hoursCap: 40,
      capEnforcement: 'hard',
    });
    expect(result.ok).toBe(true);
  });

  it('current 40h + claim 1 block → 40.5h, REJECTED (hard cap exceeded)', () => {
    // Edge case from prompt: hard cap at 40h + any claim → rejected
    // regardless of SM/HM (HM/BM authority bypasses the soft cap warning,
    // not the hard cap).
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 40,
      proposedClaimBlocks: 1,
      hoursCap: 40,
      capEnforcement: 'hard',
    });
    expect(result.ok).toBe(false);
    expect('reason' in result && result.reason).toBe('hard_cap_exceeded');
  });

  it('current 39h + claim 4 blocks (2h) → 41h, REJECTED', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 39,
      proposedClaimBlocks: 4,
      hoursCap: 40,
      capEnforcement: 'hard',
    });
    expect(result.ok).toBe(false);
    expect('reason' in result && result.reason).toBe('hard_cap_exceeded');
  });

  it('current 39h + claim 2 blocks (1h) → 40h EXACTLY, ok (cap is the ceiling, not "strictly less")', () => {
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 39,
      proposedClaimBlocks: 2,
      hoursCap: 40,
      capEnforcement: 'hard',
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkClaimAgainstCap — zero-block claim is a no-op', () => {
  it('current 0h + claim 0 blocks → ok regardless of cap', () => {
    expect(
      checkClaimAgainstCap({
        currentWeeklyHours: 0,
        proposedClaimBlocks: 0,
        hoursCap: 20,
        capEnforcement: 'soft',
      }).ok,
    ).toBe(true);
    expect(
      checkClaimAgainstCap({
        currentWeeklyHours: 0,
        proposedClaimBlocks: 0,
        hoursCap: 40,
        capEnforcement: 'hard',
      }).ok,
    ).toBe(true);
  });

  it('current already over hard cap (data drift) + claim 0 blocks → still ok (no new commitment)', () => {
    // Defensive: if the existing assignments already exceed the cap
    // (e.g., the cap was lowered mid-week — BEH §9.3 "existing shifts
    // stand"), a zero-block check is a no-op.
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 42,
      proposedClaimBlocks: 0,
      hoursCap: 40,
      capEnforcement: 'hard',
    });
    expect(result.ok).toBe(true);
  });
});
