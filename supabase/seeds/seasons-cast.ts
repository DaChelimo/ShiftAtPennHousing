// Seasons cast + preferences seed helper (docs/operating-seasons/PLAN.md §18, Workstream B).
//
// Runs AFTER `supabase db reset` + seasons-test.sql (which author, but do NOT apply, the
// Summer 2026 season). It brings the summer world to a fully-primed, preference-testable
// state in one command:
//
//   1. Clears the base seed's overlapping "Summer 2026" (regular_school_year) period so the
//      season's own period can materialize (scheduling_periods is global + has a no-overlap
//      constraint; see §18.3).
//   2. Compiles (pure @shift/core) + applies the Summer season, so the summer scheduling
//      period + blocks exist (blocks carry vacant, claimable seats).
//   3. Seeds a heavy cast per open summer house: 8 SW + 1 SM + 1 HM + 1 RSM
//      (<first>-<house>@upenn.edu, password abc123).
//   4. Seeds PARTIAL preferences: ~5 of 8 SWs per house get targets + block preferences
//      (preferred / available / cannot); the rest stay "none / unspecified".
//   5. Authors + stamps the preference deadline (2026-05-28, before summer starts).
//
// Everything is one transaction, idempotent (ON CONFLICT DO NOTHING), and touches only
// `<first>-<house>@upenn.edu` accounts + the summer season — the base a/b/c/d fixtures are
// left alone. Talks to Postgres directly as `postgres` (like supabase/seed.sql): it writes
// auth.*, calls the SECURITY DEFINER apply/deadline RPCs, and business triggers still fire.
//
// To exercise the preference-SUBMISSION flow (window open) you must time-travel the sim
// clock to before the deadline (~2026-05-20); at real-now the window is closed, which is the
// SM schedule-building phase. See §18.3.

// Imported by relative path to the built dist: @shift/core's package `exports` do not
// resolve under a root-run tsx (pnpm injects a minimal copy). Requires @shift/core built.
import { Client } from 'pg';

import { compileSeason, type SeasonAuthoringInput } from '../../packages/core/dist/index.js';

const DB_URL = process.env.SEED_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUMMER_SLUG = 'summer2026';
const PASSWORD = 'abc123';
// End-of-day NY on 2026-05-28 (EDT, -04). On/before the 2026-06-01 season start.
const PREF_DEADLINE = '2026-05-28 23:59:00-04';
// A representative early-summer weekday to hang preferences on (Tue 2026-06-02).
const PREF_DATE = '2026-06-02';

// The open summer houses (mirrors seasons-test.sql's season_house_windows).
const OPEN_HOUSES = [
  'harnwell',
  'quad',
  'lower-quad',
  'gregory',
  'rodin',
  'lauder',
  'kings-court',
] as const;

const SW_FIRST_NAMES = ['Alice', 'Ben', 'Cara', 'Dan', 'Erin', 'Fred', 'Gina', 'Hugo'] as const;
const HOUSE_LABEL: Record<string, string> = {
  harnwell: 'Harnwell',
  quad: 'Quad',
  'lower-quad': 'Lower Quad',
  gregory: 'Gregory',
  rodin: 'Rodin',
  lauder: 'Lauder',
  'kings-court': 'Kings Court',
};
// How many of the 8 SWs per house submit preferences (the rest stay unspecified).
const SUBMITTERS_PER_HOUSE = 5;

type Role = 'sw' | 'sm' | 'hm' | 'rsm';
interface Person {
  userId: string;
  name: string;
  email: string;
  homeHouse: string;
  role: Role;
  scope: string | null;
  /** SW submit-order index within its house (0-based); undefined for managers. */
  swIndex?: number;
}

