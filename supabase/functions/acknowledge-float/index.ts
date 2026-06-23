import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { fetchAppNow } from '../_shared/clock.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// acknowledge-float (parity T1-4): thin worker-authenticated wrapper around the
// service-role-only `acknowledge_float` RPC (migration 20260528000014). The RPC is
// GRANTed to service_role only, so the worker app cannot call it through PostgREST
// with its own JWT; this EF authenticates the bearer token, then calls the RPC with
// the service-role key passing the AUTHENTICATED user's id as p_user_id — the worker's
// own ack/decline is the one legitimate manual action permitted under no-takeback
// (AGENTS invariant #3). Mirrors claim-shift / drop-shift.
//
// The RPC is idempotent on terminal state: a float already acked/declined/voided
// server-side returns { acknowledged: false, reason: 'not_pending' } rather than
// erroring, which the EF passes through as a 200.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/acknowledge-float)?\/acknowledge-float$/.test(pathname)) {
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

  const { float_id: floatId } = body as { float_id?: unknown };

  if (!isUuid(floatId)) {
    return jsonResponse({ error: 'float_id must be a UUID' }, 400);
  }

  const { data, error } = await supabase.rpc('acknowledge_float', {
    p_float_id: floatId,
    p_user_id: user.id,
    p_now: (await fetchAppNow(supabase)).toISOString(),
  });

  if (error !== null) {
    return jsonResponse({ error: errorCode(error.message) }, 400);
  }

  return jsonResponse(data ?? { acknowledged: false, reason: 'not_pending' });
});
