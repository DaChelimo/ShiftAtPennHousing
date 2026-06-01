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

function isMonday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
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

  const { data: roles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['hm', 'bm']);
  if (rolesError !== null) {
    return jsonResponse({ error: rolesError.message }, 500);
  }
  if ((roles ?? []).length === 0) {
    return jsonResponse({ error: 'Only an HM or BM may modify the weekly cap.' }, 403);
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
    week_start_date: weekStartDate,
    hours_cap: hoursCap,
    cap_enforcement: capEnforcement,
    notes,
  } = body as {
    week_start_date?: unknown;
    hours_cap?: unknown;
    cap_enforcement?: unknown;
    notes?: unknown;
  };

  if (typeof weekStartDate !== 'string' || !isMonday(weekStartDate)) {
    return jsonResponse({ error: 'week_start_date must be a Monday in YYYY-MM-DD format' }, 400);
  }
  if (
    !(
      (hoursCap === 20 && capEnforcement === 'soft') ||
      (hoursCap === 40 && capEnforcement === 'hard')
    )
  ) {
    return jsonResponse({ error: 'cap must be either 20 soft or 40 hard' }, 400);
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return jsonResponse({ error: 'notes must be a string when provided' }, 400);
  }

  const { data, error } = await supabase
    .from('weekly_cap_overrides')
    .upsert(
      {
        week_start_date: weekStartDate,
        hours_cap: hoursCap,
        cap_enforcement: capEnforcement,
        modified_by: user.id,
        modified_at: new Date().toISOString(),
        notes: notes ?? null,
      },
      { onConflict: 'week_start_date' },
    )
    .select('week_start_date, hours_cap, cap_enforcement, modified_by, modified_at, notes')
    .single();
  if (error !== null) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({ ok: true, override: data });
});
