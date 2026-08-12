// Persona-based preference generation. Pure + deterministic.
// Contract under test: docs/preference-generation/PERSONA_SPEC.md

import { describe, expect, it } from 'vitest';

import {
  RUN_BLOCKS,
  bandOf,
  desirability,
  generatePreferencePackage,
  generateWorkerPreferences,
  type PrefGenBlock,
} from '../../src/preference-generation/index.js';

// A full template week of 30-minute blocks over a desk-hours window. 08:00-00:00 mirrors
// `regular_school_year`; the summer profile opens at 05:30.
function templateWeek(startMin = 480, endMin = 1440, headcount = 1): PrefGenBlock[] {
  const blocks: PrefGenBlock[] = [];
  for (let weekday = 0; weekday <= 6; weekday++) {
    for (let m = startMin; m < endMin; m += 30) {
      blocks.push({
        blockId: `b-${String(weekday)}-${String(m)}`,
        weekday,
        minuteOfDay: m,
        requiredHeadcount: headcount,
      });
    }
  }
  return blocks;
}

function roster(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `u-${String(i)}`);
}

const CONFIG = { seed: 'dev', capHours: 20 };

function preferredIds(w: { entries: { blockId: string; status: string }[] }): Set<string> {
  return new Set(w.entries.filter((e) => e.status === 'preferred').map((e) => e.blockId));
}

describe('desirability curve', () => {
  it('rates Saturday late night far above a weekday morning', () => {
    expect(desirability(5, 1350)).toBeGreaterThan(desirability(0, 510));
    expect(desirability(5, 1350)).toBeGreaterThan(0.7);
    expect(desirability(0, 510)).toBeLessThan(0.2);
  });

  it('stays within [0, 1] across the whole grid', () => {
    for (let wd = 0; wd <= 6; wd++) {
      for (let m = 0; m < 1440; m += 30) {
        expect(desirability(wd, m)).toBeGreaterThanOrEqual(0);
        expect(desirability(wd, m)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('day-part bands', () => {
  it('reads a post-midnight block as the tail of the previous night, not a morning', () => {
    expect(bandOf(60)).toBe('evening');
    expect(bandOf(510)).toBe('early');
    expect(bandOf(780)).toBe('afternoon');
    expect(bandOf(1290)).toBe('evening');
  });
});

describe('determinism', () => {
  it('reproduces the same package for a fixed seed', () => {
    const blocks = templateWeek();
    expect(generatePreferencePackage(blocks, roster(12), 'p1', CONFIG)).toEqual(
      generatePreferencePackage(blocks, roster(12), 'p1', CONFIG),
    );
  });

  it('diverges when the period changes', () => {
    const blocks = templateWeek();
    const a = generatePreferencePackage(blocks, roster(12), 'p1', CONFIG);
    const b = generatePreferencePackage(blocks, roster(12), 'p2', CONFIG);
    expect(a.workers).not.toEqual(b.workers);
  });

  it('does not depend on block ids, only on the shape of the template week', () => {
    // The reviewed package must survive being bound to real block_ids at apply time
    // (spec §8), so a pure relabelling of the slots must not change any decision.
    const original = templateWeek();
    const relabelled = original.map((b) => ({ ...b, blockId: `real-${b.blockId}` }));

    const a = generatePreferencePackage(original, roster(20), 'p1', CONFIG);
    const b = generatePreferencePackage(relabelled, roster(20), 'p1', CONFIG);

    for (let i = 0; i < a.workers.length; i++) {
      expect(b.workers[i]!.personaLabel).toBe(a.workers[i]!.personaLabel);
      expect(b.workers[i]!.targetHours).toBe(a.workers[i]!.targetHours);
      expect(b.workers[i]!.entries.map((e) => e.blockId)).toEqual(
        a.workers[i]!.entries.map((e) => `real-${e.blockId}`),
      );
      expect(b.workers[i]!.entries.map((e) => e.status)).toEqual(
        a.workers[i]!.entries.map((e) => e.status),
      );
    }
  });

  it('does not depend on the input order of the blocks', () => {
    const blocks = templateWeek();
    const shuffled = [...blocks].reverse();
    expect(generatePreferencePackage(shuffled, roster(10), 'p1', CONFIG).workers).toEqual(
      generatePreferencePackage(blocks, roster(10), 'p1', CONFIG).workers,
    );
  });
});

describe('output shape', () => {
  it('emits only preferred/cannot statuses (sparse output)', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(12), 'p1', CONFIG);
    for (const w of workers) {
      for (const e of w.entries) expect(['preferred', 'cannot']).toContain(e.status);
    }
  });

  it('gives opted-out and non-submitting workers no entries', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(60), 'p1', CONFIG);
    for (const w of workers.filter((x) => x.optedOut || !x.submitted)) {
      expect(w.entries).toHaveLength(0);
    }
  });

  it('carries a persona label for review', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(8), 'p1', CONFIG);
    for (const w of workers) expect(w.personaLabel.split('+')).toHaveLength(5);
  });

  it('produces both opt-outs and non-submitters, which are distinct states', () => {
    const { report } = generatePreferencePackage(templateWeek(), roster(300), 'p1', CONFIG);
    expect(report.optedOut).toBeGreaterThan(0);
    expect(report.nonSubmitters).toBeGreaterThan(0);
    expect(report.submitters + report.nonSubmitters).toBe(report.workers);
  });
});

describe('target hours are driven by the cap', () => {
  it('never exceeds the cap, on any cap', () => {
    for (const capHours of [8, 12, 20, 40]) {
      const { workers } = generatePreferencePackage(templateWeek(), roster(120), 'p1', {
        seed: 'dev',
        capHours,
      });
      for (const w of workers) {
        expect(w.targetHours).toBeGreaterThanOrEqual(1);
        expect(w.targetHours).toBeLessThanOrEqual(capHours);
      }
    }
  });

  it('spreads targets across low, medium, and high appetites', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(120), 'p1', CONFIG);
    const targets = workers.map((w) => w.targetHours);
    // On a 20h cap: low lands 5-9, high lands 17-20.
    expect(Math.min(...targets)).toBeLessThanOrEqual(9);
    expect(Math.max(...targets)).toBeGreaterThanOrEqual(17);
  });

  it('scales targets with the cap rather than hardcoding hours', () => {
    const low = generatePreferencePackage(templateWeek(), roster(80), 'p1', {
      seed: 'dev',
      capHours: 10,
    });
    const high = generatePreferencePackage(templateWeek(), roster(80), 'p1', {
      seed: 'dev',
      capHours: 40,
    });
    const mean = (ws: { targetHours: number }[]) =>
      ws.reduce((s, w) => s + w.targetHours, 0) / ws.length;
    expect(mean(high.workers)).toBeGreaterThan(mean(low.workers) * 3);
  });
});

