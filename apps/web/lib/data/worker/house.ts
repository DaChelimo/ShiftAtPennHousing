import { nyMidnightIso } from '../../nyTime';
import { createClient } from '../../supabase/server';

// ===========================================================================
// Worker cross-house view (BSpec §11.4) — READ ONLY.
//
// Any authenticated worker may view any house's schedule. Reads `house_schedule_grid_any`
// (owner-rights view: bypasses the home-house RLS by design; the APP scopes by the
// selected house). Present seats + vacant gaps for a chosen NY day, coalesced per worker
// into agenda rows, with the desk phone for tap-to-dial. No write path.
// ===========================================================================

const NY = 'America/New_York';
const PRESENT = new Set(['scheduled', 'claimed', 'floated_in', 'pending_float_in']);

export type HouseOption = { id: string; name: string };

export type HouseAgendaRow = {
  id: string;
  startIso: string;
  endIso: string;
  timeLabel: string;
  workerName: string | null;
  vacant: boolean;
  isFloat: boolean;
};

export type HouseViewBoard = {
  houses: HouseOption[];
  selectedHouseId: string;
  selectedHouseName: string;
  deskPhone: string | null;
  dateIso: string;
  dateLabel: string;
  dayOffset: number;
  rows: HouseAgendaRow[];
};

type GridWire = {
  id: string;
  house_name: string;
  desk_phone: string | null;
  start_at: string;
  end_at: string;
  status: string;
  is_float: boolean;
  user_id: string | null;
  worker_name: string | null;
};

function nyDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// NY midnight (as a UTC instant) for the calendar day `dayOffset` from `now`, DST-correct.
function nyDayStart(now: Date, dayOffset: number): Date {
  const shifted = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const iso = nyMidnightIso(nyDate(shifted));
  return iso === null ? shifted : new Date(iso);
}

function timeLabel(start: Date, end: Date): string {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${f.format(start)} - ${f.format(end)}`;
}

// Merge consecutive same-worker (or same-vacant) blocks into one agenda row.
function coalesceRows(rows: GridWire[]): HouseAgendaRow[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const out: HouseAgendaRow[] = [];
  for (const r of sorted) {
    const start = new Date(r.start_at);
    const end = new Date(r.end_at);
    const vacant = !PRESENT.has(r.status);
    const workerName = vacant ? null : r.worker_name;
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      new Date(prev.endIso).getTime() === start.getTime() &&
      prev.vacant === vacant &&
      prev.workerName === workerName &&
      prev.isFloat === r.is_float
    ) {
      prev.endIso = end.toISOString();
      prev.timeLabel = timeLabel(new Date(prev.startIso), end);
    } else {
      out.push({
        id: r.id,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        timeLabel: timeLabel(start, end),
        workerName,
        vacant,
        isFloat: r.is_float,
      });
    }
  }
  return out;
}

export async function getHouseViewBoard(
  now: Date,
  requestedHouseId: string | null,
  homeHouseId: string,
  dayOffset: number,
): Promise<HouseViewBoard> {
  const supabase = await createClient();

  // Worker cross-house switcher only lists LIVE houses (staggered-launch gate);
  // worker_visible_houses applies house_is_live() so dark houses stay hidden.
  const { data: houseRows } = await supabase
    .from('worker_visible_houses')
    .select('id, name')
    .order('name');
  const houses: HouseOption[] = (houseRows ?? []) as HouseOption[];
  const selectedHouseId =
    requestedHouseId !== null && houses.some((h) => h.id === requestedHouseId)
      ? requestedHouseId
      : homeHouseId;

  const dayStart = nyDayStart(now, dayOffset);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const { data: gridRows } = await supabase
    .from('house_schedule_grid_any')
    .select('id, house_name, desk_phone, start_at, end_at, status, is_float, user_id, worker_name')
    .eq('house_id', selectedHouseId)
    .gte('start_at', dayStart.toISOString())
    .lt('start_at', dayEnd.toISOString())
    .order('start_at', { ascending: true });

  const wire = (gridRows ?? []) as GridWire[];
  const rows = coalesceRows(wire);
  const first = wire[0];

  return {
    houses,
    selectedHouseId,
    selectedHouseName: first?.house_name ?? houses.find((h) => h.id === selectedHouseId)?.name ?? selectedHouseId,
    deskPhone: first?.desk_phone ?? null,
    dateIso: dayStart.toISOString(),
    dateLabel: new Intl.DateTimeFormat('en-US', {
      timeZone: NY,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(dayStart),
    dayOffset,
    rows,
  };
}
