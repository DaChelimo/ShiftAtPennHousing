import type { PreferenceRecord, PreferenceStatus } from '@shift/core';

import { createServiceClient } from '../supabase/server';

import { selectByBlockIdChunks } from './blockChunks';

const NY = 'America/New_York';

// NY wall-clock date as 'YYYY-MM-DD' (en-CA yields ISO order).
function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

// NY wall-clock 'HHMM' (the stable grid-cell key, e.g. '1000').
function nyTimeKey(iso: string): string {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  return hhmm.replace(':', '');
}

// NY 'HH:mm' for display.
function nyTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NY,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// The Monday (NY) of the week containing `date` ('YYYY-MM-DD'), returned 'YYYY-MM-DD'.
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  const dow = at.getUTCDay(); // 0=Sun..6=Sat
  const offset = (dow + 6) % 7; // days since Monday
  at.setUTCDate(at.getUTCDate() - offset);
  return at.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export type BuilderBlock = {
  blockId: string;
  startAtIso: string;
  dayKey: string; // NY YYYY-MM-DD
  timeKey: string; // NY HHMM (cell key suffix)
  cellKey: string; // `${dayKey}-${timeKey}` → data-testid `block-${cellKey}`
  timeLabel: string; // NY HH:mm
  requiredHeadcount: number; // concurrent staffing limit for this block (1 regular / 2 Harnwell / 3 Quad)
};

export type BuilderWorker = { userId: string; name: string; isRsm: boolean };

export type BuilderTarget = { targetHours: number; optedOut: boolean };

export type BuilderData = {
  periodId: string | null;
  houseId: string;
  published: boolean;
  deadlineOpen: boolean; // preference submission still open (AI panel gate)
  weekStartDate: string | null;
  blocks: BuilderBlock[];
  workers: BuilderWorker[]; // full house roster (Phase-2 pool)
  submittedUserIds: string[]; // workers with ≥1 preference row (Phase-1 pool)
  targets: Record<string, BuilderTarget>;
  preferences: PreferenceRecord[];
  drafts: Record<string, string[]>; // blockId → [userId]
};

// Load everything the builder renders for `houseId`: the current build week's blocks,
// the house roster, submitted preferences + period targets, and any existing draft
// assignments. The pure card view-model (@shift/core) is assembled client-side from
// this snapshot — the web is a thin wrapper (AGENTS Conventions).
//
// Uses the service client: the SM builds schedules (BSpec §2.2) and so needs the worker
// ROSTER (names + roles), but people-admin RLS on `users`/`user_roles` is HM/BM-only by
// design (phase-07 note: "Admin over PEOPLE stays hm/bm-only" — an SM can read
// preferences/blocks via `user_can_build_schedule` but not other people's user rows).
// The caller (`/schedule-builder`) gates on `canBuildSchedule` + scopes to the admin's
// own house, so this server-side snapshot read is authorized — the same pattern as the
// leave/rotor reads and the phase-07 orchestrator's state snapshot.
type BlockRow = { block_id: string; block_start_at: string; required_headcount: number };

