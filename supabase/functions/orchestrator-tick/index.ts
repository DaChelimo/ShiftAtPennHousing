import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TIMEZONE = 'America/New_York';
const LOOKAHEAD_MINUTES = 3 * 60 + 5;
const NO_ACK_LOOKAHEAD_MINUTES = 15;
const BLOCK_MINUTES = 30;
const FLOAT_RETENTION_DAYS = 14;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Supabase = ReturnType<typeof createClient>;
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

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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

function timeOfDayMs(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (match === null) {
    throw new Error(`invalid time of day: ${value}`);
  }
  return (Number(match[1]) * 60 + Number(match[2])) * 60 * 1000;
}

function isHmWorkingTime(date: Date, start = '08:00', end = '17:00'): boolean {
  const parts = localParts(date, TIMEZONE);
  return (
    parts.weekday >= 1 &&
    parts.weekday <= 5 &&
    parts.msSinceMidnight >= timeOfDayMs(start) &&
    parts.msSinceMidnight < timeOfDayMs(end)
  );
}

function notificationTarget(blockStartAt: Date, firedAt: Date): 'hm' | 'hmod' {
  return isHmWorkingTime(firedAt) && isHmWorkingTime(blockStartAt) ? 'hm' : 'hmod';
}

function hmodWeekStartDate(date: Date): string {
  const parts = localParts(date, TIMEZONE);
  let daysSinceMonday = (parts.weekday + 6) % 7;
  if (parts.weekday === 1 && parts.msSinceMidnight < timeOfDayMs('08:00')) {
    daysSinceMonday = 7;
  }

  const localMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  return new Date(localMidnightUtc - daysSinceMonday * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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

function stepFireAt(blockStartAt: Date, step: ChainStep): number {
  return blockStartAt.getTime() + step.offsetMinutes * 60 * 1000;
}

function evaluateChainSteps(params: {
  blockStartAt: Date;
  now: Date;
  chain: ChainStep[];
  stepStatus: StepStatusMap;
}): ChainStepEvaluation[] {
  const nowMs = params.now.getTime();
  if (nowMs >= params.blockStartAt.getTime()) {
    return [];
  }

  const maxReachedMissingOffset = params.chain.reduce<number | null>((maxOffset, step) => {
    if (
      params.stepStatus[step.stepName] !== undefined ||
      nowMs < stepFireAt(params.blockStartAt, step)
    ) {
      return maxOffset;
    }
    return maxOffset === null ? step.offsetMinutes : Math.max(maxOffset, step.offsetMinutes);
  }, null);

  return params.chain.flatMap((step) => {
    const status = params.stepStatus[step.stepName];
    const fireAt = stepFireAt(params.blockStartAt, step);
    if (nowMs < fireAt) {
      return [];
    }
    if (status === 'fired' || status === 'completed_via_force_trigger') {
      return [];
    }
    if (status === 'rolled_back') {
      return nowMs === fireAt
        ? [
            {
              stepName: step.stepName,
              ...(step.trigger === undefined ? {} : { trigger: step.trigger }),
            },
          ]
        : [];
    }
    if (maxReachedMissingOffset !== null && step.offsetMinutes < maxReachedMissingOffset) {
      return [];
    }
    return [
      { stepName: step.stepName, ...(step.trigger === undefined ? {} : { trigger: step.trigger }) },
    ];
  });
}

async function findFloaters(input: FloatLookupInput): Promise<FloatLookupResult> {
  const module = (await import('../../../packages/core/src/float-lookup/index.ts')) as {
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

async function broadcastStep(supabase: Supabase, block: BlockRef, firedAt: Date): Promise<number> {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('user_id')
    .eq('broadcast_subscribed', true)
    .eq('home_house_id', block.houseId)
    .eq('is_active', true);

  if (usersError !== null) {
    throw usersError;
  }

  const rows = (users ?? []).map((user) => ({
    recipient_user_id: user.user_id,
    type: 'broadcast',
    scheduled_for: firedAt.toISOString(),
    payload: {
      block_id: block.blockId,
      house_id: block.houseId,
      block_start_at: block.blockStartAt.toISOString(),
    },
  }));

  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabase.from('notifications').insert(rows);
  if (error !== null) {
    throw error;
  }

  return rows.length;
}

async function resolveLeaveReplacement(
  supabase: Supabase,
  userId: string,
  at: Date,
): Promise<string | null> {
  const leaveDate = localDateIso(at);
  let currentUserId: string | null = userId;

  for (let depth = 0; depth < 10 && currentUserId !== null; depth += 1) {
    const { data: leave, error } = await supabase
      .from('hm_leave')
      .select('replacement_user_id')
      .eq('user_id', currentUserId)
      .eq('status', 'active')
      .lte('start_date', leaveDate)
      .gte('end_date', leaveDate)
      .limit(1)
      .maybeSingle();

    if (error !== null) {
      throw error;
    }
    if (leave === null) {
      return currentUserId;
    }
    currentUserId = leave.replacement_user_id;
  }

  return null;
}

async function firstActiveUser(supabase: Supabase, userIds: string[]): Promise<string | null> {
  if (userIds.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from('users')
    .select('user_id')
    .in('user_id', userIds)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error !== null) {
    throw error;
  }
  return data?.user_id ?? null;
}

async function resolveHmForHouse(
  supabase: Supabase,
  houseId: string,
  at: Date,
): Promise<string | null> {
  const { data: roles, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'hm')
    .eq('scope_house_id', houseId);

  if (error !== null) {
    throw error;
  }

  for (const role of roles ?? []) {
    const resolved = await resolveLeaveReplacement(supabase, role.user_id, at);
    const active = resolved === null ? null : await firstActiveUser(supabase, [resolved]);
    if (active !== null) {
      return active;
    }
  }

  return null;
}

async function resolveHmod(supabase: Supabase, at: Date): Promise<string | null> {
  const { data, error } = await supabase
    .from('hmod_rotor')
    .select('hmod_user_id')
    .eq('week_start_date', hmodWeekStartDate(at))
    .maybeSingle();

  if (error !== null || data === null) {
    return null;
  }

  const resolved = await resolveLeaveReplacement(supabase, data.hmod_user_id, at);
  return resolved === null ? null : firstActiveUser(supabase, [resolved]);
}

async function hmodNotifyAlliedStep(
  supabase: Supabase,
  block: BlockRef,
  firedAt: Date,
  reason = 'escalation_chain',
): Promise<number> {
  const target = notificationTarget(block.blockStartAt, firedAt);
  const recipient =
    target === 'hm'
      ? ((await resolveHmForHouse(supabase, block.houseId, firedAt)) ??
        (await resolveHmod(supabase, firedAt)))
      : await resolveHmod(supabase, firedAt);

  if (recipient === null) {
    return 0;
  }

  const { error } = await supabase.from('notifications').insert({
    recipient_user_id: recipient,
    type: 'hmod_urgent',
    scheduled_for: firedAt.toISOString(),
    payload: {
      target,
      reason,
      block_id: block.blockId,
      house_id: block.houseId,
      block_start_at: block.blockStartAt.toISOString(),
    },
  });

  if (error !== null) {
    throw error;
  }

  return 1;
}

async function loadVacantGap(
  supabase: Supabase,
  block: VacantAssignment,
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

  const sorted = [...byBlock.values()].sort(
    (left, right) => left.blockStartAt.getTime() - right.blockStartAt.getTime(),
  );
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
    expectedStart += BLOCK_MINUTES * 60 * 1000;
  }

  return gap;
}

async function buildFloatLookupSnapshot(
  supabase: Supabase,
  block: VacantAssignment,
  profileName: string,
): Promise<FloatLookupSnapshot> {
  const gapRows = await loadVacantGap(supabase, block);
  const gapBlocks = gapRows.map((row) => ({
    blockId: row.blockId,
    blockStartAt: row.blockStartAt,
  }));
  const destinationAssignmentByBlockId = new Map(
    gapRows.map((row) => [row.blockId, row.assignmentId]),
  );
  const gapStart = gapBlocks[0]?.blockStartAt ?? block.blockStartAt;
  const gapEnd = addMinutes(gapBlocks.at(-1)?.blockStartAt ?? block.blockStartAt, BLOCK_MINUTES);

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
          hasConflictingFloat: false,
          hasConflictingCrossHousePickup: false,
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
): Promise<'float_assigned' | 'no_float'> {
  const snapshot = await buildFloatLookupSnapshot(supabase, block, profileName);
  const result = await findFloaters(snapshot.input);

  if (result.assignments.length === 0) {
    return 'no_float';
  }

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

    const latestBlockStart = Math.max(
      ...snapshot.input.gap.blocks
        .filter((gapBlock) => assignment.blocks.includes(gapBlock.blockId))
        .map((gapBlock) => gapBlock.blockStartAt.getTime()),
    );
    const { data: floatRow, error: floatError } = await supabase
      .from('float_assignments')
      .insert({
        user_id: assignment.workerId,
        source_assignment_ids: sourceAssignmentIds,
        destination_assignment_ids: destinationAssignmentIds,
        status: 'pending',
        initiated_by: 'automated',
        expires_for_cleanup_at: addDays(
          new Date(latestBlockStart),
          FLOAT_RETENTION_DAYS,
        ).toISOString(),
      })
      .select('float_id')
      .single();

    if (floatError !== null) {
      throw floatError;
    }

    const { error: destinationError } = await supabase
      .from('shift_block_assignments')
      .update({
        user_id: assignment.workerId,
        status: 'pending_float_in',
        vacancy_origin: 'none',
        is_float: true,
        source_house_id: assignment.sourceHouseId,
        parent_float_id: floatRow.float_id,
      })
      .in('assignment_id', destinationAssignmentIds);

    if (destinationError !== null) {
      throw destinationError;
    }

    const { error: sourceError } = await supabase
      .from('shift_block_assignments')
      .update({
        status: 'pending_float_out',
        vacancy_origin: 'none',
        is_float: true,
        source_house_id: assignment.sourceHouseId,
        parent_float_id: floatRow.float_id,
      })
      .in('assignment_id', sourceAssignmentIds);

    if (sourceError !== null) {
      throw sourceError;
    }

    await supabase.from('notifications').insert({
      recipient_user_id: assignment.workerId,
      type: 'personal_shift',
      scheduled_for: firedAt.toISOString(),
      payload: {
        kind: 'float_assigned',
        float_id: floatRow.float_id,
        destination_house_id: block.houseId,
        block_ids: assignment.blocks,
      },
    });
  }

  return 'float_assigned';
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

async function fireStep(params: {
  supabase: Supabase;
  block: VacantAssignment;
  profileName: string;
  stepName: string;
  firedAt: Date;
}): Promise<'float_assigned' | 'no_float' | 'done'> {
  switch (params.stepName) {
    case 'broadcast':
      await broadcastStep(params.supabase, params.block, params.firedAt);
      return 'done';
    case 'float_lookup':
      return await floatLookupStep(
        params.supabase,
        params.block,
        params.profileName,
        params.firedAt,
      );
    case 'hmod_notify_allied':
      await hmodNotifyAlliedStep(params.supabase, params.block, params.firedAt);
      return 'done';
    default:
      return 'done';
  }
}

async function processVacantBlocks(supabase: Supabase, now: Date): Promise<number> {
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

  let fired = 0;
  for (const row of data ?? []) {
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
    const dueSteps = evaluateChainSteps({
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

      const claimed = await claimStep(supabase, block.blockId, step.stepName, now);
      if (!claimed) {
        continue;
      }

      const outcome = await fireStep({
        supabase,
        block,
        profileName: profile.profileName,
        stepName: step.stepName,
        firedAt: now,
      });
      fired += 1;

      if (outcome === 'float_assigned') {
        floatAssignedThisTick = true;
      }
      if (
        outcome === 'no_float' &&
        !dueSteps.some((candidate) => candidate.stepName === 'hmod_notify_allied')
      ) {
        const hmodClaimed = await claimStep(supabase, block.blockId, 'hmod_notify_allied', now);
        if (hmodClaimed) {
          await hmodNotifyAlliedStep(supabase, block, now, 'float_lookup_failed');
          fired += 1;
        }
      }
    }
  }

  return fired;
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

async function processNoAckFloats(supabase: Supabase, now: Date): Promise<number> {
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
    if (earliestStart > addMinutes(now, NO_ACK_LOOKAHEAD_MINUTES).getTime()) {
      continue;
    }

    // Atomic write — single transaction in the RPC. See ARCH §4.4 and
    // migration 20260528000003 for the full set of writes performed.
    const { data: rpcResult, error: rpcError } = await supabase.rpc('process_no_ack_float', {
      p_float_id: floatRow.float_id,
      p_now: now.toISOString(),
      p_lookahead_minutes: NO_ACK_LOOKAHEAD_MINUTES,
    });
    if (rpcError !== null) {
      throw rpcError;
    }

    const outcome = (rpcResult ?? null) as NoAckRpcResult | null;
    if (outcome === null || outcome.processed !== true) {
      continue;
    }

    if (
      outcome.hmod_step_claimed === true &&
      outcome.block_id !== undefined &&
      outcome.block_start_at !== undefined &&
      outcome.house_id !== undefined
    ) {
      // Notification fires after the RPC's transaction commits so
      // external delivery only happens once the state changes are
      // durable. ARCH §4.4 explicitly orders this after the rollback
      // write.
      await hmodNotifyAlliedStep(
        supabase,
        {
          blockId: outcome.block_id,
          blockStartAt: new Date(outcome.block_start_at),
          houseId: outcome.house_id,
        },
        now,
        'float_no_acknowledgment',
      );
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

  const now = new Date();
  const [stepsFired, floatsVoided, swapsExpired] = await Promise.all([
    processVacantBlocks(supabase, now),
    processNoAckFloats(supabase, now),
    expirePendingSwaps(supabase, now),
  ]);

  return jsonResponse({
    ok: true,
    stepsFired,
    floatsVoided,
    swapsExpired,
    tickedAt: now.toISOString(),
  });
});
