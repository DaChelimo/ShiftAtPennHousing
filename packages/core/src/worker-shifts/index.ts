// Worker My-Shifts / Open-Shifts presentation logic — PURE (zero Supabase, zero clock).
//
// The live worker read models (`worker_my_shifts` / `worker_open_shifts`) return ONE
// ROW PER 30-MINUTE BLOCK (invariant #5), so a 4h shift arrives as 8 identical rows.
// This module merges consecutive same-shift blocks into one displayed card whose
// `blockIds` carry every constituent assignment_id (so drop/claim can target all, or a
// sub-range). It is the TypeScript port of the mobile shared logic in
// apps/mobile/.../shifts/{Coalesce,MyShiftPresentation,OpenShiftPresentation}.kt — the
// Kotlin test suites (CoalesceTest / OpenShiftPresentationTest) are the behavioral
// contract mirrored by ../../tests/worker-shifts/*.
//
// Contiguity is duration arithmetic on instants (`next.start == run.end` compared by
// epoch ms), never wall-clock arithmetic (invariant #6), so runs merge correctly across
// DST transitions. Claimability consumes the server-authoritative `coverageLocked` /
// `deskCovered` flags and never re-derives the T-2h lock from scratch beyond applying
// the same coverage-conditional predicate the DB uses (is_assignment_claimable).

import { weekContains, weekStart } from '../time/index.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// ===========================================================================
// My Shifts
// ===========================================================================

export type MyShiftKind = 'scheduled' | 'temp_pickup' | 'float_out';

/** One 30-minute row from `worker_my_shifts` (the loader maps a wire row to this). */
export type MyShiftBlock = {
  id: string; // this block's assignment_id
  houseId: string;
  houseName: string;
  start: Date;
  end: Date;
  kind: MyShiftKind;
  crossHouse: boolean;
  pending: boolean;
  breakShift: boolean;
  droppedStillOpen: boolean;
};

/** A displayed My-Shifts card: a maximal contiguous run of same-key blocks. */
export type MyShiftCard = MyShiftBlock & {
  /** Every constituent block's assignment_id, in ascending start order. */
  blockIds: string[];
};

// What must match for two adjacent My-Shifts blocks to be one displayed shift.
function myShiftMergeKey(b: MyShiftBlock): string {
  return [
    b.houseId,
    b.kind,
    b.crossHouse ? '1' : '0',
    b.pending ? '1' : '0',
    b.breakShift ? '1' : '0',
    b.droppedStillOpen ? '1' : '0',
  ].join('|');
}

// The visual treatment a My-Shifts card renders (independent of its section). Priority:
// dropped → float → pickup → break → scheduled (§11.2). `pending` escalates a float only.
export type MyShiftState =
  | 'scheduled'
  | 'pickup_home'
  | 'pickup_cross'
  | 'float_out'
  | 'pending_float'
  | 'break_shift'
  | 'dropped';

export function myShiftCardState(
  card: Pick<MyShiftBlock, 'kind' | 'pending' | 'crossHouse' | 'breakShift' | 'droppedStillOpen'>,
): MyShiftState {
  if (card.droppedStillOpen) return 'dropped';
  if (card.kind === 'float_out') return card.pending ? 'pending_float' : 'float_out';
  if (card.kind === 'temp_pickup') return card.crossHouse ? 'pickup_cross' : 'pickup_home';
  if (card.breakShift) return 'break_shift';
  return 'scheduled';
}

// The three My-Shifts subsections (§5.6 / decision #1, #2): dropped-still-open wins, then a
// this-week voluntary pickup, else it's the worker's own shift.
export type MyShiftSection = 'scheduled' | 'picked_up' | 'dropped';

export function classifyMyShift(
  card: Pick<MyShiftBlock, 'kind' | 'droppedStillOpen'>,
): MyShiftSection {
  if (card.droppedStillOpen) return 'dropped';
  if (card.kind === 'temp_pickup') return 'picked_up';
  return 'scheduled';
}

