// Worker semester-preference painter — pure view-model tests.
//
// Spec: BEHAVIORAL_SPECIFICATION.md §4.2/§4.4 (preferences: preferred/available/
// cannot; weekly target hours; opt-out = "no hours"). Mirrors the mobile shared
// painter contract (apps/mobile/.../preferences/Preferences.kt) laid out for the
// laptop full-week grid.

import { describe, expect, it } from 'vitest';

import {
  blockWeekSlot,
  brushOf,
  buildInitialGrid,
  buildSubmitPayload,
  buildWeekLayout,
  clampTarget,
  dayHasPaint,
  dragBrushForStart,
  effectiveTarget,
  formatMinuteOfDay,
  paint,
  toggledBrushFor,
  type PrefBlock,
  type PrefGrid,
} from '../../src/preferences/index.js';

describe('brushOf / paint', () => {
  it('defaults unpainted blocks to available', () => {
    expect(brushOf({}, 'b1')).toBe('available');
  });

  it('sets and clears brushes, keeping the grid sparse', () => {
    let g: PrefGrid = {};
    g = paint(g, 'b1', 'preferred');
    expect(brushOf(g, 'b1')).toBe('preferred');
    g = paint(g, 'b1', 'cannot');
    expect(brushOf(g, 'b1')).toBe('cannot');
    // Painting available clears the entry entirely.
    g = paint(g, 'b1', 'available');
    expect(g).toEqual({});
  });

  it('paint returns a new object (immutability)', () => {
    const g: PrefGrid = {};
    const g2 = paint(g, 'b1', 'preferred');
    expect(g2).not.toBe(g);
    expect(g).toEqual({});
  });
});

describe('tap + drag semantics', () => {
  it('tapping the active brush erases; a different brush paints', () => {
    expect(toggledBrushFor('preferred', 'preferred')).toBe('available');
    expect(toggledBrushFor('available', 'preferred')).toBe('preferred');
    expect(toggledBrushFor('cannot', 'preferred')).toBe('preferred');
  });

  it('drag decides erase-vs-paint by the start block only', () => {
    // Sweep started on a block already holding the active brush => erase sweep.
    expect(dragBrushForStart('preferred', 'preferred')).toBe('available');
    // Started elsewhere => paint the active brush across the whole sweep.
    expect(dragBrushForStart('available', 'preferred')).toBe('preferred');
    expect(dragBrushForStart('cannot', 'preferred')).toBe('preferred');
  });
});

describe('buildInitialGrid', () => {
  it('keeps only preferred/cannot; available and none collapse to default', () => {
    const g = buildInitialGrid([
      { blockId: 'a', status: 'preferred' },
      { blockId: 'b', status: 'cannot' },
      { blockId: 'c', status: 'available' },
      { blockId: 'd', status: 'none' },
    ]);
    expect(g).toEqual({ a: 'preferred', b: 'cannot' });
  });
});

describe('blockWeekSlot (NY)', () => {
  it('maps Monday 8:00 AM ET to weekday 0, minute 480', () => {
    // 2026-01-05 is a Monday. 08:00 ET = 13:00 UTC (EST, UTC-5).
    const { weekday, minuteOfDay } = blockWeekSlot(new Date('2026-01-05T13:00:00Z'));
    expect(weekday).toBe(0);
    expect(minuteOfDay).toBe(480);
  });

  it('maps Sunday 11:30 PM ET to weekday 6', () => {
    // 2026-01-11 is a Sunday. 23:30 ET = 2026-01-12T04:30Z.
    const { weekday, minuteOfDay } = blockWeekSlot(new Date('2026-01-12T04:30:00Z'));
    expect(weekday).toBe(6);
    expect(minuteOfDay).toBe(23 * 60 + 30);
  });
});

describe('formatMinuteOfDay', () => {
  it('formats 12-hour NY clock labels', () => {
    expect(formatMinuteOfDay(0)).toBe('12:00 AM');
    expect(formatMinuteOfDay(480)).toBe('8:00 AM');
    expect(formatMinuteOfDay(750)).toBe('12:30 PM');
    expect(formatMinuteOfDay(13 * 60 + 30)).toBe('1:30 PM');
  });
});

describe('buildWeekLayout', () => {
  const blocks: PrefBlock[] = [
    { blockId: 'mon8', weekday: 0, minuteOfDay: 480 },
    { blockId: 'wed8', weekday: 2, minuteOfDay: 480 },
    { blockId: 'mon9', weekday: 0, minuteOfDay: 540 },
  ];

  it('produces ascending time rows x 7 day columns with holes as null', () => {
    const layout = buildWeekLayout(blocks);
    expect(layout.dayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(layout.rows.map((r) => r.minuteOfDay)).toEqual([480, 540]);

    const row480 = layout.rows[0];
    expect(row480.label).toBe('8:00 AM');
    expect(row480.cells[0]).toBe('mon8'); // Monday
    expect(row480.cells[1]).toBeNull(); // Tuesday — no shift
    expect(row480.cells[2]).toBe('wed8'); // Wednesday

    const row540 = layout.rows[1];
    expect(row540.cells[0]).toBe('mon9');
    expect(row540.cells[2]).toBeNull();
  });

  it('dayHasPaint reflects only non-available paint in that column', () => {
    const grid: PrefGrid = { mon8: 'preferred' };
    expect(dayHasPaint(blocks, grid, 0)).toBe(true); // Monday painted
    expect(dayHasPaint(blocks, grid, 2)).toBe(false); // Wednesday untouched
  });
});

describe('target math', () => {
  it('clamps to [0, cap] and rounds', () => {
    expect(clampTarget(-4, 20)).toBe(0);
    expect(clampTarget(999, 20)).toBe(20);
    expect(clampTarget(11.6, 20)).toBe(12);
  });

  it('opt-out forces the effective target to 0', () => {
    expect(effectiveTarget(18, false)).toBe(18);
    expect(effectiveTarget(18, true)).toBe(0);
  });
});

describe('buildSubmitPayload', () => {
  it('emits an explicit status for every block (unpainted => available)', () => {
    const blocks: PrefBlock[] = [
      { blockId: 'a', weekday: 0, minuteOfDay: 480 },
      { blockId: 'b', weekday: 0, minuteOfDay: 510 },
      { blockId: 'c', weekday: 1, minuteOfDay: 480 },
    ];
    const grid: PrefGrid = { a: 'preferred', c: 'cannot' };
    expect(buildSubmitPayload(blocks, grid)).toEqual([
      { block_id: 'a', status: 'preferred' },
      { block_id: 'b', status: 'available' },
      { block_id: 'c', status: 'cannot' },
    ]);
  });
});
