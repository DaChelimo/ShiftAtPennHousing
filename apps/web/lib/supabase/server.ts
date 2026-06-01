import type { Database } from '@shift/shared';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { SUPABASE_ANON_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../env';

// Server Supabase client bound to the request's cookie session. Use in server
// components, server actions, and route handlers for RLS-scoped reads/writes as
// the signed-in user.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` from a Server Component — safe to ignore; the middleware
          // refreshes the session cookie on every request.
        }
      },
    },
  });
}

// Service-role client — bypasses RLS. Server-only, for privileged RPCs the admin
// surface needs (publish_schedule is service_role-only; cross-house leave reads).
// Never expose to the browser.
export function createServiceClient() {
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    cookies: { getAll: () => [], setAll: () => undefined },
  });
}
