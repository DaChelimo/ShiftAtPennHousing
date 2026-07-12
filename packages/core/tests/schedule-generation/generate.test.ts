// Feature B — auto-build a balanced draft schedule. Pure + deterministic.

import { describe, expect, it } from 'vitest';

import {
  generateBalancedSchedule,
  type SchedBlock,
  type SchedRosterWorker,
} from '../../src/schedule-generation/index.js';

// A house open 12:00-24:00 daily, single-staffed (laneCount 1) unless overridden.
function week(laneCount = 1, startMin = 720, endMin = 1440): SchedBlock[] {
  const blocks: SchedBlock[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    for (let m = startMin; m < endMin; m += 30) {
      blocks.push({ blockId: `b-${String(weekday)}-${String(m)}`, weekday, minuteOfDay: m, laneCount });
    }
  }
  return blocks;
}

function swRoster(n: number, house = 'gutmann'): SchedRosterWorker[] {
  return Array.from({ length: n }, (_, i) => ({ workerId: `u-${String(i)}`, homeHouseId: house }));
}

const CONFIG = { seed: 'dev', weeklyCapHours: 20 };

describe('generateBalancedSchedule', () => {
  it('is deterministic for a fixed seed', () => {
    const blocks = week();
    const a = generateBalancedSchedule(blocks, swRoster(10), 'p1', 'gutmann', false, CONFIG);
    const b = generateBalancedSchedule(blocks, swRoster(10), 'p1', 'gutmann', false, CONFIG);
    expect(a).toEqual(b);
  });

  it('fills every seat when roster capacity is ample', () => {
    // 7 days x 24 blocks = 168 block-seats = 84h. With 20h cap that needs >=5 workers.
    const result = generateBalancedSchedule(week(), swRoster(12), 'p1', 'gutmann', false, CONFIG);
    expect(result.unfilledSeatCount).toBe(0);
    expect(result.assignedCount).toBe(168);
  });

  it('never assigns more than laneCount workers to a block', () => {
    const blocks = week(2);
    const result = generateBalancedSchedule(blocks, swRoster(30), 'p1', 'gutmann', false, CONFIG);
    const perBlock = new Map<string, number>();
    for (const a of result.assignments) perBlock.set(a.blockId, (perBlock.get(a.blockId) ?? 0) + 1);
    for (const count of perBlock.values()) expect(count).toBeLessThanOrEqual(2);
  });

  it('respects the weekly cap for every worker', () => {
    const result = generateBalancedSchedule(week(), swRoster(12), 'p1', 'gutmann', false, CONFIG);
    const hours = new Map<string, number>();
    for (const a of result.assignments) hours.set(a.userId, (hours.get(a.userId) ?? 0) + 0.5);
    for (const h of hours.values()) expect(h).toBeLessThanOrEqual(20);
  });

  it('never double-books a worker in the same block', () => {
    const result = generateBalancedSchedule(week(2), swRoster(30), 'p1', 'gutmann', false, CONFIG);
    const seen = new Set<string>();
    for (const a of result.assignments) {
      const key = `${a.userId}|${a.blockId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('excludes non-Harnwell workers from the Harnwell desk', () => {
    const mixed: SchedRosterWorker[] = [
      ...swRoster(3, 'harnwell'),
      ...swRoster(3, 'gutmann').map((w) => ({ ...w, workerId: `x-${w.workerId}` })),
    ];
    const result = generateBalancedSchedule(week(), mixed, 'p1', 'harnwell', true, CONFIG);
    const assignedHomes = new Set(result.assignments.map((a) => a.userId));
    for (const id of assignedHomes) expect(id.startsWith('x-')).toBe(false);
  });

  it('reports unfilled seats when the roster cannot cover demand', () => {
    // One worker, 20h cap, but 84h of demand -> most seats unfilled, none fabricated.
    const result = generateBalancedSchedule(week(), swRoster(1), 'p1', 'gutmann', false, CONFIG);
    expect(result.assignedCount).toBeLessThanOrEqual(40); // <= 20h
    expect(result.unfilledSeatCount).toBeGreaterThan(0);
    expect(result.assignedCount + result.unfilledSeatCount).toBe(168);
  });

  it('produces mostly 2-5h shifts with few 1h remainders', () => {
    const result = generateBalancedSchedule(week(), swRoster(12), 'p1', 'gutmann', false, CONFIG);
    // Reconstruct contiguous runs per (worker, day) to measure shift lengths.
    const byWorkerDay = new Map<string, number[]>();
    for (const a of result.assignments) {
      const [, wd, m] = a.blockId.split('-');
      const key = `${a.userId}|${wd}`;
      const arr = byWorkerDay.get(key) ?? [];
      arr.push(Number(m));
      byWorkerDay.set(key, arr);
    }
    const shiftLengths: number[] = [];
    for (const mins of byWorkerDay.values()) {
      mins.sort((x, y) => x - y);
      let run = 1;
      for (let i = 1; i <= mins.length; i++) {
        if (i < mins.length && mins[i] === mins[i - 1]! + 30) {
          run++;
        } else {
          shiftLengths.push(run);
          run = 1;
        }
      }
    }
    const oneHour = shiftLengths.filter((l) => l === 2).length;
    const good = shiftLengths.filter((l) => l >= 4 && l <= 10).length;
    expect(good).toBeGreaterThan(oneHour);
  });
});
