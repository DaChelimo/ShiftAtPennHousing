import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type Supabase = ReturnType<typeof createClient>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    // Canonical 8-4-4-4-12 UUID (matches every other Edge Function's validator). The
    // prior pattern dropped the 4th group's `[0-9a-f]{3}-`, so it rejected EVERY real
    // UUID — `create-swap` 400-ed on every swap (swap_requests stayed empty). See the
    // identical regex in claim-shift / acknowledge-float / submit-preferences etc.
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function isUuidArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isUuid);
}

export async function authenticate(
  req: Request,
): Promise<{ ok: true; supabase: Supabase; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token === undefined) {
    return { ok: false, response: jsonResponse({ error: 'Authentication required' }, 401) };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return { ok: false, response: jsonResponse({ error: 'Server configuration error' }, 500) };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error !== null || user === null) {
    return { ok: false, response: jsonResponse({ error: 'Authentication required' }, 401) };
  }

  return { ok: true, supabase, userId: user.id };
}

export async function readObjectBody(
  req: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: jsonResponse({ error: 'Invalid JSON body' }, 400) };
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, response: jsonResponse({ error: 'Request body must be an object' }, 400) };
  }

  return { ok: true, body: body as Record<string, unknown> };
}

export function edgeHandler(
  expectedPath: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const pathname = new URL(req.url).pathname;
    const escaped = expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^(?:/${escaped})?/${escaped}$`).test(pathname)) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return handler(req);
  };
}
