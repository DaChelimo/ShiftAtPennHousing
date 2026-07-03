import {
  type ChainStep,
  type CompiledHouse,
  type CompiledPhase,
  type CompiledRoute,
  type CompiledSeason,
  type HouseWindowInput,
  type IsoDate,
  SeasonCompileError,
  type SeasonAuthoringInput,
  type StaffingBand,
} from './types.js';

// ---------------------------------------------------------------------
// Date helpers — operate on 'YYYY-MM-DD' via a UTC epoch-day index so there is no
// timezone/DST drift. These are CALENDAR dates (America/New_York), compared and
// stepped as whole days; no wall-clock arithmetic is involved.
// ---------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDayIndex(date: IsoDate): number {
  if (!ISO_DATE_RE.test(date)) {
    throw new SeasonCompileError(`invalid date '${date}' (expected YYYY-MM-DD)`);
  }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new SeasonCompileError(`invalid calendar date '${date}'`);
  }
  return Math.floor(ms / 86_400_000);
}

function fromDayIndex(index: number): IsoDate {
  const d = new Date(index * 86_400_000);
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function compactDate(date: IsoDate): string {
  return date.replace(/-/g, '');
}

// 'HH:MM' → minutes past midnight; '00:00' as an END bound means 24:00 (1440).
function timeToMinutes(time: string, isEndBound: boolean): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) {
    throw new SeasonCompileError(`invalid time '${time}' (expected HH:MM)`);
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) {
    throw new SeasonCompileError(`invalid time '${time}'`);
  }
  const minutes = h * 60 + m;
  if (isEndBound && minutes === 0) {
    return 1440;
  }
  return minutes;
}

// ---------------------------------------------------------------------
// Per-date signature: what the world looks like on one date. Consecutive dates
// with an identical signature belong to the same phase.
// ---------------------------------------------------------------------

type OpenHouse = { houseId: string; weekdayBands: StaffingBand[]; weekendBands: StaffingBand[] };

// A window contributes a single continuous band (this house's desk hours at its
// headcount), assigned to weekdays and/or weekends per `days`. A weekdays-only
// house has no weekend band (closed Sat/Sun), and vice versa. NULL hours inherit
// the season shift bounds.
function bandsForWindow(
  win: HouseWindowInput,
  seasonStartBound: string,
  seasonEndBound: string,
): { weekdayBands: StaffingBand[]; weekendBands: StaffingBand[] } {
  const band: StaffingBand = {
    block_start: win.shiftStart ?? seasonStartBound,
    block_end: win.shiftEnd ?? seasonEndBound,
    headcount: win.headcount,
  };
  const days = win.days ?? 'all';
  return {
    weekdayBands: days === 'weekends' ? [] : [band],
    weekendBands: days === 'weekdays' ? [] : [band],
  };
}

function maxHeadcount(house: OpenHouse): number {
  return [...house.weekdayBands, ...house.weekendBands].reduce(
    (max, b) => Math.max(max, b.headcount),
    0,
  );
}

function covers(win: { startDate: IsoDate; endDate: IsoDate }, day: number): boolean {
  return day >= toDayIndex(win.startDate) && day <= toDayIndex(win.endDate);
}

// ---------------------------------------------------------------------
// Validation (DB-independent, clock-independent). DB-collision and prospective-only
// checks live in the apply RPC (they need other seasons / operating_calendar / now).
// ---------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

