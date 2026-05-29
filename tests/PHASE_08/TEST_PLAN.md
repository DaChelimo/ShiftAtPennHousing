# Phase 08 — Test Plan: The Force-Trigger Pathway

This plan enumerates every test for phase-08, the spec section each test
covers, the function/RPC contracts the tests pin (TDD-first), and the
ambiguities surfaced and resolved before implementation.

Phase-08 is the **force-trigger pathway**: a dedicated endpoint
(ARCHITECTURE.md §6) lets an SM/HM/BM — or the currently-on-duty HMOD —
invoke the float lookup for a known coverage gap _before_ the standard
escalation timing (T-3h broadcast / T-2h float lookup) would fire. It is
intended for situations where the house manager knows in advance no local
SW will claim the shift (e.g., everyone is travelling during a break).

The pathway spans four behavioral surfaces:

| Surface                                          | Lives in                                                                            | Tested with |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------- |
| Endpoint validation (the five §6.2 checks)       | `packages/core/src/force-trigger/validation` (PURE) — **TDD-red**                   | Vitest      |
| `block_step_status` pre-mark / rollback step set | `packages/core/src/force-trigger/block-step-status` (PURE) — **TDD-red**            | Vitest      |
| Decline → standard-chain resumption (timing)     | `packages/core/src/orchestrator/evaluate` (deployed, exists)                        | Vitest      |
| Force-trigger transaction atomicity (DB)         | `decline_float` / `process_no_ack_float` / `acknowledge_float` + schema constraints | pgTAP       |

**Architecture split (matches audit finding C6a).** The phase-07 audit
removed the duplicated no-ack / routing TypeScript modules because they
re-implemented logic that is canonically a SQL RPC, and the two copies
drifted. Phase-08 avoids re-introducing that drift:

- **Pure decision surfaces in TypeScript** — the §6.2 validation predicate
  and the fixed pre-mark / rollback step sets. These run in the
  force-trigger Edge Function (ARCH §6) as a pre-flight gate and as the
  arguments to the execution RPC. They have no DB-side twin.
- **Atomic execution in SQL** — the single-transaction write
  (`float_assignments` + destination/source rows + source-side gap rows +
  `block_step_status` pre-marks) and all reconciliation (decline / no-ack)
  live in SQL RPCs. The execution RPC re-verifies only the two
  race-sensitive conditions (block still `vacant`, no `pending_float_in`)
  under row locks; it does **not** re-implement the full §6.2 policy.

The standard-chain resumption after a decline is **not a new surface**: it
is the deployed evaluator `evaluateChainSteps` (phase 07) reading the
`rolled_back` marks the decline writes. We re-test it from a phase-08 lens
using the canonical phase-07 evaluator fixtures so the phase-08 framing
cannot diverge from the phase-07 interpretation of the same rules.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §6.6 (force-triggered float — all 9 sub-rules: #1 initiation window +
  profile gate; #2 bypass; #3 floater assignment; #4 pending-float
  treatment; #5 source-side gap; #6 acknowledgment; #7 decline + chain
  resume + source-side reconciliation; #8 no-takeback; #9 no-floater
  fallback), §7.1–7.3 (acknowledgment cadence, declining, no-ack trigger)
- `ARCHITECTURE.md`
  §4.5 (the force-trigger pathway — destination + source-side rows,
  `block_step_status` pre-marking, rollback procedure, source-side
  reconciliation on decline), §6 (the force-trigger endpoint — request,
  the five validation checks, atomic execution, visibility), §4.1 (the
  `block_step_status` "not yet processed" / `rolled_back` semantics that
  the chain-resume relies on)
- `AGENTS.md` — hard invariant #3 (no-takeback: once a float is `pending`
  or `acknowledged`, automated systems may not revoke it; only manual
  SM/HM/BM override may).

Test files:

