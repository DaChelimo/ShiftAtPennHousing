// Desk Assistant Phase E — pin the Deno routing mirror to core routing.ts.
// The pure engine is duplicated for the EF (Deno cannot import the workspace); this
// asserts identical decisions across a battery so the two cannot drift.

import { describe, expect, it } from 'vitest';

import * as mirror from '../../../../supabase/functions/_shared/desk-assistant-routing.ts';
import * as core from '../../src/desk-assistant/index.js';

const rules: core.RoutingRule[] = [
  {
    ruleId: 'a',
    issueType: 'access',
    tier: 'csmod',
    dayType: 'any',
    windowStart: null,
    windowEnd: null,
    seasonScope: 'any',
    priority: 10,
    active: true,
  },
  {
    ruleId: 'b',
    issueType: 'equipment',
    tier: 'rsm',
    dayType: 'any',
    windowStart: null,
    windowEnd: null,
    seasonScope: 'any',
    priority: 10,
    active: true,
  },
  {
    ruleId: 'c',
    issueType: 'access',
    tier: 'hmod',
    dayType: 'weekend',
    windowStart: null,
    windowEnd: null,
    seasonScope: 'any',
    priority: 5,
    active: true,
  },
  {
    ruleId: 'd',
    issueType: 'facilities',
    tier: 'hmod',
    dayType: 'any',
    windowStart: '22:00',
    windowEnd: '06:00',
    seasonScope: 'summer',
    priority: 10,
    active: true,
  },
];

const snapshots: core.DutySnapshot[] = [
  { deskSm: 'ds', csmod: 'cs', rsm: 'r', hmod: 'h', ba: 'b', projectAdmin: 'pa' },
  { deskSm: null, csmod: null, rsm: 'r', hmod: 'h', ba: 'b', projectAdmin: 'pa' },
  { deskSm: null, csmod: null, rsm: null, hmod: null, ba: 'b', projectAdmin: 'pa' },
  { deskSm: null, csmod: null, rsm: null, hmod: null, ba: null, projectAdmin: null },
];

const contexts: core.RouteContext[] = [
  { issueType: 'access', dayType: 'weekday', timeHHMM: '14:00', season: 'academic' },
  { issueType: 'access', dayType: 'weekend', timeHHMM: '14:00', season: 'academic' },
  { issueType: 'equipment', dayType: 'weekday', timeHHMM: '09:00', season: 'summer' },
  { issueType: 'facilities', dayType: 'weekday', timeHHMM: '23:30', season: 'summer' },
  { issueType: 'facilities', dayType: 'weekday', timeHHMM: '12:00', season: 'summer' },
  { issueType: 'unknown', dayType: 'weekday', timeHHMM: '03:00', season: 'academic' },
];

describe('routing mirror parity', () => {
  it('TIER_LADDER matches', () => {
    expect(mirror.TIER_LADDER).toEqual(core.TIER_LADDER);
  });

  it('resolveRoute agrees across the battery', () => {
    for (const ctx of contexts) {
      for (const snap of snapshots) {
        expect(mirror.resolveRoute(ctx, rules, snap)).toEqual(core.resolveRoute(ctx, rules, snap));
      }
    }
  });
});
