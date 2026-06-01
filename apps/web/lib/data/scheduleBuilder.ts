import type { PreferenceRecord, PreferenceStatus } from '@shift/core';

import { createClient } from '../supabase/server';

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
};

export type BuilderWorker = { userId: string; name: string };

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
export async function getBuilderData(houseId: string): Promise<BuilderData> {
  const supabase = await createClient();

  // 1. Roster: active student workers whose home house is this house.
  const { data: roleRows } = await supabase.from('user_roles').select('user_id').eq('role', 'sw');
  const swIds = new Set((roleRows ?? []).map((r) => r.user_id));

  const { data: userRows } = await supabase
    .from('users')
    .select('user_id, name')
    .eq('home_house_id', houseId)
    .eq('is_active', true)
    .order('name');
  const workers: BuilderWorker[] = (userRows ?? [])
    .filter((u) => swIds.has(u.user_id))
    .map((u) => ({ userId: u.user_id, name: u.name }));
  const workerIds = workers.map((w) => w.userId);

  // 2. Blocks for the house; choose the week of the earliest block as the build week.
  const { data: blockRows } = await supabase
    .from('shift_blocks')
    .select('block_id, block_start_at')
    .eq('house_id', houseId)
    .order('block_start_at');

  const allBlocks = (blockRows ?? []).map((b) => ({
    blockId: b.block_id,
    startAtIso: b.block_start_at,
  }));

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
  const { data: prefRows } = await supabase
    .from('preferences')
    .select('user_id, block_id, status')
    .eq('period_id', periodId)
    .in(
      'block_id',
      weekBlockIds.length > 0 ? weekBlockIds : ['00000000-0000-0000-0000-000000000000'],
    );
  const preferences: PreferenceRecord[] = (prefRows ?? []).map((p) => ({
    userId: p.user_id,
    blockId: p.block_id,
    status: p.status as PreferenceStatus,
  }));
  const submittedUserIds = [...new Set(preferences.map((p) => p.userId))];

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

  // 6. Existing draft assignments for the week.
  const { data: draftRows } = await supabase
    .from('draft_block_assignments')
    .select('block_id, user_id')
    .eq('period_id', periodId)
    .in(
      'block_id',
      weekBlockIds.length > 0 ? weekBlockIds : ['00000000-0000-0000-0000-000000000000'],
    );
  const drafts: Record<string, string[]> = {};
  for (const d of draftRows ?? []) {
    (drafts[d.block_id] ??= []).push(d.user_id);
  }

  // 7. Published?
  const { data: pub } = await supabase
    .from('period_house_publications')
    .select('house_id')
    .eq('period_id', periodId)
    .eq('house_id', houseId)
    .maybeSingle();

  return {
    periodId,
    houseId,
    published: pub !== null && pub !== undefined,
    weekStartDate: wkStart,
    blocks,
    workers,
    submittedUserIds,
    targets,
    preferences,
    drafts,
  };
}
