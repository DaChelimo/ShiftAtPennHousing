// Snapshot builder for the AI schedule agent (mirrors getBuilderData's
// service-client rationale: the generator runs for a schedule builder who
// may not hold people-admin RLS; the calling action gates authorization).
//
// Snapshot-then-pure: everything the loop needs is materialized here into
// a plain AiScheduleInput; @shift/core/ai-schedule never touches the DB.
// Rules applied here, not in core: submitters-only roster (>= 1 preference
// row OR a period_targets row; opted-out workers dropped), missing rows and
// status 'none' collapse to available, voided blocks filtered, effective
// cap resolved via the effective_weekly_cap RPC, and the safe-to-build gate
// (not published AND preference deadline closed via the RPC, which honors
// the dev sim clock; never Date.now()).

import { blockWeekSlot, type AiScheduleInput } from '@shift/core';

import { createServiceClient } from '../supabase/server';

import { selectByBlockIdChunks } from './blockChunks';

const NY = 'America/New_York';
const HARNWELL_HOUSE_ID = 'harnwell';

function nyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

// The Monday (NY) of the week containing `date` ('YYYY-MM-DD').
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  const offset = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - offset);
  return at.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export type AiScheduleGate = {
  canGenerate: boolean;
  reason: string | null; // user-facing copy when canGenerate is false
  published: boolean;
  deadlineOpen: boolean;
};

export type AiScheduleContext = {
  gate: AiScheduleGate;
  periodId: string | null;
  input: AiScheduleInput | null; // null whenever gate.canGenerate is false
  existingDraftCount: number; // drafts on the template week's blocks
  workerNamesById: Record<string, string>;
};

function blocked(reason: string, published = false, deadlineOpen = false): AiScheduleContext {
  return {
    gate: { canGenerate: false, reason, published, deadlineOpen },
    periodId: null,
    input: null,
    existingDraftCount: 0,
    workerNamesById: {},
  };
}

