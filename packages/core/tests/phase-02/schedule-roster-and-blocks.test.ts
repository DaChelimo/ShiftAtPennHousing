// G1 coverage: isEligibleForScheduleRoster (eligibility/index.ts) and
// blocksBetween (time/index.ts) — previously untested.

import { describe, expect, it } from 'vitest';

import { isEligibleForScheduleRoster } from '../../src/eligibility/index.js';
import { blocksBetween } from '../../src/time/index.js';

const BLOCK_MINUTES = 30;

type Role = 'sw' | 'sm' | 'hm' | 'bm';

function user(id: string, isActive: boolean, ...roles: Role[]) {
  return {
    user_id: id,
    is_active: isActive,
    roles: roles.map((r) => ({ role: r, scope_house_id: r === 'sw' ? null : 'harnwell' })),
  };
}

describe('isEligibleForScheduleRoster', () => {
  it('admits an active SW', () => {
    expect(isEligibleForScheduleRoster(user('a', true, 'sw')).eligible).toBe(true);
  });

  it('admits an active SM and HM (HM can do everything an SM can)', () => {
    expect(isEligibleForScheduleRoster(user('a', true, 'sm')).eligible).toBe(true);
    expect(isEligibleForScheduleRoster(user('a', true, 'hm')).eligible).toBe(true);
  });

  it('excludes a BM with the roster-specific reason', () => {
    const result = isEligibleForScheduleRoster(user('a', true, 'bm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bm/i);
  });

  it('excludes an inactive worker', () => {
    expect(isEligibleForScheduleRoster(user('a', false, 'sw')).eligible).toBe(false);
  });

  it('excludes a user with no worker role', () => {
    const result = isEligibleForScheduleRoster(user('a', true));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/worker_role/);
  });
});

describe('blocksBetween', () => {
  const base = new Date('2026-02-02T10:00:00-05:00');
  const plus = (mins: number) => new Date(base.getTime() + mins * 60 * 1000);

  it('counts one block per 30 minutes', () => {
    expect(blocksBetween(base, plus(BLOCK_MINUTES))).toBe(1);
    expect(blocksBetween(base, plus(2 * 60))).toBe(4);
    expect(blocksBetween(base, plus(8 * 60))).toBe(16);
  });

  it('is zero for equal endpoints', () => {
    expect(blocksBetween(base, base)).toBe(0);
  });

  it('is negative when end precedes start', () => {
    expect(blocksBetween(plus(BLOCK_MINUTES), base)).toBe(-1);
  });
});