function validate(input: SeasonAuthoringInput): void {
  const { season, houseWindows, floatWindows } = input;

  if (!SLUG_RE.test(season.slug)) {
    throw new SeasonCompileError(`season slug '${season.slug}' must be lower_snake alphanumeric`);
  }

  const seasonStart = toDayIndex(season.startDate);
  const seasonEnd = toDayIndex(season.endDate);
  if (seasonEnd < seasonStart) {
    throw new SeasonCompileError('season end_date is before start_date');
  }
  if (season.hoursCap <= 0) {
    throw new SeasonCompileError('season hours_cap must be positive');
  }

  const seasonStartMin = timeToMinutes(season.shiftStartBound, false);
  const seasonEndMin = timeToMinutes(season.shiftEndBound, true);
  if (seasonEndMin <= seasonStartMin) {
    throw new SeasonCompileError('season shift_end_bound must be after shift_start_bound');
  }

  // House windows: within season range, headcount >= 1, bands legal, no overlap per house.
  const windowsByHouse = new Map<string, HouseWindowInput[]>();
  for (const win of houseWindows) {
    const ws = toDayIndex(win.startDate);
    const we = toDayIndex(win.endDate);
    if (we < ws) {
      throw new SeasonCompileError(`house ${win.houseId}: window end before start`);
    }
    if (ws < seasonStart || we > seasonEnd) {
      throw new SeasonCompileError(
        `house ${win.houseId}: window ${win.startDate}..${win.endDate} is outside the season range`,
      );
    }
    if (win.headcount < 1) {
      throw new SeasonCompileError(`house ${win.houseId}: headcount must be >= 1`);
    }
    // Per-house desk hours are independent of the season envelope (which is only a
    // default), so a house may open earlier/later than the season bounds. They must
    // still be valid, start before end, and land on 30-minute boundaries (every
    // shift block is a 30-minute block on a 30-minute boundary).
    if (win.shiftStart != null || win.shiftEnd != null) {
      const startStr = win.shiftStart ?? season.shiftStartBound;
      const endStr = win.shiftEnd ?? season.shiftEndBound;
      const bs = timeToMinutes(startStr, false);
      const be = timeToMinutes(endStr, true);
      if (be <= bs) {
        throw new SeasonCompileError(`house ${win.houseId}: desk close must be after desk open`);
      }
      if (bs % 30 !== 0 || (be % 30 !== 0 && be !== 1440)) {
        throw new SeasonCompileError(
          `house ${win.houseId}: desk hours must fall on 30-minute boundaries`,
        );
      }
    }
    const list = windowsByHouse.get(win.houseId) ?? [];
    list.push(win);
    windowsByHouse.set(win.houseId, list);
  }
  for (const [houseId, list] of windowsByHouse) {
    const sorted = [...list].sort((a, b) => toDayIndex(a.startDate) - toDayIndex(b.startDate));
    for (let i = 1; i < sorted.length; i++) {
      if (toDayIndex(sorted[i]!.startDate) <= toDayIndex(sorted[i - 1]!.endDate)) {
        throw new SeasonCompileError(`house ${houseId}: overlapping open windows`);
      }
    }
  }

  // Float windows: within season range, no overlap.
  const sortedFloat = [...floatWindows].sort(
    (a, b) => toDayIndex(a.startDate) - toDayIndex(b.startDate),
  );
  for (let i = 0; i < sortedFloat.length; i++) {
    const win = sortedFloat[i]!;
    if (toDayIndex(win.startDate) < seasonStart || toDayIndex(win.endDate) > seasonEnd) {
      throw new SeasonCompileError(
        `float window ${win.startDate}..${win.endDate} is outside the season range`,
      );
    }
    if (i > 0 && toDayIndex(win.startDate) <= toDayIndex(sortedFloat[i - 1]!.endDate)) {
      throw new SeasonCompileError('overlapping float windows');
    }
  }
}

// ---------------------------------------------------------------------
// The compiler.
// ---------------------------------------------------------------------

function chainFor(floatEnabled: boolean): ChainStep[] {
  if (floatEnabled) {
    return [
      { step: 'broadcast', offset: '-3 hours' },
      { step: 'float_lookup', offset: '-2 hours' },
      { step: 'hmod_notify_allied', offset: '-2 hours', trigger: 'on_float_failure' },
    ];
  }
  // Float-less chain (mirrors the winter_break profile).
  return [
    { step: 'broadcast', offset: '-3 hours' },
    { step: 'hmod_notify_allied', offset: '-2 hours' },
  ];
}

type DaySignature = { openHouses: OpenHouse[]; floatEnabled: boolean; key: string };

