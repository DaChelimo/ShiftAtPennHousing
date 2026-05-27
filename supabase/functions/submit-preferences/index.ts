import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type PreferenceInput = {
  block_id: unknown;
  status: unknown;
};

const preferenceStatuses = new Set(['preferred', 'available', 'cannot', 'none']);

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/submit-preferences)?\/preferences$/.test(pathname)) {
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
    period_id: periodId,
    preferences,
    target_hours: targetHours,
    opted_out: optedOut,
  } = body as {
    period_id?: unknown;
    preferences?: unknown;
    target_hours?: unknown;
    opted_out?: unknown;
  };

  if (!isUuid(periodId)) {
    return jsonResponse({ error: 'period_id must be a UUID' }, 400);
  }

  if (!Array.isArray(preferences)) {
    return jsonResponse({ error: 'preferences must be an array' }, 400);
  }

  if (!Number.isInteger(targetHours) || targetHours < 0) {
    return jsonResponse({ error: 'target_hours must be a non-negative integer' }, 400);
  }

  if (typeof optedOut !== 'boolean') {
    return jsonResponse({ error: 'opted_out must be a boolean' }, 400);
  }

  const normalizedPreferences = [];
  for (const preference of preferences as PreferenceInput[]) {
    if (
      typeof preference !== 'object' ||
      preference === null ||
      !isUuid(preference.block_id) ||
      typeof preference.status !== 'string' ||
      !preferenceStatuses.has(preference.status)
    ) {
      return jsonResponse(
        { error: 'each preference must include block_id UUID and valid status' },
        400,
      );
    }

    normalizedPreferences.push({
      block_id: preference.block_id,
      status: preference.status,
    });
  }

  const { data, error } = await supabase.rpc('submit_preferences', {
    p_user_id: user.id,
    p_period_id: periodId,
    p_preferences: normalizedPreferences,
    p_target_hours: targetHours,
    p_opted_out: optedOut,
  });

  if (error !== null) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse(data);
});