export async function getAiScheduleContext(houseId: string): Promise<AiScheduleContext> {
  const supabase = createServiceClient();

  // 1. Live blocks; the template week is the NY week of the earliest block
  // (same derivation publish_schedule uses for its pattern window).
  const { data: blockRows } = await supabase
    .from('shift_blocks')
    .select('block_id, block_start_at, required_headcount')
    .eq('house_id', houseId)
    .is('voided_at', null)
    .order('block_start_at');
  const allBlocks = blockRows ?? [];
  const firstBlock = allBlocks[0];
  if (firstBlock === undefined) {
    return blocked('This house has no schedule blocks yet.');
  }

  const firstDay = nyDate(firstBlock.block_start_at);
  const wkStart = weekStart(firstDay);
  const wkEnd = addDays(wkStart, 7);
  const weekBlocks = allBlocks.filter((b) => {
    const day = nyDate(b.block_start_at);
    return day >= wkStart && day < wkEnd;
  });
  const weekBlockIds = weekBlocks.map((b) => b.block_id);

  // 2. The scheduling period covering the template week.
  const { data: periodRows } = await supabase
    .from('scheduling_periods')
    .select('period_id')
    .lte('start_date', firstDay)
    .gte('end_date', firstDay);
  const periodId = periodRows?.[0]?.period_id ?? null;
  if (periodId === null) {
    return blocked('No scheduling period covers this schedule week.');
  }

  // 3. Safe-to-build gate.
  const { data: pub } = await supabase
    .from('period_house_publications')
    .select('house_id')
    .eq('period_id', periodId)
    .eq('house_id', houseId)
    .maybeSingle();
  const published = pub !== null && pub !== undefined;

  const { data: deadlineOpenData } = await supabase.rpc('preference_deadline_is_open', {
    check_period_id: periodId,
  });
  const deadlineOpen = deadlineOpenData === true;

  if (published) {
    return {
      ...blocked('This schedule is already published for the period.', true, deadlineOpen),
      periodId,
    };
  }
  if (deadlineOpen) {
    return {
      ...blocked('The preference deadline is still open. Generate after it closes.', false, true),
      periodId,
    };
  }

  // 4. House roster (active student workers), then narrow to submitters. Roster
  //    is membership-aware as-of the build week (house_roster_as_of), so a worker
  //    with a scheduled transfer is built into their DESTINATION house for the
  //    upcoming season. Their forward-looking home house for that season IS this
  //    house, so homeHouseId below is houseId (correct for the Harnwell training
  //    constraint when pre-building a transfer-in). See 20260719000001.
  const { data: rosterRows } = await supabase.rpc('house_roster_as_of', {
    p_house_id: houseId,
    p_as_of: firstDay,
  });
  // house_roster_as_of also returns the house's RSM (2026-07-29 desk-assignment
  // decision, is_rsm=true) for the manual builder. The AI agent generates a
  // preference-driven schedule for capped student workers only; an RSM never
  // submits preferences or a target and is excluded here on purpose.
  const houseWorkers = ((rosterRows ?? []) as { user_id: string; name: string; is_rsm: boolean }[])
    .filter((u) => !u.is_rsm)
    .map((u) => ({ user_id: u.user_id, name: u.name }));
  const houseWorkerIds = houseWorkers.map((u) => u.user_id);

  const prefRows = await selectByBlockIdChunks(weekBlockIds, (chunk) =>
    supabase
      .from('preferences')
      .select('user_id, block_id, status')
      .eq('period_id', periodId)
      .in('block_id', chunk),
  );

  const { data: targetRows } = await supabase
    .from('period_targets')
    .select('user_id, target_hours, opted_out')
    .eq('period_id', periodId)
    .in(
      'user_id',
      houseWorkerIds.length > 0 ? houseWorkerIds : ['00000000-0000-0000-0000-000000000000'],
    );
  const targetByUser = new Map(
    (targetRows ?? []).map((t) => [
      t.user_id,
      { targetHours: t.target_hours, optedOut: t.opted_out },
    ]),
  );

  const prefsByUser = new Map<string, Record<string, 'preferred' | 'cannot'>>();
  for (const p of prefRows) {
    // Only preferred/cannot carry signal; 'available'/'none' collapse to the
    // sparse default (missing = available for a submitter).
    if (p.status !== 'preferred' && p.status !== 'cannot') {
      if (!prefsByUser.has(p.user_id)) prefsByUser.set(p.user_id, {});
      continue;
    }
    const grid = prefsByUser.get(p.user_id) ?? {};
    grid[p.block_id] = p.status;
    prefsByUser.set(p.user_id, grid);
  }

  const roster: AiScheduleInput['roster'] = [];
  const workerNamesById: Record<string, string> = {};
  for (const worker of houseWorkers) {
    const target = targetByUser.get(worker.user_id);
    const submitted = prefsByUser.has(worker.user_id) || target !== undefined;
    if (!submitted) continue; // non-submitters are never scheduled by the agent
    if (target?.optedOut === true) continue; // opted out = zero hours
    roster.push({
      workerId: worker.user_id,
      homeHouseId: houseId,
      targetHours: target === undefined ? null : target.targetHours,
      prefs: prefsByUser.get(worker.user_id) ?? {},
    });
    workerNamesById[worker.user_id] = worker.name;
  }
  if (roster.length === 0) {
    return {
      ...blocked('No workers have submitted preferences for this period.'),
      periodId,
    };
  }

  // 5. Weekly cap for the template week. effective_weekly_cap yields
  // (20, soft) or (40, hard); the soft 20 is ADVISORY at build time (admin
  // assignment may exceed it with an override, and summer period targets
  // legitimately reach the profile ceiling of 40). The binding build
  // ceiling is therefore the RPC cap raised to the largest target any
  // roster worker holds; targets are DB-capped at the profile's
  // default_hours_cap, so this never exceeds the profile ceiling.
  const { data: capRows } = await supabase.rpc('effective_weekly_cap', {
    p_week_start_date: wkStart,
    p_block_start_at: firstBlock.block_start_at,
  });
  const rpcCap = capRows?.[0]?.hours_cap ?? 20;
  const maxTarget = Math.max(0, ...roster.map((w) => w.targetHours ?? 0));
  const capHours = Math.max(rpcCap, maxTarget);

  // 6. Existing drafts on the template week (the replace-all count).
  const draftRows = await selectByBlockIdChunks(weekBlockIds, (chunk) =>
    supabase
      .from('draft_block_assignments')
      .select('draft_assignment_id')
      .eq('period_id', periodId)
      .in('block_id', chunk),
  );

  const input: AiScheduleInput = {
    houseId,
    isHarnwell: houseId === HARNWELL_HOUSE_ID,
    periodId,
    weekStartDate: wkStart,
    capHours,
    blocks: weekBlocks.map((b) => {
      const slot = blockWeekSlot(new Date(b.block_start_at));
      return {
        blockId: b.block_id,
        blockStartAtIso: b.block_start_at,
        weekday: slot.weekday,
        minuteOfDay: slot.minuteOfDay,
        requiredHeadcount: b.required_headcount,
      };
    }),
    roster,
  };

  return {
    gate: { canGenerate: true, reason: null, published: false, deadlineOpen: false },
    periodId,
    input,
    existingDraftCount: draftRows.length,
    workerNamesById,
  };
}
