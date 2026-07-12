import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// T2-6 — Hire a worker (BSpec §4.5 "Hiring"). Creating a worker spans auth.users
// (the admin API, service-role only) + public.users + public.user_roles. This EF
// owns the ONE step that cannot run in SQL — supabase.auth.admin.createUser — and
// delegates everything else (authz re-check, validation, the two app-table inserts)
// to the hire_worker RPC (migration 20260611000004), so the contract is pgTAP-
// testable. People-admin is HM/BM-only (§6.6/§2.3/§2.6): the EF re-checks the
// caller's role from the bearer token before creating anything (mirroring
// modify-weekly-cap / fire-worker authentication). Do NOT widen to SM.

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

const ROLES = ['sw', 'sm', 'hm', 'bm'] as const;
type Role = (typeof ROLES)[number];

// Map the RPC's snake_case RAISE reasons to readable copy + an HTTP status.
const REASON_MAP: Record<string, { message: string; status: number }> = {
  not_authorized: { message: 'You are not authorized to hire workers at this house.', status: 403 },
  name_required: { message: 'A worker name is required.', status: 400 },
  invalid_email: { message: 'A valid email address is required.', status: 400 },
  house_not_found: { message: 'That house could not be found.', status: 400 },
  invalid_role: { message: 'The initial role is invalid.', status: 400 },
  worker_already_exists: {
    message: 'A worker with that account already exists.',
    status: 409,
  },
};

function friendly(raw: string): { message: string; status: number } {
  const msg = raw.trim();
  for (const [reason, mapped] of Object.entries(REASON_MAP)) {
    if (msg === reason || msg.includes(reason)) return mapped;
  }
  return { message: msg, status: 400 };
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

  // Authenticate the caller from the bearer token.
  const {
    data: { user: caller },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError !== null || caller === null) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  // People-admin is HM/BM-only (§6.6). The RPC re-checks the gate authoritatively
  // and house-scoped; this is the fail-fast role pre-check (mirrors modify-weekly-cap).
  const { data: roles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .in('role', ['hm', 'bm']);
  if (rolesError !== null) {
    return jsonResponse({ error: rolesError.message }, 500);
  }
  if ((roles ?? []).length === 0) {
    return jsonResponse({ error: 'Only an HM or BM may hire workers.' }, 403);
  }

  // Parse + validate the body.
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
    name,
    email,
    home_house_id: homeHouseId,
    role,
    phone,
  } = body as {
    name?: unknown;
    email?: unknown;
    home_house_id?: unknown;
    role?: unknown;
    phone?: unknown;
  };

  if (typeof name !== 'string' || name.trim() === '') {
    return jsonResponse({ error: 'A worker name is required.' }, 400);
  }
  if (typeof email !== 'string' || email.trim() === '') {
    return jsonResponse({ error: 'A valid email address is required.' }, 400);
  }
  if (typeof homeHouseId !== 'string' || homeHouseId.trim() === '') {
    return jsonResponse({ error: 'A home house is required.' }, 400);
  }
  const initialRole: Role = role === undefined || role === null ? 'sw' : (role as Role);
  if (!ROLES.includes(initialRole)) {
    return jsonResponse({ error: 'The initial role is invalid.' }, 400);
  }
  if (phone !== undefined && phone !== null && typeof phone !== 'string') {
    return jsonResponse({ error: 'phone must be a string when provided.' }, 400);
  }

  const cleanEmail = email.trim().toLowerCase();

  // ① Create the auth.users row (the only step that cannot run in SQL). The new
  //    hire is email-confirmed so they can sign in immediately; no password is set
  //    here (the deployment's invite/reset flow issues credentials).
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: cleanEmail,
    email_confirm: true,
    user_metadata: { name: name.trim() },
  });
  if (createError !== null || created?.user == null) {
    const raw = createError?.message ?? 'Could not create the worker account.';
    // A duplicate auth user is the common conflict.
    const status = /already|registered|exist/i.test(raw) ? 409 : 400;
    return jsonResponse({ error: raw }, status);
  }

  const newUserId = created.user.id;

  // ② Insert the app rows + role via the RPC (authz re-checked, validated, atomic).
  const { data, error } = await supabase.rpc('hire_worker', {
    p_initiator: caller.id,
    p_user_id: newUserId,
    p_name: name.trim(),
    p_email: cleanEmail,
    p_home_house_id: homeHouseId,
    p_role: initialRole,
    p_phone: phone ?? null,
  });

  if (error !== null) {
    // Roll back the orphaned auth user — the app rows never landed.
    await supabase.auth.admin.deleteUser(newUserId).catch(() => {});
    const { message, status } = friendly(error.message);
    return jsonResponse({ error: message }, status);
  }

  // ③ Phase D — issue a set-password (recovery) link so the new hire can sign in.
  //    Best-effort: a failure here never undoes the successful hire; the admin can
  //    re-issue via the web "Resend invite". SITE_URL is the WEB app origin (distinct
  //    from SUPABASE_URL); when set the link lands on /auth/update-password. When unset,
  //    generateLink still returns a link but GoTrue redirects to the project's configured
  //    site_url instead, so deployers should set SITE_URL to the web origin.
  let setupLink: string | null = null;
  const siteUrl = Deno.env.get('SITE_URL');
  try {
    const { data: link } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: cleanEmail,
      options: siteUrl ? { redirectTo: `${siteUrl}/auth/update-password` } : undefined,
    });
    setupLink = link?.properties?.action_link ?? null;
  } catch {
    setupLink = null;
  }

  return jsonResponse({ ok: true, worker: data, setupLink }, 201);
});
