// e2e-lifecycle realistic seed + greedy allocator (PLAN §3 S2).
//
// Idempotent and non-destructive: every write is `e…`-namespaced and ON CONFLICT DO NOTHING,
// publish is guarded by period_house_publications, and the whole run is one transaction (so a
// failure rolls back cleanly — including the preference-window reopen). Run via
// `pnpm e2e:lifecycle:seed`. It assumes a migrated+seeded local stack (`supabase db reset`).

import { Client } from 'pg';

import { allocate, type Assignment } from './allocate';
import { localStackEnv } from './env';
import {
  ADMINS,
  BUILDER,
  BUILD_WEEK_DATES,
  BUILD_WEEK_END,
  BUILD_WEEK_START,
  FIRST_BLOCK_MINUTE,
  HOUSES,
  PASSWORD,
  PERIOD_ID,
  prefStatus,
  WORKERS,
  type Admin,
} from './roster';

const PREF_DEADLINE_OPEN = '2099-12-31 23:59:59-05'; // reopen the submission window
const PREF_DEADLINE_CLOSED = '2026-01-30 23:59:59-05'; // restore to supabase/seed.sql's value

// The submission-window trigger (enforce_preference_deadline) gates BOTH period_targets and
// preferences. We reopen the window, write the e… roster's targets + prefs, then restore the
// deadline — all inside the seed's single transaction, so the window is never left open.
async function setPreferenceDeadline(client: Client, value: string): Promise<void> {
  await client.query(
    `UPDATE scheduling_periods SET preference_deadline = $2 WHERE period_id = $1`,
    [PERIOD_ID, value],
  );
}

interface BuildBlock {
  blockId: string;
  house: string;
  dayIndex: number;
  blockIndex: number;
}

async function seedAuthAndUsers(client: Client): Promise<void> {
  const people = [
    ...WORKERS.map((w) => ({ id: w.userId, name: w.name, email: w.email, home: w.homeHouse })),
    ...ADMINS.map((a) => ({ id: a.userId, name: a.name, email: a.email, home: a.homeHouse })),
  ];
  const ids = people.map((p) => p.id);
  const emails = people.map((p) => p.email);

  // auth.users (GoTrue). Empty-string token columns avoid GoTrue NULL-scan errors (per seed.sql).
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

  // auth.identities (email provider). `email` is a generated column — omit it.
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

  // public.users
  await client.query(
    `INSERT INTO users (user_id, name, email, home_house_id, is_active)
     SELECT id, name, email, home, true
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS v(id, name, email, home)
     ON CONFLICT (user_id) DO NOTHING`,
    [ids, people.map((p) => p.name), emails, people.map((p) => p.home)],
  );

  // user_roles: every worker is a scopeless 'sw'; admins carry their scoped roles.
  const roleUser: string[] = [];
  const roleName: string[] = [];
  const roleScope: (string | null)[] = [];
  for (const w of WORKERS) {
    roleUser.push(w.userId);
    roleName.push('sw');
    roleScope.push(null);
  }
  for (const a of ADMINS) {
    for (const r of a.roles) {
      roleUser.push(a.userId);
      roleName.push(r.role);
      roleScope.push(r.scope);
    }
  }
  await client.query(
    `INSERT INTO user_roles (user_id, role, scope_house_id)
     SELECT id, role::user_role_enum, scope
     FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, role, scope)
     ON CONFLICT DO NOTHING`,
    [roleUser, roleName, roleScope],
  );
}

async function readBuildWeekBlocks(client: Client): Promise<BuildBlock[]> {
  const { rows } = await client.query(
    `SELECT block_id,
            house_id,
            (block_start_at AT TIME ZONE 'America/New_York')::date::text AS ny_date,
            (extract(hour FROM block_start_at AT TIME ZONE 'America/New_York') * 60
             + extract(minute FROM block_start_at AT TIME ZONE 'America/New_York'))::int AS minute_of_day
     FROM shift_blocks
     WHERE (block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date`,
    [BUILD_WEEK_START, BUILD_WEEK_END],
  );
  return rows.map((r) => ({
    blockId: r.block_id as string,
    house: r.house_id as string,
    dayIndex: BUILD_WEEK_DATES.indexOf(r.ny_date),
    blockIndex: (r.minute_of_day - FIRST_BLOCK_MINUTE) / 30,
  }));
}

