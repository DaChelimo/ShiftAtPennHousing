'use server';

import {
  blockWeekSlot,
  generateBalancedSchedule,
  generateWorkerPreferences,
  weekContains,
  weekStart,
  type PrefGenBlock,
  type SchedBlock,
  type SchedRosterWorker,
} from '@shift/core';
import type { Json } from '@shift/shared';
import { revalidatePath } from 'next/cache';

import { getSessionUser, isAdmin } from '../auth';
import { nyEndOfDayIso, nyMidnightIso } from '../nyTime';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

// ===========================================================================
// Dev seeding (docs/dev-tooling/PLAN.md) — admin-only tools to simulate a full
// summer workflow without logging in as every SW/SM/SM.
//
// All three actions run through the SERVICE client (auth.uid() is NULL there), so
// the write RPCs take the actor uuid explicitly and re-verify user_is_admin(actor).
// The real gate is requireAdmin() here; the RPC check is defense-in-depth.
// ===========================================================================

// A stable run seed keeps regeneration reproducible; the generators fold in
// (periodId, userId/houseId) so different periods/houses diverge.
const DEV_SEED = 'shift-dev-seed-v1';

type ServiceClient = ReturnType<typeof createServiceClient>;

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const me = await getSessionUser();
  if (me === null || !isAdmin(me)) {
    return { error: 'Only an administrator may run the dev seeding tools.' };
  }
  return { userId: me.userId };
}

type SeasonContext = {
  periodId: string;
  startDate: string;
  endDate: string;
  capHours: number;
  openHouses: string[];
};

// Resolve the season's runtime scheduling context. period_id == season_id (apply
// materializes it that way). Errors if the season has not been applied yet.
async function resolveSeasonContext(
  service: ServiceClient,
  seasonId: string,
): Promise<SeasonContext | { error: string }> {
  const { data: period, error } = await service
    .from('scheduling_periods')
    .select('period_id, start_date, end_date, profile_name')
    .eq('period_id', seasonId)
    .maybeSingle();
  if (error !== null) return { error: error.message };
  if (period === null) {
    return { error: 'Apply this season first. No scheduling period exists for it yet.' };
  }

  const { data: profile } = await service
    .from('operating_profiles')
    .select('default_hours_cap')
    .eq('profile_name', period.profile_name)
    .maybeSingle();
  const capHours = profile?.default_hours_cap ?? null;
  if (capHours === null) {
    return { error: `No operating profile "${period.profile_name}" found for this season.` };
  }

  const lower = nyMidnightIso(period.start_date);
  const upper = nyEndOfDayIso(period.end_date);
  if (lower === null || upper === null) return { error: 'Season has invalid start/end dates.' };

  // Open houses = houses with at least one live (non-voided) block in the period. One
  // cheap existence probe per house (13) sidesteps the 1000-row read cap.
  const { data: houseRows } = await service.from('houses').select('id');
  const houseIds = (houseRows ?? []).map((h) => h.id);
  const openHouses: string[] = [];
  for (const houseId of houseIds) {
    const { count } = await service
      .from('shift_blocks')
      .select('block_id', { count: 'exact', head: true })
      .eq('house_id', houseId)
      .is('voided_at', null)
      .gte('block_start_at', lower)
      .lte('block_start_at', upper);
    if ((count ?? 0) > 0) openHouses.push(houseId);
  }

  return {
    periodId: period.period_id,
    startDate: period.start_date,
    endDate: period.end_date,
    capHours,
    openHouses,
  };
}

