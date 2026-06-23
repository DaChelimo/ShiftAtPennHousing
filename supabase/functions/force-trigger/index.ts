// Phase 08 — Force-Trigger Pathway endpoint (ARCHITECTURE.md §6).
//
// POST /force-trigger  body: { destination_house_id, block_ids, initiator_user_id }
//
// An SM/HM/BM scoped to the destination house — or the currently-on-duty
// HMOD — invokes the float lookup for a KNOWN coverage gap BEFORE the
// standard escalation timing (T-3h broadcast / T-2h float lookup) would
// fire (BSpec §6.6). The endpoint:
//
//   1. Snapshots DB state (initiator roles + HMOD status, each block's
//      status / start / pending-float-in, the date's float_enabled flag).
//   2. Runs the §6.2 validation gate — packages/core validateForceTrigger —
//      as an atomic pre-flight (reject the whole request if ANY check
//      fails; there is no partial execution).
//   3. Runs the float lookup algorithm — packages/core findFloaters — over
//      the current eligible source-house workers.
//   4. Per identified floater, invokes the atomic force_trigger_float RPC
//      (one transaction: float_assignments + destination/source rows +
//      source-side gap rows + block_step_status pre-marks).
//   5. For any block with NO floater (§6.6 #9), fires the HMOD-for-Allied
//      step directly (process_hmod_notify_allied_step) — and writes NO
//      completed_via_force_trigger marks for that gap.
//
// The decline pathway (void + rollback + source-side reconciliation) is the
// existing decline_float RPC; the orchestrator's next tick re-evaluates the
// rolled-back chain (BSpec §6.6 #7).
//
// Pure decision logic lives in packages/core (validateForceTrigger); atomic
// execution lives in SQL (force_trigger_float). This Edge Function is the
// HTTP/snapshot glue between them — it owns no policy of its own.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { fetchAppNow } from '../_shared/clock.ts';

const TIMEZONE = 'America/New_York';
const BLOCK_MINUTES = 30;
const FLOAT_RETENTION_DAYS = 14;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Supabase = ReturnType<typeof createClient>;

type Role = 'sw' | 'sm' | 'hm' | 'bm';

type ForceTriggerBlockStatus =
  | 'scheduled'
  | 'claimed'
  | 'floated_in'
  | 'floated_out'
  | 'pending_float_in'
  | 'pending_float_out'
  | 'allied'
  | 'vacant';

type ForceTriggerBlockSnapshot = {
  blockId: string;
  status: ForceTriggerBlockStatus;
  blockStartAt: Date;
  hasPendingFloatIn: boolean;
};

type ForceTriggerValidationInput = {
  initiator: { rolesAtDestinationHouse: Role[]; isCurrentHmod: boolean };
  destinationHouseId: string;
  blocks: ForceTriggerBlockSnapshot[];
  now: Date;
  floatEnabled: boolean;
};

type ForceTriggerValidationResult = { ok: true } | { ok: false; reason: string };

type GapRow = {
  assignmentId: string;
  blockId: string;
  blockStartAt: Date;
  houseId: string;
};

type FloatLookupInput = {
  gap: {
    destinationHouseId: string;
    blocks: Array<{ blockId: string; blockStartAt: Date }>;
  };
  sources: Array<{
    sourceHouseId: string;
    precedenceOrder: number;
    candidates: Array<{
      userId: string;
      homeHouseId: string;
      roles: Role[];
      isActive: boolean;
      coveredGapBlockIds: string[];
      shiftStartAt: Date;
      shiftEndAt: Date;
      hasConflictingFloat: boolean;
      hasConflictingCrossHousePickup: boolean;
    }>;
    effectiveHeadcountByBlockId: Record<string, number>;
  }>;
  exclusions: Array<{
    userId: string;
    destinationHouseId: string;
    windowStartAt: Date;
    windowEndAt: Date;
  }>;
};

type FloatLookupResult = {
  assignments: Array<{ workerId: string; sourceHouseId: string; blocks: string[] }>;
  alliedBlockIds: string[];
};

type FloatLookupSnapshot = {
  input: FloatLookupInput;
  destinationAssignmentByBlockId: Map<string, string>;
  sourceAssignmentByWorkerBlockId: Map<string, string>;
};

