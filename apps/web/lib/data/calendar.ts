import type { EscalationStep } from '../../components/ui';
import { createServiceClient } from '../supabase/server';

// ===========================================================================
// Live house calendar — READ model (presentation + wiring over EXISTING data).
//
// Reskin of the design centerpiece (apps/web/design/admin-web.html screen 03/04).
// This is a NEW screen, so per the reskin rules it builds ONLY a read layer over
// data that already exists: shift_blocks + shift_block_assignments + users +
// user_roles + houses + block_step_status. It invents NO backend.
//
// The inline-OVERRIDE writes the design shows (reassign / remove / force-trigger /
// route-to-HMOD, this-week-vs-permanent) have no backing RPC and are NOT wired —
// the detail panel surfaces them as a flagged, disabled section. See
// apps/web/design/DESIGN_TOKENS.md §6.
//
// Uses the service client (RLS-safe server snapshot) — the same authorized pattern
// as lib/data/scheduleBuilder.ts: an SM/HM viewing their house needs worker names,
// and people-admin RLS on users/user_roles is HM/BM-only. The caller scopes to the
// user's own house.
// ===========================================================================

const NY = 'America/New_York';
const DAY_START_MIN = 8 * 60; // 08:00
export const BLOCKS_PER_DAY = 32; // 08:00 → 24:00 in 30-min blocks

// The calendar's visual state for a card — maps onto the shift-state palette.
export type CalState =
  | 'scheduled'
  | 'floatin'
  | 'pickup' // picked up at home desk (default card + pickup dot)
  | 'xpickup' // cross-house pickup (green + pickup dot)
  | 'pending-in'
  | 'allied'
  | 'gap'
  | 'perm-gap';

export type CalShift = {
  id: string;
  dayIndex: number; // 0=Mon … 6=Sun
  lane: number;
  startBlock: number; // 0..31 (08:00 = 0)
  endBlock: number; // exclusive
  state: CalState;
  userId: string | null;
  workerName: string | null;
  workerPhone: string | null;
  workerRole: string | null;
  homeHouse: string | null; // for float-in / cross-house pickup
  escalationStep: EscalationStep | null; // for gaps / pending
};

export type CalendarDay = {
  index: number;
  label: string; // Mon, Tue …
  date: string; // e.g. "Feb 2"
  dateKey: string; // YYYY-MM-DD (NY)
  isToday: boolean;
};

export type CalendarModel = {
  houseId: string;
  houseName: string;
  restricted: boolean;
  weekStartDate: string; // Monday YYYY-MM-DD (NY)
  isPast: boolean;
  isFuture: boolean;
  days: CalendarDay[];
  lanes: number;
  shifts: CalShift[];
  hasBlocks: boolean;
};

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- NY wall-clock helpers (DST-safe via Intl, mirroring scheduleBuilder.ts) ---
function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function nyMinutes(iso: string): number {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// The Monday (NY) of the week containing `date`.
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  const dow = at.getUTCDay(); // 0=Sun..6=Sat
  at.setUTCDate(at.getUTCDate() - ((dow + 6) % 7));
  return at.toISOString().slice(0, 10);
}

// Today's date in NY ('YYYY-MM-DD'), via the provided clock (defaults to now).
export function nyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function dayLabelParts(dateKey: string): { date: string } {
  const [, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return { date: `${MON[m - 1]} ${d}` };
}

type AssignmentRow = {
  block_id: string;
  status: string;
  user_id: string | null;
  vacancy_origin: string;
  is_float: boolean;
  is_cross_house_pickup: boolean;
  source_house_id: string | null;
};

type Atom = {
  state: CalState;
  userId: string | null;
  homeHouse: string | null;
  escalationStep: EscalationStep | null;
};

// DB assignment → the desk-presence atom shown on the HOUSE calendar. Returns null
// for rows that do not represent presence/vacancy at THIS desk (floated_out /
// pending_float_out — that worker is staffing elsewhere; their seat shows as the
// covering float-in or a vacant block).
function toAtom(a: AssignmentRow, escalationStep: EscalationStep | null): Atom | null {
  switch (a.status) {
    case 'vacant':
      return {
        state: a.vacancy_origin === 'permanent_drop' ? 'perm-gap' : 'gap',
        userId: null,
        homeHouse: null,
        escalationStep,
      };
    case 'allied':
      return { state: 'allied', userId: null, homeHouse: null, escalationStep };
    case 'floated_in':
      return {
        state: 'floatin',
        userId: a.user_id,
        homeHouse: a.source_house_id,
        escalationStep: null,
      };
    case 'pending_float_in':
      return {
        state: 'pending-in',
        userId: a.user_id,
        homeHouse: a.source_house_id,
        escalationStep,
      };
    case 'scheduled':
    case 'claimed':
      if (a.is_cross_house_pickup) {
        return {
          state: 'xpickup',
          userId: a.user_id,
          homeHouse: a.source_house_id,
          escalationStep: null,
        };
      }
      return { state: 'scheduled', userId: a.user_id, homeHouse: null, escalationStep: null };
    default:
      return null; // floated_out / pending_float_out
  }
}

function mapStep(stepName: string | null): EscalationStep | null {
  if (stepName === null) return null;
  if (stepName.includes('hmod') || stepName.includes('allied')) return 'allied';
  if (stepName.includes('float')) return 'float';
  return 'broadcast';
}

// Greedy interval-partition: place each span in the first lane free at its start,
// so a worker's run keeps one column and concurrent shifts stack.
function assignLanes(spans: Omit<CalShift, 'lane'>[]): CalShift[] {
  const laneEnds: number[] = [];
  const ordered = [...spans].sort((x, y) => x.startBlock - y.startBlock || x.endBlock - y.endBlock);
  return ordered.map((s) => {
    let lane = laneEnds.findIndex((end) => end <= s.startBlock);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endBlock);
    } else {
      laneEnds[lane] = s.endBlock;
    }
    return { ...s, lane };
  });
}

