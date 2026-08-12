'use server';

import { compileSeason } from '@shift/core';
import type { Json } from '@shift/shared';
import { revalidatePath } from 'next/cache';

import { getSessionUser, isAdmin } from '../auth';
import { getSeasonDetail, toAuthoringInput } from '../data/operatingSeasons';
import { nyEndOfDayIso, nyMidnightIso } from '../nyTime';
import { createServiceClient } from '../supabase/server';

import type { ActionResult } from './builder';

async function requireAdmin(): Promise<{ userId: string } | { error: string }> {
  const me = await getSessionUser();
  if (me === null || !isAdmin(me)) {
    return { error: 'Only an administrator may manage operating seasons.' };
  }
  return { userId: me.userId };
}

export async function createSeason(input: {
  seasonName: string;
  slug: string;
  startDate: string;
  endDate: string;
  hoursCap: number;
  capEnforcement: 'soft' | 'hard';
  shiftStartBound: string;
  shiftEndBound: string;
}): Promise<ActionResult<{ seasonId: string }>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const service = createServiceClient();
  const { data, error } = await service
    .from('operating_seasons')
    .insert({
      season_name: input.seasonName.trim(),
      slug: input.slug.trim(),
      start_date: input.startDate,
      end_date: input.endDate,
      scheduling_mode: 'sm_built',
      hours_cap: input.hoursCap,
      cap_enforcement: input.capEnforcement,
      shift_start_bound: input.shiftStartBound,
      shift_end_bound: input.shiftEndBound,
      created_by: gate.userId,
    })
    .select('season_id')
    .maybeSingle();
  if (error !== null) return { ok: false, error: error.message };

  revalidatePath('/admin/operations');
  return { ok: true, data: { seasonId: data!.season_id } };
}

// Author the season's preference-submission deadline (§18). Stored on the season
// (authoring truth). If the season is already applied (its scheduling_periods row
// exists), the period's deadline is stamped live too via set_preference_deadline so
// the change takes effect immediately; otherwise apply stamps it. One deadline covers
// all houses (scheduling_periods is global). Pass an empty date to clear it.
export async function setSeasonPreferenceDeadline(input: {
  seasonId: string;
  /** `YYYY-MM-DD` (NY wall-clock) from the date input, or '' to clear. */
  deadlineDate: string;
}): Promise<ActionResult<{ deadlineIso: string | null }>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const service = createServiceClient();

  if (input.deadlineDate === '') {
    const { error } = await service
      .from('operating_seasons')
      .update({ preference_deadline: null })
      .eq('season_id', input.seasonId);
    if (error !== null) return { ok: false, error: error.message };
    revalidatePath(`/admin/operations/${input.seasonId}`);
    return { ok: true, data: { deadlineIso: null } };
  }

  const deadlineIso = nyEndOfDayIso(input.deadlineDate);
  if (deadlineIso === null) return { ok: false, error: 'Choose a valid deadline date.' };

  const { data: season, error: readErr } = await service
    .from('operating_seasons')
    .select('start_date')
    .eq('season_id', input.seasonId)
    .maybeSingle();
  if (readErr !== null) return { ok: false, error: readErr.message };
  if (season === null) return { ok: false, error: 'Season not found.' };

  // The deadline must fall on/before the season start (submission closes before
  // summer begins). Mirror the set_preference_deadline guard so the editor gives
  // immediate feedback instead of failing only at apply time.
  const startMidnightIso = nyMidnightIso(season.start_date);
  if (startMidnightIso !== null && deadlineIso > startMidnightIso) {
    return {
      ok: false,
      error: `The deadline must fall before the season starts (${season.start_date}).`,
    };
  }

  const { error } = await service
    .from('operating_seasons')
    .update({ preference_deadline: deadlineIso })
    .eq('season_id', input.seasonId);
  if (error !== null) return { ok: false, error: error.message };

  // If the season is already applied, stamp the live period now (period_id == season_id).
  const { data: period } = await service
    .from('scheduling_periods')
    .select('period_id')
    .eq('period_id', input.seasonId)
    .maybeSingle();
  if (period !== null) {
    const { error: stampErr } = await service.rpc('set_preference_deadline', {
      p_actor_user_id: gate.userId,
      p_period_id: input.seasonId,
      p_preference_deadline: deadlineIso,
    });
    if (stampErr !== null) return { ok: false, error: stampErr.message };
  }

  revalidatePath(`/admin/operations/${input.seasonId}`);
  return { ok: true, data: { deadlineIso } };
}