// ----- small helpers (mirrors orchestrator-tick) -----

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function nestedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function localDateIso(date: Date, timezone = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ----- packages/core (pure) — same dynamic-import pattern as orchestrator-tick -----

async function validateForceTrigger(
  input: ForceTriggerValidationInput,
): Promise<ForceTriggerValidationResult> {
  const module = (await import('../../../packages/core/dist/force-trigger/index.js')) as {
    validateForceTrigger: (input: ForceTriggerValidationInput) => ForceTriggerValidationResult;
  };
  return module.validateForceTrigger(input);
}

async function findFloaters(input: FloatLookupInput): Promise<FloatLookupResult> {
  const module = (await import('../../../packages/core/dist/float-lookup/index.js')) as {
    findFloaters: (input: FloatLookupInput) => FloatLookupResult;
  };
  return module.findFloaters(input);
}

// ----- snapshot builders -----

// The initiator's sm/hm/bm/sw roles SCOPED to the destination house.
async function loadRolesAtHouse(
  supabase: Supabase,
  userId: string,
  houseId: string,
): Promise<Role[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('scope_house_id', houseId);

  if (error !== null) {
    throw error;
  }
  return (data ?? []).map((row) => row.role as Role);
}

// The currently-on-duty HMOD (hmod_rotor + hm_leave) — resolved in SQL.
async function resolveIsCurrentHmod(
  supabase: Supabase,
  userId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('resolve_hmod_on_duty', {
    p_at: now.toISOString(),
  });
  if (error !== null) {
    throw error;
  }
  return typeof data === 'string' && data === userId;
}

// Per-requested-block validation snapshot + the vacant destination row id
// (the gap row the float fills) per block.
async function loadBlockSnapshots(
  supabase: Supabase,
  blockIds: string[],
): Promise<{
  snapshots: ForceTriggerBlockSnapshot[];
  gapRows: GapRow[];
}> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id, block_id, status, shift_blocks!inner(block_start_at, house_id)')
    .in('block_id', blockIds);

  if (error !== null) {
    throw error;
  }

  type Row = { assignmentId: string; status: string; blockStartAt: Date; houseId: string };
  const rowsByBlock = new Map<string, Row[]>();
  for (const row of data ?? []) {
    const joined = nestedOne(
      row.shift_blocks as { block_start_at: string; house_id: string } | null,
    );
    if (joined === null) {
      continue;
    }
    const list = rowsByBlock.get(row.block_id) ?? [];
    list.push({
      assignmentId: row.assignment_id,
      status: row.status,
      blockStartAt: new Date(joined.block_start_at),
      houseId: joined.house_id,
    });
    rowsByBlock.set(row.block_id, list);
  }

  const snapshots: ForceTriggerBlockSnapshot[] = [];
  const gapRows: GapRow[] = [];

  for (const blockId of blockIds) {
    const rows = rowsByBlock.get(blockId) ?? [];
    const vacantRow = rows.find((row) => row.status === 'vacant') ?? null;
    const pendingRow = rows.find((row) => row.status === 'pending_float_in') ?? null;
    const representative = vacantRow ?? pendingRow ?? rows[0] ?? null;

    // A block with no assignment rows at all is treated as non-vacant
    // (nothing to fill) — the validator rejects it as block_not_vacant.
    const status: ForceTriggerBlockStatus = vacantRow
      ? 'vacant'
      : ((representative?.status as ForceTriggerBlockStatus | undefined) ?? 'scheduled');

    snapshots.push({
      blockId,
      status,
      blockStartAt: representative?.blockStartAt ?? new Date(0),
      hasPendingFloatIn: pendingRow !== null,
    });

    if (vacantRow !== null) {
      gapRows.push({
        assignmentId: vacantRow.assignmentId,
        blockId,
        blockStartAt: vacantRow.blockStartAt,
        houseId: vacantRow.houseId,
      });
    }
  }

  return { snapshots, gapRows };
}

async function loadProfileForBlock(
  supabase: Supabase,
  blockStartAt: Date,
): Promise<{ profileName: string; floatEnabled: boolean } | null> {
  const { data: calendar, error: calendarError } = await supabase
    .from('operating_calendar')
    .select('profile_name')
    .eq('date', localDateIso(blockStartAt))
    .maybeSingle();

  if (calendarError !== null || calendar === null) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('operating_profiles')
    .select('profile_name, float_enabled')
    .eq('profile_name', calendar.profile_name)
    .single();

  if (profileError !== null || profile === null) {
    return null;
  }

  return { profileName: profile.profile_name, floatEnabled: profile.float_enabled };
}

