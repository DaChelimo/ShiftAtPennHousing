// Server-only helper: call a Supabase Edge Function AS THE SIGNED-IN WORKER.
//
// Every worker write on web (claim, drop, break-claim, submit-preferences,
// acknowledge/decline float, swaps) reuses the same backend Edge Functions the
// mobile app calls. The EF derives the actor from the bearer token (never the
// service-role key), so this forwards the request's session access token and
// lets RLS + the EF's own validation stay authoritative — the web layer adds no
// new trust. Mirrors the token-forwarding in lib/actions/forceTrigger.ts.
//
// NOT a `'use server'` module: it is imported by 'use server' action files and
// must never itself be exposed as a client-callable endpoint (the `path` is
// caller-controlled). It transitively imports next/headers (via supabase/server)
// so it can only ever run server-side.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../env';
import { createClient } from '../../supabase/server';

export type EdgeResult<T> = { ok: true; data: T } | { ok: false; error: string };

function errorMessage(json: unknown, status: number): string {
  if (
    json !== null &&
    typeof json === 'object' &&
    'error' in json &&
    typeof (json as { error: unknown }).error === 'string'
  ) {
    return (json as { error: string }).error;
  }
  return `The request could not be completed (${String(status)}).`;
}

// POST `body` to `functions/v1/<path>` with the worker's bearer token. `path`
// includes any sub-route the EF matches on (e.g. 'submit-preferences/preferences').
export async function callEdge<T>(path: string, body: unknown): Promise<EdgeResult<T>> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (token === undefined) {
    return { ok: false, error: 'Your session has expired. Sign in again.' };
  }

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach the server.',
    };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    return { ok: false, error: errorMessage(json, res.status) };
  }
  return { ok: true, data: json as T };
}