function signatureForDay(input: SeasonAuthoringInput, day: number): DaySignature {
  const { season, houseWindows, floatWindows } = input;
  const openHouses: OpenHouse[] = houseWindows
    .filter((win) => covers(win, day))
    .map((win) => ({
      houseId: win.houseId,
      ...bandsForWindow(win, season.shiftStartBound, season.shiftEndBound),
    }))
    .sort((a, b) => a.houseId.localeCompare(b.houseId));

  const floatEnabled = floatWindows.some((win) => covers(win, day));
  const key = JSON.stringify({ openHouses, floatEnabled });
  return { openHouses, floatEnabled, key };
}

const HARNWELL = 'harnwell';

// Float routing is UNIVERSAL, not admin-authored (stakeholder decision 2026-07-02).
// When floating is on in a phase, ANY open house may float to ANY OTHER open house,
// with the single absolute exception that Harnwell is never a destination (its
// training constraint means no float ever targets it). Harnwell itself MAY source.
// So the compiler derives the routing matrix automatically: every open, genuinely
// multi-staffed source (headcount >= 2, the floor guard) routes to every open
// non-Harnwell destination other than itself. Precedence prefers the fullest desks
// as lenders (descending max headcount, ties by house id), so a 3-staff house is
// tapped before a 2-staff one. The per-worker source-floor guard in the float
// algorithm still enforces "never leave a desk below one worker" at run time.
function generateRoutes(sig: DaySignature): CompiledRoute[] {
  if (!sig.floatEnabled) {
    return [];
  }
  const sources = sig.openHouses
    .filter((h) => maxHeadcount(h) >= 2)
    .sort((a, b) => maxHeadcount(b) - maxHeadcount(a) || a.houseId.localeCompare(b.houseId));
  const destinations = sig.openHouses.filter((h) => h.houseId !== HARNWELL);

  const routes: CompiledRoute[] = [];
  sources.forEach((source, index) => {
    for (const dest of destinations) {
      if (dest.houseId === source.houseId) {
        continue;
      }
      routes.push({
        sourceHouseId: source.houseId,
        destinationHouseId: dest.houseId,
        // All routes from one source share that source's rank; the orchestrator
        // checks lower precedence numbers first.
        precedenceOrder: index + 1,
      });
    }
  });
  return routes;
}

export function compileSeason(input: SeasonAuthoringInput): CompiledSeason {
  validate(input);

  const { season } = input;
  const seasonStart = toDayIndex(season.startDate);
  const seasonEnd = toDayIndex(season.endDate);

  const phases: CompiledPhase[] = [];
  let runStart = seasonStart;
  let runSig = signatureForDay(input, seasonStart);

  const flush = (start: number, endInclusive: number, sig: DaySignature): void => {
    const startDate = fromDayIndex(start);
    const houses: CompiledHouse[] = sig.openHouses.map((h) => ({
      houseId: h.houseId,
      weekdayBands: h.weekdayBands,
      weekendBands: h.weekendBands,
    }));
    phases.push({
      profileName: `s_${season.slug}_${compactDate(startDate)}`,
      startDate,
      endDate: fromDayIndex(endInclusive),
      floatEnabled: sig.floatEnabled,
      escalationChain: chainFor(sig.floatEnabled),
      schedulingMode: season.schedulingMode,
      hoursCap: season.hoursCap,
      capEnforcement: season.capEnforcement,
      shiftStartBound: season.shiftStartBound,
      shiftEndBound: season.shiftEndBound,
      houses,
      floatRouting: generateRoutes(sig),
    });
  };

  for (let day = seasonStart + 1; day <= seasonEnd; day++) {
    const sig = signatureForDay(input, day);
    if (sig.key !== runSig.key) {
      flush(runStart, day - 1, runSig);
      runStart = day;
      runSig = sig;
    }
  }
  flush(runStart, seasonEnd, runSig);

  return {
    seasonId: season.seasonId,
    slug: season.slug,
    phases,
    period: {
      periodName: season.seasonName,
      // §16.1 caveat: one scheduling_periods row, many phase profiles. The period
      // anchors on the FIRST phase's profile; the builder reads staffing per-date
      // via operating_calendar, not via the period profile, so this is safe for v1.
      profileName: phases[0]!.profileName,
      startDate: season.startDate,
      endDate: season.endDate,
    },
  };
}
