// Package report + roster guarantees. Split out of index.ts purely for size; it is the
// read-only side of generation and imports nothing back from the generator.

import type { WorkerDraft } from './scoring.js';
import type {
  GeneratedWorkerPrefs,
  GuaranteeResult,
  PrefGenBlock,
  PrefGenConfig,
  PrefGenReport,
} from './types.js';

// ---------------------------------------------------------------------------
// Report + guarantees.
// ---------------------------------------------------------------------------

export function buildReport(
  drafts: WorkerDraft[],
  workers: GeneratedWorkerPrefs[],
  blocks: PrefGenBlock[],
  config: PrefGenConfig,
  repair: { repaired: number; uncovered: PrefGenBlock[] },
  uncoveredBudgetHours: number,
): PrefGenReport {
  const submitting = workers.filter((w) => w.submitted);
  const active = workers.filter((w) => w.submitted && !w.optedOut);

  const personaMix: Record<string, Record<string, number>> = {
    dayPart: {},
    dayType: {},
    shiftLength: {},
    selectivity: {},
    appetite: {},
  };
  for (const w of workers) {
    for (const axis of Object.keys(personaMix)) {
      const member = (w.persona as unknown as Record<string, string>)[axis]!;
      personaMix[axis]![member] = (personaMix[axis]![member] ?? 0) + 1;
    }
  }

  const histogram = new Map<number, number>();
  for (const w of submitting) histogram.set(w.targetHours, (histogram.get(w.targetHours) ?? 0) + 1);
  const targetHistogram = [...histogram.entries()]
    .map(([hours, count]) => ({ hours, workers: count }))
    .sort((a, b) => a.hours - b.hours);

  const preferredCounts = blocks.map(
    (b) =>
      drafts.filter((d) => d.submitted && !d.optedOut && d.marks.get(b.blockId) === 'preferred')
        .length,
  );
  const uncoveredIds = new Set(repair.uncovered.map((b) => b.blockId));
  // Min and median describe the blocks the SM can actually build from. Folding the
  // deliberately-unwanted blocks in would peg the minimum at 0 and say nothing.
  const sorted = blocks
    .map((b, i) => ({ id: b.blockId, n: preferredCounts[i]! }))
    .filter((x) => !uncoveredIds.has(x.id))
    .map((x) => x.n)
    .sort((a, b) => a - b);
  const minPreferred = sorted.length > 0 ? sorted[0]! : 0;
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0;

  const seatHours = blocks.reduce((sum, b) => sum + (b.requiredHeadcount ?? 1) * 0.5, 0);
  const appetiteHours = active.reduce((sum, w) => sum + w.targetHours, 0);

  // Shortfall EXCLUDING the deliberately-unwanted blocks: those are an expected feature of
  // a real board, not a failure of one.
  const shortfall = blocks.filter(
    (b, i) => !uncoveredIds.has(b.blockId) && preferredCounts[i]! < (b.requiredHeadcount ?? 1),
  ).length;
  const uncoveredHours = repair.uncovered.length * 0.5;
  const overBudget = uncoveredHours > uncoveredBudgetHours;

  const availability = active
    .map((w) => w.entries.filter((e) => e.status === 'preferred').length * 0.5)
    .sort((a, b) => a - b);
  const availabilityHours = {
    min: availability.length > 0 ? availability[0]! : 0,
    median: availability.length > 0 ? availability[Math.floor(availability.length / 2)]! : 0,
    max: availability.length > 0 ? availability[availability.length - 1]! : 0,
  };
  // G2 is about ACTIVE refusal, which is a different thing from G1's lack of enthusiasm.
  // A block with zero `preferred` marks is usually still available to most of the roster:
  // three states exist, and "nobody volunteered" is not "everybody refused".
  //
  // The eligible.length guard matters: [].every() is vacuously true, so an all-opted-out
  // roster would otherwise report every block as fully blocked, when the truth is that
  // nobody submitted at all. G1 already reports that case correctly.
  const eligibleDrafts = drafts.filter((d) => d.submitted && !d.optedOut);
  const allCannot =
    eligibleDrafts.length === 0
      ? 0
      : blocks.filter((b) => eligibleDrafts.every((d) => d.marks.get(b.blockId) === 'cannot'))
          .length;
  const overCap = workers.filter(
    (w) => w.targetHours < 1 || w.targetHours > config.capHours,
  ).length;

  const guarantees: GuaranteeResult[] = [
    {
      id: 'G1',
      label: 'Every block reaches required_headcount, except the unwanted-block budget',
      passed: shortfall === 0 && !overBudget,
      detail:
        shortfall === 0 && !overBudget
          ? `${String(uncoveredHours)}h attract no interest (budget ${String(uncoveredBudgetHours)}h); every other block has ${String(minPreferred > 0 ? minPreferred : 1)} or more, median ${String(median)}`
          : overBudget
            ? `${String(uncoveredHours)}h with no interest exceeds the ${String(uncoveredBudgetHours)}h budget`
            : `${String(shortfall)} block(s) still short after repair`,
    },
    {
      id: 'G2',
      label: 'No block is `cannot` for the entire submitting roster',
      passed: allCannot === 0,
      detail:
        allCannot === 0 ? 'no fully-blocked slots' : `${String(allCannot)} fully-blocked slot(s)`,
    },
    {
      id: 'G3',
      label: `Every target within [1, ${String(config.capHours)}]`,
      passed: overCap === 0,
      detail:
        overCap === 0 ? 'all targets inside the cap' : `${String(overCap)} target(s) out of range`,
    },
    {
      id: 'G4',
      label: 'Roster appetite covers the season seat-hours',
      passed: appetiteHours >= seatHours,
      detail: `${String(appetiteHours)}h wanted vs ${String(seatHours)}h of seats${
        appetiteHours >= seatHours ? '' : ' (report only, not repaired)'
      }`,
    },
  ];

  return {
    workers: workers.length,
    submitters: submitting.length,
    optedOut: workers.filter((w) => w.optedOut).length,
    nonSubmitters: workers.filter((w) => !w.submitted).length,
    blocks: blocks.length,
    seatHours,
    appetiteHours,
    personaMix,
    targetHistogram,
    minPreferredPerBlock: minPreferred,
    medianPreferredPerBlock: median,
    repairedBlocks: repair.repaired,
    uncoveredBlocks: repair.uncovered.map((b) => ({
      weekday: b.weekday,
      minuteOfDay: b.minuteOfDay,
    })),
    uncoveredHours,
    uncoveredBudgetHours,
    availabilityHours,
    guarantees,
  };
}
