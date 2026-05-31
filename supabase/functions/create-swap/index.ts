import {
  authenticate,
  edgeHandler,
  isUuid,
  isUuidArray,
  jsonResponse,
  readObjectBody,
  type Supabase,
} from '../_shared/swap-http.ts';

type SwapType = 'shift_swap' | 'float_swap' | 'permanent_swap';

type AssignmentSnapshot = {
  assignment_id: string;
  user_id: string | null;
  is_float: boolean;
  is_cross_house_pickup: boolean;
  status: string;
  shift_blocks:
    | { house_id: string; block_start_at: string }
    | Array<{
        house_id: string;
        block_start_at: string;
      }>;
};

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function nestedOne<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function assignmentKind(row: AssignmentSnapshot): 'shift' | 'float' | 'cross_house_pickup' {
  if (row.is_float) return 'float';
  if (row.is_cross_house_pickup) return 'cross_house_pickup';
  return 'shift';
}

async function loadAssignments(
  supabase: Supabase,
  assignmentIds: string[],
): Promise<AssignmentSnapshot[]> {
  const { data, error } = await supabase
    .from('shift_block_assignments')
    .select(
      'assignment_id,user_id,is_float,is_cross_house_pickup,status,shift_blocks!inner(house_id,block_start_at)',
    )
    .in('assignment_id', assignmentIds);

  if (error !== null) {
    throw error;
  }

  return (data ?? []) as AssignmentSnapshot[];
}

async function loadHomeHouseIds(
  supabase: Supabase,
  userIds: string[],
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('users')
    .select('user_id,home_house_id,is_active')
    .in('user_id', userIds);

  if (error !== null) {
    throw error;
  }

  const result = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.is_active === true) {
      result.set(row.user_id, row.home_house_id);
    }
  }
  return result;
}

async function loadPendingSwaps(
  supabase: Supabase,
  userIds: string[],
): Promise<{ swapId: string; assignmentIds: string[] }[]> {
  const { data, error } = await supabase
    .from('swap_requests')
    .select('swap_id,initiator_assignment_ids,counterparty_assignment_ids')
    .eq('status', 'pending')
    .or(
      userIds
        .map((userId) => `initiator_user_id.eq.${userId},counterparty_user_id.eq.${userId}`)
        .join(','),
    );

  if (error !== null) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    swapId: row.swap_id,
    assignmentIds: [
      ...(row.initiator_assignment_ids ?? []),
      ...(row.counterparty_assignment_ids ?? []),
    ],
  }));
}

async function computeExpiresAt(
  swapType: SwapType,
  createdAt: Date,
  assignments: AssignmentSnapshot[],
): Promise<Date> {
  if (swapType === 'permanent_swap') {
    return addHours(createdAt, 24 * 7);
  }

  const starts = assignments.map((assignment) =>
    new Date(nestedOne(assignment.shift_blocks).block_start_at).getTime(),
  );

  if (swapType === 'shift_swap') {
    return addHours(new Date(Math.min(...starts)), -3);
  }

  return addHours(addMinutes(new Date(Math.max(...starts)), 30), 24);
}

