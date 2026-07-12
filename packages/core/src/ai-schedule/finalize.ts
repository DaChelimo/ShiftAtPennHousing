// AI Schedule Agent — deterministic finalize pass.
//
// The LLM builds a preference-aware skeleton; this pure pass turns it into a
// COMPLETE, CONTINUOUS backbone the SM can edit:
//   1. extend short existing runs to the 2-hour minimum,
//   2. fill remaining open seats with fresh >= 2-hour runs (preference- and
//      fairness-aware, capped, Harnwell-legal, never over headcount),
//   3. drop any run still under 2 hours, leaving that seat OPEN rather than a
//      stub shift.
// Guarantee on the output: every run is >= MIN_RUN_BLOCKS (2h) and the whole
// schedule stays feasible. Getting a worker to the desk is costly, so a
// sub-2-hour shift is never worth it; an open seat the SM fills is better.

import { buildGrid, type AiGridDay } from './grid.js';
import type { AiAssignment, AiScheduleInput } from './types.js';

const HARNWELL_HOUSE_ID = 'harnwell';

// Minimum shift length. 2 hours = four 30-minute blocks. The SM's hard floor:
// no shift shorter than this ever ships in the generated backbone.
export const MIN_RUN_BLOCKS = 4;

export function finalizeSchedule(
  input: AiScheduleInput,
  assignments: AiAssignment[],
): AiAssignment[] {
  const grid = buildGrid(input);

  // Mutable occupancy model: blockId -> workers on that block, plus weekly
  // hours per worker (the cap is weekly, so hours span days).
  const occ = new Map<string, string[]>();
  const hoursOf = new Map<string, number>();
  for (const worker of grid.workers) hoursOf.set(worker.workerId, 0);
  for (const a of assignments) {
    if (!grid.blockById.has(a.blockId) || !grid.workerById.has(a.workerId)) continue;
    const list = occ.get(a.blockId) ?? [];
    if (list.includes(a.workerId)) continue;
    list.push(a.workerId);
    occ.set(a.blockId, list);
    hoursOf.set(a.workerId, (hoursOf.get(a.workerId) ?? 0) + 0.5);
  }

  const required = (blockId: string): number => grid.blockById.get(blockId)?.requiredHeadcount ?? 0;
  const openSeats = (blockId: string): number =>
    required(blockId) - (occ.get(blockId)?.length ?? 0);
  const has = (w: string, blockId: string): boolean => occ.get(blockId)?.includes(w) ?? false;
  const isCannot = (w: string, blockId: string): boolean =>
    grid.workerById.get(w)?.prefs[blockId] === 'cannot';
  const homeOk = (w: string): boolean =>
    !input.isHarnwell || grid.workerById.get(w)?.homeHouseId === HARNWELL_HOUSE_ID;
  const canAdd = (w: string, blockId: string): boolean =>
    openSeats(blockId) > 0 &&
    !has(w, blockId) &&
    !isCannot(w, blockId) &&
    homeOk(w) &&
    (hoursOf.get(w) ?? 0) + 0.5 <= input.capHours;
  const addAt = (w: string, blockId: string): void => {
    const l = occ.get(blockId) ?? [];
    l.push(w);
    occ.set(blockId, l);
    hoursOf.set(w, (hoursOf.get(w) ?? 0) + 0.5);
  };
  const removeAt = (w: string, blockId: string): void => {
    occ.set(
      blockId,
      (occ.get(blockId) ?? []).filter((x) => x !== w),
    );
    hoursOf.set(w, (hoursOf.get(w) ?? 0) - 0.5);
  };

  // Contiguous index ranges [start, end] where worker w is present in a day.
  const runsOf = (w: string, day: AiGridDay): [number, number][] => {
    const runs: [number, number][] = [];
    let s = -1;
    for (let i = 0; i < day.blocks.length; i++) {
      const block = day.blocks[i];
      if (block !== undefined && has(w, block.blockId)) {
        if (s === -1) s = i;
      } else if (s !== -1) {
        runs.push([s, i - 1]);
        s = -1;
      }
    }
    if (s !== -1) runs.push([s, day.blocks.length - 1]);
    return runs;
  };

  for (const day of grid.days) {
    const blocks = day.blocks;
    const n = blocks.length;

    // Largest legal fresh run for w starting at index i: consecutive blocks
    // that are open, not already w's, not cannot, Harnwell-legal, and within
    // cap as hours accrue.
    const maxLegalLen = (w: string, i: number): number => {
      let extra = 0;
      let len = 0;
      for (let k = i; k < n; k++) {
        const block = blocks[k];
        if (block === undefined) break;
        if (openSeats(block.blockId) <= 0) break;
        if (has(w, block.blockId)) break;
        if (isCannot(w, block.blockId)) break;
        if (!homeOk(w)) break;
        extra += 0.5;
        if ((hoursOf.get(w) ?? 0) + extra > input.capHours) break;
        len++;
      }
      return len;
    };

    // PASS 1: extend short existing runs to the 2h minimum by borrowing
    // adjacent open, legal blocks (before the start, then after the end).
    for (const worker of grid.workers) {
      const w = worker.workerId;
      for (const [rs, re] of runsOf(w, day)) {
        let s = rs;
        let e = re;
        while (e - s + 1 < MIN_RUN_BLOCKS) {
          const before = blocks[s - 1];
          const after = blocks[e + 1];
          if (s - 1 >= 0 && before !== undefined && canAdd(w, before.blockId)) {
            addAt(w, before.blockId);
            s -= 1;
            continue;
          }
          if (e + 1 < n && after !== undefined && canAdd(w, after.blockId)) {
            addAt(w, after.blockId);
            e += 1;
            continue;
          }
          break;
        }
      }
    }

    // PASS 2: coverage fill. Scan blocks left to right; for each open block,
    // pick the best worker who can cover a >= 2h legal run starting there and
    // assign the maximal such run. Preference-first, then most hours remaining
    // toward target (fairness + reaching targets), then workerId (determinism).
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < n; i++) {
        const block = blocks[i];
        if (block === undefined || openSeats(block.blockId) <= 0) continue;
        let best: { w: string; remaining: number; preferred: number } | null = null;
        for (const worker of grid.workers) {
          const w = worker.workerId;
          if (maxLegalLen(w, i) < MIN_RUN_BLOCKS) continue;
          const preferred = worker.prefs[block.blockId] === 'preferred' ? 1 : 0;
          const target = worker.targetHours ?? input.capHours;
          const remaining = target - (hoursOf.get(w) ?? 0);
          const cand = { w, remaining, preferred };
          if (
            best === null ||
            cand.preferred > best.preferred ||
            (cand.preferred === best.preferred && cand.remaining > best.remaining) ||
            (cand.preferred === best.preferred &&
              cand.remaining === best.remaining &&
              cand.w.localeCompare(best.w) < 0)
          ) {
            best = cand;
          }
        }
        if (best === null) continue;
        const len = maxLegalLen(best.w, i);
        for (let k = 0; k < len; k++) {
          const runBlock = blocks[i + k];
          if (runBlock !== undefined) addAt(best.w, runBlock.blockId);
        }
        progressed = true;
      }
    }

    // PASS 3: drop residual sub-2h runs. Better an OPEN seat than a stub shift.
    for (const worker of grid.workers) {
      const w = worker.workerId;
      for (const [s, e] of runsOf(w, day)) {
        if (e - s + 1 < MIN_RUN_BLOCKS) {
          for (let i = s; i <= e; i++) {
            const block = blocks[i];
            if (block !== undefined) removeAt(w, block.blockId);
          }
        }
      }
    }
  }

  // Rebuild assignments in a stable order (day, block time, workerId).
  const out: AiAssignment[] = [];
  for (const day of grid.days) {
    for (const block of day.blocks) {
      const workers = [...(occ.get(block.blockId) ?? [])].sort((a, b) => a.localeCompare(b));
      for (const w of workers) out.push({ blockId: block.blockId, workerId: w });
    }
  }
  return out;
}