- `packages/core/tests/phase-08/fixtures.ts` — shared contract types +
  builders (validation-input builder, block-snapshot builder, role
  presets, mark→step-status translators). Re-exports the contract types
  from `../../src/force-trigger/types.js` so any drift between the
  implementation and the tests surfaces as a TypeScript error.
- `packages/core/tests/phase-08/force-trigger-validation.test.ts` —
  Vitest: all five §6.2 checks, the HMOD-not-home edge case, the exact
  T-2h boundary, winter-break (float disabled), the pending-float-in case,
  the multi-block "no partial execution" case, and the deterministic
  rejection precedence. **TDD-red** until `validateForceTrigger` lands.
- `packages/core/tests/phase-08/force-trigger-block-step-status.test.ts` —
  Vitest: the success pre-mark set, the rollback step set, the active
  (suppressed) stage, the no-takeback suppression, and the rolled-back
  re-escalation — driven through the real `evaluateChainSteps`.
  **TDD-red** until `forceTriggerSuccessMarks` / `forceTriggerRollbackSteps`
  land.
- `packages/core/tests/phase-08/decline-chain-resume.test.ts` — Vitest:
  the three §6.6 #7 resumption bands (T-3h not reached / T-3h passed /
  T-2h passed) plus the explicit "resume at the T-3h boundary, not
  immediately" edge case. **GREEN against current code** (it exercises the
  deployed evaluator).
- `supabase/tests/phase-08-force-trigger.sql` — pgTAP: force-trigger
  transaction atomicity — schema constraints, a valid success state,
  decline (restore vs displace), no-ack no-takeback, acknowledge +
  home-drop no-takeback. **GREEN against the local schema** (40
  assertions).

---

## The Function Contracts (TDD-first)

The implementation goes in `packages/core/src/force-trigger/`. Until it
lands, the two `*.test.ts` files that import it fail at the first import
line — the intended TDD-red state, identical to phase-06/07.

### Endpoint validation

```ts
// packages/core/src/force-trigger/types.ts
import type { BlockStepStatusValue, ChainStepName } from '../orchestrator/types.js';

export type ForceTriggerRole = 'sw' | 'sm' | 'hm' | 'bm';

export type ForceTriggerBlockStatus =
  | 'scheduled'
  | 'claimed'
  | 'floated_in'
  | 'floated_out'
  | 'pending_float_in'
  | 'pending_float_out'
  | 'allied'
  | 'vacant';

export type ForceTriggerBlockSnapshot = {
  blockId: string;
  status: ForceTriggerBlockStatus;
  blockStartAt: Date;
  hasPendingFloatIn: boolean; // a pending float-in already targets this block
};

export type ForceTriggerInitiator = {
  // The initiator's sm/hm/bm roles SCOPED to the destination house (the
  // caller filters the role list to this destination before building the
  // snapshot).
  rolesAtDestinationHouse: ForceTriggerRole[];
  // The initiator is the currently-on-duty HMOD (resolved via hmod_rotor
  // + hm_leave at request time). Authority spans all 13 houses.
  isCurrentHmod: boolean;
};

export type ForceTriggerValidationInput = {
  initiator: ForceTriggerInitiator;
  destinationHouseId: string;
  blocks: ForceTriggerBlockSnapshot[];
  now: Date;
  floatEnabled: boolean; // the blocks' date maps to a float-enabled profile
};

export type ForceTriggerRejectionReason =
  | 'empty_block_set'
  | 'unauthorized_initiator'
  | 'block_has_pending_float_in'
  | 'block_not_vacant'
  | 'within_two_hours'
  | 'float_not_enabled';

export type ForceTriggerValidationResult =
  | { ok: true }
  | { ok: false; reason: ForceTriggerRejectionReason };

export type ForceTriggerStepMark = {
  stepName: ChainStepName;
  status: BlockStepStatusValue;
};

// packages/core/src/force-trigger/index.ts
export function validateForceTrigger(
  input: ForceTriggerValidationInput,
): ForceTriggerValidationResult;

export function forceTriggerSuccessMarks(): ForceTriggerStepMark[];
export function forceTriggerRollbackSteps(): ChainStepName[];
```

