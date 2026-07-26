// AI Schedule Agent — derived grid indexes.
//
// buildGrid defensively copies the snapshot into sorted, indexed shapes so
// the loop/validator/scorer never mutate caller-owned data and never depend
// on caller array order (mirrors float-lookup/normalize.ts).

import type { AiAssignment, AiRosterWorker, AiScheduleBlock, AiScheduleInput } from './types.js';

export type AiGridDay = {
  weekday: number;
  blocks: AiScheduleBlock[]; // ascending minuteOfDay; slot index = array index
};

export type AiGrid = {
  days: AiGridDay[]; // Mon-first, only weekdays that have blocks
  dayByWeekday: Map<number, AiGridDay>;
  blockById: Map<string, AiScheduleBlock>;
  // Slot index of a block within its own day (the same index the prompt's
  // slot table uses). Lets boundary/alignment checks go straight from an
  // assignment to its position in the day without a scan.
  indexInDay: Map<string, number>;
  workers: AiRosterWorker[]; // sorted by workerId
  workerById: Map<string, AiRosterWorker>;
  // Stable short keys used in prompts so worker names/UUIDs never reach
  // the LLM: W1..Wn in workerId sort order.
  keyByWorkerId: Map<string, string>;
  workerByKey: Map<string, AiRosterWorker>;
};

export function buildGrid(input: AiScheduleInput): AiGrid {
  const blocks = input.blocks.map((b) => ({ ...b }));
  blocks.sort((a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay);

  const days: AiGridDay[] = [];
  const blockById = new Map<string, AiScheduleBlock>();
  for (const block of blocks) {
    blockById.set(block.blockId, block);
    const day = days.length > 0 ? days[days.length - 1] : undefined;
    if (day !== undefined && day.weekday === block.weekday) {
      day.blocks.push(block);
    } else {
      days.push({ weekday: block.weekday, blocks: [block] });
    }
  }

  const dayByWeekday = new Map<number, AiGridDay>();
  const indexInDay = new Map<string, number>();
  for (const day of days) {
    dayByWeekday.set(day.weekday, day);
    day.blocks.forEach((block, i) => indexInDay.set(block.blockId, i));
  }

  const workers = input.roster.map((w) => ({ ...w, prefs: { ...w.prefs } }));
  workers.sort((a, b) => a.workerId.localeCompare(b.workerId));

  const workerById = new Map<string, AiRosterWorker>();
  const keyByWorkerId = new Map<string, string>();
  const workerByKey = new Map<string, AiRosterWorker>();
  workers.forEach((worker, i) => {
    const key = `W${String(i + 1)}`;
    workerById.set(worker.workerId, worker);
    keyByWorkerId.set(worker.workerId, key);
    workerByKey.set(key, worker);
  });

  return {
    days,
    dayByWeekday,
    blockById,
    indexInDay,
    workers,
    workerById,
    keyByWorkerId,
    workerByKey,
  };
}

// A contiguous same-day stretch of one worker's assigned blocks.
export type AiRun = {
  workerId: string;
  weekday: number;
  blocks: AiScheduleBlock[]; // ascending minuteOfDay, adjacent (30-min steps)
};

// Split a worker's assignments into contiguous runs. Assumes assignments
// reference known blocks and are already deduplicated; unknown blockIds are
// silently skipped (the validator reports them separately).
export function splitRuns(grid: AiGrid, assignments: AiAssignment[]): AiRun[] {
  const byWorker = new Map<string, AiScheduleBlock[]>();
  for (const a of assignments) {
    const block = grid.blockById.get(a.blockId);
    if (block === undefined) continue;
    const list = byWorker.get(a.workerId);
    if (list === undefined) {
      byWorker.set(a.workerId, [block]);
    } else {
      list.push(block);
    }
  }

  const runs: AiRun[] = [];
  const workerIds = [...byWorker.keys()].sort((a, b) => a.localeCompare(b));
  for (const workerId of workerIds) {
    const blocks = byWorker.get(workerId) ?? [];
    blocks.sort((a, b) => a.weekday - b.weekday || a.minuteOfDay - b.minuteOfDay);
    let current: AiRun | null = null;
    for (const block of blocks) {
      let prev: AiScheduleBlock | undefined;
      if (current !== null) prev = current.blocks[current.blocks.length - 1];
      const adjacent =
        prev !== undefined &&
        prev.weekday === block.weekday &&
        block.minuteOfDay - prev.minuteOfDay === 30;
      if (current !== null && adjacent) {
        current.blocks.push(block);
      } else {
        current = { workerId, weekday: block.weekday, blocks: [block] };
        runs.push(current);
      }
    }
  }
  return runs;
}

// Hours held by each worker in a candidate (0.5h per unique block).
export function hoursByWorker(grid: AiGrid, assignments: AiAssignment[]): Record<string, number> {
  const seen = new Set<string>();
  const hours: Record<string, number> = {};
  for (const worker of grid.workers) hours[worker.workerId] = 0;
  for (const a of assignments) {
    if (!grid.blockById.has(a.blockId) || !grid.workerById.has(a.workerId)) continue;
    const pairKey = `${a.workerId}|${a.blockId}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    hours[a.workerId] = (hours[a.workerId] ?? 0) + 0.5;
  }
  return hours;
}
