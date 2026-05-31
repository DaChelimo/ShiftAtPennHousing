import { authenticate, jsonResponse, readObjectBody, type Supabase } from '../_shared/swap-http.ts';

const TIMEZONE = 'America/New_York';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type AssignmentSnapshot = {
  assignment_id: string;
  shift_blocks:
    | { house_id: string; block_start_at: string }
    | Array<{ house_id: string; block_start_at: string }>;
};

function nestedOne<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0]! : value;
}

function localParts(at: Date): { dayOfWeek: number; blockStartLocal: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));

  return { dayOfWeek, blockStartLocal: `${get('hour')}:${get('minute')}` };
}

function isBlockStartLocal(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isBlockStartLocals(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isBlockStartLocal);
}

async function operatorCanRemove(
  supabase: Supabase,
  operatorUserId: string,
  houseId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('user_id', operatorUserId)
    .eq('scope_house_id', houseId)
    .in('role', ['sm', 'hm', 'bm'])
    .limit(1);

  if (error !== null) throw error;
  return (data ?? []).length > 0;
}

async function loadFloatCommitmentWarnings(
  supabase: Supabase,
  droppingUserId: string,
  houseId: string,
  dayOfWeek: number,
  blockStartLocals: string[],
): Promise<{ floatId: string; status: 'pending' | 'acknowledged' }[]> {
  const { data: assignments, error: assignmentError } = await supabase
    .from('shift_block_assignments')
    .select('assignment_id,shift_blocks!inner(house_id,block_start_at)')
    .eq('shift_blocks.house_id', houseId);

  if (assignmentError !== null) throw assignmentError;

  const slotAssignmentIds = ((assignments ?? []) as AssignmentSnapshot[])
    .filter((assignment) => {
      const block = nestedOne(assignment.shift_blocks);
      const local = localParts(new Date(block.block_start_at));
      return (
        block.house_id === houseId &&
        local.dayOfWeek === dayOfWeek &&
        blockStartLocals.includes(local.blockStartLocal)
      );
    })
    .map((assignment) => assignment.assignment_id);

  const { data: floats, error: floatError } = await supabase
    .from('float_assignments')
    .select('float_id,status,source_assignment_ids')
    .eq('user_id', droppingUserId)
    .in('status', ['pending', 'acknowledged']);

  if (floatError !== null) throw floatError;

  const module =
    (await import('../../../packages/core/src/permanent-ops/drop-scope.ts')) as typeof import('../../../packages/core/src/permanent-ops/drop-scope.ts');

  return module.findFloatCommitmentWarnings({
    slotAssignmentIds,
    floatCommitments: (floats ?? []).map((float) => ({
      floatId: float.float_id,
      status: float.status,
      sourceAssignmentIds: float.source_assignment_ids,
    })),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/permanent-drop)?\/permanent-drop$/.test(pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const parsed = await readObjectBody(req);
  if (!parsed.ok) return parsed.response;

  const {
    dropping_user_id: requestedDroppingUserId,
    house_id: houseId,
    day_of_week: dayOfWeek,
    block_start_locals: blockStartLocals,
    drop_initiated_at: requestedDropInitiatedAt,
  } = parsed.body;

  const droppingUserId = requestedDroppingUserId ?? auth.userId;
  if (!isUuid(droppingUserId)) {
    return jsonResponse({ error: 'dropping_user_id must be a UUID' }, 400);
  }
  if (typeof houseId !== 'string' || houseId.length === 0) {
    return jsonResponse({ error: 'house_id must be a non-empty string' }, 400);
  }
  if (!Number.isInteger(dayOfWeek) || Number(dayOfWeek) < 0 || Number(dayOfWeek) > 6) {
    return jsonResponse({ error: 'day_of_week must be an integer from 0 through 6' }, 400);
  }
  if (!isBlockStartLocals(blockStartLocals)) {
    return jsonResponse({ error: 'block_start_locals must be a non-empty HH:MM block array' }, 400);
  }

  const dropInitiatedAt =
    requestedDropInitiatedAt === undefined
      ? new Date()
      : new Date(String(requestedDropInitiatedAt));
  if (Number.isNaN(dropInitiatedAt.getTime())) {
    return jsonResponse({ error: 'drop_initiated_at must be a valid timestamp' }, 400);
  }

  try {
    const selfInitiated = droppingUserId === auth.userId;
    if (!selfInitiated && !(await operatorCanRemove(auth.supabase, auth.userId, houseId))) {
      return jsonResponse({ error: 'permanent_removal_forbidden' }, 403);
    }

    const floatCommitmentWarnings = await loadFloatCommitmentWarnings(
      auth.supabase,
      droppingUserId,
      houseId,
      Number(dayOfWeek),
      blockStartLocals,
    );

    const { data, error } = await auth.supabase.rpc('permanent_drop_slot', {
      p_dropping_user_id: droppingUserId,
      p_house_id: houseId,
      p_day_of_week: Number(dayOfWeek),
      p_block_start_locals: blockStartLocals,
      p_drop_initiated_at: dropInitiatedAt.toISOString(),
      p_operator_user_id: selfInitiated ? null : auth.userId,
    });

    if (error !== null) {
      return jsonResponse({ error: error.message.trim().split(/\s+/)[0] }, 400);
    }

    return jsonResponse({
      ...data,
      float_commitment_warning:
        floatCommitmentWarnings.length === 0
          ? null
          : {
              count: floatCommitmentWarnings.length,
              commitments: floatCommitmentWarnings,
            },
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
