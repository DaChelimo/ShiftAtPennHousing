// Phase 03 — Pure time helpers
// Spec sources: BEHAVIORAL_SPECIFICATION §1.4 (time conventions, date attribution),
//               BEHAVIORAL_SPECIFICATION §1.5 (30-min block atomicity),
//               ARCHITECTURE §1.6 (America/New_York anchoring, timestamptz, DST).
//
// These tests describe five pure functions that operate on a JS Date
// (an instant in time) and use America/New_York wall-clock semantics
// for boundary alignment, week boundaries, and day-of-week classification.
// They are TDD-first: the implementation in packages/core/src/time/index.ts
// does not exist yet.
//
// Function contracts:
//   blockBoundary(date: Date): Date
//     Snap to the most recent 30-minute boundary in America/New_York wall time.
//
//   addBlocks(date: Date, n: number): Date
//     Add n × 30 minutes as DURATION arithmetic (ARCH §1.6).
//     A block crossing a DST transition is still exactly 30 min of UTC elapsed.
//
//   weekStart(date: Date): Date
//     The Monday 00:00 in America/New_York of the calendar week containing `date`.
//
//   weekContains(weekStart: Date, date: Date): boolean
//     True iff `date` falls within [weekStart, weekStart + 7d) — Monday 00:00
//     inclusive, the following Monday 00:00 exclusive (BEH §1.4 rollover rule).
//
//   dayType(date: Date): 'weekday' | 'weekend'
//     'weekday' for Monday–Friday in America/New_York, 'weekend' for Sat/Sun.

import { describe, expect, it } from 'vitest';

import {
  addBlocks,
  blockBoundary,
  dayType,
  weekContains,
  weekStart,
} from '../../src/time/index.js';

const MS_PER_MIN = 60_000;

// ----- blockBoundary -----------------------------------------------

describe('blockBoundary — snap to most recent 30-min boundary', () => {
  it('snaps 17:51 → 17:30', () => {
    const result = blockBoundary(new Date('2026-02-03T17:51:00-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-03T17:30:00-05:00').toISOString());
  });

  it('snaps 17:30 → 17:30 (idempotent at boundary)', () => {
    const d = new Date('2026-02-03T17:30:00-05:00');
    expect(blockBoundary(d).getTime()).toBe(d.getTime());
  });

  it('snaps 17:29 → 17:00', () => {
    const result = blockBoundary(new Date('2026-02-03T17:29:00-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-03T17:00:00-05:00').toISOString());
  });

  it('snaps 17:00 → 17:00 (idempotent at hour boundary)', () => {
    const d = new Date('2026-02-03T17:00:00-05:00');
    expect(blockBoundary(d).getTime()).toBe(d.getTime());
  });

  it('snaps 17:30:45 (sub-minute drift) → 17:30 — seconds are dropped', () => {
    const result = blockBoundary(new Date('2026-02-03T17:30:45-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-03T17:30:00-05:00').toISOString());
  });

  it('snaps 00:15 → 00:00 of the same day (no day rollover)', () => {
    const result = blockBoundary(new Date('2026-02-03T00:15:00-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-03T00:00:00-05:00').toISOString());
  });
});

// ----- addBlocks ---------------------------------------------------

describe('addBlocks — duration arithmetic, not wall-clock (ARCH §1.6)', () => {
  it('adds 1 block = 30 min', () => {
    const result = addBlocks(new Date('2026-02-03T17:00:00-05:00'), 1);
    expect(result.getTime() - new Date('2026-02-03T17:00:00-05:00').getTime()).toBe(
      30 * MS_PER_MIN,
    );
  });

  it('adds 2 blocks = 60 min', () => {
    const start = new Date('2026-02-03T17:00:00-05:00');
    const result = addBlocks(start, 2);
    expect(result.getTime() - start.getTime()).toBe(60 * MS_PER_MIN);
  });

  it('adds 0 blocks = identity', () => {
    const d = new Date('2026-02-03T17:00:00-05:00');
    expect(addBlocks(d, 0).getTime()).toBe(d.getTime());
  });

  it('negative blocks subtract duration', () => {
    const after = new Date('2026-02-03T17:30:00-05:00');
    const result = addBlocks(after, -1);
    expect(result.toISOString()).toBe(new Date('2026-02-03T17:00:00-05:00').toISOString());
  });

  it('DST spring-forward: a block crossing 02:00 EST → 03:00 EDT is still 30 min UTC elapsed', () => {
    // 2026-03-08 01:30 EST + 30 min = the moment after the wall-clock "jumps".
    // The wall clock at result is "03:00 EDT" because 02:00–02:59 EST does not exist;
    // but the elapsed-time delta is still exactly 30 minutes.
    const before = new Date('2026-03-08T01:30:00-05:00');
    const result = addBlocks(before, 1);
    expect(result.getTime() - before.getTime()).toBe(30 * MS_PER_MIN);
  });

  it('DST fall-back: a block crossing 02:00 EDT → 01:00 EST is still 30 min UTC elapsed', () => {
    // 2025-11-02 01:30 EDT + 30 min = 01:00 EST (wall clock repeats),
    // and the UTC delta remains 30 minutes.
    const before = new Date('2025-11-02T01:30:00-04:00');
    const result = addBlocks(before, 1);
    expect(result.getTime() - before.getTime()).toBe(30 * MS_PER_MIN);
  });

  it('adds 32 blocks = 16 h (the full Harnwell shift span)', () => {
    const start = new Date('2026-02-03T08:00:00-05:00');
    const result = addBlocks(start, 32);
    expect(result.toISOString()).toBe(new Date('2026-02-04T00:00:00-05:00').toISOString());
  });
});

