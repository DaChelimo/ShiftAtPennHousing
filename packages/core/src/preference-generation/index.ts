// Persona-based preference generation.
//
// Produces a plausible preference board for a whole roster so a season can be built and
// stress-tested before (or instead of) real collection. Season- and house-agnostic: the
// cap, desk window, staffing bands, and roster all arrive as arguments.
//
// Contract, rationale, and the review-then-apply workflow: docs/preference-generation/PERSONA_SPEC.md
//
// What makes this useful is structure, not randomness. Preferred blocks are painted in
// CONTIGUOUS RUNS sized by the worker's persona, and the amount painted is derived from
// their target hours. A board of independently coin-flipped 30-minute blocks is uniform
// mush that teaches you nothing about whether your staffing bands are achievable.

import { mulberry32, hashSeed, rngInt, type Rng } from '../random/seeded.js';

import {
  ANTI_AFFINITY_SWEEP,
  AVAILABILITY_CEILING_CAP_MULTIPLE,
  AVAILABILITY_CEILING_RARE_MULTIPLE,
  GENEROUS_AVAILABILITY_RATE,
  MAX_OVERPAINT_RATIO,
  OVERPAINT_FACTOR,
  RUN_BLOCKS,
  appetiteFraction,
  drawPersona,
  opposedDayPart,
  personaLabel,
  type PrefPersona,
} from './personas.js';
import { buildReport } from './report.js';
import { affinity, bandOf, type WorkerDraft } from './scoring.js';
import type {
  GeneratedPrefStatus,
  GeneratedWorkerPrefs,
  PrefGenBlock,
  PrefGenConfig,
  PrefGenPackage,
} from './types.js';

export * from './types.js';
export * from './personas.js';
// Part of the module's public surface even though the generator no longer calls them.
export { bandOf, desirability } from './scoring.js';

const DEFAULT_OPT_OUT_RATE = 0.07;
const DEFAULT_NON_SUBMITTER_RATE = 0.05;
// About 4h of a template week attracts no interest at all on a real board.
const DEFAULT_UNCOVERED_BUDGET_HOURS = 4;

// ---------------------------------------------------------------------------
// Candidate runs. A run is `length` consecutive blocks inside ONE NY day, starting on a
// clock hour (the AI scheduler's no-:30-starts rule) with the desk's own open and close
// as the only exceptions.
// ---------------------------------------------------------------------------

type Run = { blockIds: string[]; weekday: number; startMin: number; score: number };

