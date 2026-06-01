// Phase 14 — Admin Extras: hours-cap modification (the pure decision surface).
//
// Spec sources:
//   BEHAVIORAL_SPECIFICATION.md
//     §9.3 (manual cap modification — HM/BM of ANY house, global across all 13
//          houses, set 20-soft or 40-hard, instant/no-approval; SMs cannot;
//          the default-cap-for-a-week rules; the effect of a cap reduction on
//          existing state — no retroactive unassignment, pending floats honored,
//          new claims/swaps/pickups respect the new cap),
//     §3.2 (operating-rules profiles — the per-profile cap defaults that the
//          §9.3 week-default rules are derived from),
//     §5.3 (claiming over the cap — soft warns, hard blocks),
//     §9.2 (the calendar week is Monday→Sunday, resolved independently);
//   ARCHITECTURE.md §3.10 (system_config — modified_by/modified_at/notes audit
//          columns; writes affect only NEW records, in-flight state keeps its
//          snapshot);
//   AGENTS.md hard invariant #4 (the hours cap is NOT checked on float —
//          float-out seats are hours-neutral, so a cap change cannot void them).
//
// Functions under test (TDD — NOT yet implemented; see tests/PHASE_14/TEST_PLAN.md
// for the full pinned contract):
//
//   packages/core/src/cap-modification/index.ts
//     export function canModifyCap(role): CapModificationAuthResult
//     export function resolveDefaultCap(dayProfiles): CapSetting
//     export function resolveEffectiveCap(input): CapSetting
//     export function assessCapChangeEffect(input): CapChangeEffect
//
// All four are PURE FUNCTIONS — zero Supabase imports, deterministic for a given
// input. The cap-modifier Edge Function / RPC snapshots DB state (the week's
// profile days, the existing assignments + pending floats), calls these to (a)
// authorize the actor, (b) resolve the week's effective cap, and (c) classify the
// reduction's effect, then writes the `weekly_cap_overrides` row with the audit
// trail. The DB-layer write + RLS gate is exercised separately in
// supabase/tests/phase-14-cap-modification.sql (pgTAP).
//
// Re-exporting the contract types from `../../src/cap-modification/types.js`
// (rather than redefining them here) guarantees that any drift between the
// implementation and the tests surfaces as a TypeScript error — the same
// discipline the phase-06..11 fixtures use. The module does not exist yet, so
// this suite is RED at import resolution until it lands. See TEST_PLAN §"Why
// TDD-Red".

import { describe, expect, it } from 'vitest';

import {
  assessCapChangeEffect,
  canModifyCap,
  resolveDefaultCap,
  resolveEffectiveCap,
} from '../../src/cap-modification/index.js';
import type {
  AdminRole,
  CapChangeEffectInput,
  CapSetting,
  DayProfile,
} from '../../src/cap-modification/types.js';
// `checkClaimAgainstCap` is the existing, already-green cap primitive
// (packages/core/src/scheduling/hours.ts). §9.3 says "new claims, swap acceptances,
// and new float assignments are blocked if they would push a worker over the new
// cap" — i.e. a post-change claim runs through THIS primitive with the RESOLVED
// effective cap. We assert that composition so the contract is explicit: cap
// modification only changes which CapSetting the claim path consumes, not the
// claim path itself.
import { checkClaimAgainstCap } from '../../src/scheduling/hours.js';

// ---------------------------------------------------------------------------
// Canonical settings.
// ---------------------------------------------------------------------------

const SOFT_20: CapSetting = { hoursCap: 20, capEnforcement: 'soft' };
const HARD_40: CapSetting = { hoursCap: 40, capEnforcement: 'hard' };

function makeChangeInput(opts: Partial<CapChangeEffectInput> = {}): CapChangeEffectInput {
  return {
    previousCap: opts.previousCap ?? HARD_40,
    newCap: opts.newCap ?? SOFT_20,
    existingWorkers: opts.existingWorkers ?? [],
    pendingFloats: opts.pendingFloats ?? [],
  };
}

// ===========================================================================
// Authorization (§9.3): "An HM or BM (of any house) may modify the cap ...
// SMs cannot modify the cap; the authority is restricted to HMs and BMs."
// ===========================================================================

describe('cap-modification authorization (§9.3)', () => {
  it('an HM may modify the cap', () => {
    expect(canModifyCap('hm')).toEqual({ authorized: true });
  });

  it('a BM may modify the cap', () => {
    expect(canModifyCap('bm')).toEqual({ authorized: true });
  });

  it('an SM may NOT modify the cap — the authority is HM/BM only', () => {
    expect(canModifyCap('sm')).toEqual({
      authorized: false,
      reason: 'role_not_permitted',
    });
  });

  it('a worker (SW) may NOT modify the cap', () => {
    expect(canModifyCap('sw')).toEqual({
      authorized: false,
      reason: 'role_not_permitted',
    });
  });

  it('authorization is by ROLE alone — an HM/BM of ANY house qualifies (no house scoping)', () => {
    // The function takes no house argument: §9.3 makes the authority campus-wide,
    // not scoped to the actor's home house. Every HM and BM is authorized; only
    // the worker roles are not.
    const roles: AdminRole[] = ['sw', 'sm', 'hm', 'bm'];
    const authorized = roles.filter((r) => canModifyCap(r).authorized);
    expect(authorized).toEqual(['hm', 'bm']);
  });
});

