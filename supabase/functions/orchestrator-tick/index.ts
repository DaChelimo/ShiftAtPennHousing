import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TIMEZONE = 'America/New_York';
const LOOKAHEAD_MINUTES = 3 * 60 + 5;
const DEFAULT_NO_ACK_LOOKAHEAD_MINUTES = 15;
const DEFAULT_BLOCK_MINUTES = 30;
const DEFAULT_FLOAT_RETENTION_DAYS = 14;

// Desk-presence statuses. A block whose desk is already (or will be) staffed by at
// least one assignment in one of these statuses is NOT empty, so the coverage chain
// (broadcast → float → Allied) must NOT fire for it. Per the coverage rule
// (BEHAVIORAL_SPECIFICATION §5.4) the chain runs ONLY to keep a desk from being
// EMPTY — it never backfills extra vacant seats up to the full per-house headcount.
// On a triple-staffed Quad evening where one worker is still on, the other two
// seats need no coverage. `floated_out` / `pending_float_out` are NOT present (that
// seat's worker is staffing another desk); `vacant` is not present.
const PRESENT_STATUSES = [
  'scheduled',
  'claimed',
  'floated_in',
  'pending_float_in',
  'allied',
] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Supabase = ReturnType<typeof createClient>;
type RuntimeConfig = {
  blockMinutes: number;
  floatRetentionDays: number;
  noAckLookaheadMinutes: number;
};
type TickSummary = {
  tickedAt: string;
  blocksScanned: number;
  stepsFired: number;
  floatsVoided: number;
  swapsExpired: number;
  errors: string[];
};
type StepStatus = 'fired' | 'completed_via_force_trigger' | 'rolled_back';
type StepStatusMap = Record<string, StepStatus>;
type ChainStep = {
  stepName: string;
  offsetMinutes: number;
  trigger?: 'on_float_failure';
};
type ChainStepEvaluation = {
  stepName: string;
  trigger?: 'on_float_failure';
};
type BlockRef = {
  blockId: string;
  blockStartAt: Date;
  houseId: string;
};
type VacantAssignment = BlockRef & {
  assignmentId: string;
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
      roles: Array<'sw' | 'sm' | 'hm' | 'bm'>;
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadRuntimeConfig(supabase: Supabase): Promise<RuntimeConfig> {
  const { data, error } = await supabase
    .from('system_config')
    .select('config_key, config_value')
    .in('config_key', [
      'shift_block_minutes',
      'float_retention_days',
      'ack_deadline_offset_minutes',
      'no_ack_trigger_offset_minutes',
    ]);
  if (error !== null) throw error;

  const values = new Map((data ?? []).map((row) => [row.config_key, row.config_value]));
  const ackDeadlineMinutes = parsePositiveInteger(values.get('ack_deadline_offset_minutes'), 10);
  const noAckTriggerMinutes = parsePositiveInteger(values.get('no_ack_trigger_offset_minutes'), 5);
  return {
    blockMinutes: parsePositiveInteger(values.get('shift_block_minutes'), DEFAULT_BLOCK_MINUTES),
    floatRetentionDays: parsePositiveInteger(
      values.get('float_retention_days'),
      DEFAULT_FLOAT_RETENTION_DAYS,
    ),
    noAckLookaheadMinutes:
      ackDeadlineMinutes + noAckTriggerMinutes || DEFAULT_NO_ACK_LOOKAHEAD_MINUTES,
  };
}

function nestedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function localParts(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  msSinceMidnight: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    msSinceMidnight: ((hour * 60 + minute) * 60 + second) * 1000 + date.getMilliseconds(),
  };
}

function localDateIso(date: Date, timezone = TIMEZONE): string {
  const parts = localParts(date, timezone);
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-');
}

function parseOffsetMinutes(offset: unknown): number {
  if (typeof offset === 'number') {
    return offset;
  }
  if (typeof offset !== 'string') {
    throw new Error(`invalid escalation offset: ${String(offset)}`);
  }

  const match = offset.trim().match(/^(-?\d+)\s*(second|seconds|minute|minutes|hour|hours)$/i);
  if (match === null) {
    throw new Error(`invalid escalation offset: ${offset}`);
  }

  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit.startsWith('hour')) {
    return amount * 60;
  }
  if (unit.startsWith('second')) {
    return amount / 60;
  }
  return amount;
}