`validateForceTrigger` is PURE: no I/O, no clock, no DB. The caller (the
force-trigger Edge Function, ARCH §6) assembles the snapshot from DB reads
— resolving the initiator's roles + HMOD status, each block's current
status, pending-float-in presence, and the date's `float_enabled` flag —
then calls this as a pre-flight gate before invoking the atomic execution
RPC. It returns the FIRST failing reason per the precedence in pinned
decision #4, or `{ ok: true }`.

`forceTriggerSuccessMarks` returns the exact `block_step_status` rows a
SUCCESSFUL force-trigger writes per destination block. `forceTriggerRollback
Steps` returns the exact step names a decline/no-ack rolls back. Both are
pure constants returned fresh each call (mutating a result must not affect
the next call).

### Atomic execution RPC (documented contract; implemented in the phase-08 migration)

The Edge Function, after a passing `validateForceTrigger` and after running
the float lookup algorithm (`packages/core/src/float-lookup`), invokes a
SQL execution RPC — sketched here, to be added in the phase-08 migration —
once per identified floater, mirroring phase-07's
`process_float_lookup_assignment` but for the force-trigger pathway:

```
force_trigger_float(
  p_initiator_user_id          uuid,
  p_worker_id                  uuid,
  p_source_house_id            text,
  p_source_assignment_ids      uuid[],
  p_destination_assignment_ids uuid[],
  p_destination_house_id       text,
  p_now                        timestamptz
) RETURNS jsonb
```

In ONE transaction (ARCH §6.3) it MUST:

1. Lock and re-verify each destination is still `vacant` and has no
   `pending_float_in` (TOCTOU guard); abort with no writes otherwise.
2. INSERT `float_assignments` with `initiated_by = 'force_triggered'`,
   `force_triggered_by = p_initiator_user_id`, `status = 'pending'`.
3. Destination rows → `pending_float_in`; source rows → `pending_float_out`.
4. If the source drops below required headcount, INSERT `vacant`
   source-side gap rows (`parent_float_id = float_id`) and enqueue them for
   the open-shifts feed.
5. INSERT `block_step_status` `(broadcast, 'completed_via_force_trigger')`
   and `(float_lookup, 'completed_via_force_trigger')` per destination
   block — and NO `hmod_notify_allied` row.

