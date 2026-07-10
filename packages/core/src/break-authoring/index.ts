// Per-house BREAK compiler — PURE, deterministic (no DB, no clock).
//
// The admin authors a break like a single-window operating season: per house an
// open/closed state (per day-type) + headcount + weekday/weekend desk hours, plus a
// global floating switch. This derives ONE claim-based operating profile
// (`b_<slug>_<startdate>`) with universal float routing (reusing the season rule:
// any open house with headcount >= 2 floats to any other open house, Harnwell never
// a destination), the break-type hours cap, and the claim-window offsets. The
// apply_compiled_break RPC materializes the result + reconciles the window's blocks.

import { breakHoursCap, type BreakType } from '../break-claim/index.js';
import {
  generateUniversalFloatRoutes,
  type ChainStep,
  type CompiledRoute,
  type StaffingBand,
} from '../operating-seasons/index.js';

// The claim-window offsets a break profile carries (T-14d open, T-3d alert, T-1d
// close). Interval strings for the operating_profiles claim_phase_* columns.
export const DEFAULT_BREAK_CLAIM_WINDOW = {
  open: '-14 days',
  alert: '-3 days',
  close: '-1 days',
} as const;

// One day-type's desk config for a house. `open=false` => closed that day type.
export type DayConfig = { open: boolean; start: string; end: string }; // 'HH:MM'

export type BreakHouseConfig = {
  houseId: string;
  headcount: number;
  weekday: DayConfig;
  weekend: DayConfig;
};

export type BreakAuthoringInput = {
  breakId: string;
  breakName: string;
  breakType: BreakType;
  slug: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;
  floatEnabled: boolean;
  houses: BreakHouseConfig[];
};

export type CompiledBreakHouse = {
  houseId: string;
  weekdayBands: StaffingBand[];
  weekendBands: StaffingBand[];
};

export type CompiledBreak = {
  breakId: string;
  breakName: string;
  breakType: BreakType;
  slug: string;
  profileName: string;
  startDate: string;
  endDate: string;
  floatEnabled: boolean;
  schedulingMode: 'claim_based';
  hoursCap: number;
  capEnforcement: 'soft' | 'hard';
  shiftStartBound: string; // 'HH:MM'
  shiftEndBound: string; // 'HH:MM' ('00:00' = 24:00)
  escalationChain: ChainStep[];
  claimOpenOffset: string;
  claimAlertOffset: string;
  claimCloseOffset: string;
  houses: CompiledBreakHouse[];
  floatRouting: CompiledRoute[];
};

export class BreakCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreakCompileError';
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

// 'HH:MM' -> minutes; '00:00' as an END bound is 24:00 (1440).
function timeToMinutes(time: string, isEndBound: boolean): number {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (m === null) throw new BreakCompileError(`invalid time '${time}' (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) throw new BreakCompileError(`invalid time '${time}'`);
  const total = h * 60 + min;
  return isEndBound && total === 0 ? 1440 : total;
}

function minutesToTime(total: number): string {
  const t = total >= 1440 ? 0 : total; // 1440 -> '00:00' (24:00 convention)
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function chainFor(floatEnabled: boolean): ChainStep[] {
  if (floatEnabled) {
    return [
      { step: 'broadcast', offset: '-3 hours' },
      { step: 'float_lookup', offset: '-2 hours' },
      { step: 'hmod_notify_allied', offset: '-2 hours', trigger: 'on_float_failure' },
    ];
  }
  return [
    { step: 'broadcast', offset: '-3 hours' },
    { step: 'hmod_notify_allied', offset: '-2 hours' },
  ];
}

function validateDay(houseId: string, dayType: string, day: DayConfig, headcount: number): void {
  if (!day.open) return;
  if (headcount < 1) {
    throw new BreakCompileError(`house ${houseId}: ${dayType} headcount must be >= 1 when open`);
  }
  const start = timeToMinutes(day.start, false);
  const end = timeToMinutes(day.end, true);
  if (end <= start) {
    throw new BreakCompileError(`house ${houseId}: ${dayType} desk close must be after open`);
  }
  if (start % 30 !== 0 || (end % 30 !== 0 && end !== 1440)) {
    throw new BreakCompileError(
      `house ${houseId}: ${dayType} hours must fall on 30-minute boundaries`,
    );
  }
}

function bandFor(day: DayConfig, headcount: number): StaffingBand[] {
  if (!day.open) return [];
  return [{ block_start: day.start, block_end: day.end, headcount }];
}

export function compileBreak(input: BreakAuthoringInput): CompiledBreak {
  if (!SLUG_RE.test(input.slug)) {
    throw new BreakCompileError(`break slug '${input.slug}' must be lower_snake alphanumeric`);
  }
  if (!ISO_DATE_RE.test(input.startDate) || !ISO_DATE_RE.test(input.endDate)) {
    throw new BreakCompileError('break dates must be YYYY-MM-DD');
  }
  if (input.endDate < input.startDate) {
    throw new BreakCompileError('break end_date is before start_date');
  }

  const houses: CompiledBreakHouse[] = [];
  const seen = new Set<string>();
  for (const h of input.houses) {
    if (seen.has(h.houseId)) {
      throw new BreakCompileError(`house ${h.houseId}: listed more than once`);
    }
    seen.add(h.houseId);
    validateDay(h.houseId, 'weekday', h.weekday, h.headcount);
    validateDay(h.houseId, 'weekend', h.weekend, h.headcount);
    const weekdayBands = bandFor(h.weekday, h.headcount);
    const weekendBands = bandFor(h.weekend, h.headcount);
    if (weekdayBands.length === 0 && weekendBands.length === 0) continue; // closed entirely
    houses.push({ houseId: h.houseId, weekdayBands, weekendBands });
  }

  // Desk-hours envelope across all open bands (profile-level display/storage; the
  // block generator reads per-house bands, not these bounds).
  const allBands = houses.flatMap((h) => [...h.weekdayBands, ...h.weekendBands]);
  const startBound =
    allBands.length === 0
      ? '08:00'
      : minutesToTime(Math.min(...allBands.map((b) => timeToMinutes(b.block_start, false))));
  const endBound =
    allBands.length === 0
      ? '00:00'
      : minutesToTime(Math.max(...allBands.map((b) => timeToMinutes(b.block_end, true))));

  const floatRouting = input.floatEnabled
    ? generateUniversalFloatRoutes(
        houses.map((h) => ({
          houseId: h.houseId,
          maxHeadcount: [...h.weekdayBands, ...h.weekendBands].reduce(
            (mx, b) => Math.max(mx, b.headcount),
            0,
          ),
        })),
      )
    : [];

  const cap = breakHoursCap(input.breakType);

  return {
    breakId: input.breakId,
    breakName: input.breakName,
    breakType: input.breakType,
    slug: input.slug,
    profileName: `b_${input.slug}_${input.startDate.replace(/-/g, '')}`,
    startDate: input.startDate,
    endDate: input.endDate,
    floatEnabled: input.floatEnabled,
    schedulingMode: 'claim_based',
    hoursCap: cap.capHours,
    capEnforcement: cap.capEnforcement,
    shiftStartBound: startBound,
    shiftEndBound: endBound,
    escalationChain: chainFor(input.floatEnabled),
    claimOpenOffset: DEFAULT_BREAK_CLAIM_WINDOW.open,
    claimAlertOffset: DEFAULT_BREAK_CLAIM_WINDOW.alert,
    claimCloseOffset: DEFAULT_BREAK_CLAIM_WINDOW.close,
    houses,
    floatRouting,
  };
}