function parseEscalationChain(value: unknown): ChainStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('invalid escalation chain step');
    }
    const step = raw as { step?: unknown; stepName?: unknown; offset?: unknown; trigger?: unknown };
    const stepName = step.stepName ?? step.step;
    if (typeof stepName !== 'string') {
      throw new Error('invalid escalation chain step name');
    }

    const parsed: ChainStep = {
      stepName,
      offsetMinutes: parseOffsetMinutes(step.offset),
    };
    if (step.trigger === 'on_float_failure') {
      parsed.trigger = 'on_float_failure';
    }
    return parsed;
  });
}

// C6a: delegate to the canonical, unit-tested implementation in
// packages/core/src/orchestrator/evaluate.ts (covered by escalation-timing.test.ts),
// using the same dynamic-import pattern as findFloaters. This removes the
// previously-duplicated inline copy so the deployed orchestrator runs exactly
// the logic the tests exercise.
async function evaluateChainSteps(params: {
  blockStartAt: Date;
  now: Date;
  chain: ChainStep[];
  stepStatus: StepStatusMap;
}): Promise<ChainStepEvaluation[]> {
  const module = (await import('../../../packages/core/dist/orchestrator/evaluate.js')) as {
    evaluateChainSteps: (input: {
      blockStartAt: Date;
      now: Date;
      chain: ChainStep[];
      stepStatus: StepStatusMap;
    }) => ChainStepEvaluation[];
  };
  return module.evaluateChainSteps(params);
}

async function findFloaters(input: FloatLookupInput): Promise<FloatLookupResult> {
  const module = (await import('../../../packages/core/dist/float-lookup/index.js')) as {
    findFloaters: (input: FloatLookupInput) => FloatLookupResult;
  };
  return module.findFloaters(input);
}

async function loadProfileForBlock(
  supabase: Supabase,
  blockStartAt: Date,
): Promise<{ profileName: string; chain: ChainStep[]; floatEnabled: boolean } | null> {
  const blockDate = localDateIso(blockStartAt);
  const { data: calendar, error: calendarError } = await supabase
    .from('operating_calendar')
    .select('profile_name')
    .eq('date', blockDate)
    .maybeSingle();

  if (calendarError !== null || calendar === null) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('operating_profiles')
    .select('profile_name, escalation_chain, float_enabled')
    .eq('profile_name', calendar.profile_name)
    .single();

  if (profileError !== null || profile === null) {
    throw profileError ?? new Error(`profile not found: ${calendar.profile_name}`);
  }

  return {
    profileName: profile.profile_name,
    chain: parseEscalationChain(profile.escalation_chain),
    floatEnabled: profile.float_enabled,
  };
}

async function loadStepStatus(supabase: Supabase, blockId: string): Promise<StepStatusMap> {
  const { data, error } = await supabase
    .from('block_step_status')
    .select('step_name, status')
    .eq('block_id', blockId);

  if (error !== null) {
    throw error;
  }

  return Object.fromEntries((data ?? []).map((row) => [row.step_name, row.status as StepStatus]));
}

