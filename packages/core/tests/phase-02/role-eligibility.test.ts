// Phase 02 — Pure role-eligibility predicates
// Spec sources: BEHAVIORAL_SPECIFICATION §2, ARCHITECTURE §3.1
//
// These tests describe four pure functions that take a user object
// (no DB coupling) and return { eligible, reason }. They are TDD-first:
// written before the implementation in packages/core/src exists.
//
// Functions under test (to be implemented in packages/core/src/users/eligibility.ts):
//   isEligibleForFloatLookup(user)       → § BEHAVIORAL §2.3, §6.1; ARCHITECTURE §3.1
//   isEligibleForBroadcast(user)         → § BEHAVIORAL §2.3; ARCHITECTURE §3.1
//   isEligibleForClaimPool(user)         → § BEHAVIORAL §2.3 (HM may claim, BM may not)
//   isEligibleForSwapCounterparty(user)  → § BEHAVIORAL §8 (worker-to-worker only)
//
// Contract:
//   type Role = 'sw' | 'sm' | 'hm' | 'bm';
//   type RoleAssignment = { role: Role; scope_house_id: string | null };
//   type User = { user_id: string; is_active: boolean; roles: RoleAssignment[] };
//   type EligibilityResult = { eligible: boolean; reason: string };

import { describe, expect, it } from 'vitest';

import {
  isEligibleForBroadcast,
  isEligibleForClaimPool,
  isEligibleForFloatLookup,
  isEligibleForSwapCounterparty,
} from '../../src/users/eligibility.js';

// ----- helpers -----------------------------------------------------

type Role = 'sw' | 'sm' | 'hm' | 'bm';

function user(id: string, isActive: boolean, ...roles: Role[]) {
  return {
    user_id: id,
    is_active: isActive,
    roles: roles.map((r) => ({
      role: r,
      scope_house_id: r === 'sw' ? null : 'harnwell',
    })),
  };
}

const allPredicates = [
  { name: 'float-lookup', fn: isEligibleForFloatLookup },
  { name: 'broadcast', fn: isEligibleForBroadcast },
  { name: 'claim-pool', fn: isEligibleForClaimPool },
  { name: 'swap-counterparty', fn: isEligibleForSwapCounterparty },
];

// ----- is_active invariant -----------------------------------------
// ARCHITECTURE §3.1: every selection pipeline filters is_active=true.
// We test the four pure pipelines here; the other five (schedule-builder
// roster, HM-leave-replacement picker, HMOD-rotor population, cross-house
// feed visibility resolver, preference-submission reminder) are DB or UI
// queries deferred to later phases — listed in TEST_PLAN.md.

describe('is_active invariant — inactive users are excluded everywhere', () => {
  for (const { name, fn } of allPredicates) {
    it(`${name}: rejects an inactive SW`, () => {
      const result = fn(user('u1', false, 'sw'));
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/inactive|is_active/i);
    });

    it(`${name}: rejects an inactive SM`, () => {
      const result = fn(user('u2', false, 'sw', 'sm'));
      expect(result.eligible).toBe(false);
    });

    it(`${name}: rejects an inactive HM`, () => {
      const result = fn(user('u3', false, 'hm'));
      expect(result.eligible).toBe(false);
    });

    it(`${name}: rejects an inactive BM`, () => {
      const result = fn(user('u4', false, 'bm'));
      expect(result.eligible).toBe(false);
    });

    it(`${name}: rejects a user with no roles when inactive`, () => {
      expect(fn(user('u5', false)).eligible).toBe(false);
    });
  }
});

// ----- isEligibleForFloatLookup ------------------------------------
// BEHAVIORAL §2.3: "HMs are never automatically floated."
// BEHAVIORAL §2.3: BMs "cannot be floated."
// BEHAVIORAL §6.1, ARCHITECTURE §3.1: any user holding hm or bm role is
// excluded from the float lookup pool, regardless of their other roles.

