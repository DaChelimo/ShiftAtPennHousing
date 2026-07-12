// Worker My-Shifts / Open-Shifts coalescing + claimability — pure-logic tests.
//
// Mirrors the mobile CoalesceTest / OpenShiftPresentationTest behavioral contract
// (apps/mobile/.../shifts/{Coalesce,OpenShiftPresentation}.kt).
import { describe, expect, it } from 'vitest';

import {
  coalesceMyShifts,
  coalesceOpenShifts,
  isOpenShiftClaimable,
  resolveOpenState,
  weekRange,
  type MyShiftBlock,
  type OpenShiftBlock,
} from '../../src/worker-shifts/index.js';

// A 30-minute block starting at an ISO instant.
function d(iso: string): Date {
  return new Date(iso);
}
function plus30(t: Date): Date {
  return new Date(t.getTime() + 30 * 60 * 1000);
}

function myBlock(id: string, startIso: string, over: Partial<MyShiftBlock> = {}): MyShiftBlock {
  const start = d(startIso);
  return {
    id,
    houseId: 'gregory',
    houseName: 'Gregory',
    start,
    end: plus30(start),
    kind: 'scheduled',
    crossHouse: false,
    pending: false,
    breakShift: false,
    droppedStillOpen: false,
    ...over,
  };
}

function openBlock(id: string, startIso: string, over: Partial<OpenShiftBlock> = {}): OpenShiftBlock {
  const start = d(startIso);
  return {
    id,
    houseId: 'gregory',
    houseName: 'Gregory',
    start,
    end: plus30(start),
    feed: 'weekly',
    homeHouse: true,
    weeksRemaining: null,
    deskCovered: false,
    coverageLocked: false,
    ...over,
  };
}

describe('coalesceMyShifts', () => {
  it('merges contiguous same-key blocks into one card carrying every block id', () => {
    const cards = coalesceMyShifts([
      myBlock('a', '2026-07-13T12:00:00-04:00'),
      myBlock('b', '2026-07-13T12:30:00-04:00'),
      myBlock('c', '2026-07-13T13:00:00-04:00'),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('a');
    expect(cards[0].blockIds).toEqual(['a', 'b', 'c']);
    expect(cards[0].start.toISOString()).toBe(d('2026-07-13T12:00:00-04:00').toISOString());
    expect(cards[0].end.toISOString()).toBe(d('2026-07-13T13:30:00-04:00').toISOString());
  });

  it('splits a non-contiguous run into separate cards', () => {
    const cards = coalesceMyShifts([
      myBlock('a', '2026-07-13T12:00:00-04:00'),
      myBlock('b', '2026-07-13T13:00:00-04:00'), // gap
    ]);
    expect(cards).toHaveLength(2);
  });

  it('never merges across a differing display flag (kind)', () => {
    const cards = coalesceMyShifts([
      myBlock('a', '2026-07-13T12:00:00-04:00', { kind: 'scheduled' }),
      myBlock('b', '2026-07-13T12:30:00-04:00', { kind: 'temp_pickup' }),
    ]);
    expect(cards).toHaveLength(2);
  });
});

describe('coalesceOpenShifts', () => {
  it('collapses concurrent same-span lanes into one "N open" card', () => {
    const cards = coalesceOpenShifts([
      openBlock('a1', '2026-07-13T12:00:00-04:00'),
      openBlock('b1', '2026-07-13T12:00:00-04:00'),
      openBlock('a2', '2026-07-13T12:30:00-04:00'),
      openBlock('b2', '2026-07-13T12:30:00-04:00'),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].count).toBe(2);
    expect(cards[0].blockIds).toHaveLength(2); // one representative lane
    expect(cards[0].end.toISOString()).toBe(d('2026-07-13T13:00:00-04:00').toISOString());
  });

  it('keeps blocks of differing claimability in separate cards', () => {
    const cards = coalesceOpenShifts([
      openBlock('a', '2026-07-13T12:00:00-04:00', { deskCovered: true }),
      openBlock('b', '2026-07-13T12:30:00-04:00', { deskCovered: false }),
    ]);
    expect(cards).toHaveLength(2);
  });

  it('collapses permanent-opening occurrences to the earliest per recurrence identity', () => {
    // Same house + NY weekday (Mon) + local time, one week apart → one recurring slot.
    const cards = coalesceOpenShifts([
      openBlock('wk2', '2026-07-20T17:00:00-04:00', { feed: 'permanent_opening', weeksRemaining: 5 }),
      openBlock('wk1', '2026-07-13T17:00:00-04:00', { feed: 'permanent_opening', weeksRemaining: 5 }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('wk1');
  });
});

describe('isOpenShiftClaimable', () => {
  const now = d('2026-07-13T12:00:00-04:00');

  it('is not claimable once one-way locked', () => {
    expect(
      isOpenShiftClaimable(openBlock('a', '2026-07-13T18:00:00-04:00', { coverageLocked: true }), now),
    ).toBe(false);
  });

  it('is claimable when still outside the T-2h cutoff', () => {
    expect(
      isOpenShiftClaimable(openBlock('a', '2026-07-13T18:00:00-04:00'), now),
    ).toBe(true);
  });

  it('within T-2h: claimable only when a real sibling still covers the desk', () => {
    const soon = '2026-07-13T13:00:00-04:00'; // 1h out
    expect(isOpenShiftClaimable(openBlock('a', soon, { deskCovered: true }), now)).toBe(true);
    expect(isOpenShiftClaimable(openBlock('a', soon, { deskCovered: false }), now)).toBe(false);
  });
});

describe('resolveOpenState', () => {
  it('permanent openings are always a pickup, never locked by the per-occurrence cutoff', () => {
    expect(resolveOpenState('permanent_opening', false)).toBe('permanent');
    expect(resolveOpenState('weekly', true)).toBe('open');
    expect(resolveOpenState('weekly', false)).toBe('unpickable');
  });
});

describe('weekRange', () => {
  it('offset 0 spans the NY Monday..next-Monday containing now', () => {
    const { start, end } = weekRange(d('2026-07-15T12:00:00-04:00'), 0); // a Wednesday
    // Monday 2026-07-13 00:00 NY
    expect(start.toISOString()).toBe(d('2026-07-13T00:00:00-04:00').toISOString());
    expect(end.toISOString()).toBe(d('2026-07-20T00:00:00-04:00').toISOString());
  });

  it('offset +1 advances one NY week', () => {
    const { start } = weekRange(d('2026-07-15T12:00:00-04:00'), 1);
    expect(start.toISOString()).toBe(d('2026-07-20T00:00:00-04:00').toISOString());
  });
});
