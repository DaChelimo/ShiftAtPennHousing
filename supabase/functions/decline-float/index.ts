import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// decline-float (parity T1-4): thin worker-authenticated wrapper around the
// service-role-only `decline_float` RPC (migration 20260528000014). Same shape as
// acknowledge-float: authenticate the bearer, call the RPC with the service-role key
// and the AUTHENTICATED user's id. Declining reopens the destination block as the
// original gap (temporary_drop), excludes the decliner for the gap window, and
// restores the floater to their home seat — the worker's own decline is the one
// legitimate manual action permitted under no-takeback (AGENTS invariant #3).
//
// Idempotent on terminal state: a float not in `pending` returns
// { declined: false, reason: 'not_pending' }, passed through as a 200.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/decline-float)?\/decline-float$/.test(pathname)) {
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

  const { data, error } = await supabase.rpc('decline_float', {
    p_float_id: floatId,
    p_user_id: user.id,
    p_now: new Date().toISOString(),
  });

  if (error !== null) {
    return jsonResponse({ error: errorCode(error.message) }, 400);
  }

  return jsonResponse(data ?? { declined: false, reason: 'not_pending' });
});
