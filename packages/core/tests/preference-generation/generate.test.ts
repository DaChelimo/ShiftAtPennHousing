// Feature A — simulated worker preferences. Pure + deterministic.

import { describe, expect, it } from 'vitest';

import {
  desirability,
  generateWorkerPreferences,
  type PrefGenBlock,
} from '../../src/preference-generation/index.js';

// Build a full template week of 30-minute blocks over a desk-hours window.
function templateWeek(startMin = 480, endMin = 1440): PrefGenBlock[] {
  const blocks: PrefGenBlock[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    for (let m = startMin; m < endMin; m += 30) {
      blocks.push({ blockId: `b-${String(weekday)}-${String(m)}`, weekday, minuteOfDay: m });
    }
  }
  return blocks;
}

function roster(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `u-${String(i)}`);
}

const CONFIG = { seed: 'dev', capHours: 20 };

describe('desirability curve', () => {
  it('rates Saturday late night far above a weekday morning', () => {
    const satLate = desirability(5, 1350); // Sat 22:30
    const monMorning = desirability(0, 510); // Mon 08:30
    expect(satLate).toBeGreaterThan(monMorning);
    expect(satLate).toBeGreaterThan(0.7);
    expect(monMorning).toBeLessThan(0.2);
  });

  it('stays within [0, 1] across the whole grid', () => {
    for (let wd = 0; wd <= 6; wd++) {
      for (let m = 0; m < 1440; m += 30) {
        const d = desirability(wd, m);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('generateWorkerPreferences', () => {
  it('is deterministic for a fixed seed', () => {
    const blocks = templateWeek();
    const a = generateWorkerPreferences(blocks, roster(12), 'p1', CONFIG);
    const b = generateWorkerPreferences(blocks, roster(12), 'p1', CONFIG);
    expect(a).toEqual(b);
  });

  it('diverges when the period changes', () => {
    const blocks = templateWeek();
    const a = generateWorkerPreferences(blocks, roster(12), 'p1', CONFIG);
    const b = generateWorkerPreferences(blocks, roster(12), 'p2', CONFIG);
    expect(a).not.toEqual(b);
  });

  it('emits only preferred/cannot statuses (sparse output)', () => {
    const prefs = generateWorkerPreferences(templateWeek(), roster(12), 'p1', CONFIG);
    for (const w of prefs) {
      for (const e of w.entries) {
        expect(['preferred', 'cannot']).toContain(e.status);
      }
    }
  });

  it('opted-out workers carry no entries', () => {
    const prefs = generateWorkerPreferences(templateWeek(), roster(40), 'p1', CONFIG);
    for (const w of prefs.filter((x) => x.optedOut)) {
      expect(w.entries).toHaveLength(0);
    }
  });

  it('keeps opt-out in the 5-10% band across a large roster', () => {
    const prefs = generateWorkerPreferences(templateWeek(), roster(400), 'p1', CONFIG);
    const rate = prefs.filter((w) => w.optedOut).length / prefs.length;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.13);
  });

  it('never targets above the cap', () => {
    const prefs = generateWorkerPreferences(templateWeek(), roster(200), 'p1', {
      seed: 'dev',
      capHours: 12,
    });
    for (const w of prefs) {
      expect(w.targetHours).toBeGreaterThan(0);
      expect(w.targetHours).toBeLessThanOrEqual(12);
    }
  });

  it('guarantees every block has at least one preferred across the roster', () => {
    const blocks = templateWeek();
    const prefs = generateWorkerPreferences(blocks, roster(8), 'p1', CONFIG);
    const preferredBlocks = new Set<string>();
    for (const w of prefs) {
      for (const e of w.entries) if (e.status === 'preferred') preferredBlocks.add(e.blockId);
    }
    for (const b of blocks) expect(preferredBlocks.has(b.blockId)).toBe(true);
  });

  it('prefers Saturday-night blocks far more often than Monday-morning blocks', () => {
    const blocks = templateWeek();
    const prefs = generateWorkerPreferences(blocks, roster(60), 'p1', CONFIG);
    const preferredCount = (predicate: (b: PrefGenBlock) => boolean) => {
      const ids = new Set(blocks.filter(predicate).map((b) => b.blockId));
      let count = 0;
      for (const w of prefs) {
        for (const e of w.entries) if (e.status === 'preferred' && ids.has(e.blockId)) count++;
      }
      return count;
    };
    const satNight = preferredCount((b) => b.weekday === 5 && b.minuteOfDay >= 1260);
    const monMorning = preferredCount((b) => b.weekday === 0 && b.minuteOfDay < 600);
    expect(satNight).toBeGreaterThan(monMorning);
  });
});