describe('isEligibleForFloatLookup', () => {
  it('accepts a pure SW (active)', () => {
    expect(isEligibleForFloatLookup(user('u', true, 'sw'))).toEqual({
      eligible: true,
      reason: expect.any(String),
    });
  });

  it('accepts a pure SM (active)', () => {
    expect(isEligibleForFloatLookup(user('u', true, 'sw', 'sm')).eligible).toBe(true);
  });

  it('rejects an active HM', () => {
    const result = isEligibleForFloatLookup(user('u', true, 'hm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/hm/i);
  });

  it('rejects an active BM', () => {
    const result = isEligibleForFloatLookup(user('u', true, 'bm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bm/i);
  });

  it('rejects HM + SW union (HM exclusion dominates) — §3.1', () => {
    const result = isEligibleForFloatLookup(user('u', true, 'sw', 'hm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/hm/i);
  });

  it('rejects HM + SM union (HM exclusion dominates)', () => {
    expect(isEligibleForFloatLookup(user('u', true, 'sw', 'sm', 'hm')).eligible).toBe(false);
  });

  it('rejects BM + SW union (BM exclusion dominates)', () => {
    const result = isEligibleForFloatLookup(user('u', true, 'sw', 'bm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bm/i);
  });

  it('rejects a user with no roles (cannot be floated if not a worker)', () => {
    // AMBIGUOUS: spec does not explicitly say "no roles → ineligible", but
    // every worker pipeline requires at least one worker role. This is
    // the only defensible default. See TEST_PLAN.md.
    expect(isEligibleForFloatLookup(user('u', true)).eligible).toBe(false);
  });
});

// ----- isEligibleForBroadcast --------------------------------------
// ARCHITECTURE §3.1: broadcast subscription cannot be true for hm/bm.
// This predicate gates the *subscription* (and equivalently the broadcast
// recipient query), not the dispatch step's role filter.

describe('isEligibleForBroadcast', () => {
  it('accepts a pure SW', () => {
    expect(isEligibleForBroadcast(user('u', true, 'sw')).eligible).toBe(true);
  });

  it('accepts a pure SM', () => {
    expect(isEligibleForBroadcast(user('u', true, 'sw', 'sm')).eligible).toBe(true);
  });

  it('rejects an HM', () => {
    const result = isEligibleForBroadcast(user('u', true, 'hm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/hm/i);
  });

  it('rejects a BM', () => {
    const result = isEligibleForBroadcast(user('u', true, 'bm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bm/i);
  });

  it('rejects HM + SW union', () => {
    expect(isEligibleForBroadcast(user('u', true, 'sw', 'hm')).eligible).toBe(false);
  });

  it('rejects HM + SM union', () => {
    expect(isEligibleForBroadcast(user('u', true, 'sw', 'sm', 'hm')).eligible).toBe(false);
  });

  it('rejects BM + anything', () => {
    expect(isEligibleForBroadcast(user('u', true, 'sw', 'sm', 'bm')).eligible).toBe(false);
  });
});

// ----- isEligibleForClaimPool --------------------------------------
// BEHAVIORAL §2.3: HMs "may work scheduled shifts at their home desk and
// pick up open shifts (in-house or cross-house, per the standard
// eligibility matrix)." BMs "cannot claim open shifts."
// ARCHITECTURE §3.1: BM "excluded from preference submission,
// schedule-builder rosters, claim eligibility, and float lookup."

describe('isEligibleForClaimPool', () => {
  it('accepts a pure SW', () => {
    expect(isEligibleForClaimPool(user('u', true, 'sw')).eligible).toBe(true);
  });

  it('accepts a pure SM', () => {
    expect(isEligibleForClaimPool(user('u', true, 'sw', 'sm')).eligible).toBe(true);
  });

  it('accepts an HM (HMs may claim — §2.3)', () => {
    expect(isEligibleForClaimPool(user('u', true, 'hm')).eligible).toBe(true);
  });

  it('accepts HM + SW union', () => {
    expect(isEligibleForClaimPool(user('u', true, 'sw', 'hm')).eligible).toBe(true);
  });

  it('rejects a BM (admin-only — §2.3, §3.1)', () => {
    const result = isEligibleForClaimPool(user('u', true, 'bm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bm/i);
  });

  it('rejects BM + SW union (BM exclusion dominates — §3.1)', () => {
    // AMBIGUOUS: §3.1 says BM is "exclusive of worker roles for scheduling
    // purposes" — i.e. holding bm alongside sw still bars the user from
    // worker pipelines. Schema may forbid this combo entirely, in which
    // case this user object never materializes. We assert the predicate
    // is safe regardless. See TEST_PLAN.md.
    expect(isEligibleForClaimPool(user('u', true, 'sw', 'bm')).eligible).toBe(false);
  });

  it('rejects BM + HM union (admin-only)', () => {
    expect(isEligibleForClaimPool(user('u', true, 'hm', 'bm')).eligible).toBe(false);
  });
});

// ----- isEligibleForSwapCounterparty -------------------------------
// BEHAVIORAL §8: swaps are worker-to-worker. HMs may hold shifts and so
// may be swap counterparties; BMs hold no shifts and cannot.

describe('isEligibleForSwapCounterparty', () => {
  it('accepts a pure SW', () => {
    expect(isEligibleForSwapCounterparty(user('u', true, 'sw')).eligible).toBe(true);
  });

  it('accepts a pure SM', () => {
    expect(isEligibleForSwapCounterparty(user('u', true, 'sw', 'sm')).eligible).toBe(true);
  });

  it('rejects an HM (excluded from swap counterparty pool — same exclusion as float)', () => {
    // Resolved: HMs are excluded from swaps. BEH §8 does not list HMs
    // as eligible counterparties; the float-exclusion pattern extends here.
    const result = isEligibleForSwapCounterparty(user('u', true, 'hm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/hm/i);
  });

  it('rejects HM + SW union (HM exclusion dominates)', () => {
    expect(isEligibleForSwapCounterparty(user('u', true, 'sw', 'hm')).eligible).toBe(false);
  });

  it('rejects a BM (no shifts to swap)', () => {
    const result = isEligibleForSwapCounterparty(user('u', true, 'bm'));
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bm/i);
  });

  it('rejects BM + SW union', () => {
    expect(isEligibleForSwapCounterparty(user('u', true, 'sw', 'bm')).eligible).toBe(false);
  });
});

// ----- Union-of-roles semantics (§2.7) -----------------------------

describe('union-of-roles semantics — §2.7', () => {
  it('SM implies SW capabilities (SM-only user is eligible like a worker)', () => {
    // AMBIGUOUS: spec says "an SM is also implicitly an SW" — we assert
    // that an SM-only user (no explicit sw row) is still treated as a
    // worker. Implementation may require the sw role to be inserted
    // alongside sm at the data layer, in which case this test stays
    // green trivially. See TEST_PLAN.md.
    const u = {
      user_id: 'sm-only',
      is_active: true,
      roles: [{ role: 'sm' as const, scope_house_id: 'harnwell' }],
    };
    expect(isEligibleForFloatLookup(u).eligible).toBe(true);
    expect(isEligibleForClaimPool(u).eligible).toBe(true);
    expect(isEligibleForBroadcast(u).eligible).toBe(true);
  });

  it('explicit SW + SM produces identical eligibility to SM-only', () => {
    const swsm = user('a', true, 'sw', 'sm');
    const smOnly = {
      user_id: 'b',
      is_active: true,
      roles: [{ role: 'sm' as const, scope_house_id: 'harnwell' }],
    };
    for (const { fn } of allPredicates) {
      expect(fn(swsm).eligible).toBe(fn(smOnly).eligible);
    }
  });
});
