// Vitest globalSetup for the e2e-lifecycle harness (PLAN §3 S3): "verify stack up + apply S2 seed".
//
// Runs ONCE before any scenario. It (1) confirms the local stack is reachable, (2) applies the
// idempotent S2 seed as a subprocess (so the exact committed seed runs, and a failure can't
// process.exit the vitest worker), and (3) asserts the published baseline the scenarios assume —
// failing loudly with a fix hint if the DB is in an unexpected state. Scenarios then run against
// this committed baseline and roll back their own mutations, so no reset is needed between runs.

import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { localStackEnv } from './env';
import { BUILD_WEEK_END, BUILD_WEEK_START, PERIOD_ID } from './roster';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(E2E_DIR, '..', '..');

export default async function setup(): Promise<void> {
  const { dbUrl } = localStackEnv();

  // 1. Stack reachable?
  const probe = new Client({ connectionString: dbUrl });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
  } catch (err) {
    throw new Error(
      `[e2e-lifecycle] local Postgres not reachable at ${dbUrl}. Start it with \`supabase start\`.\n` +
        `  cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await probe.end();
  }

  // 2. Apply the idempotent S2 seed (subprocess → reuses the committed seed.ts verbatim).
  const tsxBin = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  console.log('[e2e-lifecycle] applying S2 seed (idempotent)…');
  execSync(`"${tsxBin}" "${join(E2E_DIR, 'seed.ts')}"`, { cwd: REPO_ROOT, stdio: 'inherit' });

  // 3. Baseline sanity: the period is published, the build week has scheduled assignments, and
  //    EVERY house is allocated. The last guard matters because the seed skips already-published
  //    houses — so if a foreign publish (e.g. a Playwright `schedule-builder` run on the shared
  //    local DB published Quad) beat the seed, that house is left unallocated. That is invisible to
  //    S3 (it doesn't touch Quad) but breaks S4 (Quad is THE float source). Fail loudly here.
  const db = new Client({ connectionString: dbUrl });
  try {
    await db.connect();
    const { rows } = await db.query(
      `SELECT
         (SELECT published_at IS NOT NULL FROM scheduling_periods WHERE period_id = $1) AS published,
         (SELECT count(*)::int FROM shift_block_assignments a
            JOIN shift_blocks b ON b.block_id = a.block_id
           WHERE a.status = 'scheduled'
             AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $2 AND $3) AS scheduled,
         (SELECT count(*)::int FROM houses h WHERE NOT EXISTS (
            SELECT 1 FROM shift_block_assignments a JOIN shift_blocks b ON b.block_id = a.block_id
             WHERE b.house_id = h.id AND a.status = 'scheduled'
               AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $2 AND $3)
         ) AS unallocated_houses`,
      [PERIOD_ID, BUILD_WEEK_START, BUILD_WEEK_END],
    );
    const { published, scheduled, unallocated_houses: unallocated } = rows[0];
    if (!published || scheduled <= 0 || unallocated > 0) {
      throw new Error(
        `[e2e-lifecycle] baseline not ready (published=${published}, scheduled=${scheduled}, ` +
          `unallocated houses=${unallocated}). The seed skips already-published houses, so a ` +
          'dirty DB leaves a house unallocated. Run `supabase db reset && pnpm e2e:lifecycle:seed`.',
      );
    }
    console.log(
      `[e2e-lifecycle] baseline ready: published, ${scheduled} scheduled, all houses allocated.`,
    );
  } finally {
    await db.end();
  }
}