/** Partition coalesced cards into the three subsections, each sorted by start ascending. */
export function partitionMyShifts(cards: MyShiftCard[]): {
  scheduled: MyShiftCard[];
  pickedUp: MyShiftCard[];
  dropped: MyShiftCard[];
} {
  const byStart = (a: MyShiftCard, b: MyShiftCard): number => a.start.getTime() - b.start.getTime();
  return {
    scheduled: cards.filter((c) => classifyMyShift(c) === 'scheduled').sort(byStart),
    pickedUp: cards.filter((c) => classifyMyShift(c) === 'picked_up').sort(byStart),
    dropped: cards.filter((c) => classifyMyShift(c) === 'dropped').sort(byStart),
  };
}

// ===========================================================================
// Open Shifts
// ===========================================================================

export type OpenFeed = 'weekly' | 'permanent_opening';

/** One 30-minute row from `worker_open_shifts` (the loader maps a wire row to this). */
export type OpenShiftBlock = {
  id: string; // this block's assignment_id
  houseId: string;
  houseName: string;
  start: Date;
  end: Date;
  feed: OpenFeed;
  homeHouse: boolean;
  weeksRemaining: number | null;
  deskCovered: boolean;
  coverageLocked: boolean;
};

/** A displayed open-shift card. `count` is how many identical concurrent openings it stands for. */
export type OpenShiftCard = OpenShiftBlock & {
  blockIds: string[];
  count: number;
};

function openShiftMergeKey(b: OpenShiftBlock): string {
  // Coverage flags are per-block (§5.4/§5.5): keying on them keeps blocks of differing
  // claimability in separate cards rather than merging into one whose action would
  // misrepresent half its blocks.
  return [
    b.houseId,
    b.feed,
    b.homeHouse ? '1' : '0',
    b.weeksRemaining === null ? 'x' : String(b.weeksRemaining),
    b.deskCovered ? '1' : '0',
    b.coverageLocked ? '1' : '0',
  ].join('|');
}

// ===========================================================================
// Lane threading (shared)
// ===========================================================================

// Thread items (already same merge key) into maximal contiguous LANES: each item
// extends the first open lane whose current end equals the item's start, else it opens
// a new lane. Handles CONCURRENT blocks (a multi-staff desk has several seats vacant for
// the same span) by running one lane per seat — a naive single-run sweep would treat the
// second same-start row as an overlap and fragment the run.
function threadLanes<T>(items: T[], start: (t: T) => Date, end: (t: T) => Date): T[][] {
  const lanes: T[][] = [];
  const laneEnds: number[] = [];
  const sorted = [...items].sort((a, b) => start(a).getTime() - start(b).getTime());
  for (const item of sorted) {
    const s = start(item).getTime();
    const laneIdx = laneEnds.findIndex((e) => e === s);
    const lane = laneIdx >= 0 ? lanes[laneIdx] : undefined;
    if (lane !== undefined) {
      lane.push(item);
      laneEnds[laneIdx] = end(item).getTime();
    } else {
      lanes.push([item]);
      laneEnds.push(end(item).getTime());
    }
  }
  return lanes;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket === undefined) out.set(k, [item]);
    else bucket.push(item);
  }
  return out;
}

// ===========================================================================
// coalesceMyShifts
// ===========================================================================

/**
 * Merge consecutive same-shift blocks into displayed cards, sorted by start. A worker
 * never holds two concurrent blocks, so each lane is a plain contiguous run.
 */
