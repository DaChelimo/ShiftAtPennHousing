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

const OUTCOMES = new Set([
  'allied_secured',
  'covered_internally',
  'desk_unstaffed',
  'no_longer_needed',
]);

// allied-coverage: manager-authenticated wrapper around the two service-role-only Allied
// coverage-request RPCs (migration 20260729000010), for the mobile manager app.
//
//   POST /allied-coverage/acknowledge  { request_id }
//   POST /allied-coverage/close        { request_id, outcome, note? }
//   POST /allied-coverage/context      {}  -> { rung_timeout_minutes, reminder_minutes }
//
// The `context` route exists because the ladder cadence is configuration
// (`system_config('allied_ladder_rung_timeout_minutes')`, BSpec §14) and the client needs it
// to render an honest "escalates in 12m" countdown. `system_config` is admin-only readable
// and the two getter functions are REVOKEd from `authenticated`, so a client cannot read the
// value directly. Serving it from here is deliberate: it keeps the countdown correct when an
// admin retunes the cadence WITHOUT widening a SECURITY DEFINER grant or an RLS policy for
// the sake of one integer. Do not "simplify" this by granting the getters to `authenticated`.
//
// WHY THIS FUNCTION EXISTS. `acknowledge_allied_coverage_request` and
// `close_allied_coverage_request` are REVOKEd from `anon` and `authenticated` and granted
// to `service_role` only, so a client cannot call them over PostgREST. The web app reaches
// them from a server action holding the service key; mobile has no server, so it needs this
// wrapper. The mobile app introduces no new TABLE and no new RPC (docs/manager-app/SPEC.md
// §7); this is transport only, and it must stay that way. If you find yourself adding
// business logic below, it belongs in the RPC.
//
// IDENTITY COMES FROM THE BEARER TOKEN, NEVER THE BODY. Both RPCs authorize on the
// `p_user_id` they are handed (`current_recipient` OR `user_can_build_schedule(user, house)`
// OR `user_is_admin`). Because this function calls them with the service key, `auth.uid()`
// is NULL inside the RPC and the spoof guard there does not fire, so passing a body-supplied
// user id would hand any signed-in worker the ability to acknowledge and close coverage
// requests as a manager. `user.id` below is resolved from the token by `auth.getUser`.
// Do not add a `user_id` field to either request body.
//
// Both RPCs are idempotent on terminal state and report it in their result rather than
// raising: `{ acknowledged: false, reason: 'already_closed' | 'already_acknowledged' }` and
// `{ closed: false, reason: 'already_closed' }`. Those pass through as 200s, because at
// least-once push delivery and a colleague resolving the same request on web both make this
// a normal outcome rather than an error. The client renders "someone already handled this".
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  const route = /^(?:\/allied-coverage)?\/(acknowledge|close|context)$/.exec(pathname)?.[1];
  if (route === undefined) {
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

  // Read-only cadence lookup. No body, and nothing request-specific: any authenticated
  // caller learns only the two configured ladder intervals, which are product constants
  // documented in BSpec §14, not anybody's data.
  if (route === 'context') {
    const [timeout, reminder] = await Promise.all([
      supabase.rpc('allied_ladder_rung_timeout_minutes'),
      supabase.rpc('allied_ladder_reminder_minutes'),
    ]);
    return jsonResponse({
      // Fall back to the documented defaults rather than failing: a wrong-but-close
      // countdown beats a Coverage tab that will not load.
      rung_timeout_minutes: typeof timeout.data === 'number' ? timeout.data : 60,
      reminder_minutes: typeof reminder.data === 'number' ? reminder.data : 15,
    });
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

  const { request_id: requestId } = body as { request_id?: unknown };
  if (!isUuid(requestId)) {
    return jsonResponse({ error: 'request_id must be a UUID' }, 400);
  }

  const nowIso = (await fetchAppNow(supabase)).toISOString();

  if (route === 'acknowledge') {
    const { data, error } = await supabase.rpc('acknowledge_allied_coverage_request', {
      p_request_id: requestId,
      p_user_id: user.id,
      p_now: nowIso,
    });

    if (error !== null) {
      return jsonResponse({ error: errorCode(error.message) }, 400);
    }

    return jsonResponse(data ?? { acknowledged: false, reason: 'not_found' });
  }

  const { outcome, note, assignSelf } = body as {
    outcome?: unknown;
    note?: unknown;
    assignSelf?: unknown;
  };

  if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) {
    return jsonResponse({ error: 'outcome must be a valid coverage outcome' }, 400);
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    return jsonResponse({ error: 'note must be a string' }, 400);
  }

  if (assignSelf !== undefined && typeof assignSelf !== 'boolean') {
    return jsonResponse({ error: 'assignSelf must be a boolean' }, 400);
  }

  // `desk_unstaffed` requires a note. The RPC raises `note_required` and stays
  // authoritative; this is the fail-fast so the client gets a clean 400 rather than a
  // Postgres error string.
  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (outcome === 'desk_unstaffed' && trimmedNote === '') {
    return jsonResponse({ error: 'note_required' }, 400);
  }

  // assignSelf only ever means anything for 'covered_internally' (the mobile Coverage
  // sheet's dedicated "I can cover it" action); the RPC ignores it for every other
  // outcome, but there is no reason to forward true where it can't apply.
  const { data, error } = await supabase.rpc('close_allied_coverage_request', {
    p_request_id: requestId,
    p_user_id: user.id,
    p_outcome: outcome,
    p_note: trimmedNote === '' ? null : trimmedNote,
    p_now: nowIso,
    p_assign_self: outcome === 'covered_internally' && assignSelf === true,
  });

  if (error !== null) {
    return jsonResponse({ error: errorCode(error.message) }, 400);
  }

  return jsonResponse(data ?? { closed: false, reason: 'not_found' });
});