function blocksByWeekday(blocks: PrefGenBlock[]): Map<number, PrefGenBlock[]> {
  const byDay = new Map<number, PrefGenBlock[]>();
  for (const b of blocks) {
    const list = byDay.get(b.weekday);
    if (list === undefined) byDay.set(b.weekday, [b]);
    else list.push(b);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  return byDay;
}

function enumerateRuns(byDay: Map<number, PrefGenBlock[]>, length: number): Run[] {
  const runs: Run[] = [];
  const weekdays = [...byDay.keys()].sort((a, b) => a - b);
  for (const weekday of weekdays) {
    const day = byDay.get(weekday)!;
    if (day.length < length) continue;
    const dayOpen = day[0]!.minuteOfDay;
    const dayClose = day[day.length - 1]!.minuteOfDay + 30;
    for (let i = 0; i + length <= day.length; i++) {
      const startMin = day[i]!.minuteOfDay;
      let contiguous = true;
      for (let k = 1; k < length; k++) {
        if (day[i + k]!.minuteOfDay !== startMin + 30 * k) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) continue;
      const endMin = startMin + 30 * length;
      const aligned = startMin % 60 === 0 || startMin === dayOpen || endMin === dayClose;
      if (!aligned) continue;
      runs.push({
        blockIds: day.slice(i, i + length).map((b) => b.blockId),
        weekday,
        startMin,
        score: 0,
      });
    }
  }
  return runs;
}

// A house whose day is shorter than the persona's preferred run still needs a board.
function runLengthFor(byDay: Map<number, PrefGenBlock[]>, preferred: number): number {
  const ladder = [preferred, 8, 4, 2].filter((n) => n <= preferred);
  for (const length of ladder) {
    if (enumerateRuns(byDay, length).length > 0) return length;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Per-worker board.
// ---------------------------------------------------------------------------

// TWO bounds, and the tighter one wins:
//   - against the CAP, because submissions rarely pass 1.5x it (30h on a 20h cap);
//   - against the worker's OWN target, because someone wanting 5h never ends up offering
//     30h just because the cap would allow it.
// The second is what the repair pass would otherwise violate: patching thin mornings onto
// whoever is cheapest inflates exactly the low-target workers whose boards should be small.
function ceilingBlocksFor(capHours: number, targetHours: number, generous: boolean): number {
  const againstCap = Math.round(
    capHours *
      2 *
      (generous ? AVAILABILITY_CEILING_RARE_MULTIPLE : AVAILABILITY_CEILING_CAP_MULTIPLE),
  );
  // Floor, not round: rounding up puts a small target over the ratio (3h -> 11 blocks is
  // 1.83x), and the ratio is the bound the calibration is stated in.
  const againstTarget = Math.floor(targetHours * 2 * MAX_OVERPAINT_RATIO);
  return Math.max(2, Math.min(againstCap, againstTarget));
}

function paintWorker(
  rng: Rng,
  persona: PrefPersona,
  targetHours: number,
  capHours: number,
  generous: boolean,
  blocks: PrefGenBlock[],
  byDay: Map<number, PrefGenBlock[]>,
): Map<string, GeneratedPrefStatus> {
  const marks = new Map<string, GeneratedPrefStatus>();

  const targetBlocks = targetHours * 2;

  // Somebody who only wants 3h a week does not ask for 6-hour runs. Without this, the
  // run-length floor below would force them to paint a full 6h and blow past the
  // overpaint model entirely.
  const desiredRun = Math.max(2, Math.min(RUN_BLOCKS[persona.shiftLength], targetBlocks));
  const length = runLengthFor(byDay, desiredRun);
  if (length === 0) return marks;

  // Target hours drive the paint. A worker who wants 6h a week must not read as wide open,
  // and nobody offers three times what they want.
  const wanted = Math.round(targetBlocks * OVERPAINT_FACTOR[persona.selectivity]);

  // Hard ceiling on offered availability. Expressed against the cap so it travels between
  // seasons; the floor keeps a worker from ever offering less than they asked for.
  const ceiling = ceilingBlocksFor(capHours, targetHours, generous);

  const budget = Math.max(length, targetBlocks, Math.min(blocks.length, ceiling, wanted));

  const affinityOf = new Map<string, number>();
  for (const b of blocks) affinityOf.set(b.blockId, affinity(persona, b));

  const runs = enumerateRuns(byDay, length);
  // One jitter draw per run, in enumeration order, so two workers who drew the same
  // persona still diverge. Order is stable (weekday asc, then start asc) — that stability
  // is what keeps the whole package deterministic.
  for (const run of runs) {
    const mean =
      run.blockIds.reduce((sum, id) => sum + (affinityOf.get(id) ?? 0), 0) / run.blockIds.length;
    run.score = mean + (rng() * 0.25 - 0.125);
  }

  runs.sort((a, b) => b.score - a.score || a.weekday - b.weekday || a.startMin - b.startMin);

  let painted = 0;
  for (const run of runs) {
    if (painted >= budget) break;
    // The budget may be overshot by a partial run — that is how a worker lands a little
    // above their target — but the ceiling never is.
    if (painted + run.blockIds.length > ceiling) continue;
    if (run.blockIds.some((id) => marks.has(id))) continue;
    for (const id of run.blockIds) marks.set(id, 'preferred');
    painted += run.blockIds.length;
  }

  // --- `cannot`: a recurring commitment, then an anti-affinity sweep. -------------
  const opposed = opposedDayPart(persona.dayPart);
  const opposedBlocks = blocks.filter((b) => bandOf(b.minuteOfDay) === opposed);

  const commitments = rngInt(rng, 1, 3);
  const hoursInBand = [...new Set(opposedBlocks.map((b) => b.minuteOfDay))]
    .filter((m) => m % 60 === 0)
    .sort((a, b) => a - b);

  for (let c = 0; c < commitments; c++) {
    if (hoursInBand.length === 0) break;
    const dayCount = rngInt(rng, 2, 3);
    // Stride 2 over Mon-Fri reproduces the real MWF / TTh timetable shape.
    const firstDay = rngInt(rng, 0, 4);
    const startMin = hoursInBand[rngInt(rng, 0, hoursInBand.length - 1)]!;
    const spanBlocks = rngInt(rng, 1, 2) * 2; // 1h or 2h

    for (let k = 0; k < dayCount; k++) {
      const weekday = (firstDay + k * 2) % 5;
      const day = byDay.get(weekday);
      if (day === undefined) continue;
      for (const b of day) {
        if (b.minuteOfDay < startMin || b.minuteOfDay >= startMin + spanBlocks * 30) continue;
        if (marks.get(b.blockId) === 'preferred') continue;
        marks.set(b.blockId, 'cannot');
      }
    }
  }

  // Sweep at CLOCK-HOUR granularity, one roll per (weekday, hour). Rolling per 30-minute
  // block instead produces speckle — a lone `cannot` at 09:30 with 09:00 and 10:00 left
  // open — which no real person paints, and which reads as noise on the SM's board.
  const sweep = ANTI_AFFINITY_SWEEP[persona.selectivity];
  const opposedHours = new Map<string, PrefGenBlock[]>();
  for (const b of opposedBlocks) {
    const key = `${String(b.weekday)}:${String(Math.floor(b.minuteOfDay / 60))}`;
    const list = opposedHours.get(key);
    if (list === undefined) opposedHours.set(key, [b]);
    else list.push(b);
  }
  for (const hourBlocks of opposedHours.values()) {
    const roll = rng();
    if (roll >= sweep) continue;
    for (const b of hourBlocks) {
      if (marks.has(b.blockId)) continue;
      marks.set(b.blockId, 'cannot');
    }
  }

  return marks;
}

// ---------------------------------------------------------------------------
// Public generator.
// ---------------------------------------------------------------------------

export function generatePreferencePackage(
  blocks: PrefGenBlock[],
  roster: string[],
  periodId: string,
  config: PrefGenConfig,
): PrefGenPackage {
  const optOutRate = config.optOutRate ?? DEFAULT_OPT_OUT_RATE;
  const nonSubmitterRate = config.nonSubmitterRate ?? DEFAULT_NON_SUBMITTER_RATE;
  const uncoveredBudgetHours = config.uncoveredBudgetHours ?? DEFAULT_UNCOVERED_BUDGET_HOURS;

  const ordered = [...blocks].sort(
    (a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay,
  );
  const byDay = blocksByWeekday(ordered);

  const drafts: WorkerDraft[] = [];

  for (const userId of roster) {
    const rng = mulberry32(hashSeed(`${config.seed}|${periodId}|${userId}`));
    const persona = drawPersona(rng);
    const fraction = appetiteFraction(rng, persona.appetite);
    const targetHours = Math.max(
      1,
      Math.min(config.capHours, Math.round(config.capHours * fraction)),
    );

    // Drawn per worker, not applied to everyone: offering 35h against a 20h cap is a real
    // but unusual submission, so it is a minority of the roster rather than a global ceiling.
    const generous = rng() < GENEROUS_AVAILABILITY_RATE;

    const participation = rng();
    const submitted = participation >= nonSubmitterRate;
    const optedOut = submitted && participation < nonSubmitterRate + optOutRate;

    const marks: Map<string, GeneratedPrefStatus> =
      submitted && !optedOut
        ? paintWorker(rng, persona, targetHours, config.capHours, generous, ordered, byDay)
        : new Map<string, GeneratedPrefStatus>();

    drafts.push({
      userId,
      persona,
      targetHours,
      optedOut,
      submitted,
      ceilingBlocks: ceilingBlocksFor(config.capHours, targetHours, generous),
      marks,
    });
  }

  const repair = repairCoverage(drafts, ordered, Math.round(uncoveredBudgetHours * 2));
  const workers = drafts.map((d) => toOutput(d, ordered));
  const report = buildReport(drafts, workers, ordered, config, repair, uncoveredBudgetHours);

  return { workers, report };
}

// Back-compat entry point for callers that only want the rows. Non-submitters are still
// present in the array with `submitted: false`; the caller MUST filter them out before
// writing, or they become opt-outs.
export function generateWorkerPreferences(
  blocks: PrefGenBlock[],
  roster: string[],
  periodId: string,
  config: PrefGenConfig,
): GeneratedWorkerPrefs[] {
  return generatePreferencePackage(blocks, roster, periodId, config).workers;
}

// ---------------------------------------------------------------------------
// Guarantee G1/G2 repair. A block nobody prefers cannot be filled from the preference
// board at all, and the SM discovers that one drag at a time. Deterministic: ranked by
// affinity, ties broken on userId, no rng.
// ---------------------------------------------------------------------------

function repairCoverage(
  drafts: WorkerDraft[],
  blocks: PrefGenBlock[],
  uncoveredBudgetBlocks: number,
): { repaired: number; uncovered: PrefGenBlock[] } {
  const eligible = drafts.filter((d) => d.submitted && !d.optedOut);
  if (eligible.length === 0) {
    return { repaired: 0, uncovered: blocks.filter((b) => (b.requiredHeadcount ?? 1) > 0) };
  }

  const marksFor = (b: PrefGenBlock) =>
    eligible.filter((d) => d.marks.get(b.blockId) === 'preferred').length;

  // Blocks nobody wants at all. Real boards have a handful of these — the Monday 08:00
  // case — and forcing them to full coverage would erase the one thing the board is best
  // placed to tell an SM: where the season is genuinely short of willing people.
  //
  // The budget is spent on the LEAST wanted of them, ranked by the best affinity anyone on
  // the roster has for the block, so what survives uncovered is what nobody would have
  // taken anyway rather than an arbitrary slice.
  const zeroInterest = blocks
    .filter((b) => marksFor(b) === 0)
    .map((b) => ({
      b,
      demand: Math.max(0, ...eligible.map((d) => affinity(d.persona, b))),
    }))
    .sort(
      (x, y) =>
        x.demand - y.demand || x.b.weekday - y.b.weekday || x.b.minuteOfDay - y.b.minuteOfDay,
    );

  const leaveAlone = new Set(
    zeroInterest.slice(0, Math.max(0, uncoveredBudgetBlocks)).map((x) => x.b.blockId),
  );

  let repaired = 0;
  for (const block of blocks) {
    if (leaveAlone.has(block.blockId)) continue;
    const need = block.requiredHeadcount ?? 1;
    let have = marksFor(block);
    if (have >= need) continue;

    const preferredCount = (d: WorkerDraft) =>
      [...d.marks.values()].filter((s) => s === 'preferred').length;

    const ranked = eligible
      .filter((d) => d.marks.get(block.blockId) !== 'preferred')
      // Never push a worker past what they would ever have offered. If that leaves the
      // block short, it stays short and G1 reports it — an under-supplied season is a
      // finding, not something to fix by fabricating availability.
      .filter((d) => preferredCount(d) < d.ceilingBlocks)
      .map((d) => ({ d, score: affinity(d.persona, block) }))
      .sort((a, b) => b.score - a.score || (a.d.userId < b.d.userId ? -1 : 1));

    for (const { d } of ranked) {
      if (have >= need) break;
      d.marks.set(block.blockId, 'preferred');
      have += 1;
    }
    repaired += 1;
  }

  return { repaired, uncovered: blocks.filter((b) => leaveAlone.has(b.blockId)) };
}

function toOutput(draft: WorkerDraft, blocks: PrefGenBlock[]): GeneratedWorkerPrefs {
  const entries = blocks
    .filter((b) => draft.marks.has(b.blockId))
    .map((b) => ({ blockId: b.blockId, status: draft.marks.get(b.blockId)! }));
  return {
    userId: draft.userId,
    targetHours: draft.targetHours,
    optedOut: draft.optedOut,
    submitted: draft.submitted,
    persona: draft.persona,
    personaLabel: personaLabel(draft.persona),
    entries,
  };
}
