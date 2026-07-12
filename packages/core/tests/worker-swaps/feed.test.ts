// Swaps-tab feed presentation — pure-logic tests.
// Mirrors the mobile SwapsFeedTest behavioral contract (apps/mobile/.../swaps/SwapsFeed.kt).
import { describe, expect, it } from 'vitest';

import { buildSwapsFeed, pillLabel, type PendingSwap } from '../../src/worker-swaps/index.js';

function d(iso: string): Date {
  return new Date(iso);
}

function baseSwap(over: Partial<PendingSwap> = {}): PendingSwap {
  return {
    swapId: 's1',
    swapType: 'shift_swap',
    direction: 'incoming',
    status: 'pending',
    createdAt: d('2026-07-13T10:00:00-04:00'),
    expiresAt: d('2026-07-14T10:00:00-04:00'),
    otherUserId: 'u-other',
    otherUserName: 'Ben Carter',
    initiatorAssignmentIds: ['i1', 'i2'],
    counterpartyAssignmentIds: ['c1', 'c2'],
    initiatorStart: d('2026-07-15T08:00:00-04:00'),
    initiatorEnd: d('2026-07-15T12:00:00-04:00'),
    initiatorBlocks: 8,
    initiatorHouseName: 'Gregory',
    counterpartyStart: d('2026-07-16T14:00:00-04:00'),
    counterpartyEnd: d('2026-07-16T16:00:00-04:00'),
    counterpartyBlocks: 4,
    counterpartyHouseName: 'Harrison',
    ...over,
  };
}

describe('buildSwapsFeed — two-sided swap', () => {
  it('incoming: you GIVE the counterparty side and GET the initiator side', () => {
    const feed = buildSwapsFeed([baseSwap()], d('2026-07-13T12:00:00-04:00'));
    expect(feed.incoming).toHaveLength(1);
    const row = feed.incoming[0];
    expect(row.incoming).toBe(true);
    expect(row.acceptable).toBe(true);
    expect(row.directionLabel).toBe('Needs your response');
    // Incoming: get = initiator (their shift → you), give = counterparty (yours → them).
    expect(row.get?.hours).toBe('4h');
    expect(row.get?.houseName).toBe('Gregory');
    expect(row.give?.hours).toBe('2h');
    expect(row.give?.houseName).toBe('Harrison');
    expect(row.isOneWayTransfer).toBe(false);
    expect(row.typeLabel).toBe('Shift swap');
  });

  it('outgoing rows are not acceptable and wait on the counterparty', () => {
    const feed = buildSwapsFeed([baseSwap({ direction: 'outgoing' })], d('2026-07-13T12:00:00-04:00'));
    const row = feed.outgoing[0];
    expect(row.acceptable).toBe(false);
    expect(row.directionLabel).toBe('Waiting on Ben Carter');
  });
});

describe('buildSwapsFeed — one-way transfer', () => {
  it('handoff-to-you (no counterparty span) reads as a single receive panel', () => {
    const feed = buildSwapsFeed(
      [
        baseSwap({
          swapType: 'handoff',
          counterpartyAssignmentIds: [],
          counterpartyStart: null,
          counterpartyEnd: null,
          counterpartyBlocks: 0,
          counterpartyHouseName: null,
        }),
      ],
      d('2026-07-13T12:00:00-04:00'),
    );
    const row = feed.incoming[0];
    expect(row.isOneWayTransfer).toBe(true);
    expect(row.give).toBeNull();
    expect(row.transferSide?.hours).toBe('4h');
    expect(row.transferHeadline).toBe('Ben Carter wants to give you these hours');
    expect(row.typeLabel).toBe('Hours offered');
  });

  it('a one-way permanent transfer keeps its permanence signal', () => {
    expect(pillLabel('permanent_swap', true)).toBe('Permanent hours');
    expect(pillLabel('permanent_swap', false)).toBe('Permanent swap');
  });
});

describe('buildSwapsFeed — sorting', () => {
  it('sorts every list by soonest deadline first', () => {
    const soon = baseSwap({ swapId: 'soon', expiresAt: d('2026-07-13T15:00:00-04:00') });
    const later = baseSwap({ swapId: 'later', expiresAt: d('2026-07-20T15:00:00-04:00') });
    const feed = buildSwapsFeed([later, soon], d('2026-07-13T12:00:00-04:00'));
    expect(feed.all.map((r) => r.swapId)).toEqual(['soon', 'later']);
    expect(feed.all[0].deadlineUrgent).toBe(true); // < 6h
    expect(feed.all[1].deadlineUrgent).toBe(false);
  });
});
