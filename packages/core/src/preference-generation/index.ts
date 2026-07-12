// Dev-seeding: simulated worker preferences (Feature A).
//
// Produces realistic, well-mixed preference boards for a whole roster so one admin can
// exercise the summer builder without logging in as every worker. Deterministic: keyed
// off (seed, periodId, userId). See docs/dev-tooling/PLAN.md Feature A.

import { mulberry32, hashSeed, rngRange, rngWeighted, type Rng } from '../random/seeded.js';

import type {
  GeneratedPrefStatus,
  GeneratedWorkerPrefs,
  PrefGenBlock,
  PrefGenConfig,
} from './types.js';

export * from './types.js';

// ---------------------------------------------------------------------------
// Desirability: how appealing a given block is to a "typical" worker, in [0, 1].
// Late nights (esp. Fri/Sat) are prized; weekday mornings and mid-day class hours are
// the least wanted (the "Monday 8am" case). Weekend days sit in the middle.
// ---------------------------------------------------------------------------

const FRI = 4;
const SAT = 5;
const SUN = 6;

// Base curve by time-of-day (minutes since NY midnight). After-midnight blocks (before
// ~5am) read as the tail of the previous night, so they stay elevated.
function timeOfDayBase(minuteOfDay: number): number {
  if (minuteOfDay < 300) return 0.7; // 00:00-05:00 late-night tail
  if (minuteOfDay < 600) return 0.12; // 05:00-10:00 early morning (lowest)
  if (minuteOfDay < 1020) return 0.3; // 10:00-17:00 daytime / class hours
  if (minuteOfDay < 1260) return 0.55; // 17:00-21:00 evening
  return 0.82; // 21:00-24:00 prime late night
}

// A block is "late" if it lands in the evening-or-later band where Fri/Sat peak.
function isLateBlock(minuteOfDay: number): boolean {
  return minuteOfDay >= 1020 || minuteOfDay < 300;
}

// A block is a weekday-morning/daytime block (the least-wanted region).
function isWeekdayDaytime(weekday: number, minuteOfDay: number): boolean {
  return weekday <= 4 && minuteOfDay >= 300 && minuteOfDay < 1020;
}

export function desirability(weekday: number, minuteOfDay: number): number {
  let d = timeOfDayBase(minuteOfDay);

  // Weekend (Fri/Sat) nights are the social peak: boost late blocks hard.
  if ((weekday === FRI || weekday === SAT) && isLateBlock(minuteOfDay)) {
    d = Math.min(1, d + 0.15);
  }
  // Sunday nights lead into the week: slightly damp the late peak.
  if (weekday === SUN && isLateBlock(minuteOfDay)) {
    d = Math.max(0, d - 0.1);
  }
  // Weekday mornings/daytime are the lowest of the low (class + sleep).
  if (isWeekdayDaytime(weekday, minuteOfDay)) {
    d = Math.max(0, d - 0.08);
  }
  return Math.max(0, Math.min(1, d));
}

// ---------------------------------------------------------------------------
// Personas — bias the desirability -> status mapping so the per-block aggregate keeps a
// realistic mix (night owls volunteer for graveyard shifts; morning-ok folks tolerate
// the 8am nobody else wants).
// ---------------------------------------------------------------------------

type Persona = {
  name: string;
  // Added to desirability before thresholding (a night owl "sees" late blocks as more
  // desirable than average).
  lateBoost: number;
  // Reduces the effective desirability drop of weekday mornings (morning-ok tolerance).
  morningTolerance: number;
  // Overall willingness to mark `preferred` (hours-maximizers say yes to more).
  eagerness: number;
  // Willingness to mark `cannot` on low-desirability blocks (picky workers veto more).
  pickiness: number;
};

const PERSONAS: readonly Persona[] = [
  { name: 'night-owl', lateBoost: 0.28, morningTolerance: -0.15, eagerness: 0.05, pickiness: 0.15 },
  { name: 'hours-maximizer', lateBoost: 0.05, morningTolerance: 0.1, eagerness: 0.28, pickiness: -0.15 },
  { name: 'picky', lateBoost: 0.0, morningTolerance: -0.1, eagerness: -0.15, pickiness: 0.28 },
  { name: 'morning-ok', lateBoost: -0.05, morningTolerance: 0.3, eagerness: 0.08, pickiness: 0.0 },
  { name: 'balanced', lateBoost: 0.0, morningTolerance: 0.0, eagerness: 0.0, pickiness: 0.0 },
];

const PERSONA_WEIGHTS = [3, 2, 2, 2, 3];

function pickPersona(rng: Rng): Persona {
  return rngWeighted(rng, PERSONAS, PERSONA_WEIGHTS);
}

