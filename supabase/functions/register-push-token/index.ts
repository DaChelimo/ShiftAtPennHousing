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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/register-push-token)?\/register-push-token$/.test(pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
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

  const { platform, device_token: deviceToken } =
    typeof body === 'object' && body !== null
      ? (body as { platform?: unknown; device_token?: unknown })
      : {};
  if (platform !== 'android' && platform !== 'ios') {
    return jsonResponse({ error: "platform must be 'android' or 'ios'" }, 400);
  }
  if (typeof deviceToken !== 'string' || deviceToken.trim() === '') {
    return jsonResponse({ error: 'device_token must be a non-empty string' }, 400);
  }

  // A device token identifies a PHONE, not an account, so it may belong to exactly one
  // user at a time. Evict every other user's claim on it before recording ours.
  //
  // Without this, account switching on one handset silently fans out: the upsert below is
  // keyed on (user_id, device_token), so signing in as a second person ADDS a row rather
  // than replacing one, and `dispatch-push` then sends that phone one push per account for
  // every notification either account receives. Found 2026-08-06 on the Harnwell pilot
  // phone, which held two rows (a `sw` and an `hm`) and so rang four times for a two-block
  // vacancy that had produced exactly two notification rows.
  //
  // Ordered before the upsert on purpose: the DELETE excludes our own user_id, so it can
  // never remove the row we are about to write, and a crash between the two statements
  // leaves the device unregistered (it re-registers on next launch) rather than
  // double-registered.
  const { error: evictError } = await supabase
    .from('push_tokens')
    .delete()
    .eq('device_token', deviceToken)
    .neq('user_id', user.id);

  if (evictError !== null) {
    return jsonResponse({ error: evictError.message }, 400);
  }

  const { data, error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        user_id: user.id,
        platform,
        device_token: deviceToken,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_token' },
    )
    .select('push_token_id, user_id, platform, device_token, created_at, last_used_at')
    .single();

  if (error !== null) {
    return jsonResponse({ error: error.message }, 400);
  }
  return jsonResponse(data);
});