// ----- weekStart ---------------------------------------------------

describe('weekStart — Monday 00:00 in America/New_York', () => {
  it('Monday noon → that same Monday 00:00 EST', () => {
    // 2026-02-02 is Monday
    const result = weekStart(new Date('2026-02-02T12:00:00-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-02T00:00:00-05:00').toISOString());
  });

  it('Wednesday afternoon → preceding Monday 00:00 EST', () => {
    const result = weekStart(new Date('2026-02-04T15:30:00-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-02T00:00:00-05:00').toISOString());
  });

  it('Sunday 23:59 → preceding Monday (Sunday is the LAST day of the week, BEH §1.4)', () => {
    // 2026-02-08 is Sunday
    const result = weekStart(new Date('2026-02-08T23:59:00-05:00'));
    expect(result.toISOString()).toBe(new Date('2026-02-02T00:00:00-05:00').toISOString());
  });

  it('Monday 00:00 → itself (rollover boundary, BEH §1.4)', () => {
    const mon = new Date('2026-02-02T00:00:00-05:00');
    expect(weekStart(mon).getTime()).toBe(mon.getTime());
  });

  it('Sunday 23:30 and next Monday 00:00 land in different weeks (rollover)', () => {
    const sunNight = new Date('2026-02-08T23:30:00-05:00');
    const monMorn = new Date('2026-02-09T00:00:00-05:00');
    expect(weekStart(sunNight).toISOString()).toBe(
      new Date('2026-02-02T00:00:00-05:00').toISOString(),
    );
    expect(weekStart(monMorn).toISOString()).toBe(
      new Date('2026-02-09T00:00:00-05:00').toISOString(),
    );
  });

  it('DST spring-forward week — Monday 00:00 EST is computed in the correct zone', () => {
    // 2026-03-08 is the DST-Sunday. The Monday of this week is 2026-03-02 (still EST).
    const dstSun = new Date('2026-03-08T12:00:00-04:00');
    const result = weekStart(dstSun);
    expect(result.toISOString()).toBe(new Date('2026-03-02T00:00:00-05:00').toISOString());
  });
});

// ----- weekContains ------------------------------------------------

describe('weekContains', () => {
  const monday = new Date('2026-02-02T00:00:00-05:00');

  it('Wednesday 15:00 is in the week', () => {
    expect(weekContains(monday, new Date('2026-02-04T15:00:00-05:00'))).toBe(true);
  });

  it('Monday 00:00 exactly is in the week (inclusive lower bound)', () => {
    expect(weekContains(monday, monday)).toBe(true);
  });

  it('Sunday 23:30 is in the week (still date N of the week per BEH §1.4)', () => {
    expect(weekContains(monday, new Date('2026-02-08T23:30:00-05:00'))).toBe(true);
  });

  it('next Monday 00:00 is NOT in the week (exclusive upper bound — BEH §1.4 rollover)', () => {
    expect(weekContains(monday, new Date('2026-02-09T00:00:00-05:00'))).toBe(false);
  });

  it('prior Sunday 23:30 is NOT in the week', () => {
    expect(weekContains(monday, new Date('2026-02-01T23:30:00-05:00'))).toBe(false);
  });
});

// ----- dayType -----------------------------------------------------

describe('dayType — weekday vs weekend in America/New_York', () => {
  it('Monday is weekday', () => {
    expect(dayType(new Date('2026-02-02T12:00:00-05:00'))).toBe('weekday');
  });

  it('Friday is weekday (BEH §3.3 explicitly lists this case)', () => {
    expect(dayType(new Date('2026-02-06T12:00:00-05:00'))).toBe('weekday');
  });

  it('Saturday is weekend (BEH §3.3 explicitly lists this case)', () => {
    expect(dayType(new Date('2026-02-07T12:00:00-05:00'))).toBe('weekend');
  });

  it('Sunday is weekend', () => {
    expect(dayType(new Date('2026-02-08T12:00:00-05:00'))).toBe('weekend');
  });

  it('Friday 23:30 EST is still a Friday (weekday) — date attribution at boundary', () => {
    expect(dayType(new Date('2026-02-06T23:30:00-05:00'))).toBe('weekday');
  });

  it('Saturday 00:00 EST is a Saturday (weekend) — rollover honored', () => {
    expect(dayType(new Date('2026-02-07T00:00:00-05:00'))).toBe('weekend');
  });

  it('zone-sensitive: 2026-02-08 00:00 UTC is Saturday evening in NY → weekend', () => {
    // 00:00Z on Sunday = 19:00 Saturday in America/New_York EST
    expect(dayType(new Date('2026-02-08T00:00:00Z'))).toBe('weekend');
  });

  it('zone-sensitive: 2026-02-07 04:00 UTC is Friday 23:00 in NY → weekday', () => {
    // 04:00Z Saturday = 23:00 Friday EST
    expect(dayType(new Date('2026-02-07T04:00:00Z'))).toBe('weekday');
  });
});
