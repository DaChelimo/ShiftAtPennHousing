// S6 — HMOD context (audit #8, #9-open-half, #18a): the pure core surface
// `fridayAnchor`, `summarizeAckReminders`, `canViewOtherHouses`,
// `resolveCalendarHouse`, `resolveCoverageScope` (web-remediation session S6).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md §2.5 (the HMOD rotor — weekly, one HMOD per week,
//     Friday-08:00 handoffs; App. A), §7.1 / §10 (on-duty HMOD campus-wide duty
//     power), §5.4 / §6.x (float ack-reminder cadence), brief §5/§6.3 (the
//     house-context switcher, "All houses" coverage, the floater "pending ack ·
//     2h reminder sent" indicator);
//   docs/web-remediation/sessions/S6/TEST_PLAN.md (§2 pinned shapes D1/D5/D6/D8,
//     §3 behavior contract groups A/D/E). This file pins §3 A1–A6, D2/D6/D7, E1–E8.
//
// THE MODEL (TEST_PLAN §1.8 / §6): `apps/web` has NO Vitest — only `packages/core`
// runs in `pnpm test`. All S6 PURE logic therefore lives in
// `packages/core/src/hmod-context/` (zero Supabase imports — the core invariant)
// and is exercised here; the I/O wrappers (`getOnDutyHmodId`, `getUnreadCount`,
// the coverage join) live in `apps/web` and are covered by review + the Playwright
// spec, not Vitest (D10).
//
//   fridayAnchor(dateKey)          — the most-recent Friday on or before a
//                                    YYYY-MM-DD key, UTC date-only (DST-immune by
//                                    construction; mirrors resolve_hmod_on_duty's
//                                    (isodow+2)%7 day-snap). D1.
//   canViewOtherHouses({isOnDutyHmod, isProjectAdmin})
//                                  — isOnDutyHmod || isProjectAdmin (D5: cross-house
//                                    authority = the on-duty HMOD's duty-week power
//                                    + the project administrator; an off-duty HM/BM
//                                    is house-scoped).
//   resolveCalendarHouse(opts)     — the (always single-house) calendar's house id,
//                                    gated on canViewOthers (D6).
//   resolveCoverageScope(opts)     — { mode:'all'|'single'; houseId } — HMOD default
//                                    aggregates all houses; a valid ?house= narrows;
//                                    an unauthorized user is silently pinned to home
//                                    (D6).
//   summarizeAckReminders({reminders, now})
//                                  — { stage; firedCount } — bucket the deepest fired
//                                    ack-reminder by its lead before the deadline
//                                    (≥180m → 6h, [90,180) → 2h, <90 → final). D8.
//
// TDD-RED: `../../src/hmod-context/index.js` does not exist yet (the module + its
// `export * from './hmod-context/index.js';` barrel line are the implementer's
// deliverable). This import is the intended failure; the file turns GREEN once the
// implementer lands the module + barrel — the same red-first discipline the S2
// force-trigger + S3 inbox specs establish.

import { describe, expect, it } from 'vitest';

import {
  canViewOtherHouses,
  fridayAnchor,
  resolveCalendarHouse,
  resolveCoverageScope,
  summarizeAckReminders,
  type AckReminderRow,
} from '../../src/hmod-context/index.js';

// ---------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------

