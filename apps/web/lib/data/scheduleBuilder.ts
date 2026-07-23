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

export type BuilderWorker = { userId: string; name: string };

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
export async function getBuilderData(houseId: string): Promise<BuilderData> {
  const supabase = createServiceClient();

  // 1. Blocks for the house; choose the week of the earliest block as the build week.
  const { data: blockRows } = await supabase
    .from('shift_blocks')
    .select('block_id, block_start_at, required_headcount')
    .eq('house_id', houseId)
    .order('block_start_at');

  const allBlocks = (blockRows ?? []).map((b) => ({
    blockId: b.block_id,
    startAtIso: b.block_start_at,
    requiredHeadcount: b.required_headcount,
  }));

  // 2. Roster: active student workers whose house membership covers the build
  //    week (as-of its first day). A worker with a scheduled transfer shows in
  //    their destination house for weeks on/after their effective date and drops
  //    from the old house for those weeks; without a transfer this is just their
  //    home house. Falls back to today when the house has no blocks yet.
  //    See house_roster_as_of / membership_house_for_date (20260719000001).
  const rosterAsOf = allBlocks.length
    ? nyDate(allBlocks[0]!.startAtIso)
    : nyDate(new Date().toISOString());
  const { data: rosterRows } = await supabase.rpc('house_roster_as_of', {
    p_house_id: houseId,
    p_as_of: rosterAsOf,
  });
  const workers: BuilderWorker[] = (rosterRows ?? []).map((u) => ({
    userId: u.user_id,
    name: u.name,
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

  // 3. The scheduling period covering this build week.
  const { data: periodRows } = await supabase
    .from('scheduling_periods')
    .select('period_id, start_date, end_date')
    .lte('start_date', firstDay)
    .gte('end_date', firstDay);
  const periodId = periodRows?.[0]?.period_id ?? null;

  if (periodId === null) {
    return { ...empty, blocks, weekStartDate: wkStart };
  }

  // 4. Preferences for the week's blocks (the Phase-1 pool = workers with any pref row).
  const prefRows = await selectByBlockIdChunks(weekBlockIds, (chunk) =>
    supabase
      .from('preferences')
      .select('user_id, block_id, status')
      .eq('period_id', periodId)
      .in('block_id', chunk),
  );
  const preferences: PreferenceRecord[] = prefRows.map((p) => ({
    userId: p.user_id,
    blockId: p.block_id,
    status: p.status as PreferenceStatus,
  }));

  // 5. Period targets.
  const { data: targetRows } = await supabase
    .from('period_targets')
    .select('user_id, target_hours, opted_out')
    .eq('period_id', periodId)
    .in('user_id', workerIds.length > 0 ? workerIds : ['00000000-0000-0000-0000-000000000000']);
  const targets: Record<string, BuilderTarget> = {};
  for (const t of targetRows ?? []) {
    targets[t.user_id] = { targetHours: t.target_hours, optedOut: t.opted_out };
  }

  // The Phase-1 pool is everyone who SUBMITTED — any preference row OR any
  // period_targets row (incl. a "no hours" opt-out). Workers with neither are
  // "none / unspecified" (§4.2) and appear only in the Phase-2 full roster. A
  // submitted worker with no preference for a span block lands in `blocked`
  // (missing) per phase1Grouping — not assignable in Phase 1, matching §4.1.
  const submittedUserIds = [
    ...new Set([...preferences.map((p) => p.userId), ...Object.keys(targets)]),
  ];

  // 6. Existing draft assignments for the week (same chunking — 224 ids 414s).
  const draftRows = await selectByBlockIdChunks(weekBlockIds, (chunk) =>
    supabase
      .from('draft_block_assignments')
      .select('block_id, user_id')
      .eq('period_id', periodId)
      .in('block_id', chunk),
  );
  const drafts: Record<string, string[]> = {};
  for (const d of draftRows) {
    (drafts[d.block_id] ??= []).push(d.user_id);
  }

  // 7. Published? And is preference submission still open? (The AI panel
  // may only generate after the deadline closes; the RPC honors app_now().)
  const { data: pub } = await supabase
    .from('period_house_publications')
    .select('house_id')
    .eq('period_id', periodId)
    .eq('house_id', houseId)
    .maybeSingle();
  const { data: deadlineOpenData } = await supabase.rpc('preference_deadline_is_open', {
    check_period_id: periodId,
  });

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
