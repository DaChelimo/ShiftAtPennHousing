// T2-7 — HMOD rotor academic-year truncation (parity matrix conflict C19, spec bug).
//
// Spec source: BEHAVIORAL_SPECIFICATION.md §2.5 ("Academic-year scope of the rotor")
// + §3.1 / §3.4 (summer is non-operating; the operating calendar is the source of
// truth for which dates carry coverage).
//
// THE RULE under test:
//   - The rotor exists ONLY for academic-year (operating) dates.
//   - The first rotor week begins on the Friday-08:00 opening the week that CONTAINS
//     the first operating date of the period (fridayAnchor of that date).
//   - The LAST rotor entry is the Friday-anchored week CONTAINING the last operating
//     day — truncated so no rotor interval extends into summer. Concretely: a week is
//     emitted iff its Friday anchor is on-or-before the last operating day. There is
//     NO rotor week whose anchor falls after the last operating day (no summer rotor).
//
// THE BUG it pins: rotor.ts iterated the scheduling_period's raw start→end with a
// Friday anchor (cap 60). A period whose end_date sits mid-summer, or that spans a
// break, over-generated weeks past the last operating day. The fix clamps the upper
// bound to the last OPERATING date (from operating_calendar), not period.end_date.
//
// `rotorWeeks` is a PURE helper (zero Supabase imports); rotor.ts feeds it the period
// bounds + the operating-calendar date list and renders the result.

import { describe, expect, it } from 'vitest';

import { rotorWeeks } from '../../src/hmod-context/index.js';

const labels = (weeks: { weekStartDate: string }[]) => weeks.map((w) => w.weekStartDate);

describe('rotorWeeks — §2.5 academic-year truncation', () => {
  it('emits a week per Friday from the first operating week through the week containing the last operating day', () => {
    // Spring-style period; operating Mon 2026-01-12 … Fri 2026-05-01 (last op day).
    const operatingDates: string[] = [];
    for (
      let d = new Date(Date.UTC(2026, 0, 12));
      d <= new Date(Date.UTC(2026, 4, 1));
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      operatingDates.push(d.toISOString().slice(0, 10));
    }
    const weeks = rotorWeeks({
      periodStart: '2026-01-12',
      periodEnd: '2026-05-01',
      operatingDates,
    });
    // First anchor: Friday on/before 2026-01-12 (Monday) → 2026-01-09.
    expect(labels(weeks)[0]).toBe('2026-01-09');
    // Last operating day 2026-05-01 is a Friday → its own anchor is the last week.
    expect(labels(weeks).at(-1)).toBe('2026-05-01');
    // Every anchor is a Friday and is <= the last operating day.
    for (const w of weeks) {
      const dow = new Date(`${w.weekStartDate}T00:00:00Z`).getUTCDay();
      expect(dow).toBe(5);
      expect(w.weekStartDate <= '2026-05-01').toBe(true);
    }
  });

  it('does NOT extend the rotor into summer when period.end_date sits mid-summer (THE BUG)', () => {
    // The scheduling_period's end_date runs deep into summer (2026-08-15), but the
    // operating calendar stops at the last spring operating day (Fri 2026-05-01).
    const operatingDates: string[] = [];
    for (
      let d = new Date(Date.UTC(2026, 0, 12));
      d <= new Date(Date.UTC(2026, 4, 1));
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      operatingDates.push(d.toISOString().slice(0, 10));
    }
    const weeks = rotorWeeks({
      periodStart: '2026-01-12',
      periodEnd: '2026-08-15', // mid-summer; MUST be ignored
      operatingDates,
    });
    // No week may begin after the last operating day (no summer HMOD).
    for (const w of weeks) {
      expect(w.weekStartDate <= '2026-05-01').toBe(true);
    }
    // Last week is the one containing the last operating day, NOT a July/August week.
    expect(labels(weeks).at(-1)).toBe('2026-05-01');
    // The buggy raw-end behavior would have produced ~13 extra summer weeks.
    expect(weeks.length).toBeLessThanOrEqual(17);
  });

  it('clamps the last week to the operating day when the period ends mid-week (Sunday last op day)', () => {
    // Last operating day is a Sunday (2026-05-03); its Friday anchor is 2026-05-01.
    // The interval is truncated to end at that Sunday — no jump to the next Friday.
    const operatingDates: string[] = [];
    for (
      let d = new Date(Date.UTC(2026, 0, 12));
      d <= new Date(Date.UTC(2026, 4, 3));
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      operatingDates.push(d.toISOString().slice(0, 10));
    }
    const weeks = rotorWeeks({
      periodStart: '2026-01-12',
      periodEnd: '2026-06-30',
      operatingDates,
    });
    // Anchor of the last operating day (Sun 2026-05-03) is Friday 2026-05-01.
    expect(labels(weeks).at(-1)).toBe('2026-05-01');
    // And no week after it.
    expect(labels(weeks).filter((l) => l > '2026-05-01')).toEqual([]);
  });

  it('returns no weeks when the period has no operating dates (fully summer/dormant)', () => {
    const weeks = rotorWeeks({
      periodStart: '2026-06-01',
      periodEnd: '2026-08-31',
      operatingDates: [],
    });
    expect(weeks).toEqual([]);
  });

  it('ignores operating dates outside the period bounds (a break-spanning period clamps to in-period op days)', () => {
    // Operating dates exist both inside and outside [periodStart, periodEnd]. Only the
    // in-period ones drive the first/last anchor.
    const operatingDates = ['2025-12-20', '2026-01-12', '2026-01-13', '2026-04-30', '2026-09-01'];
    const weeks = rotorWeeks({
      periodStart: '2026-01-12',
      periodEnd: '2026-05-01',
      operatingDates,
    });
    // First in-period op day 2026-01-12 (Mon) → anchor 2026-01-09; last in-period op
    // day 2026-04-30 (Thu) → anchor 2026-04-24.
    expect(labels(weeks)[0]).toBe('2026-01-09');
    expect(labels(weeks).at(-1)).toBe('2026-04-24');
  });
});