async function claimStep(
  supabase: Supabase,
  blockId: string,
  stepName: string,
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('block_step_status')
    .update({ status: 'fired', fired_at: nowIso, updated_at: nowIso })
    .eq('block_id', blockId)
    .eq('step_name', stepName)
    .eq('status', 'rolled_back')
    .select('block_id')
    .maybeSingle();

  if (updateError !== null) {
    throw updateError;
  }
  if (updated !== null) {
    return true;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('block_step_status')
    .upsert(
      {
        block_id: blockId,
        step_name: stepName,
        status: 'fired',
        fired_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'block_id,step_name', ignoreDuplicates: true },
    )
    .select('block_id');

  if (insertError !== null) {
    throw insertError;
  }

  return (inserted?.length ?? 0) > 0;
}

// B-1 audit fix (broadcast portion): the claim INSERT and the
// notification INSERTs are now performed atomically inside the
// process_broadcast_step RPC. The Edge Function side is a thin
// wrapper that surfaces `claimed` to the chain loop.
async function broadcastStep(supabase: Supabase, block: BlockRef, firedAt: Date): Promise<boolean> {
  const { data, error } = await supabase.rpc('process_broadcast_step', {
    p_block_id: block.blockId,
    p_house_id: block.houseId,
    p_block_start_at: block.blockStartAt.toISOString(),
    p_now: firedAt.toISOString(),
  });

  if (error !== null) {
    throw error;
  }

  return (data as { claimed?: boolean } | null)?.claimed === true;
}

// B-1 audit fix (hmod portion): the recipient resolution and the
// notification INSERT now happen atomically inside the
// process_hmod_notify_allied_step RPC, alongside the chain step
// claim. The Edge Function side is a thin wrapper that surfaces
// `claimed` to the chain loop.
//
// Recipient resolution helpers (resolve_hm_for_user,
// resolve_hm_for_house, resolve_hmod_on_duty, is_hm_working_time)
// were moved into SQL in migration 20260528000004; the TS-side helpers
// they replaced have been deleted.
// Stamp a block's one-way coverage lock (BEHAVIORAL_SPECIFICATION §5.4/§5.5).
// Called only from the T-2h coverage-securing steps (float_lookup,
// hmod_notify_allied) — NEVER from broadcast (T-3h stays claimable). A block
// reaching these steps is EMPTY (covered blocks are skipped before fireStep), so
// locking it makes its vacant seats unpickable from here on, even after a
// floater/Allied later fills the desk. Idempotent + one-way in SQL.
async function lockBlockCoverage(supabase: Supabase, blockId: string, asOf: Date): Promise<void> {
  const { error } = await supabase.rpc('lock_block_coverage', {
    p_block_id: blockId,
    p_as_of: asOf.toISOString(),
  });
  if (error !== null) {
    throw error;
  }
}

async function hmodNotifyAlliedStep(
  supabase: Supabase,
  block: BlockRef,
  firedAt: Date,
  reason = 'escalation_chain',
): Promise<boolean> {
  // §5.5: securing-tier step on an empty desk → lock its seats (one-way).
  await lockBlockCoverage(supabase, block.blockId, firedAt);

  const { data, error } = await supabase.rpc('process_hmod_notify_allied_step', {
    p_block_id: block.blockId,
    p_house_id: block.houseId,
    p_block_start_at: block.blockStartAt.toISOString(),
    p_now: firedAt.toISOString(),
    p_reason: reason,
  });

  if (error !== null) {
    throw error;
  }

  return (data as { claimed?: boolean } | null)?.claimed === true;
}

// Of the given blocks, the subset whose desk is already covered — at least one
// assignment row in a PRESENT_STATUSES status. A covered block needs no coverage,
// so both the chain trigger (processVacantBlocks) and the gap builder
// (loadVacantGap) skip it. This is also what stops the multi-tick fill-to-headcount
// loop: once a floater flips one seat to pending_float_in the block reads covered on
// the next tick, so its remaining vacant seats are never floated.
async function loadCoveredBlockIds(supabase: Supabase, blockIds: string[]): Promise<Set<string>> {
  const covered = new Set<string>();
  // Chunk the .in() filter — a full lookahead window of block ids 414s ("URI too
  // long") as one request (mirrors selectByBlockIdChunks on the web side).
  const CHUNK = 100;
  for (let start = 0; start < blockIds.length; start += CHUNK) {
    const chunk = blockIds.slice(start, start + CHUNK);
    if (chunk.length === 0) {
      continue;
    }
    const { data, error } = await supabase
      .from('shift_block_assignments')
      .select('block_id')
      .in('block_id', chunk)
      .in('status', [...PRESENT_STATUSES]);
    if (error !== null) {
      throw error;
    }
    for (const row of data ?? []) {
      covered.add(row.block_id);
    }
  }
  return covered;
}

async function loadVacantGap(
  supabase: Supabase,
  block: VacantAssignment,
  blockMinutes: number,
): Promise<Array<VacantAssignment>> {
  const windowEnd = addMinutes(block.blockStartAt, 4 * 60).toISOString();
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id, block_id, shift_blocks!inner(block_start_at, house_id)')
    .eq('status', 'vacant')
    .eq('shift_blocks.house_id', block.houseId)
    .gte('shift_blocks.block_start_at', block.blockStartAt.toISOString())
    .lte('shift_blocks.block_start_at', windowEnd)
    .order('block_start_at', { referencedTable: 'shift_blocks', ascending: true });

  if (error !== null) {
    throw error;
  }

  const byBlock = new Map<string, VacantAssignment>();
  for (const row of data ?? []) {
    const joinedBlock = nestedOne(
      row.shift_blocks as { block_start_at: string; house_id: string } | null,
    );
    if (joinedBlock === null || byBlock.has(row.block_id)) {
      continue;
    }
    byBlock.set(row.block_id, {
      assignmentId: row.assignment_id,
      blockId: row.block_id,
      blockStartAt: new Date(joinedBlock.block_start_at),
      houseId: joinedBlock.house_id,
    });
  }

  // Only EMPTY blocks (no present staff) belong to the gap — a block where someone
  // is still on the desk is covered and must not pull its remaining vacant seats
  // into the float. A non-empty block also breaks the contiguous run (mirrors the
  // user's example: empty 18:00–20:00, staffed 20:00–22:00, empty 22:00–24:00 →
  // two separate gaps, not one).
  const coveredBlockIds = await loadCoveredBlockIds(supabase, [...byBlock.keys()]);

  const sorted = [...byBlock.values()]
    .filter((row) => !coveredBlockIds.has(row.blockId))
    .sort((left, right) => left.blockStartAt.getTime() - right.blockStartAt.getTime());
  const gap: VacantAssignment[] = [];
  let expectedStart = block.blockStartAt.getTime();
  for (const row of sorted) {
    if (row.blockStartAt.getTime() < expectedStart) {
      continue;
    }
    if (row.blockStartAt.getTime() !== expectedStart) {
      break;
    }
    gap.push(row);
    expectedStart += blockMinutes * 60 * 1000;
  }

  return gap;
}

async function buildFloatLookupSnapshot(
  supabase: Supabase,
  block: VacantAssignment,
  profileName: string,
  blockMinutes: number,
): Promise<FloatLookupSnapshot> {
  const gapRows = await loadVacantGap(supabase, block, blockMinutes);
  const gapBlocks = gapRows.map((row) => ({
    blockId: row.blockId,
    blockStartAt: row.blockStartAt,
  }));
  const destinationAssignmentByBlockId = new Map(
    gapRows.map((row) => [row.blockId, row.assignmentId]),
  );
  const gapStart = gapBlocks[0]?.blockStartAt ?? block.blockStartAt;
  const gapEnd = addMinutes(gapBlocks.at(-1)?.blockStartAt ?? block.blockStartAt, blockMinutes);

  const { data: routes, error: routesError } = await supabase
    .from('float_routing')
    .select('source_house_id, precedence_order')
    .eq('profile_name', profileName)
    .eq('destination_house_id', block.houseId)
    .order('precedence_order', { ascending: true });

  if (routesError !== null) {
    throw routesError;
  }

  const sources: FloatLookupInput['sources'] = [];
  const sourceAssignmentByWorkerBlockId = new Map<string, string>();
  const gapBlockByIso = new Map(
    gapBlocks.map((gapBlock) => [gapBlock.blockStartAt.toISOString(), gapBlock]),
  );

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
    const rolesByUser = new Map<string, Array<'sw' | 'sm' | 'hm' | 'bm'>>();
    for (const role of roles ?? []) {
      const existing = rolesByUser.get(role.user_id) ?? [];
      existing.push(role.role as 'sw' | 'sm' | 'hm' | 'bm');
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

    // C4 (F-07-005): per-candidate conflict flags. A worker already committed
    // to a float (pending/acknowledged manifests as pending/floated in/out rows)
    // or to a cross-house pickup overlapping the gap window must not be selected.
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
          shiftEndAt: addMinutes(sortedBlocks.at(-1)!.blockStartAt, blockMinutes),
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
    .eq('destination_house_id', block.houseId)
    .lt('window_start_at', gapEnd.toISOString())
    .gt('window_end_at', gapStart.toISOString());

  if (exclusionsError !== null) {
    throw exclusionsError;
  }

  return {
    input: {
      gap: { destinationHouseId: block.houseId, blocks: gapBlocks },
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

async function floatLookupStep(
  supabase: Supabase,
  block: VacantAssignment,
  profileName: string,
  firedAt: Date,
  config: RuntimeConfig,
): Promise<'float_assigned' | 'no_float'> {
  // §5.5: the desk hit its T-2h float-lookup step while empty → lock its seats
  // (one-way) before attempting the float, regardless of whether a floater is
  // found. A later float-in / Allied fill never re-opens them to pickup.
  await lockBlockCoverage(supabase, block.blockId, firedAt);

  // §7.3 — never assign a float that is ALREADY inside its no-ack window at
  // creation. Such a float is dead on arrival: its acknowledgment deadline
  // (T-10m) and no-ack point (T-15m) are already past, so the worker can never
  // acknowledge it and the no-ack pass voids it immediately — re-opening the gap
  // into an assign→void→re-assign churn that also burns an unfair no_acknowledgment
  // exclusion on the floater. A gap discovered or reopened this late routes
  // straight to HMOD-for-Allied instead (the 'no_float' fallback below — the same
  // terminal a no-ack void produces). The threshold is the no-ack lookahead
  // (ack-deadline + no-ack-trigger); a float whose start is beyond it can still be
  // acknowledged and is unaffected, so normal T-2h floats never hit this guard.
  const noAckHorizon = addMinutes(firedAt, config.noAckLookaheadMinutes).getTime();
  if (block.blockStartAt.getTime() <= noAckHorizon) {
    return 'no_float';
  }

  const snapshot = await buildFloatLookupSnapshot(
    supabase,
    block,
    profileName,
    config.blockMinutes,
  );
  const result = await findFloaters(snapshot.input);

  if (result.assignments.length === 0) {
    return 'no_float';
  }

  let anyAssigned = false;
  for (const assignment of result.assignments) {
    const destinationAssignmentIds = assignment.blocks.flatMap((blockId) => {
      const assignmentId = snapshot.destinationAssignmentByBlockId.get(blockId);
      return assignmentId === undefined ? [] : [assignmentId];
    });
    const sourceAssignmentIds = assignment.blocks.flatMap((blockId) => {
      const assignmentId = snapshot.sourceAssignmentByWorkerBlockId.get(
        `${assignment.workerId}:${blockId}`,
      );
      return assignmentId === undefined ? [] : [assignmentId];
    });

    if (destinationAssignmentIds.length === 0 || sourceAssignmentIds.length === 0) {
      continue;
    }

    // B-2 audit fix: the four writes (float_assignments INSERT,
    // destination + source UPDATEs, notification INSERT) run inside a
    // single plpgsql transaction so partial state — e.g. destination
    // flipped to pending_float_in while source is still scheduled —
    // is impossible. The RPC also re-validates the destination is
    // still vacant under FOR UPDATE; a concurrent claim between the
    // algorithm's snapshot and this call cleanly returns
    // assigned=false with no writes.
    const { data: assignmentResult, error: assignmentError } = await supabase.rpc(
      'process_float_lookup_assignment',
      {
        p_worker_id: assignment.workerId,
        p_source_house_id: assignment.sourceHouseId,
        p_source_assignment_ids: sourceAssignmentIds,
        p_destination_assignment_ids: destinationAssignmentIds,
        p_destination_house_id: block.houseId,
        p_now: firedAt.toISOString(),
        p_retention_days: config.floatRetentionDays,
      },
    );
    if (assignmentError !== null) {
      throw assignmentError;
    }

    if ((assignmentResult as { assigned?: boolean } | null)?.assigned === true) {
      anyAssigned = true;
    }
  }

  // Any successful per-worker assignment means the lookup yielded a
  // float for the orchestrator's purposes. If ALL assignments aborted
  // because their destinations were no longer vacant, the chain
  // re-evaluates next tick (or hmod_notify_allied fires for the
  // residual gap).
  return anyAssigned ? 'float_assigned' : 'no_float';
}

async function hasActiveFloatForBlock(supabase: Supabase, blockId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id')
    .eq('block_id', blockId)
    .in('status', ['pending_float_in', 'floated_in'])
    .limit(1);

  if (error !== null) {
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

// Dispatcher for chain steps.
//
// Per-step atomicity model after the B-1 + B-2 audit fixes:
//
//   - broadcast            → process_broadcast_step RPC (claims +
//                            inserts notifications atomically).
//   - hmod_notify_allied   → process_hmod_notify_allied_step RPC
//                            (claims + resolves recipient + inserts
//                            notification atomically).
//   - float_lookup         → claim block_step_status first via
//                            claimStep helper, then call the
//                            process_float_lookup_assignment RPC per
//                            assignment (each is atomic). The TS-side
//                            algorithm runs between claim and write
//                            calls; failure between leaves the chain
//                            step claimed but no float assignment,
//                            which the next tick correctly routes to
//                            hmod_notify_allied.
//
// Returns:
//   'float_assigned' — at least one floater was successfully assigned.
//   'no_float'       — float_lookup returned nothing or every
//                      candidate's destination was concurrently filled.
//   'done'           — broadcast / hmod completed.
//   'skipped'        — chain step was already claimed elsewhere (race).
async function fireStep(params: {
  supabase: Supabase;
  block: VacantAssignment;
  profileName: string;
  stepName: string;
  firedAt: Date;
  config: RuntimeConfig;
}): Promise<'float_assigned' | 'no_float' | 'done' | 'skipped'> {
  switch (params.stepName) {
    case 'broadcast': {
      const claimed = await broadcastStep(params.supabase, params.block, params.firedAt);
      return claimed ? 'done' : 'skipped';
    }
    case 'float_lookup':
      return await floatLookupStep(
        params.supabase,
        params.block,
        params.profileName,
        params.firedAt,
        params.config,
      );
    case 'hmod_notify_allied': {
      const claimed = await hmodNotifyAlliedStep(params.supabase, params.block, params.firedAt);
      return claimed ? 'done' : 'skipped';
    }
    default:
      return 'done';
  }
}

async function processVacantBlocks(
  supabase: Supabase,
  now: Date,
  config: RuntimeConfig,
): Promise<{ blocksScanned: number; stepsFired: number }> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id, block_id, shift_blocks!inner(block_start_at, house_id)')
    .eq('status', 'vacant')
    .gt('shift_blocks.block_start_at', now.toISOString())
    .lte('shift_blocks.block_start_at', addMinutes(now, LOOKAHEAD_MINUTES).toISOString())
    .order('block_start_at', { referencedTable: 'shift_blocks', ascending: true });

  if (error !== null) {
    throw error;
  }

  // Skip blocks whose desk is already staffed: the coverage chain fires only to
  // keep a desk from being EMPTY (BEHAVIORAL_SPECIFICATION §5.4), never to backfill
  // vacant seats to the full headcount. A triple-staffed Quad evening with one
  // worker still on needs no broadcast/float/Allied for its other two seats.
  const coveredBlockIds = await loadCoveredBlockIds(supabase, [
    ...new Set((data ?? []).map((row) => row.block_id)),
  ]);

  let fired = 0;
  for (const row of data ?? []) {
    if (coveredBlockIds.has(row.block_id)) {
      continue;
    }
    const joinedBlock = nestedOne(
      row.shift_blocks as { block_start_at: string; house_id: string } | null,
    );
    if (joinedBlock === null) {
      continue;
    }

    const block: VacantAssignment = {
      assignmentId: row.assignment_id,
      blockId: row.block_id,
      blockStartAt: new Date(joinedBlock.block_start_at),
      houseId: joinedBlock.house_id,
    };
    const profile = await loadProfileForBlock(supabase, block.blockStartAt);
    if (profile === null) {
      continue;
    }

    const stepStatus = await loadStepStatus(supabase, block.blockId);
    const dueSteps = await evaluateChainSteps({
      blockStartAt: block.blockStartAt,
      now,
      chain: profile.chain,
      stepStatus,
    });

    let floatAssignedThisTick = false;
    for (const step of dueSteps) {
      if (
        step.trigger === 'on_float_failure' &&
        (floatAssignedThisTick || (await hasActiveFloatForBlock(supabase, block.blockId)))
      ) {
        continue;
      }

      // float_lookup still requires the orchestrator-side claim
      // because the algorithm runs in TypeScript and cannot be wrapped
      // in a single SQL transaction. broadcast and hmod_notify_allied
      // claim inside their RPCs (B-1 audit fix), so we skip the
      // claimStep round-trip for them.
      if (step.stepName === 'float_lookup') {
        const claimed = await claimStep(supabase, block.blockId, step.stepName, now);
        if (!claimed) {
          continue;
        }
      }

      const outcome = await fireStep({
        supabase,
        block,
        profileName: profile.profileName,
        stepName: step.stepName,
        firedAt: now,
        config,
      });

      if (outcome === 'skipped') {
        continue;
      }
      fired += 1;

      if (outcome === 'float_assigned') {
        floatAssignedThisTick = true;
      }
      if (
        outcome === 'no_float' &&
        !dueSteps.some((candidate) => candidate.stepName === 'hmod_notify_allied')
      ) {
        const claimed = await hmodNotifyAlliedStep(supabase, block, now, 'float_lookup_failed');
        if (claimed) {
          fired += 1;
        }
      }
    }
  }

  return { blocksScanned: data?.length ?? 0, stepsFired: fired };
}

async function loadAssignmentBlocks(
  supabase: Supabase,
  assignmentIds: string[],
): Promise<
  Array<{
    assignmentId: string;
    blockId: string;
    blockStartAt: Date;
    houseId: string;
    status: string;
  }>
> {
  if (assignmentIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id, block_id, status, shift_blocks!inner(block_start_at, house_id)')
    .in('assignment_id', assignmentIds);

  if (error !== null) {
    throw error;
  }

  return (data ?? []).flatMap((row) => {
    const joinedBlock = nestedOne(
      row.shift_blocks as { block_start_at: string; house_id: string } | null,
    );
    return joinedBlock === null
      ? []
      : [
          {
            assignmentId: row.assignment_id,
            blockId: row.block_id,
            blockStartAt: new Date(joinedBlock.block_start_at),
            houseId: joinedBlock.house_id,
            status: row.status,
          },
        ];
  });
}

type NoAckRpcResult = {
  processed: boolean;
  block_id?: string;
  block_start_at?: string;
  house_id?: string;
  hmod_step_claimed?: boolean;
  reason?: string;
};

async function processNoAckFloats(
  supabase: Supabase,
  now: Date,
  config: RuntimeConfig,
): Promise<number> {
  // Pre-filter pending floats by lookahead so the RPC only runs for
  // floats within the no-ack window. The RPC also re-validates this
  // under FOR UPDATE as defense-in-depth.
  const { data: floats, error } = await supabase
    .from('float_assignments')
    .select('float_id, destination_assignment_ids')
    .eq('status', 'pending')
    .is('acknowledged_at', null)
    .is('declined_at', null);

  if (error !== null) {
    throw error;
  }

  let processed = 0;
  for (const floatRow of floats ?? []) {
    const destinationRows = await loadAssignmentBlocks(
      supabase,
      floatRow.destination_assignment_ids,
    );
    if (destinationRows.length === 0) {
      continue;
    }

    const earliestStart = Math.min(...destinationRows.map((row) => row.blockStartAt.getTime()));
    if (earliestStart > addMinutes(now, config.noAckLookaheadMinutes).getTime()) {
      continue;
    }

    // Atomic write — single transaction in the RPC. After the B-1
    // audit fix the RPC also INSERTs the HMOD-for-Allied notification
    // inside the same transaction (using the SQL recipient-resolution
    // helpers introduced in migration 20260528000004), so the
    // Edge Function no longer fans out to hmodNotifyAlliedStep on this
    // path.
    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_no_ack_float', {
      p_float_id: floatRow.float_id,
      p_now: now.toISOString(),
      p_lookahead_minutes: config.noAckLookaheadMinutes,
    });
    if (rpcError !== null) {
      throw rpcError;
    }

    const outcome = (rpcResult ?? null) as NoAckRpcResult | null;
    if (outcome === null || outcome.processed !== true) {
      continue;
    }
    processed += 1;
  }

  return processed;
}

async function expirePendingSwaps(supabase: Supabase, now: Date): Promise<number> {
  const { data, error } = await supabase
    .from('swap_requests')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lte('expires_at', now.toISOString())
    .select('swap_id');

  if (error !== null) {
    // swap_requests is specified in architecture but not introduced by
    // the earlier committed migrations in this branch. Keep the tick alive
    // until that table lands.
    if (String(error.message).includes('swap_requests')) {
      return 0;
    }
    throw error;
  }

  return data?.length ?? 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordHealth(supabase: Supabase, summary: TickSummary): Promise<void> {
  const { error } = await supabase.from('orchestrator_health').upsert(
    {
      singleton: true,
      last_tick_at: summary.tickedAt,
      blocks_scanned: summary.blocksScanned,
      steps_fired: summary.stepsFired,
      floats_voided: summary.floatsVoided,
      swaps_expired: summary.swapsExpired,
      errors: summary.errors,
    },
    { onConflict: 'singleton' },
  );
  if (error !== null) throw error;
}

// Source the orchestrator's "now" from the database app_now() so a dev simulated
// clock (dev_sim_clock offset) fast-forwards every escalation step. app_now()
// equals now() when the offset is 0, so production ticks are unaffected. Falls
// back to wall-clock time if the RPC is unavailable.
async function fetchAppNow(supabase: Supabase): Promise<Date> {
  try {
    const { data, error } = await supabase.rpc('app_now');
    if (error === null && typeof data === 'string') {
      const parsed = new Date(data);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  } catch {
    // fall through to wall clock
  }
  return new Date();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token !== serviceRoleKey) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const now = await fetchAppNow(supabase);
  const summary: TickSummary = {
    tickedAt: now.toISOString(),
    blocksScanned: 0,
    stepsFired: 0,
    floatsVoided: 0,
    swapsExpired: 0,
    errors: [],
  };

  let runtimeConfig: RuntimeConfig = {
    blockMinutes: DEFAULT_BLOCK_MINUTES,
    floatRetentionDays: DEFAULT_FLOAT_RETENTION_DAYS,
    noAckLookaheadMinutes: DEFAULT_NO_ACK_LOOKAHEAD_MINUTES,
  };
  try {
    runtimeConfig = await loadRuntimeConfig(supabase);
  } catch (error) {
    summary.errors.push(`system_config: ${errorMessage(error)}`);
  }

  // The vacant/float-lookup pass and swap-expiry are independent — run them
  // together. The no-ack pass must run AFTER the vacant pass, not concurrently:
  // a float ASSIGNED by float-lookup this tick whose acknowledgment window is
  // already in the past (a gap discovered or reopened inside T-15m) must be
  // voided in the SAME tick and routed to HMOD-for-Allied (BSpec §7.3). Run
  // concurrently (the prior behavior), the no-ack pass reads a snapshot taken
  // before float-lookup inserts those rows, so it cannot see them; the float
  // then lingers in `pending_float_in` — falsely showing the desk covered —
  // until a later tick. With manual-only orchestration (no pg_cron) that later
  // tick may be arbitrarily far away or never arrive. Sequencing makes the pass
  // read a fresh snapshot that includes the just-created float. Normal T-2h
  // floats are untouched: their start is > now + noAckLookahead, so they fall
  // outside the no-ack window and are never voided early.
  const [vacantResult, swapsResult] = await Promise.allSettled([
    processVacantBlocks(supabase, now, runtimeConfig),
    expirePendingSwaps(supabase, now),
  ]);
  const [noAckResult] = await Promise.allSettled([
    processNoAckFloats(supabase, now, runtimeConfig),
  ]);
  if (vacantResult.status === 'fulfilled') {
    summary.blocksScanned = vacantResult.value.blocksScanned;
    summary.stepsFired = vacantResult.value.stepsFired;
  } else {
    summary.errors.push(`vacant_blocks: ${errorMessage(vacantResult.reason)}`);
  }
  if (noAckResult.status === 'fulfilled') {
    summary.floatsVoided = noAckResult.value;
  } else {
    summary.errors.push(`no_ack_floats: ${errorMessage(noAckResult.reason)}`);
  }
  if (swapsResult.status === 'fulfilled') {
    summary.swapsExpired = swapsResult.value;
  } else {
    summary.errors.push(`pending_swaps: ${errorMessage(swapsResult.reason)}`);
  }

  try {
    await recordHealth(supabase, summary);
  } catch (error) {
    summary.errors.push(`health_record: ${errorMessage(error)}`);
  }
  console.log(JSON.stringify({ event: 'orchestrator_tick', ...summary }));

  return jsonResponse(
    { ok: summary.errors.length === 0, ...summary },
    summary.errors.length ? 500 : 200,
  );
});
