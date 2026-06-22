import type { EscalationStep } from '../../components/ui';
import { createServiceClient } from '../supabase/server';

import { selectByBlockIdChunks } from './blockChunks';

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
  // The real DB block UUIDs backing this coalesced card — the unit the admin
  // override RPCs (admin_assign_worker / admin_remove_worker) act on. `id` above
  // is a synthetic span key; these are the load-bearing identifiers (S1).
  blockIds: string[];
  startAtIso: string; // first block's start (ISO timestamptz)
  dateKey: string; // the card's NY date (YYYY-MM-DD)
};

export type CalendarDay = {
  index: number;
  label: string; // Mon, Tue …
  date: string; // e.g. "Feb 2"
  dateKey: string; // YYYY-MM-DD (NY)
  isToday: boolean;
  // §3.4/§11.3: this house is CLOSED for this date (derived server-side from the
  // operating-calendar + staffing via house_closure(p_house_id, p_on_date)). A
  // closed day shows a "Closed" cell instead of the shift grid — no shifts, no
  // open-shifts feed.
  closed: boolean;
};

// Same-house roster for the inline-override worker picker (S1). Filtered to this
// house's home workers (so a Harnwell calendar naturally offers only Harnwell-home
// workers — training satisfied by construction, TEST_PLAN D8) and to active users.
// `weeklyHours` is the worker's held hours across the viewed NY week (all houses) —
// the decision-relevant number the Replace cards show against the week's soft cap.
export type AssignableWorker = {
  userId: string;
  name: string;
  isActive: boolean;
  weeklyHours: number;
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
  assignableWorkers: AssignableWorker[];
  // Campus-wide weekly cap for the viewed week (§9.3). The Replace cards show each
  // candidate's headroom against it; `enforcement` is 'hard' during breaks.
  softCapHours: number;
  capEnforcement: 'soft' | 'hard';
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

// The week the calendar should open on for a house when no ?week is given.
// Defaults to the current week, but CLAMPS into the house's scheduled range so a
// manager landing here outside the term (e.g. today is the Sun before the term
// starts) lands on the first scheduled week instead of a blank grid. Returns the
// current week unchanged when the house has no blocks at all.
export async function defaultCalendarWeek(
  houseId: string,
  now: Date = new Date(),
): Promise<string> {
  const supabase = createServiceClient();
  const thisMonday = mondayOf(nyToday(now));

  const [{ data: firstRow }, { data: lastRow }] = await Promise.all([
    supabase
      .from('shift_blocks')
      .select('block_start_at')
      .eq('house_id', houseId)
      .order('block_start_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('shift_blocks')
      .select('block_start_at')
      .eq('house_id', houseId)
      .order('block_start_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (firstRow == null || lastRow == null) return thisMonday; // no schedule yet

  const firstMonday = mondayOf(nyDate(firstRow.block_start_at));
  const lastMonday = mondayOf(nyDate(lastRow.block_start_at));
  if (thisMonday < firstMonday) return firstMonday;
  if (thisMonday > lastMonday) return lastMonday;
  return thisMonday;
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

// PostgREST embeds a many-to-one relation as either an object or a 1-element array
// depending on the inference; normalize when reading the candidate's weekly hours.
type EmbeddedBlock = { block_start_at: string };
type HoursRow = { user_id: string | null; shift_blocks: EmbeddedBlock | EmbeddedBlock[] | null };
function embeddedStartAt(row: HoursRow): string | null {
  const sb = row.shift_blocks;
  if (sb === null) return null;
  return Array.isArray(sb) ? (sb[0]?.block_start_at ?? null) : sb.block_start_at;
}

type Atom = {
  state: CalState;
  userId: string | null;
  homeHouse: string | null;
  escalationStep: EscalationStep | null;
  blockId: string; // the DB block UUID this atom sits on
  startAtIso: string; // that block's start (ISO)
};

// DB assignment → the desk-presence atom shown on the HOUSE calendar. Returns null
// for rows that do not represent presence/vacancy at THIS desk (floated_out /
// pending_float_out — that worker is staffing elsewhere; their seat shows as the
// covering float-in or a vacant block).
function toAtom(
  a: AssignmentRow,
  escalationStep: EscalationStep | null,
  startAtIso: string,
): Atom | null {
  const id = { blockId: a.block_id, startAtIso };
  switch (a.status) {
    case 'vacant':
      return {
        state: a.vacancy_origin === 'permanent_drop' ? 'perm-gap' : 'gap',
        userId: null,
        homeHouse: null,
        escalationStep,
        ...id,
      };
    case 'allied':
      return { state: 'allied', userId: null, homeHouse: null, escalationStep, ...id };
    case 'floated_in':
      return {
        state: 'floatin',
        userId: a.user_id,
        homeHouse: a.source_house_id,
        escalationStep: null,
        ...id,
      };
    case 'pending_float_in':
      return {
        state: 'pending-in',
        userId: a.user_id,
        homeHouse: a.source_house_id,
        escalationStep,
        ...id,
      };
    case 'scheduled':
    case 'claimed':
      if (a.is_cross_house_pickup) {
        return {
          state: 'xpickup',
          userId: a.user_id,
          homeHouse: a.source_house_id,
          escalationStep: null,
          ...id,
        };
      }
      return {
        state: 'scheduled',
        userId: a.user_id,
        homeHouse: null,
        escalationStep: null,
        ...id,
      };
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
    // Anonymous (gap / perm-gap / allied) seats per block, per state — the atom
    // list (not just a count) so each peeled track keeps a real DB block id.
    const anonByState = new Map<CalState, Map<number, Atom[]>>();

    for (const [blockIndex, atoms] of byBlock) {
      for (const atom of atoms) {
        if (atom.userId !== null) {
          const key = `${atom.userId}|${atom.state}|${atom.homeHouse ?? ''}`;
          (byWorker.get(key) ?? byWorker.set(key, []).get(key)!).push({ block: blockIndex, atom });
        } else {
          const perState =
            anonByState.get(atom.state) ?? anonByState.set(atom.state, new Map()).get(atom.state)!;
          (perState.get(blockIndex) ?? perState.set(blockIndex, []).get(blockIndex)!).push(atom);
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
        const members = items.slice(i, j + 1).map((it) => it.atom);
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
          blockIds: members.map((m) => m.blockId),
          startAtIso: head.startAtIso,
          dateKey: nyDate(head.startAtIso),
        });
        i = j + 1;
      }
    }

    // Anonymous seat tracks: for each state, peel off tracks so c_b seats at block b
    // become c_b stacked spans, coalescing consecutive blocks per track. Track `t`
    // takes the t-th atom at each block, so each card carries its own DB block ids.
    for (const [state, perBlock] of anonByState) {
      const maxCount = Math.max(...[...perBlock.values()].map((v) => v.length), 0);
      for (let track = 0; track < maxCount; track++) {
        const blocks = [...perBlock.entries()]
          .filter(([, atoms]) => atoms.length > track)
          .map(([b, atoms]) => ({ b, atom: atoms[track]! }))
          .sort((a, b) => a.b - b.b);
        let i = 0;
        while (i < blocks.length) {
          let j = i;
          while (j + 1 < blocks.length && blocks[j + 1]!.b === blocks[j]!.b + 1) j++;
          const members = blocks.slice(i, j + 1).map((x) => x.atom);
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
            blockIds: members.map((m) => m.blockId),
            startAtIso: members[0]!.startAtIso,
            dateKey: nyDate(members[0]!.startAtIso),
            escalationStep: members[0]!.escalationStep,
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

  // §3.4/§11.3: ask the backend which of the week's dates this house is CLOSED for
  // (winter break → only Harnwell open; no-operating-calendar date → all closed).
  // One RPC per column (≤7) is fine; resolve in parallel.
  const dateKeys = Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
  const closedFlags = await Promise.all(
    dateKeys.map(async (dateKey) => {
      const { data } = await supabase.rpc('house_closure', {
        p_house_id: houseId,
        p_on_date: dateKey,
      });
      return data === true;
    }),
  );

  const days: CalendarDay[] = dateKeys.map((dateKey, i) => ({
    index: i,
    label: DOW[i]!,
    date: dayLabelParts(dateKey).date,
    dateKey,
    isToday: dateKey === today,
    closed: closedFlags[i] ?? false,
  }));

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
    assignableWorkers: [],
    softCapHours: 20,
    capEnforcement: 'soft',
  };

  // House name.
  const { data: house } = await supabase
    .from('houses')
    .select('id, name')
    .eq('id', houseId)
    .maybeSingle();
  if (house) base.houseName = house.name;

  // Same-house roster for the inline-override picker (S1). Mirrors people.ts's
  // home_house_id-scoped read; the override RPC rejects a cross-house target, so
  // the picker is filtered to this house (Harnwell ⇒ only Harnwell-home, D8).
  const { data: rosterRows } = await supabase
    .from('users')
    .select('user_id, name, is_active')
    .eq('home_house_id', houseId)
    .order('name');
  const roster = (rosterRows ?? []).filter((u) => u.is_active);
  const rosterIds = roster.map((u) => u.user_id);

  // Per-candidate weekly hours (the Replace cards' decision number) + the campus
  // soft cap for the week. Mirrors lib/data/people.ts: counting-status seats whose
  // block lands in the NY week, summed in JS (×0.5). A ±12h UTC buffer on the query
  // bound keeps it DST-safe; the precise NY-week filter happens in JS. Hours span
  // ALL houses (a home worker may also hold a cross-house pickup that week).
  const hoursByUser = new Map<string, number>();
  if (rosterIds.length > 0) {
    const lo = new Date(
      new Date(`${weekStartDate}T00:00:00Z`).getTime() - 12 * 3600 * 1000,
    ).toISOString();
    const hi = new Date(
      new Date(`${weekEnd}T00:00:00Z`).getTime() + 12 * 3600 * 1000,
    ).toISOString();
    const { data: asg } = await supabase
      .from('shift_block_assignments')
      .select('user_id, shift_blocks!inner(block_start_at)')
      .in('user_id', rosterIds)
      .in('status', ['scheduled', 'claimed', 'floated_in', 'pending_float_in'])
      .gte('shift_blocks.block_start_at', lo)
      .lt('shift_blocks.block_start_at', hi);
    for (const row of (asg ?? []) as unknown as HoursRow[]) {
      const startAt = embeddedStartAt(row);
      if (startAt === null || row.user_id === null) continue;
      const d = nyDate(startAt);
      if (d >= weekStartDate && d < weekEnd) {
        hoursByUser.set(row.user_id, (hoursByUser.get(row.user_id) ?? 0) + 1);
      }
    }
  }
  base.assignableWorkers = roster.map((u) => ({
    userId: u.user_id,
    name: u.name,
    isActive: u.is_active,
    weeklyHours: (hoursByUser.get(u.user_id) ?? 0) * 0.5,
  }));

  // Campus-wide cap for the week (no per-user/house arg — confirmed global).
  const { data: capRows } = await supabase.rpc('effective_weekly_cap', {
    p_week_start_date: weekStartDate,
    p_block_start_at: `${weekStartDate}T00:00:00-05:00`,
  });
  const cap = capRows?.[0];
  if (cap) {
    base.softCapHours = cap.hours_cap;
    base.capEnforcement = cap.cap_enforcement;
  }

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

  const blockMeta = new Map<string, { dayIndex: number; blockIndex: number; startAtIso: string }>();
  let maxHeadcount = 1;
  for (const b of weekBlocks) {
    const dateKey = nyDate(b.block_start_at);
    const dayIndex = days.findIndex((d) => d.dateKey === dateKey);
    const blockIndex = Math.round((nyMinutes(b.block_start_at) - DAY_START_MIN) / 30);
    if (dayIndex < 0 || blockIndex < 0 || blockIndex >= BLOCKS_PER_DAY) continue;
    blockMeta.set(b.block_id, { dayIndex, blockIndex, startAtIso: b.block_start_at });
    maxHeadcount = Math.max(maxHeadcount, b.required_headcount);
  }
  const blockIds = [...blockMeta.keys()];

  // Assignments + escalation steps for these blocks. Chunk the block_id filter —
  // a full week is 224 ids, which 414s ("URI too long") as a single `.in(...)`.
  const assignments = (await selectByBlockIdChunks(blockIds, (chunk) =>
    supabase
      .from('shift_block_assignments')
      .select(
        'block_id, status, user_id, vacancy_origin, is_float, is_cross_house_pickup, source_house_id',
      )
      .in('block_id', chunk),
  )) as AssignmentRow[];

  const stepRows = await selectByBlockIdChunks(blockIds, (chunk) =>
    supabase
      .from('block_step_status')
      .select('block_id, step_name, fired_at')
      .in('block_id', chunk)
      .order('fired_at', { ascending: true }),
  );
  const stepByBlock = new Map<string, EscalationStep | null>();
  for (const s of stepRows) stepByBlock.set(s.block_id, mapStep(s.step_name));

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
    const rank = ['bm', 'hm', 'rsm', 'sm', 'sw'];
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
    const atom = toAtom(a, stepByBlock.get(a.block_id) ?? null, meta.startAtIso);
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
