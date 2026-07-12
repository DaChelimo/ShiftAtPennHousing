// Operating Seasons compiler (P5). Pure, deterministic. Proves phase-boundary
// derivation, identical-phase merging, UNIVERSAL float-routing generation (any house
// to any non-Harnwell house), profile-field mapping, the '00:00'=24:00 band
// convention, intraday multi-band windows, and the validation errors.

import { describe, expect, it } from 'vitest';

import { compileSeason } from '../../src/operating-seasons/compile.js';
import type { SeasonAuthoringInput, StaffingBand } from '../../src/operating-seasons/types.js';
import { SeasonCompileError } from '../../src/operating-seasons/types.js';

function baseSeason(overrides: Partial<SeasonAuthoringInput['season']> = {}): SeasonAuthoringInput['season'] {
  return {
    seasonId: 'sea-1',
    slug: 'summer2026',
    seasonName: 'Summer 2026',
    startDate: '2026-06-01',
    endDate: '2026-08-15',
    schedulingMode: 'sm_built',
    hoursCap: 40,
    capEnforcement: 'hard',
    shiftStartBound: '08:00',
    shiftEndBound: '00:00',
    ...overrides,
  };
}

const band = (block_start: string, block_end: string, headcount: number): StaffingBand => ({
  block_start,
  block_end,
  headcount,
});

// A house open every day at one headcount across the season default desk hours.
function allDay(headcount: number, start = '08:00', end = '00:00') {
  const b = [band(start, end, headcount)];
  return { weekdayBands: b, weekendBands: b };
}

describe('compileSeason — phase derivation', () => {
  it('a season with no changes compiles to a single phase covering the whole range', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(3) },
      ],
      floatWindows: [],
    });
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]!.startDate).toBe('2026-06-01');
    expect(result.phases[0]!.endDate).toBe('2026-08-15');
    expect(result.phases[0]!.floatEnabled).toBe(false);
    expect(result.phases[0]!.profileName).toBe('s_summer2026_20260601');
  });

  it("models the real 'first half single, second half double + float' summer", () => {
    // Rodin (house-05) single-staffed until June 8, double-staffed after.
    // Floating off before July 1, on after. Two independent change-points → phases.
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(3) },
        { houseId: 'house-07', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(1) },
        { houseId: 'house-05', startDate: '2026-06-01', endDate: '2026-06-07', ...allDay(1) },
        { houseId: 'house-05', startDate: '2026-06-08', endDate: '2026-08-15', ...allDay(2) },
      ],
      floatWindows: [{ startDate: '2026-07-01', endDate: '2026-08-15' }],
    });

    // Boundaries at 06-08 (headcount change) and 07-01 (float on) → 3 phases.
    expect(result.phases.map((p) => [p.startDate, p.endDate])).toEqual([
      ['2026-06-01', '2026-06-07'],
      ['2026-06-08', '2026-06-30'],
      ['2026-07-01', '2026-08-15'],
    ]);

    // Phase 1: float off → no routing.
    expect(result.phases[0]!.floatEnabled).toBe(false);
    expect(result.phases[0]!.floatRouting).toEqual([]);

    // Phase 2: house-05 double but float still OFF → still no routing.
    expect(result.phases[1]!.floatEnabled).toBe(false);
    expect(result.phases[1]!.floatRouting).toEqual([]);

    // Phase 3: float ON. Multi-staffed sources (quad hc3, house-05 hc2) route to every
    // other open house. house-07 (hc1) is only a destination.
    const phase3 = result.phases[2]!;
    expect(phase3.floatEnabled).toBe(true);
    const pairs = phase3.floatRouting.map((r) => `${r.sourceHouseId}->${r.destinationHouseId}`).sort();
    expect(pairs).toEqual(
      ['quad->house-05', 'quad->house-07', 'house-05->quad', 'house-05->house-07'].sort(),
    );
    // house-07 (single-staffed) is never a source.
    expect(phase3.floatRouting.some((r) => r.sourceHouseId === 'house-07')).toBe(false);
  });

  it('a house that opens mid-season creates a phase boundary', () => {
    // Lauder (house-09) opens June 15.
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(3) },
        { houseId: 'house-09', startDate: '2026-06-15', endDate: '2026-08-15', ...allDay(1) },
      ],
      floatWindows: [],
    });
    expect(result.phases.map((p) => p.startDate)).toEqual(['2026-06-01', '2026-06-15']);
    expect(result.phases[0]!.houses.map((h) => h.houseId)).toEqual(['quad']);
    expect(result.phases[1]!.houses.map((h) => h.houseId)).toEqual(['house-09', 'quad']);
  });
});

