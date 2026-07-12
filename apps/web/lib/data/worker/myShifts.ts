import {
  coalesceMyShifts,
  myShiftCardState,
  partitionMyShifts,
  weekRange,
  type MyShiftBlock,
  type MyShiftCard,
  type MyShiftKind,
  type MyShiftState,
} from '@shift/core';

import { createClient } from '../../supabase/server';

// ===========================================================================
// Worker "My Shifts" — READ model (the SW's own held assignments, week-scoped).
//
// Reads the RLS-scoped `worker_my_shifts` view (one row per 30-minute block) for the
// shown NY week, coalesces contiguous blocks into displayed cards (@shift/core), and
// partitions them into Scheduled / Picked up / Dropped subsections — the web analogue of
// the mobile My-Shifts tab. Week navigation carries a `weekOffset` like the mobile tab.
//
// Read as the signed-in worker: the view is security_invoker and self-scopes, so it only
// ever returns their rows.
// ===========================================================================

const NY = 'America/New_York';

/** The recurring-slot descriptor a permanent drop needs (permanent-drop EF contract). */
export type PermanentSlot = {
  houseId: string;
  dayOfWeek: number; // 0=Sun..6=Sat (NY)
  blockStartLocals: string[]; // "HH:MM" on 30-minute boundaries
};

export type MyShiftCardView = {
  id: string;
  blockIds: string[];
  houseId: string;
  houseName: string;
  /** ISO instants (serializable across the server/client boundary). */
  startIso: string;
  endIso: string;
  kind: MyShiftKind;
  state: MyShiftState;
  crossHouse: boolean;
  pending: boolean;
  breakShift: boolean;
  droppedStillOpen: boolean;
  timeLabel: string;
  dayLabel: string;
  durationLabel: string;
  /** Present for own recurring (scheduled) shifts: the slot a permanent drop targets. */
  slot: PermanentSlot | null;
};

export type MyShiftsBoard = {
  weekOffset: number;
  weekRangeLabel: string;
  weekHours: number;
  scheduled: MyShiftCardView[];
  pickedUp: MyShiftCardView[];
  dropped: MyShiftCardView[];
};

type WireRow = {
  id: string;
  house_id: string;
  house_name: string;
  start_at: string;
  end_at: string;
  kind: string;
  cross_house: boolean;
  pending: boolean;
  break_shift: boolean;
  dropped_still_open: boolean;
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

function dayLabel(start: Date): string {
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

// The recurring slot for an own scheduled shift, NY-anchored (permanent-drop EF contract).
function permanentSlot(card: MyShiftCard): PermanentSlot {
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short' }).format(card.start);
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const blockStartLocals = card.blockIds.map((_id, i) =>
    timeFmt.format(new Date(card.start.getTime() + i * 30 * 60 * 1000)),
  );
  return { houseId: card.houseId, dayOfWeek: dowNames.indexOf(dow), blockStartLocals };
}

function toView(card: MyShiftCard): MyShiftCardView {
  return {
    id: card.id,
    blockIds: card.blockIds,
    houseId: card.houseId,
    houseName: card.houseName,
    startIso: card.start.toISOString(),
    endIso: card.end.toISOString(),
    kind: card.kind,
    state: myShiftCardState(card),
    crossHouse: card.crossHouse,
    pending: card.pending,
    breakShift: card.breakShift,
    droppedStillOpen: card.droppedStillOpen,
    timeLabel: timeLabel(card.start, card.end),
    dayLabel: dayLabel(card.start),
    durationLabel: durationLabel(card.start, card.end),
    slot: card.kind === 'scheduled' && !card.droppedStillOpen ? permanentSlot(card) : null,
  };
}

function weekRangeLabel(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, month: 'short', day: 'numeric' });
  // `end` is next Monday 00:00 — label the inclusive Sunday.
  const lastDay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return `${fmt.format(start)} to ${fmt.format(lastDay)}`;
}

export async function getMyShiftsBoard(
  userId: string,
  now: Date,
  weekOffset: number,
): Promise<MyShiftsBoard> {
  const supabase = await createClient();
  const { start, end } = weekRange(now, weekOffset);

  const { data: rows } = await supabase
    .from('worker_my_shifts')
    .select(
      'id, house_id, house_name, start_at, end_at, kind, cross_house, pending, break_shift, dropped_still_open',
    )
    .eq('user_id', userId)
    .gte('start_at', start.toISOString())
    .lt('start_at', end.toISOString())
    .order('start_at', { ascending: true });

  const blocks: MyShiftBlock[] = ((rows ?? []) as WireRow[]).map((r) => ({
    id: r.id,
    houseId: r.house_id,
    houseName: r.house_name,
    start: new Date(r.start_at),
    end: new Date(r.end_at),
    kind: (r.kind === 'temp_pickup' || r.kind === 'float_out' ? r.kind : 'scheduled') as MyShiftKind,
    crossHouse: r.cross_house,
    pending: r.pending,
    breakShift: r.break_shift,
    droppedStillOpen: r.dropped_still_open,
  }));

  const cards = coalesceMyShifts(blocks);
  const { scheduled, pickedUp, dropped } = partitionMyShifts(cards);

  // Held hours = every 30-minute block the worker is on this week (each card's blockIds).
  const weekHours = cards.reduce((sum, c) => sum + c.blockIds.length, 0) * 0.5;

  return {
    weekOffset,
    weekRangeLabel: weekRangeLabel(start, end),
    weekHours,
    scheduled: scheduled.map(toView),
    pickedUp: pickedUp.map(toView),
    dropped: dropped.map(toView),
  };
}
