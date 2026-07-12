import { ackDeadline, canRespondToFloat, isAckUrgent, minutesToRespond } from '@shift/core';

import { createClient } from '../../supabase/server';

// ===========================================================================
// Worker "Updates" — inbound float requests (BSpec §7.1).
//
// Pending floats (worker_pending_floats) drive the prominent accept/decline carousel;
// resolved floats from the last 24h (worker_recent_floats) drive the de-emphasised
// history. A float is respondable only STRICTLY before its ack deadline (T-10m before the
// float start, @shift/core); at/after the deadline it is being reassigned. Both views are
// bounded (immune to PostgREST's 1000-row truncation — the old "wrong time" float bug).
// ===========================================================================

const NY = 'America/New_York';

export type FloatRequestView = {
  floatId: string;
  destinationHouseId: string;
  destinationHouseName: string;
  startIso: string;
  endIso: string;
  whenLabel: string;
  timeLabel: string;
  durationLabel: string;
  /** "Respond before 20:20" — the ack deadline (T-10m). */
  acceptByLabel: string;
  minutesLeft: number;
  urgent: boolean;
  respondable: boolean;
};

export type RecentFloatView = {
  floatId: string;
  destinationHouseName: string;
  timeLabel: string;
  status: string;
  statusLabel: string;
};

export type UpdatesBoard = {
  pending: FloatRequestView[];
  recent: RecentFloatView[];
};

type PendingWire = {
  float_id: string;
  destination_house_id: string;
  destination_house_name: string;
  float_start: string;
  float_end: string;
};

type RecentWire = {
  float_id: string;
  destination_house_name: string;
  float_start: string;
  float_end: string;
  status: string;
};

function timeFmt(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function timeLabel(start: Date, end: Date): string {
  const f = timeFmt();
  return `${f.format(start)} - ${f.format(end)}`;
}

function durationLabel(start: Date, end: Date): string {
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${String(h)}h ${String(m)}m`;
  if (h > 0) return `${String(h)}h`;
  return `${String(m)}m`;
}

function whenLabel(start: Date, now: Date): string {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  if (dateFmt.format(start) === dateFmt.format(now)) return 'Today';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);
}

function statusLabel(status: string): string {
  switch (status) {
    case 'acknowledged':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'voided':
      return 'Reassigned';
    default:
      return status;
  }
}

export async function getUpdatesBoard(userId: string, now: Date): Promise<UpdatesBoard> {
  const supabase = await createClient();

  const [{ data: pendingRows }, { data: recentRows }] = await Promise.all([
    supabase
      .from('worker_pending_floats')
      .select('float_id, destination_house_id, destination_house_name, float_start, float_end')
      .eq('user_id', userId)
      .order('float_start', { ascending: true }),
    supabase
      .from('worker_recent_floats')
      .select('float_id, destination_house_name, float_start, float_end, status')
      .eq('user_id', userId)
      .order('resolved_at', { ascending: false }),
  ]);

  const pending: FloatRequestView[] = ((pendingRows ?? []) as PendingWire[]).map((r) => {
    const start = new Date(r.float_start);
    const end = new Date(r.float_end);
    return {
      floatId: r.float_id,
      destinationHouseId: r.destination_house_id,
      destinationHouseName: r.destination_house_name,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      whenLabel: whenLabel(start, now),
      timeLabel: timeLabel(start, end),
      durationLabel: durationLabel(start, end),
      acceptByLabel: `Respond before ${timeFmt().format(ackDeadline(start))}`,
      minutesLeft: minutesToRespond(start, now),
      urgent: isAckUrgent(start, now),
      respondable: canRespondToFloat(start, now),
    };
  });

  const recent: RecentFloatView[] = ((recentRows ?? []) as RecentWire[]).map((r) => ({
    floatId: r.float_id,
    destinationHouseName: r.destination_house_name,
    timeLabel: timeLabel(new Date(r.float_start), new Date(r.float_end)),
    status: r.status,
    statusLabel: statusLabel(r.status),
  }));

  return { pending, recent };
}

// The bell badge count: pending floats the worker can still act on (respondable).
export async function getUpdatesBadgeCount(userId: string, now: Date): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('worker_pending_floats')
    .select('float_start')
    .eq('user_id', userId);
  return ((data ?? []) as { float_start: string }[]).filter((r) =>
    canRespondToFloat(new Date(r.float_start), now),
  ).length;
}