describe('the paint is shaped by the persona', () => {
  it('paints preferred in contiguous runs, not scattered blocks', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(40), 'p1', CONFIG);
    for (const w of workers.filter((x) => x.submitted && !x.optedOut)) {
      const preferred = w.entries.filter((e) => e.status === 'preferred');
      if (preferred.length === 0) continue;
      // Every preferred block sits next to another preferred block in the same day.
      const ids = preferredIds(w);
      const orphans = [...ids].filter((id) => {
        const [, wd, min] = id.split('-');
        const m = Number(min);
        return !ids.has(`b-${wd!}-${String(m - 30)}`) && !ids.has(`b-${wd!}-${String(m + 30)}`);
      });
      // Coverage repair can promote a single isolated block; allow a small tail.
      expect(orphans.length).toBeLessThanOrEqual(Math.ceil(ids.size * 0.25));
    }
  });

  it('has a `long` worker paint longer unbroken stretches than a `short` worker', () => {
    const blocks = templateWeek();
    const { workers } = generatePreferencePackage(blocks, roster(200), 'p1', CONFIG);
    const longestRun = (w: (typeof workers)[number]) => {
      const ids = preferredIds(w);
      let best = 0;
      for (let wd = 0; wd <= 6; wd++) {
        let run = 0;
        for (let m = 480; m < 1440; m += 30) {
          run = ids.has(`b-${String(wd)}-${String(m)}`) ? run + 1 : 0;
          best = Math.max(best, run);
        }
      }
      return best;
    };
    const active = workers.filter((w) => w.submitted && !w.optedOut);
    const meanRun = (len: string) => {
      const group = active.filter((w) => w.persona.shiftLength === len);
      return group.reduce((s, w) => s + longestRun(w), 0) / group.length;
    };
    expect(meanRun('long')).toBeGreaterThan(meanRun('short'));
    expect(meanRun('short')).toBeGreaterThanOrEqual(RUN_BLOCKS.short);
  });

  it('has selective workers paint far less than flexible workers at the same appetite', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(300), 'p1', CONFIG);
    const group = (sel: string) =>
      workers.filter(
        (w) =>
          w.submitted &&
          !w.optedOut &&
          w.persona.selectivity === sel &&
          w.persona.appetite === 'medium',
      );
    const meanPreferred = (sel: string) => {
      const g = group(sel);
      return g.reduce((s, w) => s + preferredIds(w).size, 0) / g.length;
    };
    // 1.25x, not the old 1.5x: the calibrated factors are 1.05 vs 1.7, and the shared
    // availability ceiling compresses the gap further at the top end.
    expect(meanPreferred('flexible')).toBeGreaterThan(meanPreferred('selective') * 1.25);
  });

  it('has weekend workers prefer Saturday far more than weekday workers do', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(200), 'p1', CONFIG);
    const satShare = (dayType: string) => {
      const g = workers.filter((w) => w.submitted && !w.optedOut && w.persona.dayType === dayType);
      let sat = 0;
      let total = 0;
      for (const w of g) {
        for (const id of preferredIds(w)) {
          total += 1;
          if (id.startsWith('b-5-')) sat += 1;
        }
      }
      return total === 0 ? 0 : sat / total;
    };
    expect(satShare('weekend')).toBeGreaterThan(satShare('weekday') * 2);
  });

  it('has early workers prefer mornings that evening workers refuse', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(200), 'p1', CONFIG);
    const morningShare = (dayPart: string) => {
      const g = workers.filter((w) => w.submitted && !w.optedOut && w.persona.dayPart === dayPart);
      let morning = 0;
      let total = 0;
      for (const w of g) {
        for (const id of preferredIds(w)) {
          const m = Number(id.split('-')[2]);
          total += 1;
          if (m < 720) morning += 1;
        }
      }
      return total === 0 ? 0 : morning / total;
    };
    expect(morningShare('early')).toBeGreaterThan(morningShare('evening'));
  });

  it('marks a recurring weekday commitment rather than scattered refusals', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(60), 'p1', CONFIG);
    const withCannot = workers.filter((w) => w.entries.some((e) => e.status === 'cannot'));
    expect(withCannot.length).toBeGreaterThan(0);
    // At least one worker refuses the same clock time on two or more weekdays.
    const hasRecurring = withCannot.some((w) => {
      const byMinute = new Map<number, Set<number>>();
      for (const e of w.entries) {
        if (e.status !== 'cannot') continue;
        const [, wd, min] = e.blockId.split('-');
        if (Number(wd) > 4) continue;
        const set = byMinute.get(Number(min)) ?? new Set<number>();
        set.add(Number(wd));
        byMinute.set(Number(min), set);
      }
      return [...byMinute.values()].some((days) => days.size >= 2);
    });
    expect(hasRecurring).toBe(true);
  });
});