// Deterministic UUID from a running counter: 5ca5…<12-hex counter>. Stable across runs.
let counter = 0;
function nextId(): string {
  counter += 1;
  return `5ca50000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
}

function buildRoster(): Person[] {
  const people: Person[] = [];
  for (const house of OPEN_HOUSES) {
    const label = HOUSE_LABEL[house] ?? house;
    SW_FIRST_NAMES.forEach((first, i) => {
      people.push({
        userId: nextId(),
        name: `${first} ${label}`,
        email: `${first.toLowerCase()}-${house}@upenn.edu`,
        homeHouse: house,
        role: 'sw',
        scope: null,
        swIndex: i,
      });
    });
    const managers: [string, Role][] = [
      ['Sam', 'sm'],
      ['Hana', 'hm'],
      ['Diana', 'rsm'],
    ];
    for (const [first, role] of managers) {
      people.push({
        userId: nextId(),
        name: `${first} ${label}`,
        email: `${first.toLowerCase()}-${house}@upenn.edu`,
        homeHouse: house,
        role,
        scope: house,
      });
    }
  }
  return people;
}

// ---------------------------------------------------------------------------
// 1 + 2. Clear the overlapping base period, then compile + apply the season.
// ---------------------------------------------------------------------------
async function loadSeasonInput(
  client: Client,
): Promise<{
  input: SeasonAuthoringInput;
  seasonId: string;
  adminId: string;
  start: string;
  end: string;
}> {
  const { rows: seasonRows } = await client.query(
    `SELECT season_id, slug, season_name, start_date, end_date, scheduling_mode, hours_cap,
            cap_enforcement, shift_start_bound, shift_end_bound, created_by
       FROM operating_seasons WHERE slug = $1`,
    [SUMMER_SLUG],
  );
  if (seasonRows.length === 0) {
    throw new Error(`No season with slug '${SUMMER_SLUG}'. Run seasons-test.sql first.`);
  }
  const s = seasonRows[0];
  // node-pg parses `date` columns to Date and `time` to string; normalize both.
  const iso = (d: string | Date) =>
    d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const hhmm = (t: string | Date) => String(t).slice(0, 5);

  const { rows: hw } = await client.query(
    `SELECT house_id, start_date, end_date, headcount, shift_start, shift_end, days
       FROM season_house_windows WHERE season_id = $1 ORDER BY house_id, start_date`,
    [s.season_id],
  );
  const { rows: fw } = await client.query(
    `SELECT start_date, end_date FROM season_float_windows WHERE season_id = $1 ORDER BY start_date`,
    [s.season_id],
  );

  const input: SeasonAuthoringInput = {
    season: {
      seasonId: s.season_id,
      slug: s.slug,
      seasonName: s.season_name,
      startDate: iso(s.start_date),
      endDate: iso(s.end_date),
      schedulingMode: s.scheduling_mode,
      hoursCap: s.hours_cap,
      capEnforcement: s.cap_enforcement,
      shiftStartBound: hhmm(s.shift_start_bound),
      shiftEndBound: hhmm(s.shift_end_bound),
    },
    houseWindows: hw.map((w) => ({
      houseId: w.house_id,
      startDate: iso(w.start_date),
      endDate: iso(w.end_date),
      headcount: w.headcount,
      shiftStart: w.shift_start === null ? null : hhmm(w.shift_start),
      shiftEnd: w.shift_end === null ? null : hhmm(w.shift_end),
      days: w.days,
    })),
    floatWindows: fw.map((w) => ({ startDate: iso(w.start_date), endDate: iso(w.end_date) })),
  };
  return {
    input,
    seasonId: s.season_id,
    adminId: s.created_by,
    start: iso(s.start_date),
    end: iso(s.end_date),
  };
}

async function clearOverlappingPeriods(
  client: Client,
  seasonId: string,
  start: string,
  end: string,
): Promise<void> {
  // Any non-season period overlapping the summer range would trip
  // scheduling_periods_no_overlap when apply inserts the season's period. Drop those (and
  // their preference/target/draft children) — in the seasons world they are stale.
  const { rows } = await client.query(
    `SELECT period_id FROM scheduling_periods
      WHERE period_id <> $1
        AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`,
    [seasonId, start, end],
  );
  const ids = rows.map((r) => r.period_id as string);
  if (ids.length === 0) return;
  for (const table of [
    'preferences',
    'period_targets',
    'draft_block_assignments',
    'preference_reminder_sends',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE period_id = ANY($1::uuid[])`, [ids]);
  }
  await client.query(`DELETE FROM scheduling_periods WHERE period_id = ANY($1::uuid[])`, [ids]);
}

// ---------------------------------------------------------------------------
// 3. Cast.
// ---------------------------------------------------------------------------
async function seedCast(client: Client, people: Person[]): Promise<void> {
  const ids = people.map((p) => p.userId);
  const emails = people.map((p) => p.email);

  await client.query(
    `INSERT INTO auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change_token_new, email_change)
     SELECT '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated',
       v.email, extensions.crypt($3, extensions.gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
     FROM unnest($1::uuid[], $2::text[]) AS v(id, email)
     ON CONFLICT (id) DO NOTHING`,
    [ids, emails, PASSWORD],
  );

  await client.query(
    `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider,
       last_sign_in_at, created_at, updated_at)
     SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', now(), now(), now()
     FROM auth.users u
     WHERE u.email = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM auth.identities i WHERE i.provider = 'email' AND i.provider_id = u.id::text)`,
    [emails],
  );

  await client.query(
    `INSERT INTO users (user_id, name, email, home_house_id, is_active)
     SELECT id, name, email, home, true
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS v(id, name, email, home)
     ON CONFLICT (user_id) DO NOTHING`,
    [ids, people.map((p) => p.name), emails, people.map((p) => p.homeHouse)],
  );

  await client.query(
    `INSERT INTO user_roles (user_id, role, scope_house_id)
     SELECT id, role::user_role_enum, scope
     FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, role, scope)
     ON CONFLICT DO NOTHING`,
    [people.map((p) => p.userId), people.map((p) => p.role), people.map((p) => p.scope)],
  );
}

