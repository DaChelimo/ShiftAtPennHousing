// Per-house break compiler tests (BSpec §4.4). Verifies the pure derivation:
// closed houses drop out, weekday/weekend hours can differ, float routing is the
// universal rule (open + headcount >= 2, Harnwell never a destination), the hours
// cap is break-type driven, and validation guards hold.

import { describe, expect, it } from 'vitest';

import { compileBreak, type BreakAuthoringInput } from '../../src/break-authoring/index.js';

const open = (start: string, end: string) => ({ open: true, start, end });
const closed = { open: false, start: '08:00', end: '00:00' };

function base(overrides: Partial<BreakAuthoringInput> = {}): BreakAuthoringInput {
  return {
    breakId: '11111111-1111-1111-1111-111111111111',
    breakName: 'Thanksgiving 2026',
    breakType: 'thanksgiving',
    slug: 'thanksgiving_2026',
    startDate: '2026-11-25',
    endDate: '2026-11-29',
    floatEnabled: true,
    houses: [
      {
        houseId: 'quad',
        headcount: 3,
        weekday: open('08:00', '00:00'),
        weekend: open('08:00', '00:00'),
      },
      {
        houseId: 'harnwell',
        headcount: 2,
        weekday: open('08:00', '00:00'),
        weekend: open('08:00', '00:00'),
      },
      { houseId: 'hill', headcount: 1, weekday: open('10:00', '22:00'), weekend: closed },
      { houseId: 'rodin', headcount: 1, weekday: closed, weekend: closed },
    ],
    ...overrides,
  };
}

describe('compileBreak — structure', () => {
  it('derives a claim-based per-break profile name from slug + start', () => {
    const c = compileBreak(base());
    expect(c.profileName).toBe('b_thanksgiving_2026_20261125');
    expect(c.schedulingMode).toBe('claim_based');
    expect(c.claimOpenOffset).toBe('-14 days');
    expect(c.claimCloseOffset).toBe('-1 days');
  });

  it('drops fully-closed houses; keeps day-type-specific closure', () => {
    const c = compileBreak(base());
    const ids = c.houses.map((h) => h.houseId).sort();
    expect(ids).toEqual(['harnwell', 'hill', 'quad']); // rodin (closed both) dropped
    const hill = c.houses.find((h) => h.houseId === 'hill')!;
    expect(hill.weekdayBands).toHaveLength(1);
    expect(hill.weekendBands).toHaveLength(0); // closed weekends
    expect(hill.weekdayBands[0]).toEqual({
      block_start: '10:00',
      block_end: '22:00',
      headcount: 1,
    });
  });

  it('computes the desk-hours envelope across open bands', () => {
    const c = compileBreak(base());
    expect(c.shiftStartBound).toBe('08:00');
    expect(c.shiftEndBound).toBe('00:00'); // 24:00 stored as 00:00
  });
});

describe('compileBreak — float routing (universal rule)', () => {
  it('routes only from open houses with headcount >= 2, never TO harnwell', () => {
    const c = compileBreak(base());
    const sources = new Set(c.floatRouting.map((r) => r.sourceHouseId));
    const dests = new Set(c.floatRouting.map((r) => r.destinationHouseId));
    expect(sources).toEqual(new Set(['quad', 'harnwell'])); // 3-staff + 2-staff
    expect(dests.has('harnwell')).toBe(false); // never a destination
    // quad (fullest) ranks ahead of harnwell.
    const quadRank = c.floatRouting.find((r) => r.sourceHouseId === 'quad')!.precedenceOrder;
    const harnRank = c.floatRouting.find((r) => r.sourceHouseId === 'harnwell')!.precedenceOrder;
    expect(quadRank).toBeLessThan(harnRank);
  });

  it('emits no routes when floating is disabled', () => {
    expect(compileBreak(base({ floatEnabled: false })).floatRouting).toEqual([]);
    expect(compileBreak(base({ floatEnabled: false })).escalationChain.map((s) => s.step)).toEqual([
      'broadcast',
      'hmod_notify_allied',
    ]);
  });
});

describe('compileBreak — hours cap by break type', () => {
  it('40h hard for standard breaks', () => {
    const c = compileBreak(base({ breakType: 'winter_break' }));
    expect(c.hoursCap).toBe(40);
    expect(c.capEnforcement).toBe('hard');
  });
  it('20h soft for spring_fling and other', () => {
    expect(compileBreak(base({ breakType: 'spring_fling' })).hoursCap).toBe(20);
    expect(compileBreak(base({ breakType: 'other' })).capEnforcement).toBe('soft');
  });
});

describe('compileBreak — validation', () => {
  it('rejects a bad slug', () => {
    expect(() => compileBreak(base({ slug: 'Bad Slug' }))).toThrow(/slug/);
  });
  it('rejects end before start', () => {
    expect(() => compileBreak(base({ startDate: '2026-11-29', endDate: '2026-11-25' }))).toThrow(
      /before start/,
    );
  });
  it('rejects off-grid hours', () => {
    expect(() =>
      compileBreak(
        base({
          houses: [
            { houseId: 'quad', headcount: 3, weekday: open('08:15', '00:00'), weekend: closed },
          ],
        }),
      ),
    ).toThrow(/30-minute/);
  });
  it('rejects headcount < 1 on an open day', () => {
    expect(() =>
      compileBreak(
        base({
          houses: [
            { houseId: 'quad', headcount: 0, weekday: open('08:00', '00:00'), weekend: closed },
          ],
        }),
      ),
    ).toThrow(/headcount/);
  });
  it('rejects a duplicate house', () => {
    expect(() =>
      compileBreak(
        base({
          houses: [
            { houseId: 'quad', headcount: 1, weekday: open('08:00', '00:00'), weekend: closed },
            { houseId: 'quad', headcount: 2, weekday: open('08:00', '00:00'), weekend: closed },
          ],
        }),
      ),
    ).toThrow(/more than once/);
  });
});