describe('availability offered vs hours wanted', () => {
  // Calibrated against real submissions: want 20h offer ~32h, want 8h offer 13-14h, and
  // sometimes want 8h offer exactly 8h. Nobody offers three times their target.
  it('keeps painted availability within 1.0x to 1.8x of the target', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(200), 'p1', CONFIG);
    for (const w of workers.filter((x) => x.submitted && !x.optedOut)) {
      const ratio = w.entries.filter((e) => e.status === 'preferred').length / 2 / w.targetHours;
      expect(ratio).toBeGreaterThanOrEqual(1);
      expect(ratio).toBeLessThanOrEqual(1.8);
    }
  });

  it('almost never offers more than 1.5x the cap, and never more than 1.75x', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(300), 'p1', CONFIG);
    const active = workers.filter((w) => w.submitted && !w.optedOut);
    const offered = active.map((w) => w.entries.filter((e) => e.status === 'preferred').length / 2);
    // 20h cap: hard ceiling 35h, and the 30h+ band stays a small minority.
    expect(Math.max(...offered)).toBeLessThanOrEqual(35);
    const over30 = offered.filter((h) => h > 30).length / offered.length;
    expect(over30).toBeLessThan(0.15);
  });

  it('has a selective worker offer close to exactly what they want', () => {
    const { workers } = generatePreferencePackage(templateWeek(), roster(300), 'p1', CONFIG);
    const sel = workers.filter(
      (w) => w.submitted && !w.optedOut && w.persona.selectivity === 'selective',
    );
    const ratios = sel.map(
      (w) => w.entries.filter((e) => e.status === 'preferred').length / 2 / w.targetHours,
    );
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    expect(mean).toBeLessThan(1.25);
  });

  it('scales the ceiling with the cap rather than fixing it at 30h', () => {
    const { workers } = generatePreferencePackage(templateWeek(330, 1440), roster(200), 'summer', {
      seed: 'dev',
      capHours: 40,
    });
    const offered = workers
      .filter((w) => w.submitted && !w.optedOut)
      .map((w) => w.entries.filter((e) => e.status === 'preferred').length / 2);
    expect(Math.max(...offered)).toBeGreaterThan(35); // 30h would be the wrong ceiling here
    expect(Math.max(...offered)).toBeLessThanOrEqual(70); // 1.75 * 40
  });
});

