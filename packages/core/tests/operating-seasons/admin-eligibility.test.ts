// Admin role — eligibility exclusions (BSpec §2.7; docs/operating-seasons/PLAN.md P1).
//
// The top-level administrator is a house-agnostic superuser and is NEVER a desk
// worker: excluded from float lookup, broadcast, the claim pool, swap counterparties,
// and the schedule roster — exactly like BM. These are pure predicate tests.

import { describe, expect, it } from 'vitest';

import {
  isEligibleForBroadcast,
  isEligibleForClaimPool,
  isEligibleForFloatLookup,
  isEligibleForScheduleRoster,
  isEligibleForSwapCounterparty,
  type UserEligibilityProfile,
} from '../../src/eligibility/index.js';

function admin(...extraRoles: Array<'sw' | 'sm' | 'hm' | 'rsm' | 'bm' | 'admin'>): UserEligibilityProfile {
  return {
    userId: 'ada',
    homeHouseId: 'quad',
    isActive: true,
    broadcastSubscribed: false,
    roles: [{ role: 'admin', scopeHouseId: null }, ...extraRoles.map((r) => ({ role: r, scopeHouseId: null }))],
  };
}

const pipelines = [
  { name: 'float-lookup', fn: isEligibleForFloatLookup },
  { name: 'broadcast', fn: isEligibleForBroadcast },
  { name: 'claim-pool', fn: isEligibleForClaimPool },
  { name: 'swap-counterparty', fn: isEligibleForSwapCounterparty },
  { name: 'schedule-roster', fn: isEligibleForScheduleRoster },
];

describe('admin is excluded from every worker pipeline', () => {
  for (const { name, fn } of pipelines) {
    it(`${name}: rejects a pure admin`, () => {
      const result = fn(admin());
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/admin_excluded/);
    });

    it(`${name}: an admin who also holds a worker role is still excluded`, () => {
      // Defense in depth: even if a stray sw grant coexists, admin wins.
      const result = fn(admin('sw'));
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/admin_excluded/);
    });
  }
});