export type WindowBand = { block_start: string; block_end: string; headcount: number };

// Insert a new house window, or update an existing one when `windowId` is given. A
// window carries per-day-type staffing bands (empty list = closed that day type). The
// pure compiler + DB constraints validate the bands; a bad range surfaces as an error.
export async function saveHouseWindow(input: {
  seasonId: string;
  windowId?: string;
  houseId: string;
  startDate: string;
  endDate: string;
  weekdayBands: WindowBand[];
  weekendBands: WindowBand[];
}): Promise<ActionResult<null>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  if (input.weekdayBands.length === 0 && input.weekendBands.length === 0) {
    return { ok: false, error: 'A window must open the house on weekdays, weekends, or both.' };
  }

  const service = createServiceClient();
  const row = {
    season_id: input.seasonId,
    house_id: input.houseId,
    start_date: input.startDate,
    end_date: input.endDate,
    weekday_bands: input.weekdayBands as unknown as Json,
    weekend_bands: input.weekendBands as unknown as Json,
  };
  const { error } =
    input.windowId === undefined
      ? await service.from('season_house_windows').insert(row)
      : await service.from('season_house_windows').update(row).eq('window_id', input.windowId);
  if (error !== null) return { ok: false, error: error.message };
  revalidatePath(`/admin/operations/${input.seasonId}`);
  return { ok: true, data: null };
}

export async function deleteRow(input: {
  table: 'season_house_windows' | 'season_float_windows';
  windowId: string;
  seasonId: string;
}): Promise<ActionResult<null>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };
  const service = createServiceClient();
  const { error } = await service.from(input.table).delete().eq('window_id', input.windowId);
  if (error !== null) return { ok: false, error: error.message };
  revalidatePath(`/admin/operations/${input.seasonId}`);
  return { ok: true, data: null };
}

export async function saveFloatWindow(input: {
  seasonId: string;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<null>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };
  const service = createServiceClient();
  const { error } = await service.from('season_float_windows').insert({
    season_id: input.seasonId,
    start_date: input.startDate,
    end_date: input.endDate,
  });
  if (error !== null) return { ok: false, error: error.message };
  revalidatePath(`/admin/operations/${input.seasonId}`);
  return { ok: true, data: null };
}

export type AffectedWorker = {
  house: string;
  worker: string;
  when: string;
  kind: 'shift' | 'float';
};

export type SeasonImpact = {
  dry_run: boolean;
  profiles: number;
  blocks_generated: number;
  blocks_voided: number;
  seats_added: number;
  seats_removed: number;
  assignments_cancelled: number;
  floats_voided: number;
  affected_workers: AffectedWorker[];
};

