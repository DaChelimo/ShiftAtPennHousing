// Phase parity (T2-5) — Set preference-submission deadline (BSpec §4.2 / §6.11).
//
// POST /set-preference-deadline
//   body: { period_id: uuid, preference_deadline: ISO-8601 timestamptz }
//
// An SM/HM/BM sets the deadline for preference submission. Identity comes from
// the bearer token (never the body). The role gate and the deadline validation
// live in the SECURITY DEFINER set_preference_deadline RPC; this Edge Function
// is the thin HTTP/authn wrapper (mirrors modify-weekly-cap).

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

  const { period_id: periodId, preference_deadline: preferenceDeadline } = body as {
    period_id?: unknown;
    preference_deadline?: unknown;
  };

  if (!isUuid(periodId)) {
    return jsonResponse({ error: 'period_id must be a UUID' }, 400);
  }
  if (typeof preferenceDeadline !== 'string' || Number.isNaN(Date.parse(preferenceDeadline))) {
    return jsonResponse({ error: 'preference_deadline must be an ISO-8601 timestamp' }, 400);
  }

  const { data, error } = await supabase
    .rpc('set_preference_deadline', {
      p_actor_user_id: user.id,
      p_period_id: periodId,
      p_preference_deadline: new Date(preferenceDeadline).toISOString(),
    })
    .single();
  if (error !== null) {
    // Role gate raises insufficient_privilege (42501) -> 403; everything else 400.
    const status = error.code === '42501' ? 403 : 400;
    return jsonResponse({ error: error.message }, status);
  }

  return jsonResponse({ ok: true, period: data });
});