// Pure transform: block-level assignment atoms → coalesced, lane-assigned spanning
// cards for one week. Exported for reuse/testing; no I/O.
export function buildShifts(
  perDayBlocks: Map<number, Map<number, Atom[]>>, // day → blockIndex → atoms
): CalShift[] {
  const all: CalShift[][] = [];

  for (const [dayIndex, byBlock] of perDayBlocks) {
    const spans: Omit<CalShift, 'lane'>[] = [];

    // Worker spans: coalesce consecutive blocks with the same worker + state.
    const byWorker = new Map<string, { block: number; atom: Atom }[]>();
    // Anonymous (gap / perm-gap / allied) seats counted per block, per state.
    const anonCount = new Map<
      CalState,
      Map<number, { count: number; step: EscalationStep | null }>
    >();

    for (const [blockIndex, atoms] of byBlock) {
      for (const atom of atoms) {
        if (atom.userId !== null) {
          const key = `${atom.userId}|${atom.state}|${atom.homeHouse ?? ''}`;
          (byWorker.get(key) ?? byWorker.set(key, []).get(key)!).push({ block: blockIndex, atom });
        } else {
          const perState =
            anonCount.get(atom.state) ?? anonCount.set(atom.state, new Map()).get(atom.state)!;
          const cur = perState.get(blockIndex) ?? { count: 0, step: atom.escalationStep };
          perState.set(blockIndex, { count: cur.count + 1, step: cur.step ?? atom.escalationStep });
        }
      }
    }

    // Worker runs.
    for (const items of byWorker.values()) {
      items.sort((a, b) => a.block - b.block);
      let i = 0;
      while (i < items.length) {
        let j = i;
        while (j + 1 < items.length && items[j + 1]!.block === items[j]!.block + 1) j++;
        const head = items[i]!.atom;
        spans.push({
          id: `${dayIndex}-w-${head.userId}-${items[i]!.block}`,
          dayIndex,
          startBlock: items[i]!.block,
          endBlock: items[j]!.block + 1,
          state: head.state,
          userId: head.userId,
          workerName: null,
          workerPhone: null,
          workerRole: null,
          homeHouse: head.homeHouse,
          escalationStep: null,
        });
        i = j + 1;
      }
    }

    // Anonymous seat tracks: for each state, peel off tracks so c_b seats at block b
    // become c_b stacked spans, coalescing consecutive blocks per track.
    for (const [state, perBlock] of anonCount) {
      const maxCount = Math.max(...[...perBlock.values()].map((v) => v.count), 0);
      for (let track = 0; track < maxCount; track++) {
        const blocks = [...perBlock.entries()]
          .filter(([, v]) => v.count > track)
          .map(([b, v]) => ({ b, step: v.step }))
          .sort((a, b) => a.b - b.b);
        let i = 0;
        while (i < blocks.length) {
          let j = i;
          while (j + 1 < blocks.length && blocks[j + 1]!.b === blocks[j]!.b + 1) j++;
          spans.push({
            id: `${dayIndex}-${state}-${track}-${blocks[i]!.b}`,
            dayIndex,
            startBlock: blocks[i]!.b,
            endBlock: blocks[j]!.b + 1,
            state,
            userId: null,
            workerName: null,
            workerPhone: null,
            workerRole: null,
            homeHouse: null,
            escalationStep: blocks[i]!.step,
          });
          i = j + 1;
        }
      }
    }

    all.push(assignLanes(spans));
  }

  return all.flat();
}