// The 13 houses (TEST_PLAN §1.6) — the `validHouseIds` passed to the resolvers.
const VALID_HOUSE_IDS = [
  'harnwell',
  'quad',
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

// isodow of a YYYY-MM-DD key, UTC date-only (Mon=1…Sun=7) — used to assert
// fridayAnchor outputs are always Fridays (isodow 5) WITHOUT re-deriving the
// production math (a Date readback, not the same arithmetic under test).
function isodow(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0…Sat=6
  return day === 0 ? 7 : day;
}

function reminder(scheduledForIso: string, ackDeadlineIso: string): AckReminderRow {
  return { scheduledForIso, ackDeadlineIso };
}

// =====================================================================
// A. Friday-anchor (#18a) — D1 pinned value table.
//
// The function snaps a YYYY-MM-DD key back to the most-recent Friday (on or
// before it). It must agree with the orchestrator's resolve_hmod_on_duty SQL
// day-snap and produce a key that satisfies the hmod_rotor isodow=5 CHECK.
// =====================================================================

describe('fridayAnchor (#18a) — D1 value table', () => {
  it('should return the most-recent Friday for a Monday input', () => {
    // A1: 2026-06-08 (Mon, today's duty week) → 2026-06-05 (the prior Friday).
    expect(fridayAnchor('2026-06-08')).toBe('2026-06-05');
  });

  it('should be idempotent when the input is already a Friday', () => {
    // A2: 2026-06-05 (Fri) → itself (delta 0).
    expect(fridayAnchor('2026-06-05')).toBe('2026-06-05');
  });

  it('should return a Friday (isodow 5) for every weekday of a sample week', () => {
    // A3: Mon 2026-06-08 … Sun 2026-06-14 — every output is isodow 5. (Mon–Thu of
    // this week snap back to 2026-06-05; Fri 06-12 is itself; Sat/Sun snap to 06-12.)
    const week = [
      '2026-06-08', // Mon
      '2026-06-09', // Tue
      '2026-06-10', // Wed
      '2026-06-11', // Thu
      '2026-06-12', // Fri
      '2026-06-13', // Sat
      '2026-06-14', // Sun
    ];
    for (const day of week) {
      expect(isodow(fridayAnchor(day))).toBe(5);
    }
  });

  it('should be DST-safe across US spring-forward', () => {
    // A4: 2026-03-08 is the US spring-forward Sunday — the UTC date-only technique
    // is immune to the missing wall-clock hour. → 2026-03-06 (Fri).
    expect(fridayAnchor('2026-03-08')).toBe('2026-03-06');
  });

  it('should be DST-safe across US fall-back', () => {
    // A5: 2026-11-01 is the US fall-back Sunday (ambiguous wall-clock hour). The
    // UTC date-only technique is immune. → 2026-10-30 (Fri).
    expect(fridayAnchor('2026-11-01')).toBe('2026-10-30');
  });

  it('should match the full D1 pinned value table (the orchestrator day-snap)', () => {
    // A6: every pinned input→output pair (incl. the two DST dates). These exact
    // pairs are the contract the rotor key + the resolver depend on.
    const table: Array<[string, string]> = [
      ['2026-06-08', '2026-06-05'], // Mon — today's duty week
      ['2026-06-05', '2026-06-05'], // Fri — idempotent
      ['2026-06-04', '2026-05-29'], // Thu — back to prior Friday
      ['2026-06-07', '2026-06-05'], // Sun
      ['2026-03-08', '2026-03-06'], // spring-forward Sunday
      ['2026-11-01', '2026-10-30'], // fall-back Sunday
    ];
    for (const [input, expected] of table) {
      expect(fridayAnchor(input)).toBe(expected);
    }
  });
});

// =====================================================================
// D. Cross-house authorization (pure) — the gating rule (D5).
// =====================================================================

describe('canViewOtherHouses — the cross-house gate (D5)', () => {
  it('should be true for the on-duty HMOD', () => {
    // D2a: the on-duty HMOD has campus-wide duty-week power.
    expect(canViewOtherHouses({ isOnDutyHmod: true, isProjectAdmin: false })).toBe(true);
  });

  it('should be true for a project administrator', () => {
    // D2b: the system-wide project administrator may always leave a home house.
    expect(canViewOtherHouses({ isOnDutyHmod: false, isProjectAdmin: true })).toBe(true);
  });

  it('should be false for an off-duty HM/BM and for a non-admin', () => {
    // D2c: a regular off-duty HM/BM (and any non-admin) is house-scoped — neither
    // flag set → false.
    expect(canViewOtherHouses({ isOnDutyHmod: false, isProjectAdmin: false })).toBe(false);
  });
});

// =====================================================================
// D. `?house=` resolution (pure) — calendar (always single-house), gated (D6).
// =====================================================================

describe('resolveCalendarHouse — gated ?house= for the (single-house) calendar (D6)', () => {
  it('should return the requested house when authorized and valid', () => {
    // D6a: authorized + a valid requested id → the requested house.
    expect(
      resolveCalendarHouse({
        requested: 'harnwell',
        homeHouse: 'quad',
        canViewOthers: true,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toBe('harnwell');
  });

  it('should fall back to the home house when not authorized (ignores ?house=)', () => {
    // D6b: an unauthorized user passing ?house=<other> is silently pinned to home.
    expect(
      resolveCalendarHouse({
        requested: 'harnwell',
        homeHouse: 'quad',
        canViewOthers: false,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toBe('quad');
  });

  it('should fall back to the home house for an unknown/invalid requested house', () => {
    // D6c: authorized but the requested id is not one of the 13 → home.
    expect(
      resolveCalendarHouse({
        requested: 'house-99',
        homeHouse: 'quad',
        canViewOthers: true,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toBe('quad');
  });

  it('should return the home house when no ?house= is given', () => {
    // D6d: requested null → home (regardless of authorization).
    expect(
      resolveCalendarHouse({
        requested: null,
        homeHouse: 'house-03',
        canViewOthers: true,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toBe('house-03');
  });
});

describe('resolveCoverageScope — gated ?house= for coverage (all | single) (D6)', () => {
  it('should be mode "all" for an authorized user with no ?house=', () => {
    // D7a: the HMOD default aggregates all houses (brief §6.3).
    expect(
      resolveCoverageScope({
        requested: null,
        homeHouse: 'quad',
        canViewOthers: true,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toEqual({ mode: 'all', houseId: null });
  });

  it('should be mode "all" for an authorized user passing ?house=all', () => {
    // D7b: the explicit 'all' sentinel also aggregates.
    expect(
      resolveCoverageScope({
        requested: 'all',
        homeHouse: 'quad',
        canViewOthers: true,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toEqual({ mode: 'all', houseId: null });
  });

  it('should be mode "single" + the requested house for authorized + a valid ?house=X', () => {
    // D7c: a valid (non-'all') id narrows the aggregate to one house.
    expect(
      resolveCoverageScope({
        requested: 'harnwell',
        homeHouse: 'quad',
        canViewOthers: true,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toEqual({ mode: 'single', houseId: 'harnwell' });
  });

  it('should be mode "single" + the home house for an unauthorized user passing ?house=X (gated)', () => {
    // D7d: an unauthorized user is silently pinned to home — never aggregate, never
    // the requested other house.
    expect(
      resolveCoverageScope({
        requested: 'harnwell',
        homeHouse: 'quad',
        canViewOthers: false,
        validHouseIds: VALID_HOUSE_IDS,
      }),
    ).toEqual({ mode: 'single', houseId: 'quad' });
  });
});

// =====================================================================
// E. Ack-reminder summary (#8) — D8. Construct reminders with explicit
// scheduledForIso/ackDeadlineIso and an injected `now`; bucket the DEEPEST fired
// reminder by its lead (ackDeadline − scheduledFor): ≥180m → 6h, [90,180) → 2h,
// <90 → final. "Fired" = scheduledForIso <= now (ISO instant compare).
//
// The exemplar deadline is 2026-06-07T12:00:00-04:00 (EDT). The default cadence
// instants relative to it:
//   6h reminder  → 06:00 (lead 360m)   2h reminder → 10:00 (lead 120m)
//   1h reminder  → 11:00 (lead 60m)    30m → 11:30 (lead 30m)   5m → 11:55 (lead 5m)
// =====================================================================

const DEADLINE = '2026-06-07T12:00:00-04:00';
const R_6H = reminder('2026-06-07T06:00:00-04:00', DEADLINE); // lead 360m → 6h bucket
const R_2H = reminder('2026-06-07T10:00:00-04:00', DEADLINE); // lead 120m → 2h bucket
const R_1H = reminder('2026-06-07T11:00:00-04:00', DEADLINE); // lead  60m → final bucket
const R_30M = reminder('2026-06-07T11:30:00-04:00', DEADLINE); // lead  30m → final bucket

describe('summarizeAckReminders (#8) — D8', () => {
  it('should be stage "awaiting" with firedCount 0 when there are no reminders', () => {
    // E1: an empty set → nothing has fired.
    expect(summarizeAckReminders({ reminders: [], now: new Date(DEADLINE) })).toEqual({
      stage: 'awaiting',
      firedCount: 0,
    });
  });

  it('should be stage "reminded_6h" with firedCount 1 when only the long (≈6h) reminder has fired', () => {
    // E2: now = 06:30 — only the 06:00 (lead 360m) reminder is at-or-before now.
    const now = new Date('2026-06-07T06:30:00-04:00');
    expect(summarizeAckReminders({ reminders: [R_6H, R_2H, R_1H], now })).toEqual({
      stage: 'reminded_6h',
      firedCount: 1,
    });
  });

  it('should be stage "reminded_2h" (deepest fired wins) with firedCount 2 when the 6h and 2h reminders have fired', () => {
    // E3: now = 10:30 — both 06:00 and 10:00 have fired; the DEEPEST (latest, the 2h
    // one with lead 120m) wins → reminded_2h, count 2.
    const now = new Date('2026-06-07T10:30:00-04:00');
    expect(summarizeAckReminders({ reminders: [R_6H, R_2H, R_1H], now })).toEqual({
      stage: 'reminded_2h',
      firedCount: 2,
    });
  });

  it('should be stage "reminded_final" when a mandatory (1h/30m/5m) reminder has fired', () => {
    // E4: now = 11:35 — 06:00, 10:00, 11:00, 11:30 have all fired; the deepest is the
    // 11:30 (lead 30m < 90m) mandatory nudge → reminded_final.
    const now = new Date('2026-06-07T11:35:00-04:00');
    const res = summarizeAckReminders({ reminders: [R_6H, R_2H, R_1H, R_30M], now });
    expect(res.stage).toBe('reminded_final');
    expect(res.firedCount).toBe(4);
  });

  it('should be stage "awaiting" when all reminders are still in the future (just assigned)', () => {
    // E5: now = 05:00, before the earliest (06:00) reminder → nothing fired.
    const now = new Date('2026-06-07T05:00:00-04:00');
    expect(summarizeAckReminders({ reminders: [R_6H, R_2H, R_1H], now })).toEqual({
      stage: 'awaiting',
      firedCount: 0,
    });
  });

  it('should count a reminder scheduled exactly at now as fired (<=)', () => {
    // E6: now === the 6h reminder's scheduled instant (expressed in UTC, the same
    // moment as 06:00-04:00) → fired (boundary inclusive).
    const now = new Date('2026-06-07T10:00:00Z'); // == 2026-06-07T06:00:00-04:00
    expect(summarizeAckReminders({ reminders: [R_6H], now })).toEqual({
      stage: 'reminded_6h',
      firedCount: 1,
    });
  });

  it('should compare instants correctly across a DST boundary', () => {
    // E7: reminders straddling the US fall-back day (2026-11-01), expressed in
    // DIFFERENT offsets so a naive string compare would mis-order them but a Date
    // compare is correct. now sits between the two.
    //   r1 = 2026-10-31T23:30:00-04:00 (EDT)  == 2026-11-01T03:30:00Z
    //   r2 = 2026-11-01T05:00:00-05:00 (EST)  == 2026-11-01T10:00:00Z (after now)
    const dstDeadline = '2026-11-01T06:00:00-05:00'; // == 11:00Z
    const r1 = reminder('2026-10-31T23:30:00-04:00', dstDeadline); // lead 450m → 6h bucket
    const r2 = reminder('2026-11-01T05:00:00-05:00', dstDeadline); // lead  60m → final, but FUTURE
    const now = new Date('2026-11-01T04:00:00Z'); // after r1, before r2
    expect(summarizeAckReminders({ reminders: [r1, r2], now })).toEqual({
      stage: 'reminded_6h',
      firedCount: 1,
    });
  });

  it('should set firedCount to the number of reminders at or before now', () => {
    // E8: now = 11:05 — 06:00, 10:00, 11:00 are at-or-before now; 11:30 is not.
    const now = new Date('2026-06-07T11:05:00-04:00');
    const res = summarizeAckReminders({ reminders: [R_6H, R_2H, R_1H, R_30M], now });
    expect(res.firedCount).toBe(3);
  });
});