// Compile the authoring rows (pure @shift/core) and run the reconciler. dryRun=true
// is the preview; dryRun=false applies. Compilation errors surface as a clean message.
export async function previewOrApplySeason(
  seasonId: string,
  dryRun: boolean,
): Promise<ActionResult<SeasonImpact>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const detail = await getSeasonDetail(seasonId);
  if (detail === null) return { ok: false, error: 'Season not found.' };

  let payload;
  try {
    payload = compileSeason(toAuthoringInput(detail));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Compilation failed.' };
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('apply_compiled_season', {
    p_calling_user_id: gate.userId,
    p_season_id: seasonId,
    p_payload: payload as unknown as Json,
    p_dry_run: dryRun,
  });
  if (error !== null) return { ok: false, error: error.message };

  // apply_compiled_season's serialized front (20260726000007) can return a normal
  // (not thrown) {ok: false, error, message} JSON body when the advisory lock is held
  // by a concurrent apply/preview -- nothing was attempted, so it isn't a Postgres
  // exception. Discriminate on `dry_run`, a field only the genuine impact payload
  // carries (mirrors the res.ok trap in AGENTS.md "Known traps"); otherwise this casts
  // straight to SeasonImpact and crashes the UI on the missing `affected_workers`.
  const raw = data as unknown;
  if (raw === null || typeof raw !== 'object' || !('dry_run' in raw)) {
    const message =
      raw !== null && typeof raw === 'object' && 'message' in raw
        ? String((raw as { message: unknown }).message)
        : 'Season apply returned an unexpected response.';
    return { ok: false, error: message };
  }

  // On apply, stamp the freshly (re)created period's preference deadline from the
  // season's authored value. apply's period upsert leaves preference_deadline
  // untouched on conflict, so this is the single writer of that value on apply.
  if (!dryRun && detail.preferenceDeadline !== null) {
    const { error: stampErr } = await service.rpc('set_preference_deadline', {
      p_actor_user_id: gate.userId,
      p_period_id: seasonId,
      p_preference_deadline: detail.preferenceDeadline,
    });
    if (stampErr !== null) {
      return {
        ok: false,
        error: `Season applied, but its preference deadline could not be set: ${stampErr.message}`,
      };
    }
  }

  if (!dryRun) revalidatePath(`/admin/operations/${seasonId}`);

  const o = raw as Record<string, unknown>;
  const num = (key: string): number => (typeof o[key] === 'number' ? (o[key] as number) : 0);
  const affectedRaw = Array.isArray(o.affected_workers) ? o.affected_workers : [];
  const affected_workers: AffectedWorker[] = affectedRaw.map((a) => {
    const r = (a ?? {}) as Record<string, unknown>;
    return {
      house: String(r.house ?? ''),
      worker: String(r.worker ?? ''),
      when: String(r.when ?? ''),
      kind: r.kind === 'float' ? 'float' : 'shift',
    };
  });
  return {
    ok: true,
    data: {
      dry_run: dryRun,
      profiles: num('profiles'),
      blocks_generated: num('blocks_generated'),
      blocks_voided: num('blocks_voided'),
      seats_added: num('seats_added'),
      seats_removed: num('seats_removed'),
      assignments_cancelled: num('assignments_cancelled'),
      floats_voided: num('floats_voided'),
      affected_workers,
    },
  };
}

export type OrphanDeleteImpact = {
  calendarRowsDeleted: number;
  patternRowsDeleted: number;
  floatRoutingRowsDeleted: number;
  breakPeriodsRowsDeleted: number;
  profileRowsDeleted: number;
};

// Removes a compiled-season profile's runtime config rows once no operating_seasons
// row owns them. The RPC re-verifies orphan status and refuses (no partial delete) if
// the profile still has a scheduling_periods row with real attached data.
export async function deleteOrphanedSeasonProfile(
  profileName: string,
): Promise<ActionResult<OrphanDeleteImpact>> {
  const gate = await requireAdmin();
  if ('error' in gate) return { ok: false, error: gate.error };

  const service = createServiceClient();
  const { data, error } = await service.rpc('delete_orphaned_season_profile', {
    p_calling_user_id: gate.userId,
    p_profile_name: profileName,
  });
  if (error !== null) return { ok: false, error: error.message };

  const row = (data ?? [])[0];
  if (row === undefined) return { ok: false, error: 'No response from delete.' };

  revalidatePath('/admin/operations');
  return {
    ok: true,
    data: {
      calendarRowsDeleted: row.calendar_rows_deleted,
      patternRowsDeleted: row.pattern_rows_deleted,
      floatRoutingRowsDeleted: row.float_routing_rows_deleted,
      breakPeriodsRowsDeleted: row.break_periods_rows_deleted,
      profileRowsDeleted: row.profile_rows_deleted,
    },
  };
}