describe('compileSeason — universal float routing', () => {
  it('generates no routes when floating is off', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(3) },
        { houseId: 'house-05', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(2) },
      ],
      floatWindows: [],
    });
    expect(result.phases[0]!.floatRouting).toEqual([]);
  });

  it('emits no routes when no open house is multi-staffed (floor guard)', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'house-05', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(1) },
        { houseId: 'house-07', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(1) },
      ],
      floatWindows: [{ startDate: '2026-06-01', endDate: '2026-08-15' }],
    });
    expect(result.phases[0]!.floatRouting).toEqual([]); // both single-staffed → no sources
  });

  it('a house whose headcount reaches 2 only in an intraday band may source', () => {
    // Kings Court: single-staffed morning, double-staffed evening. maxHeadcount is 2,
    // so it qualifies as a float source.
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        {
          houseId: 'kings-court',
          startDate: '2026-06-01',
          endDate: '2026-08-15',
          weekdayBands: [band('08:00', '17:00', 1), band('17:00', '00:00', 2)],
          weekendBands: [band('08:00', '00:00', 2)],
        },
        { houseId: 'house-07', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(1) },
      ],
      floatWindows: [{ startDate: '2026-06-01', endDate: '2026-08-15' }],
    });
    const routes = result.phases[0]!.floatRouting;
    expect(routes.some((r) => r.sourceHouseId === 'kings-court' && r.destinationHouseId === 'house-07')).toBe(true);
  });

  it('Harnwell may SOURCE floats but is never a DESTINATION', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'harnwell', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(2) },
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(3) },
        { houseId: 'house-05', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(1) },
      ],
      floatWindows: [{ startDate: '2026-06-01', endDate: '2026-08-15' }],
    });
    const routes = result.phases[0]!.floatRouting;
    // Harnwell sources to open non-Harnwell houses.
    expect(routes.some((r) => r.sourceHouseId === 'harnwell' && r.destinationHouseId === 'quad')).toBe(true);
    expect(routes.some((r) => r.sourceHouseId === 'harnwell' && r.destinationHouseId === 'house-05')).toBe(true);
    // Nothing ever targets Harnwell.
    expect(routes.every((r) => r.destinationHouseId !== 'harnwell')).toBe(true);
    // Quad (fullest, hc3) outranks Harnwell (hc2) as a lender → lower precedence number.
    const quadPrec = routes.find((r) => r.sourceHouseId === 'quad')!.precedenceOrder;
    const harnPrec = routes.find((r) => r.sourceHouseId === 'harnwell')!.precedenceOrder;
    expect(quadPrec).toBeLessThan(harnPrec);
  });
});

describe('compileSeason — field mapping & period', () => {
  it('maps season settings and the float-on escalation chain onto each phase', () => {
    const result = compileSeason({
      season: baseSeason({ hoursCap: 25, capEnforcement: 'soft' }),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(2) },
      ],
      floatWindows: [{ startDate: '2026-06-01', endDate: '2026-08-15' }],
    });
    const phase = result.phases[0]!;
    expect(phase.hoursCap).toBe(25);
    expect(phase.capEnforcement).toBe('soft');
    expect(phase.schedulingMode).toBe('sm_built');
    expect(phase.escalationChain).toEqual([
      { step: 'broadcast', offset: '-3 hours' },
      { step: 'float_lookup', offset: '-2 hours' },
      { step: 'hmod_notify_allied', offset: '-2 hours', trigger: 'on_float_failure' },
    ]);
    // Bands pass straight through; 00:00 kept as the 24:00 marker.
    expect(phase.houses[0]!.weekdayBands).toEqual([
      { block_start: '08:00', block_end: '00:00', headcount: 2 },
    ]);
    expect(phase.houses[0]!.weekendBands).toEqual([
      { block_start: '08:00', block_end: '00:00', headcount: 2 },
    ]);
  });

  it('float-off phases get the winter-break-shaped chain (no float_lookup)', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(2) },
      ],
      floatWindows: [],
    });
    expect(result.phases[0]!.escalationChain.map((s) => s.step)).toEqual([
      'broadcast',
      'hmod_notify_allied',
    ]);
  });

  it('emits a single period spec anchored on the first phase profile', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        { houseId: 'quad', startDate: '2026-06-01', endDate: '2026-08-15', ...allDay(3) },
      ],
      floatWindows: [{ startDate: '2026-07-01', endDate: '2026-08-15' }],
    });
    expect(result.period).toEqual({
      periodName: 'Summer 2026',
      profileName: result.phases[0]!.profileName,
      startDate: '2026-06-01',
      endDate: '2026-08-15',
    });
  });
});

