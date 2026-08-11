// Block scoring and the per-worker draft shape. Shared by the generator (index.ts) and
// the reporter (report.ts); split out so neither has to import the other.

import type { PrefPersona } from './personas.js';
import type { GeneratedPrefStatus, PrefGenBlock } from './types.js';

const FRI = 4;
const SAT = 5;

// ---------------------------------------------------------------------------
// Baseline desirability: how appealing a block is to a "typical" worker, in [0, 1].
// A small term in the affinity blend — the persona axes carry most of the signal — but it
// breaks ties in the direction a real roster leans.
// ---------------------------------------------------------------------------

function timeOfDayBase(minuteOfDay: number): number {
  if (minuteOfDay < 300) return 0.7; // 00:00-05:00 late-night tail
  if (minuteOfDay < 600) return 0.12; // 05:00-10:00 early morning (lowest)
  if (minuteOfDay < 1020) return 0.3; // 10:00-17:00 daytime / class hours
  if (minuteOfDay < 1260) return 0.55; // 17:00-21:00 evening
  return 0.82; // 21:00-24:00 prime late night
}

function isLateBlock(minuteOfDay: number): boolean {
  return minuteOfDay >= 1020 || minuteOfDay < 300;
}

function isWeekdayDaytime(weekday: number, minuteOfDay: number): boolean {
  return weekday <= FRI && minuteOfDay >= 300 && minuteOfDay < 1020;
}

export function desirability(weekday: number, minuteOfDay: number): number {
  let d = timeOfDayBase(minuteOfDay);
  if ((weekday === FRI || weekday === SAT) && isLateBlock(minuteOfDay)) d = Math.min(1, d + 0.15);
  if (weekday === 6 && isLateBlock(minuteOfDay)) d = Math.max(0, d - 0.1);
  if (isWeekdayDaytime(weekday, minuteOfDay)) d = Math.max(0, d - 0.08);
  return Math.max(0, Math.min(1, d));
}

// ---------------------------------------------------------------------------
// Affinity: how much THIS persona wants THIS block.
// ---------------------------------------------------------------------------

type Band = 'early' | 'afternoon' | 'evening';

// Post-midnight blocks read as the tail of the previous night, not as an early morning.
export function bandOf(minuteOfDay: number): Band {
  if (minuteOfDay < 300) return 'evening';
  if (minuteOfDay < 720) return 'early';
  if (minuteOfDay < 1020) return 'afternoon';
  return 'evening';
}

const BAND_ORDER: Band[] = ['early', 'afternoon', 'evening'];

// `base` is the baseline desirability of the specific block, not of the band, and is used
// only by `any_time`: having no strong day-part PREFERENCE is not the same as being
// indifferent to the least-wanted hour of the week. This is a modelling correction, not
// the thing that lets slots go unwanted — that is the `base` weight in affinity() below,
// which is what a sabotage run actually showed to be load-bearing.
function dayPartScore(persona: PrefPersona, band: Band, base: number): number {
  if (persona.dayPart === 'any_time') return 0.35 + 0.5 * base;
  if (persona.dayPart === band) return 1.0;
  const distance = Math.abs(BAND_ORDER.indexOf(persona.dayPart) - BAND_ORDER.indexOf(band));
  return distance === 1 ? 0.45 : 0.15;
}

function dayTypeScore(persona: PrefPersona, weekday: number, band: Band): number {
  const isFridayNight = weekday === FRI && band === 'evening';
  if (persona.dayType === 'any_day') return 0.7;
  if (persona.dayType === 'weekend') {
    if (weekday >= SAT) return 1.0;
    return isFridayNight ? 0.9 : 0.3;
  }
  if (weekday >= SAT) return 0.3;
  return isFridayNight ? 0.65 : 1.0;
}

export function affinity(persona: PrefPersona, block: PrefGenBlock): number {
  const band = bandOf(block.minuteOfDay);
  const base = desirability(block.weekday, block.minuteOfDay);
  return (
    0.45 * dayPartScore(persona, band, base) +
    0.3 * dayTypeScore(persona, block.weekday, band) +
    // 0.25, raised from 0.15, and the raise is load-bearing: below about 0.2 the persona
    // terms dominate hard enough that SOMEBODY always wants every slot, and the board
    // never produces the handful of no-interest blocks a real one has. Verified by
    // sabotage — dropping it back to 0.15 turns the unwanted-block tests red.
    0.25 * base
  );
}

// A worker's board mid-generation, before it is flattened into sparse entries.
export type WorkerDraft = {
  userId: string;
  persona: PrefPersona;
  targetHours: number;
  optedOut: boolean;
  submitted: boolean;
  // Most blocks this worker may ever end up offering. The repair pass respects it, so
  // patching a thin morning can never inflate somebody to twice what they asked for.
  ceilingBlocks: number;
  marks: Map<string, GeneratedPrefStatus>;
};
