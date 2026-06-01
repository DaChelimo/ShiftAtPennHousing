# Phase 14 — Admin Extras: Test Plan

## Overview

Phase 14 covers the **system-wide hours-cap modification** admin surface
(BEHAVIORAL_SPECIFICATION.md §9.3) and the `system_config` audit contract
(ARCHITECTURE.md §3.10). The cap-checking primitive itself already exists and is
green (`packages/core/src/scheduling/hours.ts` — `checkClaimAgainstCap`); Phase 14
adds the layer that decides **who may change the cap, what the cap resolves to for
a given week, and what a cap change does (and does not) do to existing state**.

The surface splits the same way every prior phase has:

| Surface             | Tool       | What it verifies                                                                                        |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| Pure decision logic | Vitest     | Authorization, week-default resolution, effective-cap resolution, retroactive-non-effect of a change.   |
| Admin web flow      | Playwright | HM/BM can modify (audit-trailed); SM/SW are blocked; the change advertises its global (13-house) scope. |

Sources of truth: BEHAVIORAL_SPECIFICATION.md §9.3 (cap modification), §3.2
(profile cap defaults), §5.3 (claim-over-cap soft/hard), §9.2 (the calendar week);
ARCHITECTURE.md §3.10 (`system_config` `modified_by`/`modified_at`/`notes`);
AGENTS.md hard invariant #4 (the hours cap is not checked on float).

## The Pure Contract

The Vitest suite drives a not-yet-built pure module. Implementing it makes the
suite green; the test file re-exports the contract types so any drift is a
TypeScript error.

```ts
// packages/core/src/cap-modification/types.ts
export type AdminRole = 'sw' | 'sm' | 'hm' | 'bm';
export type CapEnforcement = 'soft' | 'hard';
export type CapHours = 20 | 40;
export type CapSetting = { hoursCap: CapHours; capEnforcement: CapEnforcement };

export type DayProfile =
  | 'regular_school_year'
  | 'winter_break'
  | 'thanksgiving'
  | 'fall_break'
  | 'spring_break'
  | 'spring_fling';

export type CapModificationAuthResult =
  | { authorized: true }
  | { authorized: false; reason: 'role_not_permitted' };

export type CapChangeEffectInput = {
  previousCap: CapSetting;
  newCap: CapSetting;
  existingWorkers: { workerId: string; scheduledHours: number }[];
  pendingFloats: { floatId: string; workerId: string; status: 'pending' | 'acknowledged' }[];
};

export type CapChangeEffect = {
  overCapWorkers: string[]; // existing hours > new cap — flagged for UI, never touched
  unassignedWorkers: string[]; // ALWAYS [] — §9.3 no retroactive unassignment
  honoredFloats: string[]; // ALL pending/acknowledged floats — survive
  voidedFloats: string[]; // ALWAYS [] — §9.3 pending floats are honored
};
```

```ts
// packages/core/src/cap-modification/index.ts
export function canModifyCap(role: AdminRole): CapModificationAuthResult;
export function resolveDefaultCap(dayProfiles: DayProfile[]): CapSetting;
export function resolveEffectiveCap(input: {
  default: CapSetting;
  override: CapSetting | null;
}): CapSetting;
export function assessCapChangeEffect(input: CapChangeEffectInput): CapChangeEffect;
```

All four are **pure** (zero Supabase imports, deterministic). The cap-modifier
Edge Function / RPC snapshots DB state, calls these to authorize, resolve, and
classify, then writes the `weekly_cap_overrides` row with the §3.10 audit trail.

## Pinned Decisions

| #   | Topic                       | Decision                                                                                                                                                | Rationale                                                                                                              |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Authorization is role-only  | `canModifyCap` takes a role and **no house**. HM and BM are authorized; SW and SM are not.                                                              | §9.3: "an HM or BM (of any house)" — campus-wide authority, not house-scoped. No house arg encodes "any house".        |
| 2   | Global application          | `resolveEffectiveCap` takes **no house**. One (default, override) pair resolves identically everywhere.                                                 | §9.3: "applies to all 13 houses simultaneously." Absence of a house parameter is the encoding of "global".             |
| 3   | Only 20 or 40               | A cap is `{20, soft}` or `{40, hard}`. Soft = overridable warning; hard = not overridable.                                                              | §9.3 / §3.2 / §5.3. Mirrors the `weekly_cap_overrides.hours_cap IN (20, 40)` CHECK + `cap_enforcement_enum`.           |
| 4   | Week-default = safe side    | `resolveDefaultCap`: any 40-hour-break day (Thanksgiving/fall/spring/winter) in the week ⇒ 40-hard. Spring-fling-only ⇒ 20-soft. All-regular ⇒ 20-soft. | §9.3 "Default rules for setting the cap of a week" — a straddling week defaults to 40 "on the safe side".              |
| 5   | 40-break beats spring-fling | A week with both a 40-hour break day and a spring-fling day resolves to 40-hard.                                                                        | §9.3 safe-side rule: the hard ceiling wins over the soft one when both are present.                                    |
| 6   | Override replaces default   | A manual override (if present) wins over the week default — in either direction (20→40 or 40→20).                                                       | §9.3: the HM/BM "may set a week to either 20 or 40" — the set value is authoritative.                                  |
| 7   | At-cap is not over-cap      | A worker with `scheduledHours === newCap.hoursCap` is NOT in `overCapWorkers`.                                                                          | The cap is a ceiling (≤), per `checkClaimAgainstCap` (`projectedHours <= hoursCap`).                                   |
| 8   | No retroactive unassign     | `unassignedWorkers` is **always** `[]`, even for workers far over a lowered cap.                                                                        | §9.3: "Workers whose existing assignments already exceed the new cap are not retroactively unassigned."                |
| 9   | Pending floats are honored  | `honoredFloats` lists every pending **and** acknowledged float; `voidedFloats` is **always** `[]`.                                                      | §9.3: "Pending float assignments ... are honored and are not voided." AGENTS #4: floats are hours-neutral.             |
| 10  | New claims use the new cap  | A post-change claim runs through the **existing** `checkClaimAgainstCap` with the **resolved** cap — hard blocks, soft warns.                           | §9.3: "New claims ... are blocked if they would push a worker over the new cap." Only the consumed CapSetting changes. |
| 11  | Audit trail                 | The web write records `modified_by` + `modified_at` + `notes`; the UI reads them back.                                                                  | ARCH §3.10 audit columns. `weekly_cap_overrides` gains a `notes` column in the Phase-14 migration.                     |