describe('compileSeason — per-house bands, hours & days', () => {
  it('a house may open earlier than the season default (independent desk hours)', () => {
    // Kings Court: 05:30 to 17:00, even though the season default is 08:00 to 00:00.
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        {
          houseId: 'kings-court',
          startDate: '2026-06-01',
          endDate: '2026-08-15',
          ...allDay(1, '05:30', '17:00'),
        },
      ],
      floatWindows: [],
    });
    expect(result.phases[0]!.houses[0]!.weekdayBands).toEqual([
      { block_start: '05:30', block_end: '17:00', headcount: 1 },
    ]);
  });

  it('carries an intraday multi-band day through to the phase (single AM, double PM)', () => {
    // The Harnwell shape the admin asked for: weekdays single 05:30-12:00 then double
    // 12:00-00:00; weekends double all day.
    const result = compileSeason({
      season: baseSeason({ shiftStartBound: '05:30' }),
      houseWindows: [
        {
          houseId: 'harnwell',
          startDate: '2026-06-01',
          endDate: '2026-08-15',
          weekdayBands: [band('05:30', '12:00', 1), band('12:00', '00:00', 2)],
          weekendBands: [band('05:30', '00:00', 2)],
        },
      ],
      floatWindows: [],
    });
    const house = result.phases[0]!.houses[0]!;
    expect(house.weekdayBands).toEqual([
      { block_start: '05:30', block_end: '12:00', headcount: 1 },
      { block_start: '12:00', block_end: '00:00', headcount: 2 },
    ]);
    expect(house.weekendBands).toEqual([{ block_start: '05:30', block_end: '00:00', headcount: 2 }]);
  });

  it('a weekdays-only house has no weekend band (closed Sat/Sun)', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        {
          houseId: 'kings-court',
          startDate: '2026-06-01',
          endDate: '2026-08-15',
          weekdayBands: [band('05:30', '17:00', 1)],
          weekendBands: [],
        },
      ],
      floatWindows: [],
    });
    const house = result.phases[0]!.houses[0]!;
    expect(house.weekdayBands).toHaveLength(1);
    expect(house.weekendBands).toEqual([]);
  });

  it('a weekends-only house has no weekday band', () => {
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        {
          houseId: 'quad',
          startDate: '2026-06-01',
          endDate: '2026-08-15',
          weekdayBands: [],
          weekendBands: [band('08:00', '00:00', 2)],
        },
      ],
      floatWindows: [],
    });
    const house = result.phases[0]!.houses[0]!;
    expect(house.weekdayBands).toEqual([]);
    expect(house.weekendBands).toHaveLength(1);
  });

  it('changing a house days/hours creates a phase boundary', () => {
    // Same house, weekdays-only first half then every-day second half.
    const result = compileSeason({
      season: baseSeason(),
      houseWindows: [
        {
          houseId: 'quad',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          weekdayBands: [band('08:00', '00:00', 2)],
          weekendBands: [],
        },
        { houseId: 'quad', startDate: '2026-07-01', endDate: '2026-08-15', ...allDay(2) },
      ],
      floatWindows: [],
    });
    expect(result.phases.map((p) => [p.startDate, p.endDate])).toEqual([
      ['2026-06-01', '2026-06-30'],
      ['2026-07-01', '2026-08-15'],
    ]);
    expect(result.phases[0]!.houses[0]!.weekendBands).toEqual([]);
    expect(result.phases[1]!.houses[0]!.weekendBands).toHaveLength(1);
  });
});

describe('compileSeason — validation', () => {
  it('rejects a window outside the season range', () => {
    expect(() =>
      compileSeason({
        season: baseSeason(),
        houseWindows: [
          { houseId: 'quad', startDate: '2026-05-01', endDate: '2026-08-15', ...allDay(3) },
        ],
        floatWindows: [],
      }),
    ).toThrow(SeasonCompileError);
  });

  it('rejects a band off a 30-minute boundary', () => {
    expect(() =>
      compileSeason({
        season: baseSeason(),
        houseWindows: [
          {
            houseId: 'quad',
            startDate: '2026-06-01',
            endDate: '2026-08-15',
            weekdayBands: [band('05:45', '17:00', 3)],
            weekendBands: [],
          },
        ],
        floatWindows: [],
      }),
    ).toThrow(/30-minute/);
  });

  it('rejects overlapping intraday bands', () => {
    expect(() =>
      compileSeason({
        season: baseSeason(),
        houseWindows: [
          {
            houseId: 'quad',
            startDate: '2026-06-01',
            endDate: '2026-08-15',
            weekdayBands: [band('08:00', '14:00', 1), band('12:00', '00:00', 2)],
            weekendBands: [],
          },
        ],
        floatWindows: [],
      }),
    ).toThrow(/overlapping bands/);
  });

  it('rejects a window that opens no day type', () => {
    expect(() =>
      compileSeason({
        season: baseSeason(),
        houseWindows: [
          {
            houseId: 'quad',
            startDate: '2026-06-01',
            endDate: '2026-08-15',
            weekdayBands: [],
            weekendBands: [],
          },
        ],
        floatWindows: [],
      }),
    ).toThrow(/at least one day type/);
  });
});
