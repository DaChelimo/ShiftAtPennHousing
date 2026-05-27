import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
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

function extractTargetUserId(pathname: string): string | null {
  const match = pathname.match(
    /^(?:\/users-broadcast-subscription)?\/users\/([^/]+)\/broadcast_subscribed$/,
  );

  return match?.[1] ?? null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const targetUserId = extractTargetUserId(new URL(req.url).pathname);
  if (targetUserId === null) {
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

  if (user.id !== targetUserId) {
    return jsonResponse({ error: 'Cannot modify another user' }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const broadcastSubscribed =
    typeof body === 'object' && body !== null && 'broadcast_subscribed' in body
      ? (body as { broadcast_subscribed: unknown }).broadcast_subscribed
      : undefined;

  if (typeof broadcastSubscribed !== 'boolean') {
    return jsonResponse({ error: 'broadcast_subscribed must be a boolean' }, 400);
  }

  if (broadcastSubscribed === true) {
    const { data: roles, error: rolesError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', targetUserId)
      .in('role', ['hm', 'bm']);

    if (rolesError !== null) {
      return jsonResponse({ error: rolesError.message }, 500);
    }

    if ((roles?.length ?? 0) > 0) {
      return jsonResponse(
        { error: 'HMs and BMs cannot subscribe to broadcast notifications' },
        403,
      );
    }
  }

  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update({ broadcast_subscribed: broadcastSubscribed })
    .eq('user_id', targetUserId)
    .select('user_id, broadcast_subscribed')
    .single();

  if (updateError !== null) {
    return jsonResponse({ error: updateError.message }, 400);
  }

  return jsonResponse(updatedUser);
});