export async function getHouseCalendar(
  houseId: string,
  weekStartDate: string,
  now: Date = new Date(),
): Promise<CalendarModel> {
  const supabase = createServiceClient();
  const weekEnd = addDays(weekStartDate, 7);
  const today = nyToday(now);
  const thisWeekMon = mondayOf(today);

  const days: CalendarDay[] = Array.from({ length: 7 }, (_, i) => {
    const dateKey = addDays(weekStartDate, i);
    return {
      index: i,
      label: DOW[i]!,
      date: dayLabelParts(dateKey).date,
      dateKey,
      isToday: dateKey === today,
    };
  });

  const base: CalendarModel = {
    houseId,
    houseName: houseId,
    restricted: houseId === 'harnwell',
    weekStartDate,
    isPast: weekStartDate < thisWeekMon,
    isFuture: weekStartDate > thisWeekMon,
    days,
    lanes: 1,
    shifts: [],
    hasBlocks: false,
  };

  // House name.
  const { data: house } = await supabase
    .from('houses')
    .select('id, name')
    .eq('id', houseId)
    .maybeSingle();
  if (house) base.houseName = house.name;

  // Blocks for the house in (a generous UTC envelope around) the NY week, then
  // filter precisely by NY date to avoid DST edge math.
  const { data: blockRows } = await supabase
    .from('shift_blocks')
    .select('block_id, block_start_at, required_headcount')
    .eq('house_id', houseId)
    .gte('block_start_at', `${weekStartDate}T00:00:00.000Z`)
    .lt('block_start_at', `${weekEnd}T12:00:00.000Z`)
    .order('block_start_at');

  const weekBlocks = (blockRows ?? []).filter((b) => {
    const d = nyDate(b.block_start_at);
    return d >= weekStartDate && d < weekEnd;
  });
  if (weekBlocks.length === 0) return base;

  const blockMeta = new Map<string, { dayIndex: number; blockIndex: number }>();
  let maxHeadcount = 1;
  for (const b of weekBlocks) {
    const dateKey = nyDate(b.block_start_at);
    const dayIndex = days.findIndex((d) => d.dateKey === dateKey);
    const blockIndex = Math.round((nyMinutes(b.block_start_at) - DAY_START_MIN) / 30);
    if (dayIndex < 0 || blockIndex < 0 || blockIndex >= BLOCKS_PER_DAY) continue;
    blockMeta.set(b.block_id, { dayIndex, blockIndex });
    maxHeadcount = Math.max(maxHeadcount, b.required_headcount);
  }
  const blockIds = [...blockMeta.keys()];

  // Assignments + escalation steps for these blocks.
  const { data: asgRows } = await supabase
    .from('shift_block_assignments')
    .select(
      'block_id, status, user_id, vacancy_origin, is_float, is_cross_house_pickup, source_house_id',
    )
    .in('block_id', blockIds);
  const assignments = (asgRows ?? []) as AssignmentRow[];

  const { data: stepRows } = await supabase
    .from('block_step_status')
    .select('block_id, step_name, fired_at')
    .in('block_id', blockIds)
    .order('fired_at', { ascending: true });
  const stepByBlock = new Map<string, EscalationStep | null>();
  for (const s of stepRows ?? []) stepByBlock.set(s.block_id, mapStep(s.step_name));

  // Worker identities (name, phone, home, role) — service-client read.
  const userIds = [
    ...new Set(assignments.map((a) => a.user_id).filter((x): x is string => x !== null)),
  ];
  const usersById = new Map<string, { name: string; phone: string | null; home: string }>();
  const roleById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: userRows } = await supabase
      .from('users')
      .select('user_id, name, phone, home_house_id')
      .in('user_id', userIds);
    for (const u of userRows ?? []) {
      usersById.set(u.user_id, { name: u.name, phone: u.phone, home: u.home_house_id });
    }
    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', userIds);
    const rank = ['bm', 'hm', 'sm', 'sw'];
    for (const r of roleRows ?? []) {
      const prev = roleById.get(r.user_id);
      if (prev === undefined || rank.indexOf(r.role) < rank.indexOf(prev))
        roleById.set(r.user_id, r.role);
    }
  }

  // Group atoms by day → block.
  const perDay = new Map<number, Map<number, Atom[]>>();
  for (const a of assignments) {
    const meta = blockMeta.get(a.block_id);
    if (!meta) continue;
    const atom = toAtom(a, stepByBlock.get(a.block_id) ?? null);
    if (!atom) continue;
    const byBlock =
      perDay.get(meta.dayIndex) ?? perDay.set(meta.dayIndex, new Map()).get(meta.dayIndex)!;
    (byBlock.get(meta.blockIndex) ?? byBlock.set(meta.blockIndex, []).get(meta.blockIndex)!).push(
      atom,
    );
  }

  const spans = buildShifts(perDay);
  // Hydrate worker identity onto the spans (kept out of the pure transform).
  const shifts: CalShift[] = spans.map((s) => {
    const u = s.userId ? usersById.get(s.userId) : undefined;
    return {
      ...s,
      workerName: u?.name ?? null,
      workerPhone: u?.phone ?? null,
      workerRole: s.userId ? (roleById.get(s.userId) ?? null) : null,
    };
  });

  const lanes = Math.max(maxHeadcount, ...shifts.map((s) => s.lane + 1), 1);
  return { ...base, lanes, shifts, hasBlocks: true };
}
