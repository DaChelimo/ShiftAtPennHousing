// Operating Seasons compiler — public type surface.
//
// PURE, deterministic transformation: authoring rows (a season + its house/float
// windows + routing matrix) → an ordered list of PHASES, each materializable into
// the existing runtime config tables (operating_profiles / staffing_patterns /
// float_routing / operating_calendar). No DB, no I/O, no clock.
// See docs/operating-seasons/PLAN.md §7.

export type IsoDate = string; // 'YYYY-MM-DD' (America/New_York calendar date)

export type SchedulingMode = 'sm_built' | 'claim_based';
export type CapEnforcement = 'soft' | 'hard';

// One staffing band: mirrors staffing_patterns.block_headcounts elements.
// block_end '00:00' means 24:00 (repo convention; the generator casts to +24h).
export type StaffingBand = {
  block_start: string; // 'HH:MM'
  block_end: string; // 'HH:MM'
  headcount: number;
};

export type SeasonInput = {
  seasonId: string;
  slug: string;
  seasonName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  schedulingMode: SchedulingMode;
  hoursCap: number;
  capEnforcement: CapEnforcement;
  shiftStartBound: string; // 'HH:MM'
  shiftEndBound: string; // 'HH:MM' ('00:00' = 24:00)
};

export type OperatingDays = 'all' | 'weekdays' | 'weekends';

export type HouseWindowInput = {
  houseId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  headcount: number;
  // Per-house desk hours for this window. NULL inherits the season shift bounds.
  // Single continuous band per day (v1). Must fall on 30-minute boundaries.
  shiftStart?: string | null; // 'HH:MM'
  shiftEnd?: string | null; // 'HH:MM' ('00:00' = 24:00)
  // Which days the house operates. 'weekdays' => no weekend shifts (closed Sat/Sun).
  days?: OperatingDays;
};

export type FloatWindowInput = {
  startDate: IsoDate;
  endDate: IsoDate;
};

export type SeasonAuthoringInput = {
  season: SeasonInput;
  houseWindows: HouseWindowInput[];
  floatWindows: FloatWindowInput[];
  // Float routing is NOT authored: it is derived automatically (universal float,
  // Harnwell never a destination). See generateRoutes in compile.ts.
};

export type ChainStep = {
  step: 'broadcast' | 'float_lookup' | 'hmod_notify_allied';
  offset: string;
  trigger?: string;
};

export type CompiledHouse = {
  houseId: string;
  // Per-day-type bands. An empty array means the house is closed for that day type
  // (e.g. weekdays-only => weekendBands: []).
  weekdayBands: StaffingBand[];
  weekendBands: StaffingBand[];
};

export type CompiledRoute = {
  sourceHouseId: string;
  destinationHouseId: string;
  precedenceOrder: number;
};

export type CompiledPhase = {
  // Stable per phase boundary: `s_<slug>_<YYYYMMDD>` of the phase start date.
  profileName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  floatEnabled: boolean;
  escalationChain: ChainStep[];
  schedulingMode: SchedulingMode;
  hoursCap: number;
  capEnforcement: CapEnforcement;
  shiftStartBound: string;
  shiftEndBound: string;
  houses: CompiledHouse[];
  floatRouting: CompiledRoute[];
};

export type CompiledPeriod = {
  periodName: string;
  profileName: string; // the first phase's profile (see §16.1 caveat)
  startDate: IsoDate;
  endDate: IsoDate;
};

export type CompiledSeason = {
  seasonId: string;
  slug: string;
  phases: CompiledPhase[];
  period: CompiledPeriod;
};

export class SeasonCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonCompileError';
  }
}
