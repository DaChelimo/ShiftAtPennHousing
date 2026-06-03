// Exit-gate checker for chunk S2 (PLAN §3 S2). Asserts the realistic seed produced the right
// shape, then exits non-zero if any assertion fails. Run via `pnpm e2e:lifecycle:seed:check`
// (after `pnpm e2e:lifecycle:seed`). Read-only — never mutates the DB.

import { Client } from 'pg';

import { localStackEnv } from '../env';
import { BUILD_WEEK_END, BUILD_WEEK_START, HOUSES, PERIOD_ID } from '../roster';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const WEEK = [BUILD_WEEK_START, BUILD_WEEK_END] as const;
const NY_DATE = `(b.block_start_at AT TIME ZONE 'America/New_York')::date`;

async function run(client: Client): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  // 1. ≥46 e… SW workers, spanning all 13 houses.
  const workers = await client.query(
    `SELECT count(*)::int AS n, count(DISTINCT u.home_house_id)::int AS houses
     FROM users u
     WHERE u.email LIKE 'e.%@pennhousing.test'
       AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role = 'sw')`,
  );
  const wn = workers.rows[0].n as number;
  const wh = workers.rows[0].houses as number;
  add(
    '≥46 e… SW workers across all 13 houses',
    wn >= 46 && wh === HOUSES.length,
    `${wn} workers / ${wh} houses`,
  );

  const missing = await client.query(
    `SELECT h.id FROM houses h
     WHERE NOT EXISTS (
       SELECT 1 FROM users u JOIN user_roles r ON r.user_id = u.user_id AND r.role = 'sw'
       WHERE u.home_house_id = h.id AND u.email LIKE 'e.%@pennhousing.test')`,
  );
  add(
    'every house has ≥1 e… worker',
    missing.rowCount === 0,
    missing.rowCount === 0 ? 'all covered' : `missing: ${missing.rows.map((r) => r.id).join(', ')}`,
  );

  // 2. published scheduled assignments exist for the build week, and the period flipped.
  const scheduled = await client.query(
    `SELECT count(*)::int AS n FROM shift_block_assignments a
     JOIN shift_blocks b ON b.block_id = a.block_id
     WHERE a.status = 'scheduled' AND a.user_id IS NOT NULL
       AND ${NY_DATE} BETWEEN $1::date AND $2::date`,
    [...WEEK],
  );
  const sn = scheduled.rows[0].n as number;
  add('published scheduled assignments exist (build week)', sn > 0, `${sn} scheduled`);

  const period = await client.query(
    `SELECT published_at IS NOT NULL AS published FROM scheduling_periods WHERE period_id = $1`,
    [PERIOD_ID],
  );
  add(
    'period published_at is set',
    period.rows[0]?.published === true,
    period.rows[0]?.published ? 'published' : 'NULL',
  );

  // 3. ZERO scheduled assignment lands on a worker's 'cannot' block.
  const cannotHits = await client.query(
    `SELECT count(*)::int AS n FROM shift_block_assignments a
     JOIN preferences p ON p.user_id = a.user_id AND p.block_id = a.block_id AND p.period_id = $1
     WHERE p.status = 'cannot' AND a.status IN ('scheduled', 'claimed')`,
    [PERIOD_ID],
  );
  const cn = cannotHits.rows[0].n as number;
  add('zero assignment on a cannot block', cn === 0, `${cn} violations`);

  // 4. Every worker's daily assignment is contiguous run(s) of ≥4 blocks.
  const perDay = await client.query(
    `SELECT a.user_id::text AS user_id, ${NY_DATE}::text AS d,
            ((extract(hour FROM b.block_start_at AT TIME ZONE 'America/New_York') * 60
              + extract(minute FROM b.block_start_at AT TIME ZONE 'America/New_York'))::int - 480) / 30 AS bidx
     FROM shift_block_assignments a
     JOIN shift_blocks b ON b.block_id = a.block_id
     WHERE a.status = 'scheduled' AND a.user_id IS NOT NULL
       AND ${NY_DATE} BETWEEN $1::date AND $2::date
     ORDER BY a.user_id, d, bidx`,
    [...WEEK],
  );
  const byUserDay = new Map<string, number[]>();
  for (const r of perDay.rows) {
    const key = `${r.user_id}|${r.d}`;
    const list = byUserDay.get(key);
    if (list) list.push(r.bidx);
    else byUserDay.set(key, [r.bidx]);
  }
  let shortRuns = 0;
  let exampleShort = '';
  for (const [key, indices] of byUserDay) {
    indices.sort((a, b) => a - b);
    let runStart = indices[0];
    let prev = indices[0];
    const flush = (end: number) => {
      if (end - runStart + 1 < 4) {
        shortRuns += 1;
        if (!exampleShort) exampleShort = `${key} run len ${end - runStart + 1}`;
      }
    };
    for (let i = 1; i < indices.length; i += 1) {
      if (indices[i] !== prev + 1) {
        flush(prev);
        runStart = indices[i];
      }
      prev = indices[i];
    }
    flush(prev);
  }
  add(
    'daily assignments are contiguous runs ≥4 blocks',
    shortRuns === 0,
    shortRuns === 0
      ? `${byUserDay.size} worker-days, all runs ≥4`
      : `${shortRuns} short run(s), e.g. ${exampleShort}`,
  );

  // 5. Some vacancies remain in the build week (float/escalation material).
  const vacant = await client.query(
    `SELECT count(*)::int AS n FROM shift_block_assignments a
     JOIN shift_blocks b ON b.block_id = a.block_id
     WHERE a.status = 'vacant' AND ${NY_DATE} BETWEEN $1::date AND $2::date`,
    [...WEEK],
  );
  const vn = vacant.rows[0].n as number;
  add('some vacancies remain (build week)', vn > 0, `${vn} vacant seats`);

  // 6. No worker exceeds the 20h soft cap (40 blocks) in the build week.
  const overCap = await client.query(
    `SELECT max(c)::int AS max_blocks FROM (
       SELECT a.user_id, count(*)::int AS c FROM shift_block_assignments a
       JOIN shift_blocks b ON b.block_id = a.block_id
       WHERE a.status = 'scheduled' AND a.user_id IS NOT NULL
         AND ${NY_DATE} BETWEEN $1::date AND $2::date
       GROUP BY a.user_id) s`,
    [...WEEK],
  );
  const maxBlocks = (overCap.rows[0].max_blocks as number | null) ?? 0;
  add(
    'no worker over 20h soft cap (≤40 blocks)',
    maxBlocks <= 40,
    `max ${maxBlocks} blocks = ${maxBlocks / 2}h`,
  );

  return results;
}

async function main(): Promise<void> {
  const { dbUrl } = localStackEnv();
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  let results: CheckResult[];
  try {
    results = await run(client);
  } finally {
    await client.end();
  }

  console.log('[seed-check] e2e-lifecycle S2 exit gate');
  let failed = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`);
    if (!r.ok) failed += 1;
  }
  if (failed > 0) {
    console.error(`[seed-check] FAIL — ${failed}/${results.length} checks failed`);
    process.exit(1);
  }
  console.log(`[seed-check] PASS — ${results.length}/${results.length} checks green`);
}

main().catch((err) => {
  console.error('[seed-check] ERROR');
  console.error(err);
  process.exit(1);
});
