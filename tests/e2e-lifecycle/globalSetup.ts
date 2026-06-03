// Vitest globalSetup for the e2e-lifecycle harness (PLAN §3 S3): "verify stack up + apply S2 seed".
//
// Runs ONCE before any scenario. It (1) confirms the local stack is reachable, (2) applies the
// idempotent S2 seed as a subprocess (so the exact committed seed runs, and a failure can't
// process.exit the vitest worker), and (3) asserts the published baseline the scenarios assume.
//
// SELF-HEALING: the seed SKIPS already-published houses (its idempotency rule), so if a *foreign*
// publish touched the shared local DB — e.g. Playwright's `schedule-builder` spec publishes Quad,
// which is THE float source for S4 — that house is left published-but-unallocated and the baseline
// is broken. Rather than abort with a manual "go reset" hint (which made `pnpm e2e:lifecycle`
// fragile after any Playwright/verify-all run), we recover automatically: a dirty baseline triggers
// exactly ONE `supabase db reset` (clean seed.sql, nothing published) + reseed, after which the seed
// allocates + publishes all 13 e… houses. The fast path (clean or already-correctly-seeded DB) does
// the cheap idempotent seed and NEVER resets.

import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { localStackEnv } from './env';
import { BUILD_WEEK_END, BUILD_WEEK_START, PERIOD_ID } from './roster';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(E2E_DIR, '..', '..');

interface Baseline {
  published: boolean;
  scheduled: number;
  unallocated: number;
  ready: boolean;
}

function runSeed(): void {
  const tsxBin = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  execSync(`"${tsxBin}" "${join(E2E_DIR, 'seed.ts')}"`, { cwd: REPO_ROOT, stdio: 'inherit' });
}

async function readBaseline(dbUrl: string): Promise<Baseline> {
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
    const published = rows[0].published === true;
    const scheduled = rows[0].scheduled as number;
    const unallocated = rows[0].unallocated_houses as number;
    return {
      published,
      scheduled,
      unallocated,
      ready: published && scheduled > 0 && unallocated === 0,
    };
  } finally {
    await db.end();
  }
}

const describe = (b: Baseline): string =>
  `published=${b.published}, scheduled=${b.scheduled}, unallocated houses=${b.unallocated}`;

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

  // 2. Seed + check. Clean / already-seeded DB → ready on the first pass (no reset).
  console.log('[e2e-lifecycle] applying S2 seed (idempotent)…');
  runSeed();
  let baseline = await readBaseline(dbUrl);

  // 3. Self-heal a dirty baseline (a foreign publish beat the seed) with one reset + reseed.
  if (!baseline.ready) {
    console.warn(
      `[e2e-lifecycle] baseline dirty (${describe(baseline)}) — a foreign publish beat the seed. ` +
        'Self-healing with `supabase db reset` + reseed (one time)…',
    );
    try {
      execSync('supabase db reset', { cwd: REPO_ROOT, stdio: 'inherit' });
    } catch (err) {
      throw new Error(
        '[e2e-lifecycle] `supabase db reset` failed while recovering a dirty baseline. Reset ' +
          `manually, then re-run.\n  cause: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    runSeed();
    baseline = await readBaseline(dbUrl);
    if (!baseline.ready) {
      throw new Error(
        `[e2e-lifecycle] baseline STILL not ready after reset + reseed (${describe(baseline)}). ` +
          'This indicates a real seed/allocator bug, not a dirty DB.',
      );
    }
  }

  console.log(
    `[e2e-lifecycle] baseline ready: published, ${baseline.scheduled} scheduled, all houses allocated.`,
  );
}
