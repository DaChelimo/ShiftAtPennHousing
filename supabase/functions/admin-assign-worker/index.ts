// SM/HM/BM/RSM add-a-worker override (BSpec §2.2 / §4.4) — the mobile-safe HTTP
// wrapper around the admin_assign_worker RPC.
//
// POST /admin-assign-worker
//   body: {
//     assignment_ids: uuid[],        // the tapped vacant run's seat ids (house grid)
//     user_id: uuid,                 // the worker to assign
//     scope: 'this_week' | 'permanent',
//     override_advisories?: boolean  // resend true after a needs_confirm response
//   }
//
// WHY AN EDGE FUNCTION: the web calls admin_assign_worker through the service-role
// client and passes p_operator_user_id explicitly; the RPC authorizes purely on
// that param. A mobile client must NEVER be able to name the operator — so identity
// is derived from the bearer token here and passed as p_operator_user_id (mirrors
// force-trigger / set-preference-deadline). Never trust a body-supplied operator id.
//
// The house grid exposes seat assignment_ids, not block_ids, and a tapped "Open
// seat" is a coalesced run of several 30-minute vacant seats. So this function
// resolves assignment_ids -> distinct block_ids before calling the RPC, which
// operates at block granularity and fills a vacant seat in each block.
//
// The RPC owns all authorization (user_can_build_schedule scoped to the block's
// house -> a plain SM is own-house only), the same-house constraint, the hard cap,
// and the soft-advisory two-step confirm. This layer is thin authn + id resolution.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

// Business rejections the RPC RAISEs (SQLSTATE P0001). not_authorized is a 403; the
// rest are 409 conflicts the client surfaces as a friendly message.
const AUTHZ_REASONS = new Set(['not_authorized']);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
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
    assignment_ids: assignmentIds,
    user_id: assigneeId,
    scope,
    override_advisories: overrideAdvisories,
  } = body as {
    assignment_ids?: unknown;
    user_id?: unknown;
    scope?: unknown;
    override_advisories?: unknown;
  };

  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0 || !assignmentIds.every(isUuid)) {
    return jsonResponse({ error: 'assignment_ids must be a non-empty array of UUIDs' }, 400);
  }
  if (!isUuid(assigneeId)) {
    return jsonResponse({ error: 'user_id must be a UUID' }, 400);
  }
  if (scope !== 'this_week' && scope !== 'permanent') {
    return jsonResponse({ error: "scope must be 'this_week' or 'permanent'" }, 400);
  }
  const override = overrideAdvisories === true;

  // Resolve the tapped seats to their distinct block ids. The RPC keys on block_ids
  // (it fills a vacant seat in each block); the grid only gives us seat ids.
  const { data: seatRows, error: seatError } = await supabase
    .from('shift_block_assignments')
    .select('block_id')
    .in('assignment_id', assignmentIds);
  if (seatError !== null) {
    return jsonResponse({ error: seatError.message }, 400);
  }
  const blockIds = [...new Set((seatRows ?? []).map((r) => r.block_id as string))];
  if (blockIds.length === 0) {
    return jsonResponse({ error: 'block_not_found', reason: 'block_not_found' }, 409);
  }

  const { data, error } = await supabase.rpc('admin_assign_worker', {
    p_operator_user_id: user.id,
    p_block_ids: blockIds,
    p_user_id: assigneeId,
    p_scope: scope,
    p_override_advisories: override,
    p_now: new Date().toISOString(),
    p_incumbent_user_id: null,
  });
  if (error !== null) {
    // The RPC RAISEs business rejections as P0001 with the reason as the message.
    if (error.code === 'P0001') {
      const reason = error.message;
      const status = AUTHZ_REASONS.has(reason) ? 403 : 409;
      return jsonResponse({ error: 'assign_rejected', reason }, status);
    }
    return jsonResponse({ error: error.message }, 400);
  }

  // Passes through the RPC jsonb verbatim: either { needs_confirm: true, advisories }
  // (the client shows the confirm dialog and resends with override_advisories: true)
  // or { needs_confirm: false, assigned_count, scope, advisories }.
  return jsonResponse({ ok: true, result: data });
});
