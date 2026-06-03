// e2e-lifecycle harness — connection layer (PLAN §3 S3, §5 "Client").
//
// Two clients, by purpose:
//
//   * `openDb()` / `inTx()` — a raw `pg` connection as the `postgres` superuser (same path S2's
//     seed uses). This is the WORKHORSE for every S3 scenario: it calls the SECURITY DEFINER
//     lifecycle RPCs via `SELECT`, reads/asserts state, and bypasses RLS while business triggers
//     still fire. `inTx(fn)` wraps a scenario in `BEGIN … ROLLBACK` so each test mutates a private
//     copy of the committed-and-published baseline and leaves it pristine — the harness is fully
//     deterministic and re-runnable WITHOUT a destructive `db reset` between runs (only the seed
//     commits; tests never do).
//
//   * `serviceClient()` / `asUser(email)` — supabase-js over PostgREST. Not needed by S3's
//     service-role scenarios (1–5 assert state directly via `pg`), but the brief makes them an S3
//     deliverable because S4 asserts RLS *visibility* (e.g. "the destination SM sees inbound
//     floats"): those need a real authed user, not a superuser bypass. Provided here, exercised
//     there. NOTE: a supabase-js call opens its own HTTP connection — it CANNOT join an `inTx`
//     transaction, so visibility tests that use it must operate on committed rows.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

import { localStackEnv } from './env';
import { PASSWORD } from './roster';

const env = localStackEnv();

export function openDb(): Client {
  return new Client({ connectionString: env.dbUrl });
}

/**
 * Run `fn` inside a single transaction that is ALWAYS rolled back. Returns whatever `fn` returns;
 * if `fn` throws (e.g. an `expect` failure, or an RPC that raises and aborts the transaction), the
 * error propagates after the rollback. Each call gets its own connection, so tests are isolated.
 */
export async function inTx<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = openDb();
  await db.connect();
  try {
    await db.query('BEGIN');
    return await fn(db);
  } finally {
    // ROLLBACK is safe even when the transaction is already aborted (a raised RPC) or the
    // connection is dying; swallow any rollback error so the original failure surfaces.
    try {
      await db.query('ROLLBACK');
    } catch {
      /* transaction already aborted/closed */
    }
    await db.end();
  }
}

export function serviceClient(): SupabaseClient {
  return createClient(env.apiUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A supabase-js client authenticated as `email` (anon key + password sign-in). For S4 RLS tests. */
export async function asUser(email: string, password: string = PASSWORD): Promise<SupabaseClient> {
  const supabase = createClient(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`asUser(${email}) sign-in failed: ${error.message}`);
  }
  return supabase;
}