export function coalesceMyShifts(blocks: MyShiftBlock[]): MyShiftCard[] {
  const cards: MyShiftCard[] = [];
  for (const group of groupBy(blocks, myShiftMergeKey).values()) {
    for (const lane of threadLanes(group, (b) => b.start, (b) => b.end)) {
      const first = lane[0];
      if (first === undefined) continue;
      const last = lane[lane.length - 1] ?? first;
      cards.push({ ...first, end: last.end, blockIds: lane.map((b) => b.id) });
    }
  }
  return cards.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ===========================================================================
// coalesceOpenShifts (concurrency-aware + permanent recurrence collapse)
// ===========================================================================

// The recurring-slot identity of a permanent opening: same house + home-house flag + NY
// weekday + local start/end time-of-day. Two occurrences a week apart share this key but
// sit at different absolute instants — matching how permanent pickup names the slot
// (invariant #6: NY-local day-of-week + HH:MM, never an absolute date).
const NY = 'America/New_York';
function nyParts(t: Date): { isoDow: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(t);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const dowMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { isoDow: dowMap[get('weekday')] ?? 0, hhmm: `${hour}:${get('minute')}` };
}
function recurrenceKey(card: OpenShiftCard): string {
  const s = nyParts(card.start);
  const e = nyParts(card.end);
  return [card.houseId, card.homeHouse ? '1' : '0', String(s.isoDow), s.hhmm, e.hhmm].join('|');
}

/**
 * The open-feed analogue of coalesceMyShifts, concurrency-aware. Threading produces one
 * lane per seat; lanes with an IDENTICAL (start, end) span collapse into one card whose
 * `count` is the lane count and whose `blockIds` are one representative lane's — so a
 * multi-staff house shows "N open" instead of N duplicate cards. Permanent openings then
 * get a second collapse: keep only the earliest occurrence per recurrence identity.
 */
export function coalesceOpenShifts(blocks: OpenShiftBlock[]): OpenShiftCard[] {
  const perSpan: OpenShiftCard[] = [];
  for (const group of groupBy(blocks, openShiftMergeKey).values()) {
    const lanes: OpenShiftCard[] = [];
    for (const lane of threadLanes(group, (b) => b.start, (b) => b.end)) {
      const first = lane[0];
      if (first === undefined) continue;
      const last = lane[lane.length - 1] ?? first;
      lanes.push({ ...first, end: last.end, blockIds: lane.map((b) => b.id), count: 1 });
    }
    for (const sameSpan of groupBy(
      lanes,
      (c) => `${String(c.start.getTime())}|${String(c.end.getTime())}`,
    ).values()) {
      const rep = sameSpan[0];
      if (rep === undefined) continue;
      perSpan.push({ ...rep, count: sameSpan.length });
    }
  }

  const permanent = perSpan.filter((c) => c.feed === 'permanent_opening');
  const weekly = perSpan.filter((c) => c.feed !== 'permanent_opening');
  const recurringSlots: OpenShiftCard[] = [];
  for (const occurrences of groupBy(permanent, recurrenceKey).values()) {
    recurringSlots.push(
      occurrences.reduce((min, c) => (c.start.getTime() < min.start.getTime() ? c : min)),
    );
  }
  return [...weekly, ...recurringSlots].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
  );
}

// ===========================================================================
// Claimability (coverage-conditional; mirrors is_assignment_claimable)
// ===========================================================================

/**
 * Whether a WEEKLY open-shift card is claimable at `now`, using the server-authoritative
 * coverage flags. Same predicate the DB enforces: not one-way locked, and either still
 * outside the T-2h cutoff OR a real sibling worker is still on the desk (§5.4/§5.5).
 * Permanent openings are pickups, not subject to the per-occurrence lock — see
 * `resolveOpenState`.
 */
export function isOpenShiftClaimable(card: OpenShiftBlock, now: Date): boolean {
  if (card.coverageLocked) return false;
  return card.start.getTime() > now.getTime() + TWO_HOURS_MS || card.deskCovered;
}

export type OpenShiftState = 'open' | 'unpickable' | 'permanent';

/** A permanent opening always renders `permanent`; a weekly gap is `unpickable` once no longer claimable. */
export function resolveOpenState(feed: OpenFeed, claimable: boolean): OpenShiftState {
  if (feed === 'permanent_opening') return 'permanent';
  if (!claimable) return 'unpickable';
  return 'open';
}

// ===========================================================================
// Week scoping
// ===========================================================================

/** The NY calendar-week window for a given `weekOffset` from `now` (offset 0 = this week). */
export function weekRange(now: Date, weekOffset: number): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + weekOffset * 7 * 24 * 60 * 60 * 1000);
  const start = weekStart(shifted);
  // Add 8 days then re-normalize to that week's Monday — DST-safe next-Monday boundary.
  const end = weekStart(new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000));
  return { start, end };
}

/** Filter coalesced My-Shifts cards to those whose start falls in the NY week starting at `weekStartAt`. */
export function myShiftsInWeek(cards: MyShiftCard[], weekStartAt: Date): MyShiftCard[] {
  return cards.filter((c) => weekContains(weekStartAt, c.start));
}