// ===========================================================================
// Default cap for a week (§9.3 "Default rules for setting the cap of a week"),
// derived from the §3.2 per-profile defaults. The week-default is the safe-side
// resolution across the week's days BEFORE any manual override.
// ===========================================================================

describe('default cap for a week (§9.3 default rules)', () => {
  it('every day regular school year → 20 hours (soft, overridable)', () => {
    const week: DayProfile[] = Array(7).fill('regular_school_year');
    expect(resolveDefaultCap(week)).toEqual(SOFT_20);
  });

  it('every day winter break → 40 hours (hard, not overridable)', () => {
    const week: DayProfile[] = Array(7).fill('winter_break');
    expect(resolveDefaultCap(week)).toEqual(HARD_40);
  });

  it('a week containing a Thanksgiving / fall-break / spring-break day → 40 hours (hard)', () => {
    expect(
      resolveDefaultCap([
        'regular_school_year',
        'regular_school_year',
        'thanksgiving',
        'thanksgiving',
        'thanksgiving',
        'thanksgiving',
        'regular_school_year',
      ]),
    ).toEqual(HARD_40);
    expect(resolveDefaultCap(['fall_break', ...Array(6).fill('regular_school_year')])).toEqual(
      HARD_40,
    );
    expect(resolveDefaultCap(['spring_break', ...Array(6).fill('regular_school_year')])).toEqual(
      HARD_40,
    );
  });

  it('a week containing spring fling but no other break → 20 hours (soft)', () => {
    expect(
      resolveDefaultCap([
        'regular_school_year',
        'regular_school_year',
        'spring_fling',
        'spring_fling',
        'regular_school_year',
        'regular_school_year',
        'regular_school_year',
      ]),
    ).toEqual(SOFT_20);
  });

  it('a week straddling regular school year and a 40-hour break → 40 hours (safe side)', () => {
    // Mixed week: 40-hour break days win over regular-school-year days.
    expect(
      resolveDefaultCap([
        'regular_school_year',
        'regular_school_year',
        'regular_school_year',
        'spring_break',
        'spring_break',
        'spring_break',
        'spring_break',
      ]),
    ).toEqual(HARD_40);
  });

  it('a 40-hour break beats a co-occurring spring fling in the same week (safe side)', () => {
    // Spring fling alone is soft-20, but any 40-hour break day in the week wins.
    expect(
      resolveDefaultCap([
        'spring_fling',
        'spring_fling',
        'spring_break',
        'regular_school_year',
        'regular_school_year',
        'regular_school_year',
        'regular_school_year',
      ]),
    ).toEqual(HARD_40);
  });
});

// ===========================================================================
// Effective cap = manual override (if any) over the week default. A manual
// override is GLOBAL: §9.3 "it applies to all 13 houses simultaneously". The
// resolver takes NO house argument — that is the encoding of "global".
// ===========================================================================

describe('effective cap resolution (§9.3 — manual override is global)', () => {
  it('with no override, the effective cap is the week default', () => {
    expect(resolveEffectiveCap({ default: SOFT_20, override: null })).toEqual(SOFT_20);
  });

  it('a manual override REPLACES the default — HM sets a soft-20 week to hard-40', () => {
    expect(resolveEffectiveCap({ default: SOFT_20, override: HARD_40 })).toEqual(HARD_40);
  });

  it('an override may also relax a default-40 week down to soft-20 (overridable)', () => {
    expect(resolveEffectiveCap({ default: HARD_40, override: SOFT_20 })).toEqual(SOFT_20);
  });

  it('the resolver is house-agnostic — one override resolves identically for every house', () => {
    // §9.3: the modification applies to all 13 houses simultaneously. There is no
    // per-house parameter, so the SAME (default, override) pair yields the SAME
    // cap no matter which house consumes it. We assert idempotence/stability:
    const a = resolveEffectiveCap({ default: SOFT_20, override: HARD_40 });
    const b = resolveEffectiveCap({ default: SOFT_20, override: HARD_40 });
    expect(a).toEqual(b);
    expect(a).toEqual(HARD_40);
  });

  it('the only legal cap values are 20 and 40', () => {
    expect([20, 40]).toContain(resolveEffectiveCap({ default: SOFT_20, override: null }).hoursCap);
    expect([20, 40]).toContain(resolveEffectiveCap({ default: HARD_40, override: null }).hoursCap);
  });
});

// ===========================================================================
// Effect of a cap REDUCTION on existing state (§9.3 "Effect of a cap reduction
// on existing state"). This is the load-bearing invariant: a lowered cap is
// NEVER retroactive.
// ===========================================================================