// The persona-adjusted desirability actually used to decide this worker's status.
function adjustedDesirability(persona: Persona, weekday: number, minuteOfDay: number): number {
  let d = desirability(weekday, minuteOfDay);
  if (isLateBlock(minuteOfDay)) d += persona.lateBoost;
  if (isWeekdayDaytime(weekday, minuteOfDay)) d += persona.morningTolerance;
  d += persona.eagerness * 0.15;
  return Math.max(0, Math.min(1, d));
}

// Map an adjusted-desirability score + a roll to a status. Returns null for `available`
// (the sparse default). Thresholds: high desirability -> likely preferred; low
// desirability -> chance of cannot scaled by pickiness.
function statusFor(persona: Persona, adj: number, roll: number): GeneratedPrefStatus | null {
  const preferredCut = 0.55 - persona.eagerness; // easier to clear when eager
  if (adj >= preferredCut && roll < adj) return 'preferred';

  const cannotChance = Math.max(0, (0.4 - adj)) * (0.5 + persona.pickiness);
  if (roll > 1 - cannotChance) return 'cannot';

  return null;
}

// ---------------------------------------------------------------------------
// Target hours + opt-out.
// ---------------------------------------------------------------------------

const OPT_OUT_RATE = 0.075; // ~7.5%, inside the 5-10% band

function sampleTargetHours(rng: Rng, capHours: number): number {
  // Cluster around 75-90% of the cap; clamp into [ceil, cap] so the trigger never fires.
  const frac = rngRange(rng, 0.75, 0.9);
  const raw = Math.round(capHours * frac);
  const floor = Math.max(1, Math.min(capHours, Math.round(capHours * 0.4)));
  return Math.max(floor, Math.min(capHours, raw));
}

// ---------------------------------------------------------------------------
// Public generator.
// ---------------------------------------------------------------------------

export function generateWorkerPreferences(
  blocks: PrefGenBlock[],
  roster: string[],
  periodId: string,
  config: PrefGenConfig,
): GeneratedWorkerPrefs[] {
  const results: GeneratedWorkerPrefs[] = [];

  // Track, per block, the worker best positioned to cover it (highest adjusted
  // desirability among non-opted-out workers) so we can guarantee >=1 `preferred`.
  const bestForBlock = new Map<string, { userId: string; score: number }>();
  // Index into results by userId for the coverage post-pass.
  const byUser = new Map<string, GeneratedWorkerPrefs>();
  // Per-worker set of blocks already marked (to override cannot -> preferred cleanly).
  const markedByUser = new Map<string, Map<string, GeneratedPrefStatus>>();

  for (const userId of roster) {
    const rng = mulberry32(hashSeed(`${config.seed}|${periodId}|${userId}`));
    const persona = pickPersona(rng);
    const optedOut = rng() < OPT_OUT_RATE;
    const targetHours = sampleTargetHours(rng, config.capHours);

    const marks = new Map<string, GeneratedPrefStatus>();

    if (!optedOut) {
      for (const b of blocks) {
        const adj = adjustedDesirability(persona, b.weekday, b.minuteOfDay);
        // A fresh roll per block, drawn from the same worker stream (deterministic).
        const roll = rng();
        const status = statusFor(persona, adj, roll);
        if (status !== null) marks.set(b.blockId, status);

        const prev = bestForBlock.get(b.blockId);
        if (prev === undefined || adj > prev.score) {
          bestForBlock.set(b.blockId, { userId, score: adj });
        }
      }
    }

    const record: GeneratedWorkerPrefs = { userId, targetHours, optedOut, entries: [] };
    results.push(record);
    byUser.set(userId, record);
    markedByUser.set(userId, marks);
  }

  // Coverage guarantee: every block gets at least one `preferred` from the non-opted-out
  // worker who wants it most (SM always has options to build with). Deterministic —
  // bestForBlock is derived purely from adjusted desirability + a stable tie on insert
  // order (roster order). Blocks whose entire roster opted out are left uncovered.
  for (const b of blocks) {
    const anyPreferred = roster.some(
      (u) => markedByUser.get(u)?.get(b.blockId) === 'preferred',
    );
    if (anyPreferred) continue;
    const best = bestForBlock.get(b.blockId);
    if (best !== undefined) markedByUser.get(best.userId)?.set(b.blockId, 'preferred');
  }

  // Flatten the per-worker mark maps into sparse entry lists, block-ordered for stable
  // output.
  for (const record of results) {
    const marks = markedByUser.get(record.userId);
    if (marks === undefined || record.optedOut) continue;
    record.entries = blocks
      .filter((b) => marks.has(b.blockId))
      .map((b) => ({ blockId: b.blockId, status: marks.get(b.blockId)! }));
  }

  return results;
}
