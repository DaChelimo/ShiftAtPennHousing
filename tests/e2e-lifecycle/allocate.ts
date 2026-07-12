// Greedy, deterministic allocator (PLAN §3 S2). It produces a built schedule with realistic
// contiguous shifts and deliberate gaps, with zero RNG.
//
// Design — fixed shift templates instead of free-form window search. The 32-block day is
// partitioned into four 4-hour (8-block) templates. Per (house, day, template) we assign up to
// `required_headcount` eligible home workers. This structure makes every invariant the
// seed-check enforces hold by construction:
//   * Contiguity: a worker takes at most ONE template per day ⇒ their daily assignment is a
//     single run of 8 contiguous blocks (≥ the 4-block / 2h minimum).
//   * No over-assignment: templates partition the day and we cap each at headcount, so a block
//     never receives more drafts than its required_headcount (publish_schedule would reject that).
//   * Never a 'cannot': a worker is eligible for a template only if NONE of its blocks are
//     'cannot' for them that day.
//   * Soft cap: 4 templates × 4h = 16h max/week (< the 20h soft cap).
//   * Deliberate gaps: when fewer than headcount workers are eligible, the template under-fills,
//     leaving vacancies — abundant here because the houses are open 112h/week but each worker is
//     capped well below full coverage. THIN_SPOT_HOUSES are understaffed further on purpose.

import { HEADCOUNT, prefStatus, type Worker } from './roster';

export interface ShiftTemplate {
  id: string;
  blocks: number[]; // block indices (0..31) the template covers
}

// 08:00–12:00, 12:00–16:00, 16:00–20:00, 20:00–24:00.
export const TEMPLATES: ShiftTemplate[] = [
  { id: 'T1', blocks: [0, 1, 2, 3, 4, 5, 6, 7] },
  { id: 'T2', blocks: [8, 9, 10, 11, 12, 13, 14, 15] },
  { id: 'T3', blocks: [16, 17, 18, 19, 20, 21, 22, 23] },
  { id: 'T4', blocks: [24, 25, 26, 27, 28, 29, 30, 31] },
];

export const DEFAULT_MAX_SHIFTS = 4; // 4 × 4h = 16h/week (< 20h soft cap)
export const THIN_SPOT_MAX_SHIFTS = 2; // deliberately understaffed houses
export const THIN_SPOT_HOUSES = new Set<string>(['radian', 'rodin']);

export function maxShiftsForHouse(house: string): number {
  return THIN_SPOT_HOUSES.has(house) ? THIN_SPOT_MAX_SHIFTS : DEFAULT_MAX_SHIFTS;
}

export interface Assignment {
  house: string;
  dayIndex: number;
  userId: string;
  blockIndexes: number[];
}

export interface AllocateOptions {
  skipHouses?: Set<string>; // houses already published (idempotent re-run) — do not re-allocate
}

/**
 * Allocate the build week. `days` is the list of dayIndexes (0=Mon..6=Sun) to staff. Pure: the
 * same inputs always yield the same assignments.
 */
export function allocate(
  workers: Worker[],
  days: number[],
  options: AllocateOptions = {},
): Assignment[] {
  const skip = options.skipHouses ?? new Set<string>();

  const byHouse = new Map<string, Worker[]>();
  for (const w of workers) {
    if (skip.has(w.homeHouse)) continue;
    const list = byHouse.get(w.homeHouse);
    if (list) list.push(w);
    else byHouse.set(w.homeHouse, [w]);
  }

  const result: Assignment[] = [];
  const shiftCount = new Map<string, number>();
  const shiftsOf = (userId: string): number => shiftCount.get(userId) ?? 0;

  for (const [house, rawRoster] of byHouse) {
    const roster = rawRoster.slice().sort((a, b) => a.rosterIndex - b.rosterIndex);
    const headcount = HEADCOUNT[house] ?? 1;
    const maxShifts = maxShiftsForHouse(house);

    for (const dayIndex of days) {
      const assignedToday = new Set<string>();

      for (const template of TEMPLATES) {
        const eligible = roster.filter(
          (w) =>
            !assignedToday.has(w.userId) &&
            shiftsOf(w.userId) < maxShifts &&
            template.blocks.every((b) => prefStatus(w.archetype, dayIndex, b) !== 'cannot'),
        );

        const preferredOverlap = (w: Worker): number =>
          template.blocks.filter((b) => prefStatus(w.archetype, dayIndex, b) === 'preferred')
            .length;

        // Spread load (fewest shifts first), then favour who wants it (preferred overlap),
        // then a stable index tiebreaker.
        eligible.sort(
          (a, b) =>
            shiftsOf(a.userId) - shiftsOf(b.userId) ||
            preferredOverlap(b) - preferredOverlap(a) ||
            a.rosterIndex - b.rosterIndex,
        );

        for (const w of eligible.slice(0, headcount)) {
          result.push({
            house,
            dayIndex,
            userId: w.userId,
            blockIndexes: [...template.blocks],
          });
          assignedToday.add(w.userId);
          shiftCount.set(w.userId, shiftsOf(w.userId) + 1);
        }
      }
    }
  }

  return result;
}