## Test File Coverage Map

### Vitest — `packages/core/tests/phase-14/cap-modification.test.ts`

| Test group                                  | Cases | Decisions | Spec            |
| ------------------------------------------- | ----- | --------- | --------------- |
| cap-modification authorization              | 5     | 1         | §9.3            |
| default cap for a week                      | 6     | 3,4,5     | §9.3, §3.2      |
| effective cap resolution (global override)  | 5     | 2,3,6     | §9.3            |
| effect of a cap reduction on existing state | 5     | 7,8,9     | §9.3, AGENTS #4 |
| new claims after the cap change             | 3     | 3,10      | §9.3, §5.3      |

### Playwright — `apps/web/e2e/cap-modification.spec.ts`

| Test                                                        | Decisions | Spec        |
| ----------------------------------------------------------- | --------- | ----------- |
| an SM cannot modify the cap                                 | 1         | §9.3        |
| a worker (SW) cannot modify the cap                         | 1         | §9.3        |
| an HM can set a week to 40 (hard), applied globally + audit | 1,2,3,11  | §9.3, §3.10 |
| a BM can set a week to 20 (soft)                            | 1,3,11    | §9.3, §3.10 |

The Playwright selector + seed contract is documented in `apps/web/e2e/README.md`
(Phase-14 section). It reuses the phase-13b SEED fixtures (`hmQuad`, `bmQuad`,
`smQuad`, `alice`) and target week `SEED.date` (2026-02-02, regular school year →
default 20-soft).

## What This Phase Does NOT Cover

- **The cap-checking primitive** (`checkClaimAgainstCap` / `computeWeeklyHours`) —
  already built and green; Phase 14 only verifies that the modification path feeds
  it the right `CapSetting`.
- **DB-layer write + RLS** for `weekly_cap_overrides` (the HM/BM-only write gate,
  the global single-row-per-week semantics, the `notes` column) — pgTAP, scoped to
  `supabase/tests/phase-14-cap-modification.sql`, not this plan.
- **Orchestrator cache refresh timing** — §9.3 / §3.10 say a change "takes effect
  within the next orchestrator tick (~60 s)". That cadence is the runtime/cache
  layer (the once-a-minute refresh of §3.10), not the pure decision surface.
- **In-flight weekly-feed re-validation at submission time** — §9.3 final bullet;
  this is the claim-submission path (phase-05/11 surface) re-reading the cap, not a
  Phase-14 concern beyond decision #10's "new claims use the new cap".
- **The web data/auth plumbing** — the Next.js proxy auth, server actions, Supabase
  client — the same data/UI layer every prior web/mobile phase scopes out.

## Ambiguities — resolved

| #   | Surface                           | Resolution                                                                                                                                                  |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "of any house" → house arg?       | Encoded by OMITTING a house parameter from `canModifyCap` and `resolveEffectiveCap` (decisions 1, 2). A house arg would invite incorrect per-house scoping. |
| 2   | Straddle + spring-fling           | A 40-hour break day wins even when a spring-fling day co-occurs (decision 5) — the §9.3 safe-side rule reads "on the safe side" = the hard ceiling.         |
| 3   | Worker exactly at the new cap     | Not over-cap (decision 7) — the cap is `≤`, consistent with the existing `checkClaimAgainstCap`.                                                            |
| 4   | Acknowledged vs pending floats    | Both survive (decision 9). §9.3 names "acknowledged floats and floats that are assigned but not yet accepted"; AGENTS #4 (hours-neutral) makes this safe.   |
| 5   | `notes` on `weekly_cap_overrides` | The Phase-14 migration adds `notes text` (the table lacks it today); `system_config` already has `modified_by`/`modified_at`/`notes` (ARCH §3.10).          |

## Why TDD-Red

- **Vitest** is red at import resolution: `packages/core/src/cap-modification/`
  does not exist. The contract types and function signatures above are the
  implementation spec; landing the module turns the suite green with no test
  edits. The one already-green dependency (`checkClaimAgainstCap`) is imported to
  pin decision #10's composition explicitly.
- **Playwright** is red at the first selector: `/admin/hours-cap` and the
  `cap-*` test-ids do not exist yet. Like the phase-13b specs, the flow runs
  against a real, seeded local Supabase + dev server (see `e2e/README.md`); the
  seed reuses the phase-13b Quad fixtures.
- The contract was validated pre-commit against the existing primitives
  (`scheduling/hours.ts` `CapCheckInput`/`CapCheckResult`, the
  `weekly_cap_overrides` schema, the `cap_enforcement_enum`) so the types align
  with the layers Phase 14 builds on.
