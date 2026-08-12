// The five-axis persona model. See docs/preference-generation/PERSONA_SPEC.md §2.
//
// Axes are drawn independently EXCEPT appetite, which is tilted by selectivity so that
// "selective and low-hours" is the common shape of a selective worker without forbidding
// the selective maximizer (only Saturday nights, but every one of them) — the case that
// breaks a naive builder and therefore the one worth generating.

import { rngRange, rngWeighted, type Rng } from '../random/seeded.js';

export type PrefDayPart = 'early' | 'afternoon' | 'evening' | 'any_time';
export type PrefDayType = 'weekday' | 'weekend' | 'any_day';
export type PrefShiftLength = 'short' | 'medium' | 'long';
export type PrefSelectivity = 'selective' | 'moderate' | 'flexible';
export type PrefAppetite = 'low' | 'medium' | 'high';

export type PrefPersona = {
  dayPart: PrefDayPart;
  dayType: PrefDayType;
  shiftLength: PrefShiftLength;
  selectivity: PrefSelectivity;
  appetite: PrefAppetite;
};

const DAY_PARTS: readonly PrefDayPart[] = ['early', 'afternoon', 'evening', 'any_time'];
const DAY_PART_WEIGHTS = [3, 4, 5, 3];

const DAY_TYPES: readonly PrefDayType[] = ['weekday', 'weekend', 'any_day'];
const DAY_TYPE_WEIGHTS = [5, 3, 4];

const SHIFT_LENGTHS: readonly PrefShiftLength[] = ['short', 'medium', 'long'];
const SHIFT_LENGTH_WEIGHTS = [4, 5, 3];

const SELECTIVITIES: readonly PrefSelectivity[] = ['selective', 'moderate', 'flexible'];
const SELECTIVITY_WEIGHTS = [3, 5, 4];

const APPETITES: readonly PrefAppetite[] = ['low', 'medium', 'high'];

// Selectivity tilts the appetite draw (spec §2, "D and E are correlated").
const APPETITE_WEIGHTS_BY_SELECTIVITY: Record<PrefSelectivity, number[]> = {
  selective: [5, 5, 2],
  moderate: [3, 5, 4],
  flexible: [2, 5, 6],
};

// Target hours as a fraction of the season's cap. The cap itself is never hardcoded.
export const APPETITE_FRACTION_RANGE: Record<PrefAppetite, [number, number]> = {
  low: [0.25, 0.45],
  medium: [0.55, 0.75],
  high: [0.85, 1.0],
};

// How much preferred a worker paints, as a multiple of what they intend to work.
//
// Calibrated against how people actually submit (stakeholder, 2026-08-11), not invented:
// someone wanting 20h offers about 32h; someone wanting 8h offers 13 to 14h; and a
// selective worker often offers exactly what they want, 8h for 8h. Nobody paints three or
// four times their target — an earlier 1.4/2.2/3.5 produced 60-hour boards, which read to
// the SM as "available all week" and made the board useless.
export const OVERPAINT_FACTOR: Record<PrefSelectivity, number> = {
  selective: 1.05,
  moderate: 1.35,
  flexible: 1.7,
};

// Absolute ceiling on painted availability, as a multiple of the season's CAP rather than
// a fixed hour count, so it travels to a 40h summer the same way. 1.5x is 30h on a 20h cap:
// submissions rarely go past that. The rare generous worker reaches 1.75x (35h), which does
// happen but is unusual, so it is drawn per worker rather than applied to everyone.
export const AVAILABILITY_CEILING_CAP_MULTIPLE = 1.5;
export const AVAILABILITY_CEILING_RARE_MULTIPLE = 1.75;
export const GENEROUS_AVAILABILITY_RATE = 0.1;

// The most anyone ever offers relative to their OWN target, whatever the cap allows. Just
// above the flexible factor (1.7) to leave room for whole-run rounding.
export const MAX_OVERPAINT_RATIO = 1.8;

// Preferred contiguous run, in 30-minute blocks.
export const RUN_BLOCKS: Record<PrefShiftLength, number> = {
  short: 4, // 2h
  medium: 8, // 4h
  long: 12, // 6h
};

// Probability that a block in the worker's most-opposed day part is swept to `cannot`.
export const ANTI_AFFINITY_SWEEP: Record<PrefSelectivity, number> = {
  selective: 0.55,
  moderate: 0.3,
  flexible: 0.12,
};

// Draw order is fixed and load-bearing: every draw pulls from the same worker stream, so
// reordering these lines silently changes every board ever generated.
export function drawPersona(rng: Rng): PrefPersona {
  const dayPart = rngWeighted(rng, DAY_PARTS, DAY_PART_WEIGHTS);
  const dayType = rngWeighted(rng, DAY_TYPES, DAY_TYPE_WEIGHTS);
  const shiftLength = rngWeighted(rng, SHIFT_LENGTHS, SHIFT_LENGTH_WEIGHTS);
  const selectivity = rngWeighted(rng, SELECTIVITIES, SELECTIVITY_WEIGHTS);
  const appetite = rngWeighted(rng, APPETITES, APPETITE_WEIGHTS_BY_SELECTIVITY[selectivity]);
  return { dayPart, dayType, shiftLength, selectivity, appetite };
}

export function appetiteFraction(rng: Rng, appetite: PrefAppetite): number {
  const [lo, hi] = APPETITE_FRACTION_RANGE[appetite];
  return rngRange(rng, lo, hi);
}

export function personaLabel(p: PrefPersona): string {
  return `${p.dayPart}+${p.dayType}+${p.shiftLength}+${p.selectivity}+${p.appetite}`;
}

// The day part a worker is most likely to refuse. Mornings are the default refusal
// because they are the least-wanted band on a student desk; an `early` worker refuses
// nights instead.
export function opposedDayPart(dayPart: PrefDayPart): Exclude<PrefDayPart, 'any_time'> {
  return dayPart === 'early' ? 'evening' : 'early';
}
