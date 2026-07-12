import {
  coalesceOpenShifts,
  isOpenShiftClaimable,
  resolveOpenState,
  weekRange,
  type OpenFeed,
  type OpenShiftBlock,
  type OpenShiftCard,
  type OpenShiftState,
} from '@shift/core';

import { createClient } from '../../supabase/server';

// ===========================================================================
// Worker "Open Shifts" — READ model (claimable open seats + permanent openings).
//
// Reads the RLS/eligibility-scoped `worker_open_shifts` view (one row per 30-minute
// vacant block, already filtered to seats THIS worker may claim) and coalesces them into
// displayed cards. Server-authoritative claimability: the view emits `coverage_locked` +
// `desk_covered`, and `isOpenShiftClaimable` applies the same coverage-conditional
// predicate the DB enforces (is_assignment_claimable) — the client NEVER re-derives the
// T-2h lock (AGENTS.md [Coverage-lock]).
//
// The open feed is NOT week-scoped like My Shifts. It is bounded to a rolling window and
// carries a CURRENT-week hours meter (claiming is always current-week).
// ===========================================================================

const NY = 'America/New_York';
const SOFT_HOURS_CAP = 20;
const WINDOW_DAYS = 21;

/** The recurring-slot descriptor a permanent pickup needs (permanent-pickup EF contract). */
export type PermanentSlot = {
  houseId: string;
  dayOfWeek: number; // 0=Sun..6=Sat (NY), matching the EF
  blockStartLocals: string[]; // "HH:MM" on 30-minute boundaries, NY
};

export type OpenShiftCardView = {
  id: string;
  blockIds: string[];
  houseId: string;
  houseName: string;
  startIso: string;
  endIso: string;
  feed: OpenFeed;
  state: OpenShiftState;
  homeHouse: boolean;
  count: number;
  weeksRemaining: number | null;
  timeLabel: string;
  dayLabel: string;
  durationLabel: string;
  meta: string | null;
  actionLabel: string | null;
  /** Present only for permanent openings (the pickup slot). */
  slot: PermanentSlot | null;
};

export type OpenShiftsBoard = {
  cards: OpenShiftCardView[];
  currentWeekHours: number;
  hoursCap: number;
};

type WireRow = {
  id: string;
  house_id: string;
  house_name: string;
  start_at: string;
  end_at: string;
  feed: string;
  home_house: boolean;
  weeks_remaining: number | null;
  coverage_locked: boolean;
  desk_covered: boolean;
};

function timeLabel(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function dayLabel(start: Date, recurring: boolean): string {
  if (recurring) {
    const dow = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short' }).format(start);
    return `Every ${dow}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);
}

function durationLabel(start: Date, end: Date): string {
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${String(h)}h ${String(m)}m`;
  if (h > 0) return `${String(h)}h`;
  return `${String(m)}m`;
}

// The pickup slot for a permanent opening, derived from the card's blocks (NY-anchored).
function permanentSlot(card: OpenShiftCard): PermanentSlot {
  const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short' });
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = dowNames.indexOf(dowFmt.format(card.start));
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const blockStartLocals = card.blockIds.map((_id, i) => {
    const t = new Date(card.start.getTime() + i * 30 * 60 * 1000);
    return timeFmt.format(t);
  });
  return { houseId: card.houseId, dayOfWeek, blockStartLocals };
}

function toView(card: OpenShiftCard, now: Date): OpenShiftCardView {
  const claimable = isOpenShiftClaimable(card, now);
  const state = resolveOpenState(card.feed, claimable);
  const start = card.start;
  const end = card.end;
  const meta =
    state === 'permanent'
      ? card.weeksRemaining !== null
        ? `${String(card.weeksRemaining)} weeks remaining`
        : null
      : state === 'unpickable'
        ? 'Locked, within 2h of start'
        : null;
  const actionLabel = state === 'permanent' ? 'Pick up' : state === 'open' ? 'Claim' : null;
  return {
    id: card.id,
    blockIds: card.blockIds,
    houseId: card.houseId,
    houseName: card.houseName,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    feed: card.feed,
    state,
    homeHouse: card.homeHouse,
    count: card.count,
    weeksRemaining: card.weeksRemaining,
    timeLabel: timeLabel(start, end),
    dayLabel: dayLabel(start, state === 'permanent'),
    durationLabel: durationLabel(start, end),
    meta,
    actionLabel,
    slot: card.feed === 'permanent_opening' ? permanentSlot(card) : null,
  };
}

export async function getOpenShiftsBoard(userId: string, now: Date): Promise<OpenShiftsBoard> {
  const supabase = await createClient();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data: rows } = await supabase
    .from('worker_open_shifts')
    .select(
      'id, house_id, house_name, start_at, end_at, feed, home_house, weeks_remaining, coverage_locked, desk_covered',
    )
    .eq('eligible_user_id', userId)
    .lt('start_at', windowEnd.toISOString())
    .order('start_at', { ascending: true });

  const blocks: OpenShiftBlock[] = ((rows ?? []) as WireRow[]).map((r) => ({
    id: r.id,
    houseId: r.house_id,
    houseName: r.house_name,
    start: new Date(r.start_at),
    end: new Date(r.end_at),
    feed: (r.feed === 'permanent_opening' ? 'permanent_opening' : 'weekly') as OpenFeed,
    homeHouse: r.home_house,
    weeksRemaining: r.weeks_remaining,
    deskCovered: r.desk_covered,
    coverageLocked: r.coverage_locked,
  }));

  const cards = coalesceOpenShifts(blocks).map((c) => toView(c, now));

  // Current-week held hours (claim meter). One row per 30-minute held block.
  const { start, end } = weekRange(now, 0);
  const { count } = await supabase
    .from('worker_my_shifts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('dropped_still_open', false)
    .gte('start_at', start.toISOString())
    .lt('start_at', end.toISOString());

  return { cards, currentWeekHours: (count ?? 0) * 0.5, hoursCap: SOFT_HOURS_CAP };
}
