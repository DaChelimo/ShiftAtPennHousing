import type { BreakHouseConfig, DayConfig } from '@shift/core';

import { createServiceClient } from '../supabase/server';

import { getShellHouses } from './hmod';

// ===========================================================================
// Admin break authoring — READ model for /admin/breaks (project admin only).
//
// The break configurator authors a break per-house (open/closed + headcount +
// weekday/weekend hours) like a mini operating season. This loader supplies:
//   * the full house list,
//   * the shipped DEFAULT per-house config (from the seeded `short_break` profile)
//     to pre-fill the named break types,
//   * the existing breaks, each with its live claim phase AND its per-house config
//     reconstructed from the profile's staffing_patterns (so Edit round-trips).
// No new backend — the WRITE is compileBreak -> apply_compiled_break.
// ===========================================================================

type StaffingBand = { block_start: string; block_end: string; headcount: number };

export type BreakType =
  | 'thanksgiving'
  | 'fall_break'
  | 'spring_break'
  | 'spring_fling'
  | 'winter_break'
  | 'other';

export type ExistingBreak = {
  breakId: string;
  breakName: string;
  breakType: BreakType;
  startDate: string;
  endDate: string;
  profileName: string;
  phase: string;
  floatEnabled: boolean;
  houses: BreakHouseConfig[];
};

// A shipped staffing template (per-house config + floating) that a break type
// pre-fills from. Reconstructed from the seeded `short_break` / `winter_break`
// operating profiles (BEHAVIORAL_SPECIFICATION §3.2/§3.3).
export type BreakTypeDefaults = { houses: BreakHouseConfig[]; floatEnabled: boolean };

export type BreakAuthoringData = {
  houses: { houseId: string; houseName: string }[];
  // Shipped defaults per break shape. `short` = Thanksgiving / fall / spring / spring
  // fling (all houses open, Harnwell 2, Quad 3, rest 1, float on). `winter` = winter
  // break (only Harnwell, 1 worker, float off). "Other" is a blank canvas (in the UI).
  typeDefaults: { short: BreakTypeDefaults; winter: BreakTypeDefaults };
  breaks: ExistingBreak[];
};

const CLOSED: DayConfig = { open: false, start: '08:00', end: '00:00' };

function firstBand(value: unknown): StaffingBand | null {
  const arr = value as StaffingBand[] | null;
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

// Reconstruct per-house config for a profile from its staffing_patterns rows.
// A house with no row for a day type is closed that day type.
function reconstruct(
  profileName: string,
  staffing: {
    profile_name: string;
    house_id: string;
    day_type: string;
    block_headcounts: unknown;
  }[],
  houseIds: string[],
): BreakHouseConfig[] {
  const wd = new Map<string, StaffingBand>();
  const we = new Map<string, StaffingBand>();
  for (const row of staffing) {
    if (row.profile_name !== profileName) continue;
    const band = firstBand(row.block_headcounts);
    if (band === null) continue;
    (row.day_type === 'weekend' ? we : wd).set(row.house_id, band);
  }
  return houseIds.map((houseId) => {
    const w = wd.get(houseId);
    const e = we.get(houseId);
    const dayFrom = (b: StaffingBand | undefined): DayConfig =>
      b
        ? { open: true, start: b.block_start.slice(0, 5), end: b.block_end.slice(0, 5) }
        : { ...CLOSED };
    return {
      houseId,
      headcount: w?.headcount ?? e?.headcount ?? 1,
      weekday: dayFrom(w),
      weekend: dayFrom(e),
    };
  });
}

export async function getBreakAuthoringData(now: Date): Promise<BreakAuthoringData> {
  const supabase = createServiceClient();
  const shellHouses = await getShellHouses();
  const houses = shellHouses.map((h) => ({ houseId: h.id, houseName: h.name }));
  const houseIds = houses.map((h) => h.houseId);

  const { data: staffing } = await supabase
    .from('staffing_patterns')
    .select('profile_name, house_id, day_type, block_headcounts');
  const staffingRows = staffing ?? [];

  const { data: profileRows } = await supabase
    .from('operating_profiles')
    .select('profile_name, float_enabled');
  const floatByProfile = new Map((profileRows ?? []).map((p) => [p.profile_name, p.float_enabled]));

  // Shipped defaults: reconstruct the two seeded break profiles so each break type
  // can pre-fill its real house coverage + floating (BEHAVIORAL_SPECIFICATION §3.3).
  const typeDefaults = {
    short: {
      houses: reconstruct('short_break', staffingRows, houseIds),
      floatEnabled: floatByProfile.get('short_break') ?? true,
    },
    winter: {
      houses: reconstruct('winter_break', staffingRows, houseIds),
      floatEnabled: floatByProfile.get('winter_break') ?? false,
    },
  };

  const { data: breakRows } = await supabase
    .from('break_periods')
    .select('break_id, break_name, break_type, start_date, end_date, profile_name')
    .order('start_date', { ascending: false });

  const breaks: ExistingBreak[] = [];
  for (const b of breakRows ?? []) {
    const { data: phase } = await supabase.rpc('break_claim_phase', {
      p_break_id: b.break_id,
      p_as_of: now.toISOString(),
    });
    breaks.push({
      breakId: b.break_id,
      breakName: b.break_name,
      breakType: b.break_type as BreakType,
      startDate: b.start_date,
      endDate: b.end_date,
      profileName: b.profile_name,
      phase: typeof phase === 'string' ? phase : 'pre_open',
      floatEnabled: floatByProfile.get(b.profile_name) ?? true,
      houses: reconstruct(b.profile_name, staffingRows, houseIds),
    });
  }

  return { houses, typeDefaults, breaks };
}
