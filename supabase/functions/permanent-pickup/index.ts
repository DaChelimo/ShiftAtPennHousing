import * as pickupEvaluator from '../_shared/core/permanent-ops/pickup-evaluator.js';
import { authenticate, jsonResponse, readObjectBody, type Supabase } from '../_shared/swap-http.ts';
// Vendored @shift/core -- static so `supabase functions deploy` actually bundles it.
// See scripts/vendor-core-into-functions.mjs.

const TIMEZONE = 'America/New_York';
const WORKED_STATUSES = ['scheduled', 'claimed', 'floated_in', 'pending_float_in'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type SlotDefinition = {
  houseId: string;
  dayOfWeek: number;
  blockStartLocals: string[];
};

type AssignmentSnapshot = {
  block_id: string;
  shift_blocks:
    | { house_id: string; block_start_at: string }
    | Array<{ house_id: string; block_start_at: string }>;
};

type BlockSnapshot = {
  blockId: string;
  houseId: string;
  blockStartAt: string;
};

function nestedOne<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0]! : value;
}

function localParts(at: Date): {
  date: string;
  dayOfWeek: number;
  blockStartLocal: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dayOfWeek,
    blockStartLocal: `${get('hour')}:${get('minute')}`,
  };
}

function weekStartDate(at: Date): string {
  const local = localParts(at).date;
  const date = new Date(`${local}T12:00:00Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function isBlockStartLocal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(value);
}

function parseSlotDefinition(raw: Record<string, unknown>): SlotDefinition | null {
  const houseId = raw.house_id;
  const dayOfWeek = Number(raw.day_of_week);
  const blockStartLocals = Array.isArray(raw.block_start_locals)
    ? raw.block_start_locals
    : typeof raw.block_start_locals === 'string'
      ? raw.block_start_locals.split(',')
      : [];

  if (
    typeof houseId !== 'string' ||
    houseId.length === 0 ||
    !Number.isInteger(dayOfWeek) ||
    dayOfWeek < 0 ||
    dayOfWeek > 6 ||
    blockStartLocals.length === 0 ||
    !blockStartLocals.every(isBlockStartLocal)
  ) {
    return null;
  }

  return { houseId, dayOfWeek, blockStartLocals };
}

/**
 * The end of the current-or-upcoming operating period, WHATEVER its profile (a
 * `regular_school_year` term or a compiled `s_%` season) — widened 2026-07-29 so a
 * recurring SUMMER slot can be picked up for the rest of the season instead of one week
 * at a time. Mirrors `permanent_drop_slot`'s boundary resolution (20260729000003) so the
 * two halves of the same recurrence agree on where it ends; give and take must be
 * symmetric.
 *
 * Earliest not-yet-ended period rather than a BETWEEN point lookup, also matching the
 * drop: it stays correct when `asOf` falls just before a period opens or between two
 * periods. It still throws when no period covers or follows the date, so a pickup is
 * never unbounded.
 */
async function semesterEndDate(supabase: Supabase, asOf: Date): Promise<string> {
  const date = localParts(asOf).date;
  const { data, error } = await supabase
    .from('scheduling_periods')
    .select('end_date')
    .gte('end_date', date)
    .order('start_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) throw new Error('semester_boundary_not_found');
  return data.end_date;
}

async function candidateBlocks(
  supabase: Supabase,
  slot: SlotDefinition,
  asOf: Date,
  endDate: string,
): Promise<BlockSnapshot[]> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('block_id,shift_blocks!inner(house_id,block_start_at)')
    .eq('status', 'vacant')
    .eq('vacancy_origin', 'permanent_drop')
    .eq('shift_blocks.house_id', slot.houseId);

  if (error !== null) throw error;

  // `shift_block_assignments` holds one row per SEAT, so a multi-staff desk
  // (Harnwell required_headcount 2, Quad 3) whose recurring slot was permanently
  // dropped by BOTH of its owners returns the same block_id twice. The pickup scope
  // reasons in BLOCKS — 0.5h each (ARCH §7.2 step 4c) — and the seats of a block are
  // interchangeable, so collapse to one entry per block. Leaving the duplicate in
  // double-counts the occurrence at 1.0h and can wrongly skip the whole week
  // `hours_cap` (§8.4.3). Same "block, not seat" framing as claim_open_shift
  // (20260724000003) and permanent_pickup_slot (20260724000005).
  const distinct = new Map<string, BlockSnapshot>();
  for (const assignment of (data ?? []) as AssignmentSnapshot[]) {
    if (distinct.has(assignment.block_id)) continue;
    const block = nestedOne(assignment.shift_blocks);
    distinct.set(assignment.block_id, {
      blockId: assignment.block_id,
      houseId: block.house_id,
      blockStartAt: block.block_start_at,
    });
  }

  const matching = [...distinct.values()].filter((block) => {
    const at = new Date(block.blockStartAt);
    const local = localParts(at);
    return (
      at.getTime() > asOf.getTime() &&
      local.date <= endDate &&
      local.dayOfWeek === slot.dayOfWeek &&
      slot.blockStartLocals.includes(local.blockStartLocal)
    );
  });

  const dates = [
    ...new Set(matching.map((block) => localParts(new Date(block.blockStartAt)).date)),
  ];
  if (dates.length === 0) return [];

  // Keep only SCHEDULE-BUILT days. Widened 2026-07-29 from
  // `profile_name === 'regular_school_year'` to the profile's MODE, so a summer season's
  // occurrences are pickable as a whole recurrence. Two reasons it is the mode and not a
  // name: a season compiles into SEVERAL phase profiles (s_summer2026_20260601,
  // _20260701, ...), so no single name identifies it; and what the old equality actually
  // excluded was claim-based BREAK days, which have no recurring slot to pick up —
  // `sm_built` keeps exactly that exclusion.
  //
  // This predicate MUST match worker_open_shifts' `schedule_built`
  // (20260729000011) and permanent_drop_slot's occurrence filter (20260729000003).
  // The feed must never advertise a recurrence this function cannot take
  // (20260617000004); the three move together or not at all.
  const { data: calendar, error: calendarError } = await supabase
    .from('operating_calendar')
    .select('date,operating_profiles!inner(scheduling_mode)')
    .in('date', dates)
    .eq('operating_profiles.scheduling_mode', 'sm_built');

  if (calendarError !== null) throw calendarError;
  const scheduleBuiltDates = new Set((calendar ?? []).map((day) => day.date));
  return matching.filter((block) =>
    scheduleBuiltDates.has(localParts(new Date(block.blockStartAt)).date),
  );
}

async function currentAssignments(supabase: Supabase, userId: string): Promise<BlockSnapshot[]> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('block_id,shift_blocks!inner(house_id,block_start_at)')
    .eq('user_id', userId)
    .in('status', WORKED_STATUSES);

  if (error !== null) throw error;
  return ((data ?? []) as AssignmentSnapshot[]).map((assignment) => {
    const block = nestedOne(assignment.shift_blocks);
    return {
      blockId: assignment.block_id,
      houseId: block.house_id,
      blockStartAt: block.block_start_at,
    };
  });
}

async function buildPickupSnapshot(supabase: Supabase, userId: string, slot: SlotDefinition) {
  const asOf = new Date();
  const endDate = await semesterEndDate(supabase, asOf);
  const candidates = await candidateBlocks(supabase, slot, asOf, endDate);
  const assigned = await currentAssignments(supabase, userId);
  const assignedStartTimes = new Set(assigned.map((block) => block.blockStartAt));
  const assignedBlocksByWeek = new Map<string, number>();

  for (const block of assigned) {
    const week = weekStartDate(new Date(block.blockStartAt));
    assignedBlocksByWeek.set(week, (assignedBlocksByWeek.get(week) ?? 0) + 1);
  }

  const candidateBlocksByWeek = new Map<string, BlockSnapshot[]>();
  for (const block of candidates) {
    const week = weekStartDate(new Date(block.blockStartAt));
    candidateBlocksByWeek.set(week, [...(candidateBlocksByWeek.get(week) ?? []), block]);
  }

  const weeks = await Promise.all(
    [...candidateBlocksByWeek.entries()].map(async ([week, blocks]) => {
      const { data: cap, error } = await supabase
        .rpc('effective_weekly_cap', {
          p_week_start_date: week,
          p_block_start_at: blocks[0]!.blockStartAt,
        })
        .single();

      if (error !== null) throw error;
      return {
        weekStartDate: week,
        blocks: blocks.map((block) => ({
          blockId: block.blockId,
          conflictsWithExisting: assignedStartTimes.has(block.blockStartAt),
        })),
        currentWeeklyHours: (assignedBlocksByWeek.get(week) ?? 0) * 0.5,
        capHours: cap.hours_cap,
        capEnforcement: cap.cap_enforcement,
      };
    }),
  );

  weeks.sort((left, right) => left.weekStartDate.localeCompare(right.weekStartDate));
  return pickupEvaluator.evaluatePermanentPickup({ weeks });
}

function queryObject(url: URL): Record<string, unknown> {
  return {
    house_id: url.searchParams.get('house_id'),
    day_of_week: url.searchParams.get('day_of_week'),
    block_start_locals: url.searchParams.get('block_start_locals'),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(req.url);
  if (!/^(?:\/permanent-pickup)?\/permanent-pickup$/.test(url.pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const raw =
    req.method === 'GET'
      ? queryObject(url)
      : await (async () => {
          const parsed = await readObjectBody(req);
          return parsed.ok ? parsed.body : parsed.response;
        })();
  if (raw instanceof Response) return raw;

  const slot = parseSlotDefinition(raw);
  if (slot === null) {
    return jsonResponse(
      { error: 'house_id, day_of_week, and non-empty block_start_locals are required' },
      400,
    );
  }

  try {
    const scope = await buildPickupSnapshot(auth.supabase, auth.userId, slot);
    if (req.method === 'GET') {
      return jsonResponse({ scope });
    }

    const { data, error } = await auth.supabase.rpc('permanent_pickup_slot', {
      p_picking_user_id: auth.userId,
      p_assigned_block_ids: scope.assignedBlockIds,
      p_skipped_block_ids: scope.skippedBlockIds,
    });
    if (error !== null) {
      return jsonResponse({ error: error.message.trim().split(/\s+/)[0] }, 400);
    }

    return jsonResponse({ ...data, scope });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message.trim().split(/\s+/)[0] }, 400);
  }
});
