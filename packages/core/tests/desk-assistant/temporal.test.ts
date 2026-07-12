// Desk Assistant — temporal validity windows (INTAKE_PLAN section 4a).

import { describe, expect, it } from 'vitest';

import {
  DURABLE_WINDOW,
  isExpired,
  isInEffect,
  validateWindow,
  type EffectiveWindow,
} from '../../src/desk-assistant/index.js';

const expires = (from: string | null, until: string | null): EffectiveWindow => ({
  temporality: 'expires',
  effectiveFrom: from,
  effectiveUntil: until,
});

describe('isInEffect', () => {
  it('durable items are always in effect', () => {
    expect(isInEffect(DURABLE_WINDOW, '2026-01-01')).toBe(true);
    expect(isInEffect(DURABLE_WINDOW, '2030-12-31T09:00:00-05:00')).toBe(true);
  });

  it('gates on both bounds inclusively', () => {
    const w = expires('2026-07-10', '2026-07-17');
    expect(isInEffect(w, '2026-07-09')).toBe(false);
    expect(isInEffect(w, '2026-07-10')).toBe(true);
    expect(isInEffect(w, '2026-07-17')).toBe(true);
    expect(isInEffect(w, '2026-07-18')).toBe(false);
  });

  it('accepts a full timestamp and compares on the date part only', () => {
    const w = expires('2026-06-19', '2026-06-19');
    expect(isInEffect(w, '2026-06-19T23:30:00-04:00')).toBe(true);
  });

  it('the Celine case: a backup-BA note in effect that Tuesday, gone two weeks later', () => {
    const tuesday = expires('2026-07-14', '2026-07-14');
    expect(isInEffect(tuesday, '2026-07-14')).toBe(true);
    expect(isInEffect(tuesday, '2026-07-28')).toBe(false);
  });
});

describe('isExpired / validateWindow', () => {
  it('reports expiry past the end bound', () => {
    expect(isExpired(expires('2026-07-10', '2026-07-17'), '2026-07-18')).toBe(true);
    expect(isExpired(DURABLE_WINDOW, '2999-01-01')).toBe(false);
  });

  it('rejects an out-of-order or unbounded expires window', () => {
    expect(validateWindow(expires('2026-07-17', '2026-07-10'))).toContain(
      'effectiveUntil before effectiveFrom',
    );
    expect(validateWindow(expires('2026-07-10', null))).toContain(
      'expires window needs an effectiveUntil',
    );
  });

  it('rejects a durable window that carries bounds', () => {
    expect(
      validateWindow({ temporality: 'durable', effectiveFrom: '2026-07-10', effectiveUntil: null }),
    ).toContain('durable window must have no bounds');
  });

  it('accepts a clean durable and a clean expires window', () => {
    expect(validateWindow(DURABLE_WINDOW)).toEqual([]);
    expect(validateWindow(expires('2026-07-10', '2026-07-17'))).toEqual([]);
  });
});
