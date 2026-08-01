// Compile and apply an operating season against a REMOTE (hosted) project.
//
// The web surface does this through previewOrApplySeason(), but that path is unusable
// headlessly: it calls requireAdmin() for a browser session, and apps/web/lib/supabase/server.ts
// imports next/headers at module scope. So this mirrors the same three steps directly --
// read the authoring rows, run the PURE compiler, call the RPC -- and imports only
// @shift/core, which has no Supabase or Next dependency.
//
// The RUNBOOK's `apply_compiled_season(..., '{}'::jsonb, true)` is WRONG: p_payload is the
// COMPILED season ({slug, period, phases}), not an empty object. With {} the RPC reads a
// null slug and no phases and reconciles nothing.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm tsx scripts/apply-season-remote.ts [--apply]
//
// Without --apply it is a dry run, which the RPC implements as a rolled-back subtransaction,
// so preview and apply share identical logic.

// Imported from source, not '@shift/core': the workspace package exposes no root export
// map, so a bare specifier fails to resolve outside a bundler. compile.ts is pure TS with
// no runtime dependencies, so tsx loads it directly.
import { createClient } from '@supabase/supabase-js';

import { compileSeason } from '../packages/core/src/operating-seasons/compile.js';

const URL = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const APPLY = process.argv.includes('--apply');

if (URL === '' || KEY === '') {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  const { data: seasons, error: seasonErr } = await db
    .from('operating_seasons')
    .select(
      'season_id, season_name, slug, start_date, end_date, scheduling_mode, hours_cap, cap_enforcement, shift_start_bound, shift_end_bound, preference_deadline, created_by',
    )
    .order('start_date');
  if (seasonErr !== null) throw seasonErr;
  if (seasons === null || seasons.length === 0) throw new Error('No operating_seasons rows.');

  for (const season of seasons) {
    const [{ data: houseWindows, error: hwErr }, { data: floatWindows, error: fwErr }] =
      await Promise.all([
        db
          .from('season_house_windows')
          .select('window_id, house_id, start_date, end_date, weekday_bands, weekend_bands')
          .eq('season_id', season.season_id)
          .order('house_id')
          .order('start_date'),
        db
          .from('season_float_windows')
          .select('window_id, start_date, end_date')
          .eq('season_id', season.season_id)
          .order('start_date'),
      ]);
    if (hwErr !== null) throw hwErr;
    if (fwErr !== null) throw fwErr;

    // Same mapping as apps/web/lib/data/operatingSeasons.ts getSeasonDetail + toAuthoringInput.
    // windowId is deliberately dropped: the compiler keys on (house, range), not row identity.
    const authoring = {
      season: {
        seasonId: season.season_id,
        slug: season.slug,
        seasonName: season.season_name,
        startDate: season.start_date,
        endDate: season.end_date,
        schedulingMode: season.scheduling_mode,
        hoursCap: season.hours_cap,
        capEnforcement: season.cap_enforcement,
        shiftStartBound: String(season.shift_start_bound).slice(0, 5),
        shiftEndBound: String(season.shift_end_bound).slice(0, 5),
      },
      houseWindows: (houseWindows ?? []).map((w) => ({
        houseId: w.house_id,
        startDate: w.start_date,
        endDate: w.end_date,
        weekdayBands: (w.weekday_bands ?? []) as never,
        weekendBands: (w.weekend_bands ?? []) as never,
      })),
      floatWindows: (floatWindows ?? []).map((w) => ({
        startDate: w.start_date,
        endDate: w.end_date,
      })),
    };

    const payload = compileSeason(authoring as never);
    const phases = (payload as { phases?: unknown[] }).phases ?? [];
    console.log(
      `\n=== ${season.season_name} (${season.slug}) ===\n` +
        `  house windows : ${authoring.houseWindows.length}\n` +
        `  float windows : ${authoring.floatWindows.length}\n` +
        `  phases        : ${phases.length}`,
    );

    const { data: impact, error: rpcErr } = await db.rpc('apply_compiled_season', {
      p_calling_user_id: season.created_by,
      p_season_id: season.season_id,
      p_payload: payload as never,
      p_dry_run: !APPLY,
    });
    if (rpcErr !== null) throw rpcErr;

    console.log(`  ${APPLY ? 'APPLIED' : 'DRY RUN'}:`, JSON.stringify(impact));

    // apply's period upsert leaves preference_deadline untouched on conflict, so the web
    // action stamps it separately. Mirror that or the preference board loses its deadline.
    if (APPLY && season.preference_deadline !== null) {
      const { error: stampErr } = await db.rpc('set_preference_deadline', {
        p_actor_user_id: season.created_by,
        p_period_id: season.season_id,
        p_preference_deadline: season.preference_deadline,
      });
      if (stampErr !== null) console.error('  preference deadline stamp failed:', stampErr.message);
      else console.log('  preference deadline stamped');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
