import { execSync } from 'node:child_process';

// Local-stack connection details. The seed/allocator/checker talk to Postgres
// DIRECTLY as the `postgres` superuser (via DB_URL) — the most robust path for
// raw setup: it can write the `auth` schema (like supabase/seed.sql), call the
// SECURITY DEFINER RPCs via SELECT, and bypass PostgREST/RLS while business
// triggers still fire. supabase-js (service key + asUser) is reserved for S3's
// RLS-visibility harness. Keys are read at runtime (PLAN §2.1) — never hardcoded
// beyond the documented local fallbacks.

export interface StackEnv {
  dbUrl: string;
  apiUrl: string;
  serviceKey: string;
  anonKey: string;
}

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = 'http://127.0.0.1:54321';

export function localStackEnv(): StackEnv {
  const parsed: Record<string, string> = {};
  try {
    const out = execSync('supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)="(.*)"$/);
      if (m) parsed[m[1]] = m[2];
    }
  } catch {
    // `supabase` CLI not reachable here — fall back to the documented local defaults.
  }
  return {
    dbUrl: process.env.E2E_DB_URL ?? parsed.DB_URL ?? LOCAL_DB,
    apiUrl: process.env.E2E_API_URL ?? parsed.API_URL ?? LOCAL_API,
    serviceKey: process.env.E2E_SERVICE_KEY ?? parsed.SECRET_KEY ?? parsed.SERVICE_ROLE_KEY ?? '',
    anonKey: process.env.E2E_ANON_KEY ?? parsed.ANON_KEY ?? parsed.PUBLISHABLE_KEY ?? '',
  };
}