describe('roster-level guarantees', () => {
  it('G1: every block reaches headcount except the unwanted-block budget', () => {
    const blocks = templateWeek(480, 1440, 2);
    const { workers, report } = generatePreferencePackage(blocks, roster(28), 'p1', CONFIG);
    const counts = new Map<string, number>();
    for (const w of workers.filter((x) => x.submitted && !x.optedOut)) {
      for (const id of preferredIds(w)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const uncovered = new Set(
      report.uncoveredBlocks.map((b) => `b-${String(b.weekday)}-${String(b.minuteOfDay)}`),
    );
    for (const b of blocks) {
      if (uncovered.has(b.blockId)) {
        expect(counts.get(b.blockId) ?? 0).toBe(0);
      } else {
        expect(counts.get(b.blockId) ?? 0).toBeGreaterThanOrEqual(2);
      }
    }
    expect(report.guarantees.find((g) => g.id === 'G1')!.passed).toBe(true);
  });

  it('leaves a few unwanted blocks rather than repairing every slot away', () => {
    const { report } = generatePreferencePackage(
      templateWeek(480, 1440, 2),
      roster(28),
      'p1',
      CONFIG,
    );
    expect(report.uncoveredHours).toBeGreaterThan(0);
    expect(report.uncoveredHours).toBeLessThanOrEqual(report.uncoveredBudgetHours);
  });

  it('spends the unwanted budget on the least-wanted blocks, not arbitrary ones', () => {
    // The rule is a ranking, not a guess about which hour loses: whatever stays uncovered
    // must be less wanted than the typical block. (In practice it lands on the opening
    // hour and the dinner-time seam, but that is an output, not the contract.)
    const blocks = templateWeek(480, 1440, 2);
    const { workers, report } = generatePreferencePackage(blocks, roster(28), 'p1', CONFIG);

    const demand = new Map<string, number>();
    for (const b of blocks) demand.set(b.blockId, 0);
    for (const w of workers.filter((x) => x.submitted && !x.optedOut)) {
      for (const id of preferredIds(w)) demand.set(id, (demand.get(id) ?? 0) + 1);
    }
    const sorted = [...demand.values()].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;

    expect(report.uncoveredBlocks.length).toBeGreaterThan(0);
    for (const b of report.uncoveredBlocks) {
      expect(demand.get(`b-${String(b.weekday)}-${String(b.minuteOfDay)}`)).toBeLessThan(median);
    }
  });

  it('never strands a peak slot: Saturday evening is always covered', () => {
    const { report } = generatePreferencePackage(
      templateWeek(480, 1440, 2),
      roster(28),
      'p1',
      CONFIG,
    );
    for (const b of report.uncoveredBlocks) {
      expect(b.weekday === 5 && b.minuteOfDay >= 1200).toBe(false);
    }
  });

  it('honours a zero budget by covering everything', () => {
    const { report } = generatePreferencePackage(templateWeek(480, 1440, 2), roster(28), 'p1', {
      ...CONFIG,
      uncoveredBudgetHours: 0,
    });
    expect(report.uncoveredBlocks).toHaveLength(0);
    expect(report.minPreferredPerBlock).toBeGreaterThanOrEqual(2);
  });

  it('G2: no block is `cannot` for the whole submitting roster', () => {
    const { report } = generatePreferencePackage(templateWeek(), roster(28), 'p1', CONFIG);
    expect(report.guarantees.find((g) => g.id === 'G2')!.passed).toBe(true);
  });

  it('G1 and G2 measure different things: an unwanted block is not a refused one', () => {
    // The intuition that they contradict each other assumes two states. There are three:
    // a block with zero `preferred` marks is still AVAILABLE to everyone who simply left
    // it unmarked, which is most of the roster.
    const blocks = templateWeek(480, 1440, 2);
    const { workers, report } = generatePreferencePackage(blocks, roster(28), 'p1', CONFIG);
    const active = workers.filter((w) => w.submitted && !w.optedOut);

    expect(report.uncoveredBlocks.length).toBeGreaterThan(0);
    for (const b of report.uncoveredBlocks) {
      const id = `b-${String(b.weekday)}-${String(b.minuteOfDay)}`;
      const prefers = active.filter((w) => preferredIds(w).has(id)).length;
      const refuses = active.filter((w) =>
        w.entries.some((e) => e.blockId === id && e.status === 'cannot'),
      ).length;
      expect(prefers).toBe(0); // nobody volunteered — that is what G1 permits
      expect(refuses).toBeLessThan(active.length); // but not everybody refused — G2 holds
      // and the remainder are assignable without overriding a stated refusal
      expect(active.length - prefers - refuses).toBeGreaterThan(0);
    }
  });

  it('does not report an all-opted-out roster as fully blocked', () => {
    // [].every() is vacuously true; without a guard every block reads as refused by all.
    const { report } = generatePreferencePackage(templateWeek(), roster(20), 'p1', {
      ...CONFIG,
      optOutRate: 1,
      nonSubmitterRate: 0,
    });
    const g2 = report.guarantees.find((g) => g.id === 'G2')!;
    expect(g2.passed).toBe(true);
    expect(g2.detail).not.toContain('224');
    // G1 is the guarantee that correctly reports this board as unusable.
    expect(report.guarantees.find((g) => g.id === 'G1')!.passed).toBe(false);
  });

  it('G3: reports every target inside the cap', () => {
    const { report } = generatePreferencePackage(templateWeek(), roster(28), 'p1', CONFIG);
    expect(report.guarantees.find((g) => g.id === 'G3')!.passed).toBe(true);
  });

  it('G4: reports an under-hired roster instead of inflating targets to hide it', () => {
    // Three workers cannot cover a 2-seat week. The generator must say so, not fake it.
    const blocks = templateWeek(480, 1440, 2);
    const { report, workers } = generatePreferencePackage(blocks, roster(3), 'p1', CONFIG);
    const g4 = report.guarantees.find((g) => g.id === 'G4')!;
    expect(g4.passed).toBe(false);
    for (const w of workers) expect(w.targetHours).toBeLessThanOrEqual(CONFIG.capHours);
  });

  it('reports the coverage repair count so a badly-configured season is visible', () => {
    const { report } = generatePreferencePackage(
      templateWeek(480, 1440, 2),
      roster(28),
      'p1',
      CONFIG,
    );
    expect(report.repairedBlocks).toBeGreaterThanOrEqual(0);
    expect(report.minPreferredPerBlock).toBeGreaterThanOrEqual(2);
  });
});

describe('season and house agnosticism', () => {
  it('handles a summer desk window that opens at 05:30', () => {
    const blocks = templateWeek(330, 1440, 2);
    const { report } = generatePreferencePackage(blocks, roster(28), 'summer', {
      seed: 'dev',
      capHours: 40,
    });
    expect(report.guarantees.find((g) => g.id === 'G1')!.passed).toBe(true);
    expect(report.blocks).toBe(blocks.length);
  });

  it('handles a short claim-based window too small for a 6h run', () => {
    // 10:00-14:00, four hours: no `long` run fits, so the ladder must fall back.
    const blocks = templateWeek(600, 840, 1);
    const { workers, report } = generatePreferencePackage(blocks, roster(12), 'break', CONFIG);
    expect(report.guarantees.find((g) => g.id === 'G1')!.passed).toBe(true);
    expect(workers.some((w) => w.entries.length > 0)).toBe(true);
  });

  it('survives a roster where everyone opted out', () => {
    const { report } = generatePreferencePackage(templateWeek(), roster(20), 'p1', {
      seed: 'dev',
      capHours: 20,
      optOutRate: 1,
      nonSubmitterRate: 0,
    });
    expect(report.optedOut).toBe(20);
    expect(report.guarantees.find((g) => g.id === 'G1')!.passed).toBe(false);
  });
});

describe('back-compat entry point', () => {
  it('returns the same worker rows as the package', () => {
    const blocks = templateWeek();
    expect(generateWorkerPreferences(blocks, roster(10), 'p1', CONFIG)).toEqual(
      generatePreferencePackage(blocks, roster(10), 'p1', CONFIG).workers,
    );
  });
});
