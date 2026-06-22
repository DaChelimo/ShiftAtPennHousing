import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const errorStatus: Record<string, number> = {
  break_claim_window_closed: 409,
  shift_unavailable: 409,
  harnwell_training_required: 403,
  time_conflict: 409,
  hard_cap_exceeded: 409,
  user_inactive: 403,
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

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function errorCode(message: string): string {
  return message.trim().split(/\s+/)[0] ?? message;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/break-claim)?\/break-claim$/.test(pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token === undefined) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

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
    assignment_id: assignmentId,
    claim_type: claimType,
    block_ids: blockIds,
  } = body as {
    assignment_id?: unknown;
    claim_type?: unknown;
    block_ids?: unknown;
  };

  if (claimType !== 'temporary') {
    return jsonResponse({ error: "claim_type must be 'temporary'" }, 400);
  }

  // Break calendar drag (§4.4 "The calendar picker"): claim one open seat per block,
  // FCFS-trimmed server-side by claim_break_blocks. The response carries exactly the
  // claimed (block, seat) pairs so the client reconciles its optimistic drag.
  if (blockIds !== undefined) {
    if (!Array.isArray(blockIds) || blockIds.length === 0 || !blockIds.every(isUuid)) {
      return jsonResponse({ error: 'block_ids must be a non-empty array of UUIDs' }, 400);
    }
    const { data: claimed, error: rangeError } = await supabase.rpc('claim_break_blocks', {
      p_block_ids: blockIds,
      p_user_id: user.id,
      p_as_of: new Date().toISOString(),
    });
    if (rangeError !== null) {
      const code = errorCode(rangeError.message);
      return jsonResponse({ error: code }, errorStatus[code] ?? 400);
    }
    return jsonResponse({
      claim_type: claimType,
      claimed: (claimed ?? []).map(
        (r: { claimed_block_id: string; claimed_assignment_id: string }) => ({
          block_id: r.claimed_block_id,
          assignment_id: r.claimed_assignment_id,
        }),
      ),
    });
  }

  if (!isUuid(assignmentId)) {
    return jsonResponse({ error: 'assignment_id must be a UUID' }, 400);
  }

  const { data: projection, error: projectionError } = await supabase
    .rpc('claim_hours_projection', {
      p_assignment_id: assignmentId,
      p_user_id: user.id,
    })
    .maybeSingle();

  if (projectionError !== null) {
    const code = errorCode(projectionError.message);
    return jsonResponse({ error: code }, errorStatus[code] ?? 400);
  }

  const { data: claimedAssignmentId, error: claimError } = await supabase.rpc('claim_break_shift', {
    p_assignment_id: assignmentId,
    p_user_id: user.id,
    p_as_of: new Date().toISOString(),
  });

  if (claimError !== null) {
    const code = errorCode(claimError.message);
    return jsonResponse({ error: code }, errorStatus[code] ?? 400);
  }

  return jsonResponse({
    assignment_id: claimedAssignmentId,
    claim_type: claimType,
    warning: projection?.soft_cap_warning === true ? 'soft_cap_exceeded' : null,
    currentHours: projection?.current_hours ?? null,
    projectedHours: projection?.projected_hours ?? null,
  });
});