When the algorithm returns NO floater (§6.6 #9), the Edge Function does NOT
call this RPC; it fires `process_hmod_notify_allied_step` directly, and no
`completed_via_force_trigger` rows are ever written for the gap.

The pgTAP suite tests the constraints and reconciliation machinery this RPC
relies on (all GREEN). Its own success-path / rejection-atomicity pgTAP
tests land alongside the RPC migration.

---

## Pinned Decisions

The behavioral spec and architecture document leave several implementation
choices implicit. The decisions below are pinned by the test suite — the
implementation MUST match them, and any future reinterpretation requires
updating both the tests and this plan.

| #   | Topic                                       | Decision                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Authorization is OR, not AND                | The initiator is authorized iff they hold an `sm`/`hm`/`bm` role scoped to the destination house **OR** they are the currently-on-duty HMOD. The HMOD path needs no role at the destination at all (the HMOD holds HM permissions across all 13 houses). An HM who is also the HMOD is authorized either way.                                             | ARCH §6.2 #1 explicit: HMOD check is "in addition to, not in place of" the role-scope check. BSpec §2.5. Tested in `force-trigger-validation.test.ts` (SM/HM/BM ok; HMOD-not-home ok; SW + non-HMOD rejected).                                                                             |
| 2   | The 2-hour window is STRICT                 | A force-trigger is valid iff `(earliestStart - now) > 2h`. At exactly T-2h it is REJECTED (`within_two_hours`). The complement of phase-07 pinned #1: the standard chain's `float_lookup` fires AT T-2h (inclusive), so force-trigger is valid only STRICTLY before T-2h.                                                                                 | BSpec §6.6 #1 "up to T-2 hours… the system rejects late force-trigger requests"; ARCH §6.2 #3 "MORE than 2 hours". The edge case "initiated at T-2h exactly → rejected" is explicit in the brief. Tested at T-2h, T-2h±1ms, and a past start.                                              |
| 3   | `pending_float_in` is its own reason        | A block already targeted by a pending float-in is reported as `block_has_pending_float_in`, which takes PRECEDENCE over the generic `block_not_vacant` (such a block is also "not vacant"). The validator keys this off the caller-computed `hasPendingFloatIn` flag, not merely the `status` enum.                                                       | ARCH §6.2 lists #2 (vacant) and #4 (no pending float-in) as separate checks; the brief wants the pending case rejected with a specific signal. Surfacing the specific reason lets the endpoint return an accurate message. Tested standalone and as a precedence case.                     |
| 4   | Deterministic rejection precedence          | When several checks fail, the validator returns ONE reason in this fixed order: `empty_block_set` → `unauthorized_initiator` → `block_has_pending_float_in` → `block_not_vacant` → `within_two_hours` → `float_not_enabled`. The first failing check names the reason.                                                                                    | ARCH §6.2 "If any check fails, the request is rejected with a descriptive error." A fixed order makes the endpoint's error stable and lets tests use equality. Authorization first (most fundamental); per-block identity before the window/profile gates. Tested in the precedence block. |
| 5   | The window check uses min(start)            | The 2-hour window is evaluated against the EARLIEST block start across ALL blocks. A single too-soon block rejects the whole request — there is no partial execution.                                                                                                                                                                                     | BSpec §6.6 #1 ("earliest block start"); ARCH §6.2 #3 ("The earliest block's start time"). The "some vacant some not / some too-soon" edge cases require the whole-request rejection. Tested with mixed-offset and mixed-status block sets.                                                 |
| 6   | Success pre-mark set is exactly two         | `forceTriggerSuccessMarks()` returns `[(broadcast, completed_via_force_trigger), (float_lookup, completed_via_force_trigger)]` and NOTHING else. `hmod_notify_allied` is deliberately NOT pre-marked so it stays fireable if the chain rolls back later.                                                                                                  | ARCH §4.5 explicit on the two pre-marked steps and on leaving `hmod_notify_allied` without a row. Tested for set equality, the hmod exclusion, length, and status. Mirror of phase-07 pinned #14/#20.                                                                                      |
| 7   | Rollback step set mirrors the pre-mark set  | `forceTriggerRollbackSteps()` returns exactly `['broadcast', 'float_lookup']`, the same steps (and order) that were pre-marked. `hmod_notify_allied` is never in the list.                                                                                                                                                                                | ARCH §4.5 "Rollback procedure"; phase-07 pinned #14. Tested for equality and against the pre-mark set.                                                                                                                                                                                     |
| 8   | No-takeback is "no automated re-fire"       | While the marks stand at `completed_via_force_trigger` (float pending or acknowledged), the evaluator returns NO `broadcast`/`float_lookup` at ANY scan time before block start — so the automated system creates no competing assignment and cannot recall the pending float. Only a worker decline/no-ack (a rollback) or a manual override removes it. | BSpec §6.6 #8 / AGENTS invariant #3. The evaluator's suppression while pre-marked is the observable face. Tested across a sweep of scan times in `force-trigger-block-step-status.test.ts`; the DB no-op-before-window is tested in pgTAP (`process_no_ack_float` outside lookahead).      |
| 9   | Decline resume = evaluator on rolled_back   | The §6.6 #7 resumption is NOT a new function. After a decline flips broadcast + float_lookup to `rolled_back`, `evaluateChainSteps` produces the three bands directly (phase-07 pinned #2): T-3h not reached → broadcast at T-3h; T-3h past, T-2h not → broadcast skipped, float_lookup at T-2h; T-2h past → only `hmod_notify_allied`.                   | Avoids a second copy of the chain-progression rules (the C6a drift trap). `decline-chain-resume.test.ts` drives the deployed evaluator with the canonical phase-07 `forceTriggerRolledBack()` snapshot. GREEN today.                                                                       |
| 10  | Resumed broadcast waits for the offset      | When the decline lands before T-3h, the resumed `broadcast` fires AT T-3h (inclusive, minute-bucket tolerant for cron jitter) — NOT the instant the rollback is observed. 1ms before T-3h → nothing.                                                                                                                                                      | The brief's explicit edge case ("chain resumes at the T-3h boundary exactly → broadcast fires at T-3h, not immediately"). Composes phase-07 pinned #1 (inclusive offset) + C-2 (minute-bucket jitter). Tested at T-3h−1ms, T-3h, T-3h+30s.                                                 |
| 11  | Decline source-side reconciliation outcomes | Force-triggered decline: source-side gap **still vacant** (or no compensation rows) → floater RESTORED to `scheduled` and redundant compensation rows deleted; gap **claimed / Allied'd** → floater DISPLACED (source seat → `vacant`, `vacancy_origin = 'displaced_decliner'`). Destination always reopens `vacant` / `temporary_drop`.                  | BSpec §6.6 #7 + ARCH §4.5 "Source-side reconciliation on decline". This is the existing `decline_float` machinery (the no-ack RPC header notes the force-trigger branch "activates when Phase 08 adds [the endpoint]"). Tested GREEN in pgTAP for both branches.                           |
| 12  | Decline does NOT fire hmod_notify_allied    | On a force-triggered decline the rolled-back marks re-open the chain but the decline transaction writes NO `hmod_notify_allied` row — unlike the no-ack handler, which fires it directly (T-2h is always past at the no-ack trigger). The orchestrator re-evaluates on its next tick.                                                                     | ARCH `decline_float` header: "Unlike no-ack it does NOT fire hmod_notify_allied or apply a lookahead gate: a decline can land well before the float start." Tested in pgTAP (hmod row count = 0 after decline).                                                                            |

---

## Test File Coverage Map

### `force-trigger-validation.test.ts` (Vitest) — TDD-red

| Surface                                                               | Cases | Pinned decisions |
| --------------------------------------------------------------------- | ----- | ---------------- |
| Valid request accepted (incl. just past T-2h)                         | 2     | #2               |
| Check 1 — authorization (SM/HM/BM, HMOD-not-home, SW, none, both)     | 8     | #1               |
| Check 2 — every block vacant (scheduled/claimed/floated/allied/mixed) | 7     | #5               |
| Check 3 — earliest start > 2h (exact, ±1ms, past, min-of-set)         | 7     | #2, #5           |
| Check 4 — no pending float-in (standalone + precedence)               | 3     | #3               |
| Check 5 — float_enabled (winter break)                                | 2     | —                |
| Rejection precedence — deterministic first-failing reason             | 5     | #3, #4           |
| Purity — stable output, no input mutation                             | 2     | —                |

**Total: 34 cases.**

### `force-trigger-block-step-status.test.ts` (Vitest) — TDD-red

| Surface                                                         | Cases | Pinned decisions |
| --------------------------------------------------------------- | ----- | ---------------- |
| Success marks — exactly broadcast + float_lookup, hmod excluded | 4     | #6               |
| Rollback step set — `['broadcast','float_lookup']`              | 3     | #7               |
| Active pre-mark stage — standard chain suppressed               | 2     | #6, #8           |
| No-takeback — no automated re-fire while pending                | 2     | #8               |
| Rollback stage — rolled-back marks re-open the chain            | 2     | #7, #9           |
| `completed_via_force_trigger` suppresses re-fire like `fired`   | 2     | —                |
| Purity of the mark helpers + chain-membership guard             | 4     | —                |

**Total: 19 cases.**

### `decline-chain-resume.test.ts` (Vitest) — GREEN

| Surface                                                   | Cases | Pinned decisions |
| --------------------------------------------------------- | ----- | ---------------- |
| Scenario A — decline before T-3h → broadcast at T-3h      | 4     | #9               |
| Scenario A boundary — resumed broadcast waits for T-3h    | 3     | #10              |
| Scenario B — decline T-3h..T-2h → float_lookup at T-2h    | 3     | #9               |
| Scenario C — decline after T-2h → HMOD only               | 3     | #9               |
| Resumed chain is one-way — no re-fire after completion    | 2     | —                |
| Stale-gap guard — decline after block start fires nothing | 2     | —                |

**Total: 17 cases.**

### `phase-08-force-trigger.sql` (pgTAP) — GREEN

| Surface                                                                                       | Cases |
| --------------------------------------------------------------------------------------------- | ----- |
| A. Schema atomicity (force_triggered_by CHECK ×2; pre-mark idempotency ×2)                    | 4     |
| B. Valid success state (force_triggered/by, pending_float_in/out, pre-marks, no hmod)         | 6     |
| C. Decline + source still vacant → restore (void/vacant/rolled_back/restore/delete/exclusion) | 11    |
| D. Decline + source claimed → displace                                                        | 8     |
| E. No-takeback — no-ack outside lookahead is a no-op                                          | 4     |
| F. Acknowledge + home-drop → float commitment stands                                          | 7     |

**Total: 40 assertions.**

---

## What This Phase Does NOT Cover

- **The force-trigger endpoint's HTTP layer** — request parsing,
  auth-token → user resolution, response shaping. This phase ends at the
  pure validation decision and the atomic SQL contract.
- **The `force_trigger_float` execution RPC's own pgTAP** — the success-
  path and rejection-atomicity tests for the RPC land with the migration
  that implements it (the constraints and reconciliation it relies on are
  covered GREEN here).
- **The float lookup algorithm itself** — phase-06 (`packages/core/src/
float-lookup`). Force-trigger invokes it unchanged; "no eligible floater
  → empty result → Allied" is a phase-06 behavior.
- **Notification delivery** (push/email/SMS) — phase-09. This phase ends at
  "a notification row was generated" / "the HMOD step was claimed."
- **The orchestrator tick loop & no-ack/HMOD routing internals** — phase-07
  (`escalation-timing` evaluator + `process_no_ack_float` /
  `process_hmod_notify_allied_step` RPCs). Phase-08 reuses them.
- **Visibility / "(Pending)" labels** (BSpec §6.6 #3, ARCH §6.4) — a
  read-model / UI concern.

---

## Why TDD-Red (and what is already GREEN)

Phase-06/07 established the TDD-red pattern: tests import a not-yet-existing
module path and fail at import; the implementation lands in a follow-up
commit and turns them green. Phase-08 follows it for the two PURE decision
surfaces:

- `force-trigger-validation.test.ts` and
  `force-trigger-block-step-status.test.ts` import
  `../../src/force-trigger/index.js`, which does not exist yet → red.

Two surfaces are GREEN today because they exercise deployed code:

- `decline-chain-resume.test.ts` drives the deployed `evaluateChainSteps`
  (17/17 passing).
- `phase-08-force-trigger.sql` runs against the local schema and the
  existing `decline_float` / `process_no_ack_float` / `acknowledge_float`
  RPCs (40/40 passing via `supabase test db`).

The contracts in this plan were verified implementable: a scratch
`packages/core/src/force-trigger/` implementation matching pinned decisions
#1–#7 turned all 70 Vitest cases green and type-checked clean, then was
removed so the deliverable remains tests-only.