// Page past the PostgREST max_rows cap (1000). A single house can hold ~3000 blocks
// across a summer period, so full-period reads MUST paginate.
async function fetchAllBlocks(
  service: ServiceClient,
  houseId: string,
  gteIso: string,
  lteIso: string,
): Promise<{ blockId: string; startAtIso: string; requiredHeadcount: number }[]> {
  const PAGE = 1000;
  const out: { blockId: string; startAtIso: string; requiredHeadcount: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from('shift_blocks')
      .select('block_id, block_start_at, required_headcount')
      .eq('house_id', houseId)
      .is('voided_at', null)
      .gte('block_start_at', gteIso)
      .lte('block_start_at', lteIso)
      .order('block_start_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error !== null) throw error;
    const rows = data ?? [];
    out.push(
      ...rows.map((b) => ({
        blockId: b.block_id,
        startAtIso: b.block_start_at,
        requiredHeadcount: b.required_headcount,
      })),
    );
    if (rows.length < PAGE) break;
  }
  return out;
}

// SW+SM whose HOME house is `houseId` (their paint page shows this house's blocks).
async function loadHouseRoster(
  service: ServiceClient,
  houseId: string,
  roles: ('sw' | 'sm')[],
): Promise<string[]> {
  const { data: roleRows } = await service
    .from('user_roles')
    .select('user_id')
    .in('role', roles);
  const eligible = new Set((roleRows ?? []).map((r) => r.user_id));

  const { data: userRows } = await service
    .from('users')
    .select('user_id')
    .eq('home_house_id', houseId)
    .eq('is_active', true);
  return (userRows ?? []).map((u) => u.user_id).filter((id) => eligible.has(id));
}

// ---------------------------------------------------------------------------
// Feature A — Simulate worker preferences.
// ---------------------------------------------------------------------------

export type SimulatePrefsResult = {
  houses: number;
  workers: number;
  prefsWritten: number;
  skippedHouses: string[];
};

export async function simulateWorkerPreferences(
  seasonId: string,
): Promise<ActionResult<SimulatePrefsResult>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const service = createServiceClient();
  const ctx = await resolveSeasonContext(service, seasonId);
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const startMidnight = nyMidnightIso(ctx.startDate);
  if (startMidnight === null) return { ok: false, error: 'Season has an invalid start date.' };
  // The worker paint page anchors on the Monday of the period's start week and shows
  // only that week's blocks; mirror it so simulated prefs are the ones a worker sees.
  const week = weekStart(new Date(startMidnight));
  const upperBound = new Date(week.getTime() + 8 * 24 * 60 * 60 * 1000);

  // The RPC wipes ALL of the period's prefs/targets, so every house's rows must be
  // gathered and written in ONE call.
  const allRows: Json[] = [];
  let workerCount = 0;
  const skippedHouses: string[] = [];

  for (const houseId of ctx.openHouses) {
    const roster = await loadHouseRoster(service, houseId, ['sw', 'sm']);
    if (roster.length === 0) continue;

    const { data: blockRows } = await service
      .from('shift_blocks')
      .select('block_id, block_start_at')
      .eq('house_id', houseId)
      .is('voided_at', null)
      .gte('block_start_at', week.toISOString())
      .lt('block_start_at', upperBound.toISOString())
      .order('block_start_at', { ascending: true });

    const blocks: PrefGenBlock[] = (blockRows ?? [])
      .filter((b) => weekContains(week, new Date(b.block_start_at)))
      .map((b) => {
        const { weekday, minuteOfDay } = blockWeekSlot(new Date(b.block_start_at));
        return { blockId: b.block_id, weekday, minuteOfDay };
      });

    if (blocks.length === 0) {
      // House opens after the period's first week: no blocks to paint (the paint page
      // shares this limitation). Report and skip rather than fail.
      skippedHouses.push(houseId);
      continue;
    }

    const generated = generateWorkerPreferences(blocks, roster, ctx.periodId, {
      seed: DEV_SEED,
      capHours: ctx.capHours,
    });
    for (const w of generated) {
      workerCount += 1;
      allRows.push({
        user_id: w.userId,
        target_hours: w.targetHours,
        opted_out: w.optedOut,
        entries: w.entries.map((e) => ({ block_id: e.blockId, status: e.status })),
      } as unknown as Json);
    }
  }

  const { data, error } = await service.rpc('admin_seed_preferences', {
    p_actor_user_id: gate.userId,
    p_period_id: ctx.periodId,
    p_rows: allRows as unknown as Json,
  });
  if (error !== null) return { ok: false, error: error.message };

  const result = (data ?? {}) as { workers?: number; preferences?: number };
  revalidatePath(`/admin/operations/${seasonId}`);
  return {
    ok: true,
    data: {
      houses: ctx.openHouses.length - skippedHouses.length,
      workers: result.workers ?? workerCount,
      prefsWritten: result.preferences ?? 0,
      skippedHouses,
    },
  };
}

// ---------------------------------------------------------------------------
// Feature B — Auto-build a balanced draft schedule (per house).
// ---------------------------------------------------------------------------

export type AutoBuildHouseResult = {
  houseId: string;
  assigned: number;
  unfilled: number;
  skipped: boolean;
  error?: string;
};