Deno.serve(
  edgeHandler('create-swap', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;

    const {
      swap_type: swapType,
      counterparty_user_id: counterpartyUserId,
      initiator_assignment_ids: initiatorAssignmentIds,
      counterparty_assignment_ids: counterpartyAssignmentIds,
      recurring_pattern: recurringPattern,
    } = parsed.body;

    if (swapType !== 'shift_swap' && swapType !== 'float_swap' && swapType !== 'permanent_swap') {
      return jsonResponse({ error: 'swap_type_invalid' }, 400);
    }
    if (!isUuid(counterpartyUserId)) {
      return jsonResponse({ error: 'counterparty_user_id must be a UUID' }, 400);
    }
    if (!isUuidArray(initiatorAssignmentIds)) {
      return jsonResponse(
        { error: 'initiator_assignment_ids must be a non-empty UUID array' },
        400,
      );
    }
    if (swapType !== 'permanent_swap' && !isUuidArray(counterpartyAssignmentIds)) {
      return jsonResponse(
        { error: 'counterparty_assignment_ids must be a non-empty UUID array' },
        400,
      );
    }

    const concreteCounterpartyIds =
      Array.isArray(counterpartyAssignmentIds) && counterpartyAssignmentIds.every(isUuid)
        ? counterpartyAssignmentIds
        : [];
    const touchedAssignmentIds = [...initiatorAssignmentIds, ...concreteCounterpartyIds];

    try {
      const assignments = await loadAssignments(auth.supabase, touchedAssignmentIds);
      if (assignments.length !== touchedAssignmentIds.length) {
        return jsonResponse({ error: 'assignment_not_found' }, 404);
      }

      const initiatorRows = assignments.filter((row) =>
        initiatorAssignmentIds.includes(row.assignment_id),
      );
      const counterpartyRows = assignments.filter((row) =>
        concreteCounterpartyIds.includes(row.assignment_id),
      );

      if (initiatorRows.some((row) => row.user_id !== auth.userId)) {
        return jsonResponse({ error: 'initiator_span_not_owned' }, 403);
      }
      if (
        swapType !== 'permanent_swap' &&
        counterpartyRows.some((row) => row.user_id !== counterpartyUserId)
      ) {
        return jsonResponse({ error: 'counterparty_span_not_owned' }, 403);
      }

      const homeHouseIds = await loadHomeHouseIds(auth.supabase, [auth.userId, counterpartyUserId]);
      const initiatorHomeHouseId = homeHouseIds.get(auth.userId);
      const counterpartyHomeHouseId = homeHouseIds.get(counterpartyUserId);
      if (initiatorHomeHouseId === undefined || counterpartyHomeHouseId === undefined) {
        return jsonResponse({ error: 'user_inactive' }, 403);
      }

      const module =
        (await import('../../../packages/core/src/swaps/eligibility.ts')) as typeof import('../../../packages/core/src/swaps/eligibility.ts');

      if (swapType !== 'permanent_swap') {
        const eligibility = module.evaluateSwapEligibility({
          swapType,
          initiator: {
            userId: auth.userId,
            homeHouseId: initiatorHomeHouseId,
            span: initiatorRows.map((row) => ({
              assignmentId: row.assignment_id,
              houseId: nestedOne(row.shift_blocks).house_id,
              kind: assignmentKind(row),
              inPendingFloat:
                row.status === 'pending_float_in' || row.status === 'pending_float_out',
            })),
          },
          counterparty: {
            userId: counterpartyUserId,
            homeHouseId: counterpartyHomeHouseId,
            span: counterpartyRows.map((row) => ({
              assignmentId: row.assignment_id,
              houseId: nestedOne(row.shift_blocks).house_id,
              kind: assignmentKind(row),
              inPendingFloat:
                row.status === 'pending_float_in' || row.status === 'pending_float_out',
            })),
          },
        });

        if (!eligibility.eligible) {
          return jsonResponse(
            { error: eligibility.violations[0]?.reason, violations: eligibility.violations },
            409,
          );
        }
      }

      const pendingSwaps = await loadPendingSwaps(auth.supabase, [auth.userId, counterpartyUserId]);
      const conflicts = module.findConflictingPendingSwaps({
        newAssignmentIds: touchedAssignmentIds,
        pendingSwaps,
      });
      if (conflicts.length > 0) {
        return jsonResponse(
          { error: 'pending_swap_conflict', conflicting_swap_ids: conflicts },
          409,
        );
      }

      const createdAt = new Date();
      const expiresAt = await computeExpiresAt(swapType, createdAt, assignments);
      const { data, error } = await auth.supabase
        .from('swap_requests')
        .insert({
          swap_type: swapType,
          initiator_user_id: auth.userId,
          counterparty_user_id: counterpartyUserId,
          initiator_assignment_ids: initiatorAssignmentIds,
          counterparty_assignment_ids:
            swapType === 'permanent_swap' && concreteCounterpartyIds.length === 0
              ? null
              : concreteCounterpartyIds,
          recurring_pattern: recurringPattern ?? null,
          created_at: createdAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .select('swap_id,expires_at,status')
        .single();

      if (error !== null) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse(data, 201);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'swap_create_failed' },
        500,
      );
    }
  }),
);
