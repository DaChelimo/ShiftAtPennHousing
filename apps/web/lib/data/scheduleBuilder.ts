import type { PreferenceRecord, PreferenceStatus } from '@shift/core';

import { createServiceClient } from '../supabase/server';
import { simNow } from '../time/simClock';

import { selectByBlockIdChunks } from './blockChunks';
import { resolveBuildTarget } from './buildTarget';

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

  // 1. The season being built, and its first week at this house (buildTarget.ts).
  //    The week is derived from the PERIOD, not from the house's all-time earliest
  //    block: a house with two seasons materialized would otherwise stay pinned to
  //    the oldest one forever, showing last summer's hours and last summer's
  //    preferences while the admin prepares the upcoming season.
  const target = await resolveBuildTarget(supabase, houseId);
  const periodId = target?.periodId ?? null;

  // 2. Roster: active student workers whose house membership covers the build
  //    week (as-of its first day). A worker with a scheduled transfer shows in
  //    their destination house for weeks on/after their effective date and drops
  //    from the old house for those weeks; without a transfer this is just their
  //    home house. Falls back to the period start, then today, when the house has
  //    no blocks in the season (it is closed).
  //    See house_roster_as_of / membership_house_for_date (20260719000001).
  const weekLo = target?.weekStartDate ?? null;
  const weekHi = target?.weekEndDate ?? null;
  const rosterAsOf = weekLo ?? target?.periodStartDate ?? nyDate((await simNow()).toISOString());

  const [rosterResult, weekBlockResult] = await Promise.all([
    supabase.rpc('house_roster_as_of', { p_house_id: houseId, p_as_of: rosterAsOf }),
    weekLo === null
      ? Promise.resolve({ data: [] as BlockRow[] })
      : // A ±12h UTC envelope around the NY week, filtered precisely by NY date below —
        // same DST-safe pattern the live calendar uses.
        supabase
          .from('shift_blocks')
          .select('block_id, block_start_at, required_headcount')
          .eq('house_id', houseId)
          .is('voided_at', null)
          .gte('block_start_at', `${weekLo}T00:00:00.000Z`)
          .lt('block_start_at', `${weekHi!}T12:00:00.000Z`)
          .order('block_start_at'),
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
    weekStartDate: null,
    blocks: [],
    workers,
    submittedUserIds: [],
    targets: {},
    preferences: [],
    drafts: {},
  };
  if (allBlocks.length === 0 || weekLo === null) return empty;

  const wkStart = weekLo;
  const wkEnd = weekHi!;

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

  if (periodId === null) {
    return { ...empty, blocks, weekStartDate: wkStart };
  }

  // 3-5. Everything keyed off the period. None of these three reads depends on another,
  // but they used to run strictly in sequence — preferences, then targets, then drafts —
  // with the two chunked reads each paying five serial round trips of their own on top.
  // One wave now. (The publication check is already answered by resolveBuildTarget.)
  const [prefRows, targetResult, draftRows] = await Promise.all([
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

  return {
    periodId,
    houseId,
    published: target?.publishedForHouse === true,
    weekStartDate: wkStart,
    blocks,
    workers,
    submittedUserIds,
    targets,
    preferences,
    drafts,
  };
}