export async function getBuilderData(houseId: string): Promise<BuilderData> {
  const supabase = createServiceClient();

  // 1. Blocks for the house; choose the week of the earliest block as the build week.
  //
  // Only the FIRST week is ever used (everything below filters to `wkStart`..`wkEnd`),
  // so this reads the earliest block first and then fetches just that week's rows
  // instead of pulling the house's entire block history to look at its head. On a house
  // with a full season seeded that was thousands of rows crossing the wire per render,
  // and it sat right up against PostgREST's 1000-row cap.
  const { data: firstBlockRows } = await supabase
    .from('shift_blocks')
    .select('block_start_at')
    .eq('house_id', houseId)
    .order('block_start_at')
    .limit(1);

  const firstBlockStart = firstBlockRows?.[0]?.block_start_at ?? null;

  // 2. Roster: active student workers whose house membership covers the build
  //    week (as-of its first day). A worker with a scheduled transfer shows in
  //    their destination house for weeks on/after their effective date and drops
  //    from the old house for those weeks; without a transfer this is just their
  //    home house. Falls back to today when the house has no blocks yet.
  //    See house_roster_as_of / membership_house_for_date (20260719000001).
  //
  //    Fetched alongside the build week's blocks and its scheduling period: all three
  //    key off the first block's DATE, which we already have, so they no longer run one
  //    after another.
  const rosterAsOf =
    firstBlockStart !== null ? nyDate(firstBlockStart) : nyDate(new Date().toISOString());
  const weekLo = firstBlockStart === null ? null : weekStart(nyDate(firstBlockStart));
  const weekHi = weekLo === null ? null : addDays(weekLo, 7);

  const [rosterResult, weekBlockResult, periodResult] = await Promise.all([
    supabase.rpc('house_roster_as_of', { p_house_id: houseId, p_as_of: rosterAsOf }),
    weekLo === null
      ? Promise.resolve({ data: [] as BlockRow[] })
      : // A ±12h UTC envelope around the NY week, filtered precisely by NY date below —
        // same DST-safe pattern the live calendar uses.
        supabase
          .from('shift_blocks')
          .select('block_id, block_start_at, required_headcount')
          .eq('house_id', houseId)
          .gte('block_start_at', `${weekLo}T00:00:00.000Z`)
          .lt('block_start_at', `${weekHi!}T12:00:00.000Z`)
          .order('block_start_at'),
    // The scheduling period covering the build week's first day. `rosterAsOf` IS that
    // day (it falls back to today only when the house has no blocks, in which case the
    // empty-blocks return below fires before the period is ever read).
    supabase
      .from('scheduling_periods')
      .select('period_id, start_date, end_date')
      .lte('start_date', rosterAsOf)
      .gte('end_date', rosterAsOf),
  ]);

  const allBlocks = ((weekBlockResult.data ?? []) as BlockRow[]).map((b) => ({
    blockId: b.block_id,
    startAtIso: b.block_start_at,
    requiredHeadcount: b.required_headcount,
  }));

  // Cast until `database.types.ts` is regenerated against the 20260729000001
  // migration (adds is_rsm); the generated RPC return type doesn't know it yet.
  const roster = (rosterResult.data ?? []) as { user_id: string; name: string; is_rsm: boolean }[];
  const workers: BuilderWorker[] = roster.map((u) => ({
    userId: u.user_id,
    name: u.name,
    isRsm: u.is_rsm,
  }));
  const workerIds = workers.map((w) => w.userId);

  const empty: BuilderData = {
    periodId: null,
    houseId,
    published: false,
    deadlineOpen: false,
    weekStartDate: null,
    blocks: [],
    workers,
    submittedUserIds: [],
    targets: {},
    preferences: [],
    drafts: {},
  };
  if (allBlocks.length === 0) return empty;

  const firstDay = nyDate(allBlocks[0]!.startAtIso);
  const wkStart = weekStart(firstDay);
  const wkEnd = addDays(wkStart, 7);

  const blocks: BuilderBlock[] = allBlocks
    .filter((b) => {
      const day = nyDate(b.startAtIso);
      return day >= wkStart && day < wkEnd;
    })
    .map((b) => {
      const dayKey = nyDate(b.startAtIso);
      const timeKey = nyTimeKey(b.startAtIso);
      return {
        blockId: b.blockId,
        startAtIso: b.startAtIso,
        dayKey,
        timeKey,
        cellKey: `${dayKey}-${timeKey}`,
        timeLabel: nyTimeLabel(b.startAtIso),
        requiredHeadcount: b.requiredHeadcount,
      };
    });
  const weekBlockIds = blocks.map((b) => b.blockId);

  // 3. The scheduling period covering this build week (fetched in the wave above).
  const periodId = periodResult.data?.[0]?.period_id ?? null;

  if (periodId === null) {
    return { ...empty, blocks, weekStartDate: wkStart };
  }

  // 4-7. Everything keyed off the period. None of these five reads depends on another,
  // but they used to run strictly in sequence — preferences, then targets, then drafts,
  // then the publication row, then the deadline RPC — with the two chunked reads each
  // paying five serial round trips of their own on top. One wave now.
  const [prefRows, targetResult, draftRows, pubResult, deadlineResult] = await Promise.all([
    // Preferences for the week's blocks (the Phase-1 pool = workers with any pref row).
    selectByBlockIdChunks(weekBlockIds, (chunk) =>
      supabase
        .from('preferences')
        .select('user_id, block_id, status')
        .eq('period_id', periodId)
        .in('block_id', chunk),
    ),
    // Period targets.
    supabase
      .from('period_targets')
      .select('user_id, target_hours, opted_out')
      .eq('period_id', periodId)
      .in('user_id', workerIds.length > 0 ? workerIds : ['00000000-0000-0000-0000-000000000000']),
    // Existing draft assignments for the week (same chunking — 224 ids 414s).
    selectByBlockIdChunks(weekBlockIds, (chunk) =>
      supabase
        .from('draft_block_assignments')
        .select('block_id, user_id')
        .eq('period_id', periodId)
        .in('block_id', chunk),
    ),
    // Published?
    supabase
      .from('period_house_publications')
      .select('house_id')
      .eq('period_id', periodId)
      .eq('house_id', houseId)
      .maybeSingle(),
    // Is preference submission still open? (The AI panel may only generate after the
    // deadline closes; the RPC honors app_now().)
    supabase.rpc('preference_deadline_is_open', { check_period_id: periodId }),
  ]);

  const preferences: PreferenceRecord[] = prefRows.map((p) => ({
    userId: p.user_id,
    blockId: p.block_id,
    status: p.status as PreferenceStatus,
  }));

  const targets: Record<string, BuilderTarget> = {};
  for (const t of targetResult.data ?? []) {
    targets[t.user_id] = { targetHours: t.target_hours, optedOut: t.opted_out };
  }

  // The Phase-1 pool is everyone who SUBMITTED: any preference row OR any
  // period_targets row (incl. a "no hours" opt-out). Workers with neither are
  // "none / unspecified" (§4.2) and appear only in the Phase-2 full roster. A
  // submitted worker with no preference for a span block lands in `blocked`
  // (missing) per phase1Grouping, not assignable in Phase 1, matching §4.1.
  //
  // The house's RSM never submits preferences (2026-07-29 desk-assignment
  // decision) but must still be visible in Phase 1, so they're unioned in
  // here too; `buildPhase1Card` special-cases them (isRsm) to skip phase-04's
  // preference grouping instead of always landing them in `blocked: missing`.
  const submittedUserIds = [
    ...new Set([
      ...preferences.map((p) => p.userId),
      ...Object.keys(targets),
      ...workers.filter((w) => w.isRsm).map((w) => w.userId),
    ]),
  ];

  const drafts: Record<string, string[]> = {};
  for (const d of draftRows) {
    (drafts[d.block_id] ??= []).push(d.user_id);
  }

  const pub = pubResult.data;
  const deadlineOpenData = deadlineResult.data;

  return {
    periodId,
    houseId,
    published: pub !== null && pub !== undefined,
    deadlineOpen: deadlineOpenData === true,
    weekStartDate: wkStart,
    blocks,
    workers,
    submittedUserIds,
    targets,
    preferences,
    drafts,
  };
}
