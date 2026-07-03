import type {
  FloatWindowInput,
  HouseWindowInput,
  SeasonAuthoringInput,
  SeasonInput,
} from '@shift/core';

import { createServiceClient } from '../supabase/server';

export type SeasonListRow = {
  seasonId: string;
  seasonName: string;
  slug: string;
  startDate: string;
  endDate: string;
  lastAppliedAt: string | null;
};

export type SeasonDetail = {
  season: SeasonInput;
  // Admin-authored preference-submission deadline (ISO timestamptz) or null. Kept
  // beside `season` rather than on the core SeasonInput because the pure compiler
  // does not consume it; the web stamps the period from it on apply.
  preferenceDeadline: string | null;
  houseWindows: (HouseWindowInput & { windowId: string })[];
  floatWindows: (FloatWindowInput & { windowId: string })[];
};

export type AuditRow = {
  auditId: string;
  action: string;
  appliedAt: string;
  appliedByName: string | null;
  impact: Record<string, number>;
};

export async function listSeasons(): Promise<SeasonListRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('operating_seasons')
    .select('season_id, season_name, slug, start_date, end_date, last_applied_at')
    .order('start_date', { ascending: false });
  if (error !== null) throw error;
  return (data ?? []).map((r) => ({
    seasonId: r.season_id,
    seasonName: r.season_name,
    slug: r.slug,
    startDate: r.start_date,
    endDate: r.end_date,
    lastAppliedAt: r.last_applied_at,
  }));
}

export async function getSeasonDetail(seasonId: string): Promise<SeasonDetail | null> {
  const service = createServiceClient();
  const { data: season, error } = await service
    .from('operating_seasons')
    .select(
      'season_id, season_name, slug, start_date, end_date, scheduling_mode, hours_cap, cap_enforcement, shift_start_bound, shift_end_bound, preference_deadline',
    )
    .eq('season_id', seasonId)
    .maybeSingle();
  if (error !== null) throw error;
  if (season === null) return null;

  const [{ data: houseWindows }, { data: floatWindows }] = await Promise.all([
    service
      .from('season_house_windows')
      .select('window_id, house_id, start_date, end_date, headcount, shift_start, shift_end, days')
      .eq('season_id', seasonId)
      .order('house_id')
      .order('start_date'),
    service
      .from('season_float_windows')
      .select('window_id, start_date, end_date')
      .eq('season_id', seasonId)
      .order('start_date'),
  ]);

  return {
    season: {
      seasonId: season.season_id,
      slug: season.slug,
      seasonName: season.season_name,
      startDate: season.start_date,
      endDate: season.end_date,
      schedulingMode: season.scheduling_mode,
      hoursCap: season.hours_cap,
      capEnforcement: season.cap_enforcement,
      shiftStartBound: (season.shift_start_bound as string).slice(0, 5),
      shiftEndBound: (season.shift_end_bound as string).slice(0, 5),
    },
    preferenceDeadline: season.preference_deadline,
    houseWindows: (houseWindows ?? []).map((w) => ({
      windowId: w.window_id,
      houseId: w.house_id,
      startDate: w.start_date,
      endDate: w.end_date,
      headcount: w.headcount,
      shiftStart: w.shift_start === null ? null : (w.shift_start as string).slice(0, 5),
      shiftEnd: w.shift_end === null ? null : (w.shift_end as string).slice(0, 5),
      days: w.days as HouseWindowInput['days'],
    })),
    floatWindows: (floatWindows ?? []).map((w) => ({
      windowId: w.window_id,
      startDate: w.start_date,
      endDate: w.end_date,
    })),
  };
}

// Assemble the pure-compiler input from the stored authoring rows. Float routing is
// derived by the compiler (universal float), not authored, so it is not passed in.
export function toAuthoringInput(detail: SeasonDetail): SeasonAuthoringInput {
  return {
    season: detail.season,
    houseWindows: detail.houseWindows.map(({ windowId: _drop, ...w }) => w),
    floatWindows: detail.floatWindows.map(({ windowId: _drop, ...w }) => w),
  };
}

export async function getAuditLog(seasonId: string): Promise<AuditRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('operating_config_audit')
    .select('audit_id, action, applied_at, applied_by, impact')
    .eq('season_id', seasonId)
    .order('applied_at', { ascending: false })
    .limit(20);
  if (error !== null) throw error;

  const actorIds = [...new Set((data ?? []).map((r) => r.applied_by).filter(Boolean) as string[])];
  const { data: actors } =
    actorIds.length === 0
      ? { data: [] }
      : await service.from('users').select('user_id, name').in('user_id', actorIds);
  const actorName = new Map((actors ?? []).map((a) => [a.user_id, a.name]));

  return (data ?? []).map((r) => ({
    auditId: r.audit_id,
    action: r.action,
    appliedAt: r.applied_at,
    appliedByName: r.applied_by === null ? null : (actorName.get(r.applied_by) ?? 'Unknown'),
    impact: (r.impact ?? {}) as Record<string, number>,
  }));
}

export type HouseOption = { id: string; name: string };

export async function listHouses(): Promise<HouseOption[]> {
  const service = createServiceClient();
  const { data } = await service.from('houses').select('id, name').order('name');
  return (data ?? []).map((h) => ({ id: h.id, name: h.name }));
}
