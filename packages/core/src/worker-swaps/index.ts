// Swaps tab presentation — PURE (zero Supabase, zero clock; `now` injected).
//
// TypeScript port of the mobile shared logic in apps/mobile/.../swaps/SwapsFeed.kt.
// Each row leads with the DECISION-CRITICAL facts: the hours you give, the hours you get
// (durations computed for the worker), the physical house of each side (a swap must never
// silently relocate the acceptor), and a live countdown. A one-directional TRANSFER
// (exactly one side present) is reframed as a single panel, never a two-sided swap.
//
// Built from the enriched `worker_pending_swaps()` read model (PendingSwap). The Kotlin
// SwapsFeedTest suite is the behavioral contract mirrored by ../../tests/worker-swaps/*.

import {
  formatDayLabel,
  formatDuration,
  formatHoursFromBlocks,
  formatTimeRange,
} from '../worker-shifts/format.js';

export type SwapDirection = 'incoming' | 'outgoing';

/** One row of `worker_pending_swaps()` (the loader maps a wire row to this). */
export type PendingSwap = {
  swapId: string;
  swapType: string;
  direction: SwapDirection;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  otherUserId: string | null;
  otherUserName: string;
  initiatorAssignmentIds: string[];
  counterpartyAssignmentIds: string[];
  initiatorStart: Date | null;
  initiatorEnd: Date | null;
  initiatorBlocks: number;
  initiatorHouseName: string | null;
  counterpartyStart: Date | null;
  counterpartyEnd: Date | null;
  counterpartyBlocks: number;
  counterpartyHouseName: string | null;
};

/** One side of a swap: the WHEN is the hero; the computed hours + physical house are chips. */
export type SwapSide = {
  timeRange: string | null; // "08:00 - 12:00"
  dayLabel: string | null; // "Sat · Jun 20"
  hours: string; // "4h" / "2h 30m"
  houseName: string | null; // where this side is physically worked
};

export type SwapRow = {
  swapId: string;
  typeLabel: string;
  counterpartyName: string;
  incoming: boolean;
  directionLabel: string;
  acceptable: boolean;
  give: SwapSide | null;
  get: SwapSide | null;
  deadline: string;
  deadlineUrgent: boolean;
  expiresAt: Date;
  groupId: string | null;
  groupSize: number;
  // A one-directional transfer: exactly one side present. The UI drops the give↔get split.
  isOneWayTransfer: boolean;
  transferSide: SwapSide | null;
  transferHeadline: string;
};

export type SwapsFeed = {
  all: SwapRow[];
  incoming: SwapRow[];
  outgoing: SwapRow[];
};

function swapTypeLabel(swapType: string): string {
  switch (swapType.toLowerCase()) {
    case 'shift_swap':
      return 'Shift swap';
    case 'float_swap':
      return 'Float swap';
    case 'permanent_swap':
      return 'Permanent swap';
    case 'handoff':
      return 'Hand-off';
    default:
      return 'Swap';
  }
}

/**
 * Chip label. A one-directional transfer must never read as a "swap": relabel by
 * permanence. Shared so the card and the accept/decline modal agree.
 */
export function pillLabel(swapType: string, oneWay: boolean): string {
  if (!oneWay) return swapTypeLabel(swapType);
  if (swapType.toLowerCase() === 'permanent_swap') return 'Permanent hours';
  return 'Hours offered';
}

function sideOf(
  start: Date | null,
  end: Date | null,
  blocks: number,
  houseName: string | null,
): SwapSide | null {
  if (blocks === 0) return null;
  if (start !== null && end !== null) {
    return {
      timeRange: formatTimeRange(start, end),
      dayLabel: formatDayLabel(start),
      hours: formatDuration(start, end),
      houseName,
    };
  }
  return { timeRange: null, dayLabel: null, hours: formatHoursFromBlocks(blocks), houseName };
}

