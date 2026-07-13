// Desk Assistant Phase E — escalation routing engine (V1_SCOPE §4.2, §10.1).
// Injected everything (no clock, no DB); exercises the PLACEHOLDER ladder semantics.

import { describe, expect, it } from 'vitest';

import {
  resolveRoute,
  TIER_LADDER,
  type DutySnapshot,
  type RouteContext,
  type RoutingRule,
} from '../../src/desk-assistant/index.js';

let seq = 0;
function rule(over: Partial<RoutingRule> = {}): RoutingRule {
  seq += 1;
  return {
    ruleId: over.ruleId ?? `r${seq}`,
    issueType: 'access',
    tier: 'csmod',
    dayType: 'any',
    windowStart: null,
    windowEnd: null,
    seasonScope: 'any',
    priority: 10,
    active: true,
    ...over,
  };
}

function ctx(over: Partial<RouteContext> = {}): RouteContext {
  return {
    issueType: 'access',
    dayType: 'weekday',
    timeHHMM: '14:00',
    season: 'academic',
    ...over,
  };
}

const full: DutySnapshot = {
  deskSm: 'desk-sm',
  csmod: 'csmod-1',
  rsm: 'rsm-1',
  hmod: 'hmod-1',
  ba: 'ba-1',
  projectAdmin: 'admin-1',
};

describe('rule matching', () => {
  it('routes a matching issue to its tier and resolves the person', () => {
    const d = resolveRoute(ctx(), [rule({ tier: 'csmod' })], full);
    expect(d.matchedTier).toBe('csmod');
    expect(d.resolvedTier).toBe('csmod');
    expect(d.userId).toBe('csmod-1');
  });

  it('defaults to HMOD when no rule matches', () => {
    const d = resolveRoute(ctx({ issueType: 'unknown' }), [rule({ issueType: 'access' })], full);
    expect(d.ruleId).toBeNull();
    expect(d.matchedTier).toBe('hmod');
    expect(d.userId).toBe('hmod-1');
  });

  it('filters by season scope', () => {
    const summerOnly = rule({ tier: 'rsm', seasonScope: 'summer' });
    expect(resolveRoute(ctx({ season: 'summer' }), [summerOnly], full).matchedTier).toBe('rsm');
    // In academic season the summer-only rule does not match -> default HMOD.
    expect(resolveRoute(ctx({ season: 'academic' }), [summerOnly], full).matchedTier).toBe('hmod');
  });

  it('filters by day type', () => {
    const weekendOnly = rule({ tier: 'rsm', dayType: 'weekend' });
    expect(resolveRoute(ctx({ dayType: 'weekend' }), [weekendOnly], full).matchedTier).toBe('rsm');
    expect(resolveRoute(ctx({ dayType: 'weekday' }), [weekendOnly], full).matchedTier).toBe('hmod');
  });

  it('respects a time window', () => {
    const daytime = rule({ tier: 'csmod', windowStart: '09:00', windowEnd: '17:00' });
    expect(resolveRoute(ctx({ timeHHMM: '10:00' }), [daytime], full).matchedTier).toBe('csmod');
    expect(resolveRoute(ctx({ timeHHMM: '18:00' }), [daytime], full).matchedTier).toBe('hmod');
  });

  it('handles an overnight window that wraps midnight', () => {
    const overnight = rule({ tier: 'hmod', windowStart: '22:00', windowEnd: '06:00' });
    expect(
      resolveRoute(ctx({ issueType: 'access', timeHHMM: '23:30' }), [overnight], full).ruleId,
    ).not.toBeNull();
    expect(
      resolveRoute(ctx({ issueType: 'access', timeHHMM: '02:00' }), [overnight], full).ruleId,
    ).not.toBeNull();
    expect(
      resolveRoute(ctx({ issueType: 'access', timeHHMM: '12:00' }), [overnight], full).ruleId,
    ).toBeNull();
  });

  it('ignores inactive rules', () => {
    expect(resolveRoute(ctx(), [rule({ tier: 'csmod', active: false })], full).matchedTier).toBe(
      'hmod',
    );
  });
});

describe('priority', () => {
  it('lowest priority wins among matches', () => {
    const rules = [
      rule({ ruleId: 'a', tier: 'hmod', priority: 20 }),
      rule({ ruleId: 'b', tier: 'csmod', priority: 5 }),
    ];
    const d = resolveRoute(ctx(), rules, full);
    expect(d.ruleId).toBe('b');
    expect(d.matchedTier).toBe('csmod');
  });

  it('breaks priority ties deterministically by ruleId', () => {
    const rules = [
      rule({ ruleId: 'z', tier: 'rsm', priority: 10 }),
      rule({ ruleId: 'a', tier: 'csmod', priority: 10 }),
    ];
    expect(resolveRoute(ctx(), rules, full).ruleId).toBe('a');
  });
});

describe('tier fallback (leave / unfilled slots)', () => {
  it('walks up to the next filled slot when the matched tier is empty', () => {
    const snap: DutySnapshot = { ...full, csmod: null };
    const d = resolveRoute(ctx(), [rule({ tier: 'csmod' })], snap);
    expect(d.matchedTier).toBe('csmod');
    expect(d.resolvedTier).toBe('rsm');
    expect(d.userId).toBe('rsm-1');
    expect(d.fallbackChain).toEqual(['csmod', 'rsm']);
  });

  it('walks up to the Building Administrator when RSM and HMOD are on leave', () => {
    // The canonical scenario: this week the RSM and HM are away, so the person in
    // charge is the BA (Celine). rsm + hmod resolve null; the walk-up lands on ba.
    const snap: DutySnapshot = {
      deskSm: null,
      csmod: null,
      rsm: null,
      hmod: null,
      ba: 'celine',
      projectAdmin: 'admin-1',
    };
    const d = resolveRoute(ctx(), [rule({ tier: 'rsm' })], snap);
    expect(d.resolvedTier).toBe('ba');
    expect(d.userId).toBe('celine');
    expect(d.fallbackChain).toEqual(['rsm', 'hmod', 'ba']);
  });

  it('falls all the way to the terminal project administrator', () => {
    const snap: DutySnapshot = {
      deskSm: null,
      csmod: null,
      rsm: null,
      hmod: null,
      ba: null,
      projectAdmin: 'admin-1',
    };
    const d = resolveRoute(ctx(), [rule({ tier: 'csmod' })], snap);
    expect(d.resolvedTier).toBe('project_admin');
    expect(d.userId).toBe('admin-1');
    expect(d.fallbackChain).toEqual(['csmod', 'rsm', 'hmod', 'ba', 'project_admin']);
  });

  it('returns userId null when nothing is filled (EF logs a warning)', () => {
    const empty: DutySnapshot = {
      deskSm: null,
      csmod: null,
      rsm: null,
      hmod: null,
      ba: null,
      projectAdmin: null,
    };
    const d = resolveRoute(ctx(), [rule({ tier: 'hmod' })], empty);
    expect(d.userId).toBeNull();
    expect(d.resolvedTier).toBe('project_admin');
  });

  it('TIER_LADDER is the escalation order terminating at project_admin', () => {
    expect(TIER_LADDER[TIER_LADDER.length - 1]).toBe('project_admin');
  });
});