async function seedPeriodTargets(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO period_targets (user_id, period_id, target_hours, opted_out)
     SELECT id, $2::uuid, 16, false FROM unnest($1::uuid[]) AS v(id)
     ON CONFLICT (user_id, period_id) DO NOTHING`,
    [WORKERS.map((w) => w.userId), PERIOD_ID],
  );
}

async function seedPreferences(client: Client, blocks: BuildBlock[]): Promise<number> {
  // Compute the non-'available' preference rows (the persisted ones) for each worker against
  // their own home-house blocks, using the same archetype model the allocator uses.
  const blocksByHouse = new Map<string, BuildBlock[]>();
  for (const b of blocks) {
    const list = blocksByHouse.get(b.house);
    if (list) list.push(b);
    else blocksByHouse.set(b.house, [b]);
  }

  const prefUser: string[] = [];
  const prefBlock: string[] = [];
  const prefStatusValue: string[] = [];
  for (const w of WORKERS) {
    for (const b of blocksByHouse.get(w.homeHouse) ?? []) {
      const status = prefStatus(w.archetype, b.dayIndex, b.blockIndex);
      if (status === 'available') continue;
      prefUser.push(w.userId);
      prefBlock.push(b.blockId);
      prefStatusValue.push(status);
    }
  }

  // The submission window is opened by the caller (around targets + preferences).
  const CHUNK = 1000;
  for (let i = 0; i < prefUser.length; i += CHUNK) {
    await client.query(
      `INSERT INTO preferences (user_id, block_id, period_id, status)
       SELECT u, b, $4::uuid, s::preference_status_enum
       FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS v(u, b, s)
       ON CONFLICT (user_id, block_id, period_id) DO NOTHING`,
      [
        prefUser.slice(i, i + CHUNK),
        prefBlock.slice(i, i + CHUNK),
        prefStatusValue.slice(i, i + CHUNK),
        PERIOD_ID,
      ],
    );
  }

  return prefUser.length;
}

async function insertDrafts(
  client: Client,
  assignments: Assignment[],
  blocks: BuildBlock[],
  builder: Admin,
): Promise<number> {
  const blockId = new Map<string, string>();
  for (const b of blocks) blockId.set(`${b.house}|${b.dayIndex}|${b.blockIndex}`, b.blockId);

  const draftBlock: string[] = [];
  const draftUser: string[] = [];
  for (const a of assignments) {
    for (const bi of a.blockIndexes) {
      const id = blockId.get(`${a.house}|${a.dayIndex}|${bi}`);
      if (id) {
        draftBlock.push(id);
        draftUser.push(a.userId);
      }
    }
  }

  const CHUNK = 1000;
  for (let i = 0; i < draftBlock.length; i += CHUNK) {
    await client.query(
      `INSERT INTO draft_block_assignments (period_id, block_id, user_id, created_by)
       SELECT $1::uuid, b, u, $2::uuid
       FROM unnest($3::uuid[], $4::uuid[]) AS v(b, u)
       ON CONFLICT (period_id, block_id, user_id) DO NOTHING`,
      [PERIOD_ID, builder.userId, draftBlock.slice(i, i + CHUNK), draftUser.slice(i, i + CHUNK)],
    );
  }
  return draftBlock.length;
}

async function main(): Promise<void> {
  const { dbUrl } = localStackEnv();
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Guard the build-week anchor (a wrong constant would silently misalign every archetype).
    const dow = await client.query(`SELECT extract(dow FROM $1::date)::int AS d`, [
      BUILD_WEEK_START,
    ]);
    if (dow.rows[0].d !== 1) {
      throw new Error(
        `BUILD_WEEK_START ${BUILD_WEEK_START} is not a Monday (dow=${dow.rows[0].d})`,
      );
    }

    await seedAuthAndUsers(client);

    // Map the build-week dates onto the regular_school_year profile so the generator runs.
    await client.query(
      `INSERT INTO operating_calendar (date, profile_name)
       SELECT d::date, 'regular_school_year'
       FROM generate_series($1::date, $2::date, interval '1 day') AS d
       ON CONFLICT (date) DO NOTHING`,
      [BUILD_WEEK_START, BUILD_WEEK_END],
    );

    const gen = await client.query(`SELECT * FROM generate_blocks_for_range($1::date, $2::date)`, [
      BUILD_WEEK_START,
      BUILD_WEEK_END,
    ]);

    const blocks = await readBuildWeekBlocks(client);

    // Open the submission window for the e… roster, write targets + prefs, restore the deadline.
    await setPreferenceDeadline(client, PREF_DEADLINE_OPEN);
    await seedPeriodTargets(client);
    const prefCount = await seedPreferences(client, blocks);
    await setPreferenceDeadline(client, PREF_DEADLINE_CLOSED);

    // Idempotent re-run guard: never re-allocate or re-publish an already-published house.
    const publishedHouses = new Set<string>(
      (
        await client.query(`SELECT house_id FROM period_house_publications WHERE period_id = $1`, [
          PERIOD_ID,
        ])
      ).rows.map((r) => r.house_id as string),
    );

    const days = [0, 1, 2, 3, 4, 5, 6];
    const assignments = allocate(WORKERS, days, { skipHouses: publishedHouses });
    const draftCount = await insertDrafts(client, assignments, blocks, BUILDER);

    const toPublish = HOUSES.filter((h) => !publishedHouses.has(h));
    for (const house of toPublish) {
      await client.query(`SELECT publish_schedule($1::uuid, $2::uuid, $3::text)`, [
        PERIOD_ID,
        BUILDER.userId,
        house,
      ]);
    }

    await client.query('COMMIT');

    const scheduled = await client.query(
      `SELECT count(*)::int AS n FROM shift_block_assignments a
       JOIN shift_blocks b ON b.block_id = a.block_id
       WHERE a.status = 'scheduled'
         AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date`,
      [BUILD_WEEK_START, BUILD_WEEK_END],
    );
    const vacant = await client.query(
      `SELECT count(*)::int AS n FROM shift_block_assignments a
       JOIN shift_blocks b ON b.block_id = a.block_id
       WHERE a.status = 'vacant'
         AND (b.block_start_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date`,
      [BUILD_WEEK_START, BUILD_WEEK_END],
    );

    console.log('[seed] e2e-lifecycle realistic seed complete');
    console.log(
      `  workers .............. ${WORKERS.length} (e… SWs across ${HOUSES.length} houses)`,
    );
    const adminsWithRole = (role: string): number =>
      ADMINS.filter((a) => a.roles.some((r) => r.role === role)).length;
    console.log(
      `  admins ............... ${ADMINS.length} (${adminsWithRole('bm')} BM · ${adminsWithRole(
        'hm',
      )} HM · ${adminsWithRole('sm')} SM)`,
    );
    console.log(`  build week ........... ${BUILD_WEEK_START} … ${BUILD_WEEK_END}`);
    console.log(
      `  blocks (this run) .... +${gen.rows[0].blocks_inserted} (${blocks.length} in week)`,
    );
    console.log(`  preferences .......... ${prefCount} non-'available' rows`);
    console.log(`  drafts allocated ..... ${draftCount}`);
    console.log(`  houses published ..... ${toPublish.length} (${publishedHouses.size} already)`);
    console.log(`  scheduled / vacant ... ${scheduled.rows[0].n} / ${vacant.rows[0].n}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED');
  console.error(err);
  process.exit(1);
});