function deadlineLabel(now: Date, at: Date): string {
  const mins = Math.floor((at.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'Expired';
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const onlyMins = mins % 60;
  let span: string;
  if (days > 0 && hours > 0) span = `${String(days)}d ${String(hours)}h`;
  else if (days > 0) span = `${String(days)}d`;
  else if (hours > 0 && onlyMins > 0) span = `${String(hours)}h ${String(onlyMins)}m`;
  else if (hours > 0) span = `${String(hours)}h`;
  else span = `${String(onlyMins)}m`;
  return `Expires in ${span}`;
}

// Cosmetic grouping key for co-created outgoing legs: create-minute + type.
function bucketKey(swap: PendingSwap): string {
  return `${String(Math.floor(swap.createdAt.getTime() / 60000))}-${swap.swapType.toLowerCase()}`;
}

function rowOf(
  swap: PendingSwap,
  now: Date,
  groupId: string | null,
  groupSize: number,
): SwapRow {
  const outgoing = swap.direction === 'outgoing';
  const mySide = sideOf(
    swap.initiatorStart,
    swap.initiatorEnd,
    swap.initiatorBlocks,
    swap.initiatorHouseName,
  );
  const theirSide = sideOf(
    swap.counterpartyStart,
    swap.counterpartyEnd,
    swap.counterpartyBlocks,
    swap.counterpartyHouseName,
  );
  const give = outgoing ? mySide : theirSide;
  const get = outgoing ? theirSide : mySide;
  const oneWay = (give === null) !== (get === null);
  const minsToExpiry = Math.floor((swap.expiresAt.getTime() - now.getTime()) / 60000);
  return {
    swapId: swap.swapId,
    typeLabel: pillLabel(swap.swapType, oneWay),
    counterpartyName: swap.otherUserName,
    incoming: !outgoing,
    directionLabel: outgoing ? `Waiting on ${swap.otherUserName}` : 'Needs your response',
    acceptable: !outgoing,
    give,
    get,
    deadline: deadlineLabel(now, swap.expiresAt),
    deadlineUrgent: minsToExpiry >= 1 && minsToExpiry <= 6 * 60,
    expiresAt: swap.expiresAt,
    groupId,
    groupSize,
    isOneWayTransfer: oneWay,
    transferSide: give ?? get,
    transferHeadline: !outgoing
      ? `${swap.otherUserName} wants to give you these hours`
      : `You're offering these hours to ${swap.otherUserName}`,
  };
}

/**
 * Build the Swaps tab's All / Incoming / Outgoing lists from the worker's pending swaps.
 * Every list is sorted by deadline ascending (soonest to expire first); co-created
 * outgoing legs stay adjacent so a "Proposed together" header renders once.
 */
export function buildSwapsFeed(pendingSwaps: PendingSwap[], now: Date): SwapsFeed {
  const incoming = pendingSwaps
    .filter((s) => s.direction === 'incoming')
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
    .map((s) => rowOf(s, now, null, 1));

  const outgoingSwaps = pendingSwaps.filter((s) => s.direction === 'outgoing');
  const bucketSizes = new Map<string, number>();
  for (const s of outgoingSwaps) {
    const k = bucketKey(s);
    bucketSizes.set(k, (bucketSizes.get(k) ?? 0) + 1);
  }
  const outgoing = [...outgoingSwaps]
    .sort(
      (a, b) =>
        a.expiresAt.getTime() - b.expiresAt.getTime() ||
        bucketKey(a).localeCompare(bucketKey(b)) ||
        a.swapId.localeCompare(b.swapId),
    )
    .map((s) => {
      const key = bucketKey(s);
      const size = bucketSizes.get(key) ?? 1;
      const grouped = size >= 2;
      return rowOf(s, now, grouped ? key : null, grouped ? size : 1);
    });

  const all = [...incoming, ...outgoing].sort(
    (a, b) =>
      a.expiresAt.getTime() - b.expiresAt.getTime() ||
      (a.groupId ?? '').localeCompare(b.groupId ?? '') ||
      a.swapId.localeCompare(b.swapId),
  );

  return { all, incoming, outgoing };
}