export async function autoBuildBalancedSchedule(
  seasonId: string,
): Promise<ActionResult<{ perHouse: AutoBuildHouseResult[] }>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const service = createServiceClient();
  const ctx = await resolveSeasonContext(service, seasonId);
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const lower = nyMidnightIso(ctx.startDate);
  const upper = nyEndOfDayIso(ctx.endDate);
  if (lower === null || upper === null) return { ok: false, error: 'Season has invalid dates.' };

  const perHouse: AutoBuildHouseResult[] = [];

  for (const houseId of ctx.openHouses) {
    const isHarnwell = houseId === 'harnwell';
    const allBlocks = await fetchAllBlocks(service, houseId, lower, upper);
    if (allBlocks.length === 0) {
      perHouse.push({ houseId, assigned: 0, unfilled: 0, skipped: true });
      continue;
    }

    // laneCount per (weekday, minuteOfDay) slot = MINIMUM required_headcount across every
    // week's block at that slot. Publish stamps the template week's (isodow, tod) pattern
    // across all weeks and RAISES on any block whose headcount is smaller, so a template
    // seat count above this minimum would make the house unpublishable.
    const slotMin = new Map<string, number>();
    for (const b of allBlocks) {
      const { weekday, minuteOfDay } = blockWeekSlot(new Date(b.startAtIso));
      const key = `${String(weekday)}:${String(minuteOfDay)}`;
      const prev = slotMin.get(key);
      slotMin.set(key, prev === undefined ? b.requiredHeadcount : Math.min(prev, b.requiredHeadcount));
    }

    // Anchor the house's template week on its earliest live block (the same anchor the
    // builder + publish use), NOT the period start (a house window may open mid-season).
    const week = weekStart(new Date(allBlocks[0]!.startAtIso));
    const templateBlocks: SchedBlock[] = allBlocks
      .filter((b) => weekContains(week, new Date(b.startAtIso)))
      .map((b) => {
        const { weekday, minuteOfDay } = blockWeekSlot(new Date(b.startAtIso));
        const key = `${String(weekday)}:${String(minuteOfDay)}`;
        return { blockId: b.blockId, weekday, minuteOfDay, laneCount: slotMin.get(key) ?? 1 };
      });

    if (templateBlocks.length === 0) {
      perHouse.push({ houseId, assigned: 0, unfilled: 0, skipped: true });
      continue;
    }

    const rosterIds = await loadHouseRoster(service, houseId, ['sw']);
    const roster: SchedRosterWorker[] = rosterIds.map((id) => ({
      workerId: id,
      homeHouseId: houseId,
    }));

    const result = generateBalancedSchedule(
      templateBlocks,
      roster,
      ctx.periodId,
      houseId,
      isHarnwell,
      { seed: DEV_SEED, weeklyCapHours: ctx.capHours },
    );

    const rows = result.assignments.map((a) => ({ block_id: a.blockId, user_id: a.userId }));
    const { error } = await service.rpc('admin_seed_draft_schedule', {
      p_actor_user_id: gate.userId,
      p_period_id: ctx.periodId,
      p_house_id: houseId,
      p_rows: rows as unknown as Json,
    });
    if (error !== null) {
      perHouse.push({ houseId, assigned: 0, unfilled: 0, skipped: false, error: error.message });
      continue;
    }

    perHouse.push({
      houseId,
      assigned: result.assignedCount,
      unfilled: result.unfilledSeatCount,
      skipped: false,
    });
  }

  revalidatePath(`/admin/operations/${seasonId}`);
  return { ok: true, data: { perHouse } };
}

// ---------------------------------------------------------------------------
// Feature C — Publish open houses.
// ---------------------------------------------------------------------------

export type PublishHouseResult = {
  houseId: string;
  status: 'published' | 'skipped' | 'failed';
  scheduled?: number;
  error?: string;
};

export async function publishOpenHouses(
  seasonId: string,
): Promise<ActionResult<{ perHouse: PublishHouseResult[] }>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const service = createServiceClient();
  const ctx = await resolveSeasonContext(service, seasonId);
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const perHouse: PublishHouseResult[] = [];

  for (const houseId of ctx.openHouses) {
    // Publishing is one-way; a re-publish RAISES unique_violation. Pre-check the ledger
    // and skip rather than surface an error for already-live houses.
    const { data: pub } = await service
      .from('period_house_publications')
      .select('house_id')
      .eq('period_id', ctx.periodId)
      .eq('house_id', houseId)
      .maybeSingle();
    if (pub !== null) {
      perHouse.push({ houseId, status: 'skipped' });
      continue;
    }

    const { data, error } = await service.rpc('publish_schedule', {
      p_period_id: ctx.periodId,
      p_published_by: gate.userId,
      p_house_id: houseId,
    });
    if (error !== null) {
      perHouse.push({ houseId, status: 'failed', error: error.message });
      continue;
    }
    perHouse.push({ houseId, status: 'published', scheduled: (data as number | null) ?? 0 });
  }

  revalidatePath(`/admin/operations/${seasonId}`);
  return { ok: true, data: { perHouse } };
}