// Build the float-lookup input from the known gap rows. Mirrors the
// orchestrator's buildFloatLookupSnapshot, but the gap is the explicit set
// of requested vacant blocks rather than a scanned lookahead window.
async function buildFloatLookupSnapshot(
  supabase: Supabase,
  destinationHouseId: string,
  profileName: string,
  gapRows: GapRow[],
): Promise<FloatLookupSnapshot> {
  const sortedGap = [...gapRows].sort(
    (left, right) => left.blockStartAt.getTime() - right.blockStartAt.getTime(),
  );
  const gapBlocks = sortedGap.map((row) => ({
    blockId: row.blockId,
    blockStartAt: row.blockStartAt,
  }));
  const destinationAssignmentByBlockId = new Map(
    sortedGap.map((row) => [row.blockId, row.assignmentId]),
  );

  const gapStart = gapBlocks[0]?.blockStartAt ?? new Date();
  const gapEnd = addMinutes(gapBlocks.at(-1)?.blockStartAt ?? gapStart, BLOCK_MINUTES);
  const gapBlockByIso = new Map(
    gapBlocks.map((gapBlock) => [gapBlock.blockStartAt.toISOString(), gapBlock]),
  );

  const { data: routes, error: routesError } = await supabase
    .from('float_routing')
    .select('source_house_id, precedence_order')
    .eq('profile_name', profileName)
    .eq('destination_house_id', destinationHouseId)
    .order('precedence_order', { ascending: true });

  if (routesError !== null) {
    throw routesError;
  }

  const sources: FloatLookupInput['sources'] = [];
  const sourceAssignmentByWorkerBlockId = new Map<string, string>();

  for (const route of routes ?? []) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from('shift_block_assignments')
      .select(
        'assignment_id, user_id, status, shift_blocks!inner(block_id, block_start_at, house_id)',
      )
      .in('status', ['scheduled', 'claimed'])
      .eq('shift_blocks.house_id', route.source_house_id)
      .gte('shift_blocks.block_start_at', gapStart.toISOString())
      .lt('shift_blocks.block_start_at', gapEnd.toISOString());

    if (sourceError !== null) {
      throw sourceError;
    }

    const userIds = [
      ...new Set((sourceRows ?? []).map((row) => row.user_id).filter(Boolean) as string[]),
    ];

    const { data: users, error: usersError } =
      userIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('users')
            .select('user_id, home_house_id, is_active')
            .in('user_id', userIds);
    if (usersError !== null) {
      throw usersError;
    }
    const usersById = new Map((users ?? []).map((user) => [user.user_id, user]));

    const { data: roles, error: rolesError } =
      userIds.length === 0
        ? { data: [], error: null }
        : await supabase.from('user_roles').select('user_id, role').in('user_id', userIds);
    if (rolesError !== null) {
      throw rolesError;
    }
    const rolesByUser = new Map<string, Role[]>();
    for (const role of roles ?? []) {
      const existing = rolesByUser.get(role.user_id) ?? [];
      existing.push(role.role as Role);
      rolesByUser.set(role.user_id, existing);
    }

    const coveredByUser = new Map<string, Array<{ blockId: string; blockStartAt: Date }>>();
    const effectiveHeadcountByBlockId: Record<string, number> = Object.fromEntries(
      gapBlocks.map((gapBlock) => [gapBlock.blockId, 0]),
    );

    for (const row of sourceRows ?? []) {
      if (row.user_id === null) {
        continue;
      }
      const joinedBlock = nestedOne(
        row.shift_blocks as { block_id: string; block_start_at: string; house_id: string } | null,
      );
      if (joinedBlock === null) {
        continue;
      }
      const gapBlock = gapBlockByIso.get(new Date(joinedBlock.block_start_at).toISOString());
      if (gapBlock === undefined) {
        continue;
      }
      effectiveHeadcountByBlockId[gapBlock.blockId] =
        (effectiveHeadcountByBlockId[gapBlock.blockId] ?? 0) + 1;
      sourceAssignmentByWorkerBlockId.set(`${row.user_id}:${gapBlock.blockId}`, row.assignment_id);
      const existing = coveredByUser.get(row.user_id) ?? [];
      existing.push(gapBlock);
      coveredByUser.set(row.user_id, existing);
    }

    // Per-candidate conflict flags (orchestrator C4): a worker already
    // committed to a float or a cross-house pickup overlapping the gap
    // window must not be selected.
    const floatConflictUserIds = new Set<string>();
    const crossHousePickupConflictUserIds = new Set<string>();
    if (userIds.length > 0) {
      const { data: conflictRows, error: conflictError } = await supabase
        .from('shift_block_assignments')
        .select('user_id, status, is_cross_house_pickup, shift_blocks!inner(block_start_at)')
        .in('user_id', userIds)
        .gte('shift_blocks.block_start_at', gapStart.toISOString())
        .lt('shift_blocks.block_start_at', gapEnd.toISOString());
      if (conflictError !== null) {
        throw conflictError;
      }
      for (const row of conflictRows ?? []) {
        if (row.user_id === null) {
          continue;
        }
        if (
          row.status === 'pending_float_in' ||
          row.status === 'floated_in' ||
          row.status === 'pending_float_out' ||
          row.status === 'floated_out'
        ) {
          floatConflictUserIds.add(row.user_id);
        }
        if (row.is_cross_house_pickup === true) {
          crossHousePickupConflictUserIds.add(row.user_id);
        }
      }
    }

    const candidates = [...coveredByUser.entries()].flatMap(([userId, coveredBlocks]) => {
      const user = usersById.get(userId);
      if (user === undefined || coveredBlocks.length === 0) {
        return [];
      }
      const sortedBlocks = [...coveredBlocks].sort(
        (left, right) => left.blockStartAt.getTime() - right.blockStartAt.getTime(),
      );
      return [
        {
          userId,
          homeHouseId: user.home_house_id,
          roles: rolesByUser.get(userId) ?? ['sw'],
          isActive: user.is_active,
          coveredGapBlockIds: sortedBlocks.map((gapBlock) => gapBlock.blockId),
          shiftStartAt: sortedBlocks[0]!.blockStartAt,
          shiftEndAt: addMinutes(sortedBlocks.at(-1)!.blockStartAt, BLOCK_MINUTES),
          hasConflictingFloat: floatConflictUserIds.has(userId),
          hasConflictingCrossHousePickup: crossHousePickupConflictUserIds.has(userId),
        },
      ];
    });

    sources.push({
      sourceHouseId: route.source_house_id,
      precedenceOrder: route.precedence_order,
      candidates,
      effectiveHeadcountByBlockId,
    });
  }

  const { data: exclusions, error: exclusionsError } = await supabase
    .from('float_exclusions')
    .select('user_id, destination_house_id, window_start_at, window_end_at')
    .eq('destination_house_id', destinationHouseId)
    .lt('window_start_at', gapEnd.toISOString())
    .gt('window_end_at', gapStart.toISOString());

  if (exclusionsError !== null) {
    throw exclusionsError;
  }

  return {
    input: {
      gap: { destinationHouseId, blocks: gapBlocks },
      sources,
      exclusions: (exclusions ?? []).map((exclusion) => ({
        userId: exclusion.user_id,
        destinationHouseId: exclusion.destination_house_id,
        windowStartAt: new Date(exclusion.window_start_at),
        windowEndAt: new Date(exclusion.window_end_at),
      })),
    },
    destinationAssignmentByBlockId,
    sourceAssignmentByWorkerBlockId,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/force-trigger)?\/force-trigger$/.test(pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token === undefined) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Identity comes from the bearer token, never the request body.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError !== null || user === null) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return jsonResponse({ error: 'Request body must be an object' }, 400);
  }

  const {
    destination_house_id: destinationHouseId,
    block_ids: blockIds,
    initiator_user_id: initiatorUserId,
  } = body as { destination_house_id?: unknown; block_ids?: unknown; initiator_user_id?: unknown };

  if (typeof destinationHouseId !== 'string' || destinationHouseId.length === 0) {
    return jsonResponse({ error: 'destination_house_id must be a non-empty string' }, 400);
  }
  if (!Array.isArray(blockIds) || blockIds.length === 0 || !blockIds.every(isUuid)) {
    return jsonResponse({ error: 'block_ids must be a non-empty array of UUIDs' }, 400);
  }
  // The initiator is the authenticated caller; a body initiator_user_id, if
  // present, must agree (no acting on another user's behalf).
  if (initiatorUserId !== undefined && initiatorUserId !== user.id) {
    return jsonResponse({ error: 'initiator_user_id must match the authenticated user' }, 403);
  }
  const initiator = user.id;
  // Honor the dev sim clock so a force-trigger under time-travel uses simulated
  // "now" for the within-2h gate, HMOD resolution, and ack-reminder snapshot
  // (no-op in production where app_now() === now()).
  const now = await fetchAppNow(supabase);

  try {
    // ----- snapshot + validation gate (ARCH §6.2) -----
    const [rolesAtDestinationHouse, isCurrentHmod, { snapshots, gapRows }] = await Promise.all([
      loadRolesAtHouse(supabase, initiator, destinationHouseId),
      resolveIsCurrentHmod(supabase, initiator, now),
      loadBlockSnapshots(supabase, blockIds as string[]),
    ]);

    const earliestStart = snapshots.reduce<Date | null>(
      (earliest, snapshot) =>
        earliest === null || snapshot.blockStartAt.getTime() < earliest.getTime()
          ? snapshot.blockStartAt
          : earliest,
      null,
    );
    const profile =
      earliestStart === null ? null : await loadProfileForBlock(supabase, earliestStart);
    const floatEnabled = profile?.floatEnabled ?? false;

    const validation = await validateForceTrigger({
      initiator: { rolesAtDestinationHouse, isCurrentHmod },
      destinationHouseId,
      blocks: snapshots,
      now,
      floatEnabled,
    });

    if (!validation.ok) {
      const status = validation.reason === 'unauthorized_initiator' ? 403 : 409;
      return jsonResponse({ error: 'force_trigger_rejected', reason: validation.reason }, status);
    }

    // ----- float lookup (BSpec §6.6 #3, packages/core findFloaters) -----
    const snapshot = await buildFloatLookupSnapshot(
      supabase,
      destinationHouseId,
      profile!.profileName,
      gapRows,
    );
    const result = await findFloaters(snapshot.input);

    // ----- per-floater atomic execution (force_trigger_float RPC) -----
    const floatAssignmentIds: string[] = [];
    for (const assignment of result.assignments) {
      const destinationAssignmentIds = assignment.blocks.flatMap((blockId) => {
        const id = snapshot.destinationAssignmentByBlockId.get(blockId);
        return id === undefined ? [] : [id];
      });
      const sourceAssignmentIds = assignment.blocks.flatMap((blockId) => {
        const id = snapshot.sourceAssignmentByWorkerBlockId.get(
          `${assignment.workerId}:${blockId}`,
        );
        return id === undefined ? [] : [id];
      });
      if (destinationAssignmentIds.length === 0 || sourceAssignmentIds.length === 0) {
        continue;
      }

      const { data: rpcResult, error: rpcError } = await supabase.rpc('force_trigger_float', {
        p_initiator_user_id: initiator,
        p_worker_id: assignment.workerId,
        p_source_house_id: assignment.sourceHouseId,
        p_source_assignment_ids: sourceAssignmentIds,
        p_destination_assignment_ids: destinationAssignmentIds,
        p_destination_house_id: destinationHouseId,
        p_now: now.toISOString(),
        p_retention_days: FLOAT_RETENTION_DAYS,
      });
      if (rpcError !== null) {
        throw rpcError;
      }

      const outcome = rpcResult as { assigned?: boolean; float_id?: string } | null;
      if (outcome?.assigned === true && typeof outcome.float_id === 'string') {
        floatAssignmentIds.push(outcome.float_id);
      }
    }

    // ----- no-floater fallback (§6.6 #9): HMOD-for-Allied per uncovered block -----
    const gapByBlockId = new Map(gapRows.map((row) => [row.blockId, row]));
    const alliedNotifications: Array<{ blockId: string; claimed: boolean }> = [];
    for (const blockId of result.alliedBlockIds) {
      const gap = gapByBlockId.get(blockId);
      if (gap === undefined) {
        continue;
      }
      const { data: notifyResult, error: notifyError } = await supabase.rpc(
        'process_hmod_notify_allied_step',
        {
          p_block_id: gap.blockId,
          p_house_id: gap.houseId,
          p_block_start_at: gap.blockStartAt.toISOString(),
          p_now: now.toISOString(),
          p_reason: 'force_trigger_no_floater',
        },
      );
      if (notifyError !== null) {
        throw notifyError;
      }
      alliedNotifications.push({
        blockId,
        claimed: (notifyResult as { claimed?: boolean } | null)?.claimed === true,
      });
    }

    return jsonResponse({
      ok: true,
      floatAssignmentIds,
      alliedNotifications,
      forcedAt: now.toISOString(),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: 'force_trigger_failed',
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