describe('effect of a cap reduction on existing state (§9.3)', () => {
  it('workers already over the new cap are NOT retroactively unassigned', () => {
    const effect = assessCapChangeEffect(
      makeChangeInput({
        previousCap: HARD_40,
        newCap: SOFT_20,
        existingWorkers: [
          { workerId: 'w-over', scheduledHours: 30 }, // over the new 20 cap
          { workerId: 'w-under', scheduledHours: 12 },
        ],
      }),
    );

    // The over-cap worker is identified (for UI/reporting) but never unassigned.
    expect(effect.overCapWorkers).toEqual(['w-over']);
    expect(effect.unassignedWorkers).toEqual([]);
  });

  it('a worker exactly AT the new cap is not flagged as over', () => {
    const effect = assessCapChangeEffect(
      makeChangeInput({
        existingWorkers: [{ workerId: 'w-at', scheduledHours: 20 }],
      }),
    );
    expect(effect.overCapWorkers).toEqual([]);
    expect(effect.unassignedWorkers).toEqual([]);
  });

  it('pending float assignments for over-cap workers survive — honored, never voided', () => {
    const effect = assessCapChangeEffect(
      makeChangeInput({
        previousCap: HARD_40,
        newCap: SOFT_20,
        existingWorkers: [{ workerId: 'w-over', scheduledHours: 38 }],
        pendingFloats: [{ floatId: 'f-pending', workerId: 'w-over', status: 'pending' }],
      }),
    );
    expect(effect.honoredFloats).toEqual(['f-pending']);
    expect(effect.voidedFloats).toEqual([]);
  });

  it('acknowledged floats for over-cap workers also survive (no-takeback + hours-neutral float)', () => {
    // AGENTS invariant #4: floats relocate already-scheduled hours, so they are
    // hours-neutral and a cap change cannot make them "over cap" to begin with.
    const effect = assessCapChangeEffect(
      makeChangeInput({
        pendingFloats: [
          { floatId: 'f-ack', workerId: 'w-over', status: 'acknowledged' },
          { floatId: 'f-pending', workerId: 'w-over', status: 'pending' },
        ],
        existingWorkers: [{ workerId: 'w-over', scheduledHours: 30 }],
      }),
    );
    expect(new Set(effect.honoredFloats)).toEqual(new Set(['f-ack', 'f-pending']));
    expect(effect.voidedFloats).toEqual([]);
  });

  it('raising the cap (20 → 40) flags no over-cap workers and voids nothing', () => {
    const effect = assessCapChangeEffect(
      makeChangeInput({
        previousCap: SOFT_20,
        newCap: HARD_40,
        existingWorkers: [{ workerId: 'w', scheduledHours: 18 }],
        pendingFloats: [{ floatId: 'f', workerId: 'w', status: 'pending' }],
      }),
    );
    expect(effect.overCapWorkers).toEqual([]);
    expect(effect.unassignedWorkers).toEqual([]);
    expect(effect.honoredFloats).toEqual(['f']);
    expect(effect.voidedFloats).toEqual([]);
  });
});

// ===========================================================================
// New claims AFTER the cap change respect the new cap (§9.3 / §5.3). The claim
// path is unchanged — it just consumes the newly-resolved effective cap.
// ===========================================================================

describe('new claims after the cap change respect the new cap (§9.3 / §5.3)', () => {
  it('a claim that would exceed the new HARD cap is blocked', () => {
    const cap = resolveEffectiveCap({ default: SOFT_20, override: HARD_40 });
    // worker at 39h, claiming a 1h (2-block) shift → 40h is exactly at the cap (ok),
    // but a further block over is blocked.
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 39.5,
      proposedClaimBlocks: 2, // +1.0h → 40.5h > 40
      hoursCap: cap.hoursCap,
      capEnforcement: cap.capEnforcement,
    });
    expect(result).toEqual({ ok: false, reason: 'hard_cap_exceeded' });
  });

  it('a claim that would exceed the new SOFT cap warns but is permitted', () => {
    const cap = resolveEffectiveCap({ default: SOFT_20, override: null }); // soft 20
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 19.5,
      proposedClaimBlocks: 2, // +1.0h → 20.5h > 20
      hoursCap: cap.hoursCap,
      capEnforcement: cap.capEnforcement,
    });
    expect(result).toEqual({ ok: true, warning: 'soft_cap_exceeded' });
  });

  it('a claim within the newly-lowered cap is allowed cleanly', () => {
    const cap = resolveEffectiveCap({ default: HARD_40, override: SOFT_20 }); // lowered to 20
    const result = checkClaimAgainstCap({
      currentWeeklyHours: 12,
      proposedClaimBlocks: 4, // +2.0h → 14h ≤ 20
      hoursCap: cap.hoursCap,
      capEnforcement: cap.capEnforcement,
    });
    expect(result).toEqual({ ok: true });
  });
});
