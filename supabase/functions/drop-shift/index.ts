import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const errorStatus: Record<string, number> = {
  empty_drop: 400,
  drop_not_owned: 403,
  drop_not_contiguous: 400,
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const pathname = new URL(req.url).pathname;
  if (!/^(?:\/drop-shift)?\/drop-shift$/.test(pathname)) {
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

  const { assignment_ids: assignmentIds, drop_type: dropType } = body as {
    assignment_ids?: unknown;
    drop_type?: unknown;
  };

  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0 || !assignmentIds.every(isUuid)) {
    return jsonResponse({ error: 'assignment_ids must be a non-empty UUID array' }, 400);
  }

  if (dropType !== 'temporary') {
    return jsonResponse({ error: "drop_type must be 'temporary'" }, 400);
  }

  const { data, error } = await supabase
    .rpc('drop_shift', {
      p_assignment_ids: assignmentIds,
      p_user_id: user.id,
      p_as_of: new Date().toISOString(),
    })
    .single();

  if (error !== null) {
    const code = errorCode(error.message);
    return jsonResponse({ error: code }, errorStatus[code] ?? 400);
  }

  return jsonResponse({
    assignment_ids: data.dropped_assignment_ids,
    drop_type: dropType,
    shortNoticeWarning: data.short_notice_warning,
    directHmodNotification: data.direct_hmod_notification,
  });
});