// ---------------------------------------------------------------------------
// 4. Partial preferences. Seeded while the period deadline is still NULL (open).
// ---------------------------------------------------------------------------
async function seedPreferences(client: Client, people: Person[], periodId: string): Promise<void> {
  const submitters = people.filter(
    (p) => p.role === 'sw' && p.swIndex !== undefined && p.swIndex < SUBMITTERS_PER_HOUSE,
  );

  // Targets: vary 20/30/40 so the builder shows a spread. 0-40 is the summer cap.
  const targetFor = (i: number) => [20, 30, 40, 30, 20][i % 5] ?? 20;
  await client.query(
    `INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
     SELECT id, $2::uuid, t, false FROM unnest($1::uuid[], $3::int[]) AS v(id, t)
     ON CONFLICT (user_id, period_id) DO NOTHING`,
    [submitters.map((p) => p.userId), periodId, submitters.map((p) => targetFor(p.swIndex!))],
  );

  // Block preferences on PREF_DATE in each submitter's home house. Deterministic pattern:
  // first third preferred, middle third available, one 'cannot' — varied by swIndex so the
  // Phase-1 grouping shows preferred / available / blocked workers.
  for (const p of submitters) {
    // The house's first open day on/after PREF_DATE (Lauder only opens 06-15, etc.).
    const { rows: blocks } = await client.query(
      `SELECT block_id FROM shift_blocks
        WHERE house_id = $1
          AND voided_at IS NULL
          AND (block_start_at AT TIME ZONE 'America/New_York')::date = (
            SELECT min((block_start_at AT TIME ZONE 'America/New_York')::date)
              FROM shift_blocks
             WHERE house_id = $1 AND voided_at IS NULL
               AND (block_start_at AT TIME ZONE 'America/New_York')::date >= $2::date)
        ORDER BY block_start_at`,
      [p.homeHouse, PREF_DATE],
    );
    if (blocks.length === 0) continue;
    const blockIds: string[] = [];
    const statuses: string[] = [];
    const n = blocks.length;
    const shift = (p.swIndex ?? 0) * 2; // stagger by worker
    blocks.forEach((b, idx) => {
      const pos = (idx + shift) % n;
      let status: string;
      if (pos < n / 3) status = 'preferred';
      else if (pos < (2 * n) / 3) status = 'available';
      else status = idx === n - 1 ? 'cannot' : 'available';
      blockIds.push(b.block_id);
      statuses.push(status);
    });
    await client.query(
      `INSERT INTO preferences (user_id, block_id, period_id, status)
       SELECT $1::uuid, b, $3::uuid, s::preference_status_enum
       FROM unnest($2::uuid[], $4::text[]) AS v(b, s)
       ON CONFLICT (user_id, block_id, period_id) DO NOTHING`,
      [p.userId, blockIds, periodId, statuses],
    );
  }
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const { input, seasonId, adminId, start, end } = await loadSeasonInput(client);
    await clearOverlappingPeriods(client, seasonId, start, end);

    const payload = compileSeason(input);
    await client.query(`SELECT apply_compiled_season($1::uuid, $2::uuid, $3::jsonb, false)`, [
      adminId,
      seasonId,
      JSON.stringify(payload),
    ]);

    const people = buildRoster();
    await seedCast(client, people);

    // Open the submission window before writing preferences: on a re-run the period may
    // already carry a now-passed deadline, which enforce_preference_deadline would use to
    // block the writes. We restore the deadline at the end (reopen -> write -> restore).
    await client.query(
      `UPDATE scheduling_periods SET preference_deadline = NULL WHERE period_id = $1`,
      [seasonId],
    );
    await seedPreferences(client, people, seasonId);

    // Author + stamp the deadline (period_id == season_id). Do this LAST so the preference
    // inserts above ran while the window was open (deadline NULL).
    await client.query(
      `UPDATE operating_seasons SET preference_deadline = $2 WHERE season_id = $1`,
      [seasonId, PREF_DEADLINE],
    );
    await client.query(`SELECT set_preference_deadline($1::uuid, $2::uuid, $3::timestamptz)`, [
      adminId,
      seasonId,
      PREF_DEADLINE,
    ]);

    await client.query('COMMIT');

    const { rows: counts } = await client.query(
      `SELECT
         (SELECT count(*) FROM users WHERE email LIKE '%-%@upenn.edu' AND email !~ '@pennhousing')            AS cast_accounts,
         (SELECT count(*) FROM shift_blocks WHERE (block_start_at AT TIME ZONE 'America/New_York')::date
             BETWEEN $1::date AND $2::date)                                                                   AS summer_blocks,
         (SELECT count(*) FROM preferences WHERE period_id = $3)                                              AS preferences,
         (SELECT count(*) FROM period_targets WHERE period_id = $3)                                           AS targets`,
      [start, end, seasonId],
    );
    const c = counts[0];
    console.log(
      `Seasons cast seeded: ${c.cast_accounts} accounts, ${c.summer_blocks} summer blocks, ` +
        `${c.preferences} preferences, ${c.targets} targets. Deadline ${PREF_DEADLINE} (submission ` +
        `opens when the sim clock is before it; time-travel to ~2026-05-20 to submit).`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
