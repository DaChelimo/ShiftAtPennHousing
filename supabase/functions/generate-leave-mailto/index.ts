import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isUuid(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(req.url);
  if (!/^(?:\/generate-leave-mailto)?\/leave-mailto$/.test(url.pathname)) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  const leaveId = url.searchParams.get('leave_id');
  if (!isUuid(leaveId)) {
    return jsonResponse({ error: 'leave_id must be a UUID' }, 400);
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

  const { data: leave, error: leaveError } = await supabase
    .from('hm_leave')
    .select('user_id')
    .eq('leave_id', leaveId)
    .maybeSingle();
  if (leaveError !== null) {
    return jsonResponse({ error: leaveError.message }, 500);
  }
  if (leave === null) {
    return jsonResponse({ error: 'Leave not found' }, 404);
  }
  if (leave.user_id !== user.id) {
    return jsonResponse({ error: "Cannot generate another user's leave email" }, 403);
  }

  const { data: mailtoUrl, error } = await supabase.rpc('craft_hm_leave_mailto', {
    p_leave_id: leaveId,
  });
  if (error !== null) {
    return jsonResponse({ error: error.message }, 400);
  }
  return jsonResponse({ mailtoUrl });
});
