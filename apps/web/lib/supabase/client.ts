'use client';

import type { Database } from '@shift/shared';
import { createBrowserClient } from '@supabase/ssr';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

// Browser Supabase client (anon key + the authenticated user's cookie session).
// All reads/writes go through RLS as the signed-in admin/worker.
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
