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

// acknowledge-allied-page: thin worker-authenticated wrapper around the service-role-only
// `acknowledge_allied_page` RPC (migration 20260713000001). Mirrors acknowledge-float.
//
// During the staggered pilot, an off-hours coverage-lock event routes through the
// Allied-page ladder (responsible worker -> SM -> desk). "I've called the desk" is the
// one legitimate manual action that resolves the ladder so no further rung fires. The
// RPC verifies the caller actually received an allied_page alert for the block, so a
// user cannot resolve a ladder they were never paged for.
//
// Idempotent on terminal state: a ladder already acknowledged/resolved returns
// { acknowledged: false, reason: 'already_resolved' }, passed through as a 200.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/acknowledge-allied-page)?\/acknowledge-allied-page$/.test(pathname)) {
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

  const { block_id: blockId } = body as { block_id?: unknown };

  if (!isUuid(blockId)) {
    return jsonResponse({ error: 'block_id must be a UUID' }, 400);
  }

  const { data, error } = await supabase.rpc('acknowledge_allied_page', {
    p_block_id: blockId,
    p_user_id: user.id,
    p_now: (await fetchAppNow(supabase)).toISOString(),
  });

  if (error !== null) {
    return jsonResponse({ error: errorCode(error.message) }, 400);
  }

  return jsonResponse(data ?? { acknowledged: false, reason: 'not_found' });
});
