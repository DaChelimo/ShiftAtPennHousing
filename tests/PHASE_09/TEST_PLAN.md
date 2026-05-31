# Phase 09 — Test Plan: Swaps

This plan enumerates every test for phase-09, the spec section each test
covers, the function/RPC contracts the tests pin (TDD-first), and the
ambiguities surfaced and resolved before implementation.

Phase-09 is **swaps**: two workers exchange shifts off-system and the system
records the exchange through an in-app accept/reject flow. There are three
swap types (BEHAVIORAL_SPECIFICATION.md §8):

- **Temporary shift swap (§8.1)** — two specific spans, one occurrence.
- **Temporary float swap (§8.2)** — at least one span is an active float.
- **Permanent shift swap (§8.3)** — two recurring slots, all future weeks.

plus the **expiry cron** that flips overdue `pending` requests to `expired`
(ARCHITECTURE.md §3.5).

The phase spans five behavioral surfaces:

| Surface                                                | Lives in                                                         | Tested with |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ----------- |
| Symmetric swap eligibility (pre-creation + acceptance) | `packages/core/src/swaps/eligibility` (PURE) — **TDD-red**       | Vitest      |
| Pending-swap conflict guard                            | `packages/core/src/swaps/eligibility` (PURE) — **TDD-red**       | Vitest      |
| Permanent-swap week scoping (affected vs skipped)      | `packages/core/src/swaps/permanent-scope` (PURE) — **TDD-red**   | Vitest      |
| Swap-request schema + expiry cron                      | `swap_requests` table + `expire_pending_swaps` RPC — **TDD-red** | pgTAP       |
| Atomic acceptance (shift / float / permanent)          | `accept_swap` / `apply_permanent_swap` RPCs — **TDD-red**        | pgTAP       |

**Architecture split (matches the phase-07 audit's C6a anti-drift rule).**
Phase-08 established the discipline: pure decision surfaces in TypeScript,
atomic execution in SQL, with no duplicated logic across the two. Phase-09
follows it:

- **Pure decision surfaces in TypeScript** — the symmetric eligibility
  predicate (used at BOTH the §8.1 pre-creation guard and the §8.1
  acceptance-time backstop), the pending-swap conflict guard, and the
  permanent-swap week partition. These run in the swap Edge Functions; they
  have no DB-side twin.
- **Atomic execution in SQL** — the single-transaction `user_id` exchange,
  the ownership-guarded bulk transfer, the silent-invalidation void, and the
  expiry-cron flip live in SQL RPCs. The acceptance RPC re-checks the
  race-sensitive conditions (span still owned, receiver still eligible) under
  the transaction; it reports failures with the SAME reason vocabulary the
  pure predicate uses (`harnwell_training_required`, etc.) so the two layers
  cannot describe the same rule differently.

The acceptance-time eligibility check is therefore **not a new surface**: it
is `evaluateSwapEligibility` re-run against a freshly snapshotted input
(`swap-eligibility.test.ts` exercises exactly this — same input shape, a
changed snapshot, a different result). This keeps the §8.1 "acceptance guard
re-runs eligibility" requirement from drifting away from the pre-creation
guard's interpretation.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §8.1 (temporary shift swap — either-initiates / counterparty-accepts;
  pre-swap calendar until acceptance; atomic exchange on acceptance;
  symmetric pre-creation guard; acceptance guard re-run; T-3h expiry; silent
  invalidation on drop/auto-float; no shared block across a worker's pending
  swaps), §8.2 (temporary float swap — ≥1 float span; symmetric Harnwell /
  float-direction / cross-house constraints; 24h-after-latest-end expiry;
  retroactive acceptance with NO cap re-check; destination SM/HM notified of
  the corrected floater), §8.3 (permanent shift swap — workers (not SM/HM)
  approve; 7-day expiry; bulk-update all future weeks A currently owns; skip
  weeks A no longer owns; confirmation popup lists skipped weeks; regular
  school year only), §1.2 (float direction), §5.3 (cross-house pickup
  eligibility), §9 (cap applies to claim/swap/pickup — never float)
- `ARCHITECTURE.md`
  §3.5 (`swap_requests` schema; the three expiry policies; "the orchestrator
  scans `swap_requests` with `status = pending` and flips them to `expired`"),
  §8.4 (the `user_id = :owner` bulk-update ownership predicate — shared by
  permanent drop and permanent swap), §10 (acceptance atomicity: "swap
  `user_id` between block sets atomically")
- `AGENTS.md` — hard invariant #1 (Harnwell training, enforced in code at
  every assignment write point, symmetrically), #2 (float direction:
  single-staff houses are never float sources; Quad cannot float to
  Harnwell), #4 (hours cap is not checked on float assignment).

Test files:

- `packages/core/tests/phase-09/fixtures.ts` — shared contract types +
  builders (participant / span-assignment / eligibility-input builders, the
  recurring-occurrence builder, house + worker constants, week-label helper).
  Re-exports the contract types from `../../src/swaps/types.js` so any drift
  between the implementation and the tests surfaces as a TypeScript error.
- `packages/core/tests/phase-09/swap-eligibility.test.ts` — Vitest: the
  symmetric eligibility predicate (Harnwell training in both directions, the
  float-vs-pickup asymmetry, the pending-float block guard, the float-swap
  presence precondition, two-sided violation collection, the acceptance-time
  re-run) and the pending-swap conflict guard. **TDD-red** until
  `evaluateSwapEligibility` / `findConflictingPendingSwaps` land.
- `packages/core/tests/phase-09/permanent-swap-scope.test.ts` — Vitest: the
  permanent-swap week partition (affected vs skipped, skip-reason precedence,
  the strictly-future boundary, break-profile exclusion, the zero-week edge,
  ownership against Worker A). **TDD-red** until `scopePermanentSwapWeeks`
  lands.
- `supabase/tests/phase-09-swaps.sql` — pgTAP: the `swap_requests` schema, the
  expiry cron (`expire_pending_swaps`, per-type anchors + idempotency), and
  atomic acceptance (`accept_swap` shift/float, `apply_permanent_swap`) — 55
  assertions. **TDD-red** until the phase-09 migration adds the table + RPCs.

---

## The Function Contracts (TDD-first)

The implementation goes in `packages/core/src/swaps/` and the phase-09
migration. Until they land, the test files that import them fail at the first
import line — the intended TDD-red state, identical to phase-06/07/08.

### Pure decision surfaces

```ts
// packages/core/src/swaps/types.ts
export type SwapType = 'shift_swap' | 'float_swap' | 'permanent_swap';
export type SwapAssignmentKind = 'shift' | 'float' | 'cross_house_pickup';

export type SwapSpanAssignment = {
  assignmentId: string;
  houseId: string; // the house this assignment STAFFS (home for a
  // shift; the destination for a float / pickup)
  kind: SwapAssignmentKind;
  inPendingFloat?: boolean; // the underlying block sits in a pending float
};

export type SwapParticipant = { userId: string; homeHouseId: string; span: SwapSpanAssignment[] };

export type SwapEligibilityInput = {
  swapType: 'shift_swap' | 'float_swap';
  initiator: SwapParticipant;
  counterparty: SwapParticipant;
};

export type SwapIneligibilityReason =
  | 'harnwell_training_required'
  | 'single_staff_cannot_float'
  | 'block_in_pending_float'
  | 'float_swap_requires_a_float';

export type SwapEligibilityViolation = {
  receiverUserId: string | null; // null = a span-level precondition
  assignmentId: string | null; // null = the float-presence precondition
  destinationHouseId: string | null;
  reason: SwapIneligibilityReason;
};

export type SwapEligibilityResult =
  | { eligible: true }
  | { eligible: false; violations: SwapEligibilityViolation[] };

// packages/core/src/swaps/index.ts
export function evaluateSwapEligibility(input: SwapEligibilityInput): SwapEligibilityResult;

export function findConflictingPendingSwaps(input: {
  newAssignmentIds: string[];
  pendingSwaps: { swapId: string; assignmentIds: string[] }[];
}): string[]; // conflicting swapIds, in input order

export function scopePermanentSwapWeeks(input: {
  workerAUserId: string;
  acceptedAt: Date;
  occurrences: RecurringOccurrence[];
}): { affected: ScopedWeek[]; skipped: SkippedWeek[] };
```

`evaluateSwapEligibility` is PURE: no I/O, no clock, no DB. A swap transfers
each party's span to the OTHER, so the guard asks — for every transferred
assignment — whether the RECEIVER is eligible to staff that assignment's
destination house, **symmetrically in both directions**. The swap Edge
Functions call it once as the §8.1 pre-creation guard and again as the §8.1
acceptance-time backstop, each against a fresh DB snapshot.

`scopePermanentSwapWeeks` is PURE: it partitions Worker A's recurring-slot
occurrences into the weeks the acceptance RPC will transfer (`affected`) and
the weeks it will skip with a reason (`skipped`, rendered in the confirmation
popup). The Edge Function hands `affected`'s assignment ids to
`apply_permanent_swap`.

### SQL contracts (documented here; implemented in the phase-09 migration)

```
-- The orchestrator expiry scan (ARCH §3.5).
expire_pending_swaps(p_now timestamptz) RETURNS integer
  -- UPDATE swap_requests SET status='expired'
  --   WHERE status='pending' AND expires_at <= p_now;  RETURNS rows flipped.

-- Temporary (shift / float) swap acceptance — ONE transaction (ARCH §10).
accept_swap(p_swap_id uuid, p_accepting_user_id uuid, p_now timestamptz) RETURNS jsonb
  -- 1. lock the swap; if status != 'pending' -> {accepted:false, reason:'not_pending'}.
  -- 2. re-verify each span is still owned by its original party; if not,
  --    set status='voided' -> {accepted:false, reason:'span_invalidated'} (§8.1).
  -- 3. re-run the symmetric Harnwell / float-direction eligibility check; on
  --    failure -> {accepted:false, reason:<SwapIneligibilityReason>} (§8.1).
  -- 4. swap user_id between initiator_assignment_ids and counterparty_assignment_ids.
  -- 5. status='accepted'. For a float swap: notify the destination SM/HM of the
  --    corrected floater (§8.2). NO hours-cap re-check (retroactive-safe, §8.2).
  --    Returns {accepted:true}.

-- Permanent swap bulk transfer — ONE transaction (ARCH §8.4 / §10).
apply_permanent_swap(
  p_swap_id uuid, p_new_owner_user_id uuid,
  p_affected_assignment_ids uuid[], p_now timestamptz
) RETURNS jsonb
  -- UPDATE shift_block_assignments SET user_id = p_new_owner_user_id
  --   WHERE assignment_id = ANY(p_affected_assignment_ids)
  --     AND user_id = <swap.initiator_user_id>;   -- the ownership predicate
  -- status='accepted'. Returns {accepted:true, transferred_count:int}.
  -- p_affected_assignment_ids is scopePermanentSwapWeeks(...).affected resolved
  -- to ids; the WHERE guard is the SQL-side re-check of the same ownership rule.
```

The `swap_requests` schema (ARCH §3.5): `swap_type_enum`
(`shift_swap`/`float_swap`/`permanent_swap`), `swap_status_enum`
(`pending`/`accepted`/`rejected`/`expired`/`voided`), `initiator_assignment_ids`
/ `counterparty_assignment_ids` as `uuid[]` (seat-level, like floats),
`recurring_pattern jsonb`, `status` defaulting to `pending`, `created_at`,
`expires_at`, and RLS enabled. `counterparty_assignment_ids` is NULL-able ONLY
because `permanent_swap` leaves it unresolved until acceptance; a temporary
swap with an empty initiator OR counterparty set is rejected by a CHECK.

---

## Pinned Decisions

The behavioral spec and architecture document leave several implementation
choices implicit. The decisions below are pinned by the test suite — the
implementation MUST match them, and any future reinterpretation requires
updating both the tests and this plan.

| #   | Topic                                       | Decision                                                                                                                                                                                                                                                                                                                                                                          | Why                                                                                                                                                                                                                         |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Receiver-side, symmetric evaluation         | A swap gives each party the OTHER's span. Eligibility is evaluated per transferred assignment against the RECEIVER, in BOTH directions. The result lists every violation, not just the first.                                                                                                                                                                                     | §8.1 pre-creation guard: "if A's span includes a … assignment, B must be eligible for that destination … in both directions." Symmetric collection makes a two-sided failure visible at once.                               |
| 2   | Harnwell training is absolute               | Any transferred assignment whose destination is Harnwell requires the receiver's home house to be Harnwell — regardless of the assignment KIND (shift, float, or pickup). Reported as `harnwell_training_required`, which DOMINATES the float-direction reason (a Quad floater into Harnwell fails the training check, not the direction check).                                  | AGENTS invariant #1 ("under any mechanism"); BSpec §1.2/§5.3/§8.2 ("place a non-Harnwell-trained worker at Harnwell … is rejected"). The training rule is the one mechanism-independent invariant.                          |
| 3   | Float-vs-pickup asymmetry (the crux)        | Receiving a `float` makes the receiver a float SOURCE → a single-staff-home receiver is rejected `single_staff_cannot_float` (Quad/Harnwell OK). Receiving a `shift` or `cross_house_pickup` at a non-Harnwell house is governed by the PERMISSIVE pickup rule → always eligible. The SAME single-staff receiver passes a pickup but fails a float at the same house.             | BSpec §8.1 cites BOTH §1.2 (float direction — single-staff can't be sources) AND §5.3 (pickup — only Harnwell training carries over). Conflating them would wrongly reject a single-staff worker's cross-house pickup swap. |
| 4   | Pending-float block is not swappable        | An assignment whose block sits in a pending float (`inPendingFloat`) yields `block_in_pending_float`, which OUTRANKS the destination checks for that assignment. The block is not in a clean, transferable state.                                                                                                                                                                 | Brief edge case: "swap a block involved in a force-triggered pending float → the pre-creation guard should catch/flag this." A half-committed float seat has no settled owner to exchange.                                  |
| 5   | Float-swap presence precondition            | A `float_swap` requires ≥1 `float` across the two spans, else `float_swap_requires_a_float` (a span-level violation with null receiver/assignment). A `shift_swap` has NO such requirement — it MAY involve floats (§8.1) but is never rejected for lacking one.                                                                                                                  | BSpec §8.2 ("at least one of the two swapped spans must include an active float … otherwise … use a temporary shift swap"); §8.1 ("A temporary shift swap may involve float assignments").                                  |
| 6   | Deterministic violation order               | Precondition first; then the initiator's span (counterparty receives), in span order; then the counterparty's span (initiator receives), in span order. `eligible` iff zero violations. Per assignment: `block_in_pending_float` > `harnwell_training_required` > `single_staff_cannot_float`.                                                                                    | A fixed order lets tests use equality and makes the endpoint's error message stable. Mirrors phase-08 pinned #4 (deterministic rejection precedence).                                                                       |
| 7   | Acceptance guard = re-run, not re-implement | The §8.1 acceptance-time check is `evaluateSwapEligibility` re-run on a fresh snapshot. A swap eligible at creation can fail at acceptance if a party's snapshot changed (e.g., home house reassigned away from Harnwell). No second copy of the rule exists.                                                                                                                     | BSpec §8.1 "Acceptance guard (backstop) … re-runs the symmetric eligibility checks." Avoids the C6a drift trap (two copies of one rule). `accept_swap` re-checks the same conditions SQL-side with the same reason names.   |
| 8   | Conflict guard is set-intersection          | `findConflictingPendingSwaps` returns the swapIds of the worker's pending swaps whose assignment-id set intersects the new swap's touched ids (union of both spans). Reported in input order. Used at BOTH creation and acceptance.                                                                                                                                               | BSpec §8.1 "a worker cannot create or accept a … swap that touches a block already involved in another pending swap request of theirs." The guard is over touched blocks, either side of the span.                          |
| 9   | Permanent-swap scope partition              | `affected` = occurrences that are FUTURE (start `>` acceptedAt, strictly) ∧ `regular_school_year` ∧ currently owned by Worker A. Everything else is `skipped` with a reason. Skip precedence: `past_occurrence` > `break_profile` > `not_owned_by_worker_a`. Zero `affected` is ALLOWED (the popup shows 0).                                                                      | BSpec §8.3 ("all future weeks where A currently owns … skip weeks where A no longer owns"); §8.4.1 ownership boundary; §8.3 break exclusion ("regular school year only"). Brief edge: "all future weeks claimed → 0 weeks." |
| 10  | Expiry anchors + idempotent cron            | `expire_pending_swaps(now)` flips `pending` rows with `expires_at <= now` to `expired`, never touches non-pending rows, and is idempotent (a second run flips 0). Per-type `expires_at`: `shift_swap` = T-3h of the EARLIER span; `float_swap` = 24h after the LATEST span end; `permanent_swap` = `created_at` + 7 days.                                                         | ARCH §3.5 (the scan + the three policies). Constructing each row's `expires_at` with the anchor formula and flipping it at the boundary tests both the policy and the cron. Timestamptz/NY tz math (invariant #6).          |
| 11  | Acceptance atomicity & shared vocabulary    | `accept_swap` is one transaction: it refuses a non-pending swap (`not_pending`), silently VOIDS a swap whose span was dropped before acceptance (`span_invalidated`, status→`voided`, §8.1), refuses an acceptance-time-ineligible swap (`harnwell_training_required`) with NO seat writes, and otherwise exchanges `user_id` atomically. Reason strings match the TS vocabulary. | ARCH §10 atomicity; BSpec §8.1 (silent invalidation, acceptance guard). A failed guard makes ZERO seat writes (no partial swap). Shared reason names keep the SQL backstop and the TS predicate describing one rule.        |
| 12  | Float swap is retroactive-safe              | `accept_swap` on a `float_swap` succeeds even when `p_now` is AFTER the worked shift (the calendar updates retroactively) and performs NO hours-cap re-check. On success it notifies the destination SM (a `swap_request` notification carrying `payload.corrected_floater_user_id`). The corrected seat stays `is_float = true`; only the identity changes.                      | BSpec §8.2 ("accepted after the shift has been worked → calendar updates retroactively … No hours cap re-check … destination SMs and HMs are notified of the corrected floater"). Invariant #4 (no cap on float).           |
| 13  | Permanent transfer is ownership-guarded     | `apply_permanent_swap` bulk-updates ONLY the supplied future occurrences still owned by the swap's initiator (`user_id = initiator` predicate). Weeks that passed to another owner are skipped SQL-side, so `transferred_count` reflects the actual transfers. The affected set comes from `scopePermanentSwapWeeks`.                                                             | ARCH §8.4 ("the `user_id = :owner` predicate ensures the bulk update only affects blocks the … worker currently owns"); §8.3. The SQL predicate is the re-check of the pure scoping rule at execution time.                 |
| 14  | `counterparty_assignment_ids` nullability   | `counterparty_assignment_ids` is NULL-able ONLY because `permanent_swap` leaves it unresolved before acceptance. A `shift_swap`/`float_swap` with an empty initiator OR counterparty set is rejected by a CHECK; both spans are named at creation.                                                                                                                                | ARCH §3.5 ("null/empty for permanent_swap before resolution"). Temporary swaps name two concrete spans up front (§8.1); a permanent swap names one recurring slot and resolves the counterparty's at acceptance.            |

---

## Test File Coverage Map

### `swap-eligibility.test.ts` (Vitest) — TDD-red

| Surface                                                                       | Cases | Pinned decisions |
| ----------------------------------------------------------------------------- | ----- | ---------------- |
| Eligible swaps (in/cross-house shift, Harnwell↔Harnwell, single-staff pickup) | 5     | #1, #3, #5       |
| Harnwell training — symmetric, absolute, dominance, two-sided collection      | 4     | #1, #2, #6       |
| Float direction — single-staff source rejected; Quad OK; float-vs-pickup      | 3     | #3               |
| Float-swap presence precondition (required / satisfied / not for shift_swap)  | 3     | #5               |
| Pending-float block guard (standalone + precedence over destination)          | 2     | #4               |
| Acceptance-time guard re-run (eligible→ineligible on a changed snapshot)      | 1     | #7               |
| Pending-swap conflict guard (one / none / multiple / empty / either-side)     | 5     | #8               |
| Purity — stable output, no input mutation (both functions)                    | 3     | —                |

**Total: 26 cases.**

### `permanent-swap-scope.test.ts` (Vitest) — TDD-red

| Surface                                                       | Cases | Pinned decisions |
| ------------------------------------------------------------- | ----- | ---------------- |
| Week partition — typical mix; all-affected                    | 2     | #9               |
| Zero-week edge — all claimed away; vacant week                | 2     | #9               |
| Break-profile exclusion — short / winter; resumes after break | 3     | #9               |
| Future boundary — exactly-at-acceptedAt; +1ms                 | 2     | #9               |
| Skip-reason precedence — past > break > not_owned             | 2     | #9               |
| Ownership against Worker A (counterparty-owned week skipped)  | 1     | #9               |
| Empty occurrence set                                          | 1     | #9               |
| Purity — stable output, no input mutation                     | 2     | —                |

**Total: 15 cases.**

### `phase-09-swaps.sql` (pgTAP) — TDD-red

| Surface                                                                                                 | Cases |
| ------------------------------------------------------------------------------------------------------- | ----- |
| A. Schema — enums, columns, types, NOT NULL, status default, nullable counterparty, CHECKs, RLS         | 19    |
| B. Expiry cron — not-yet-due / per-type flips / idempotency / non-pending untouched / survivors         | 13    |
| C. Shift-swap acceptance — accepted, status, atomic exchange ×2, post-swap drop belongs to new owner    | 5     |
| D. Acceptance guards — Harnwell re-check (×3), silent invalidation (×3), non-pending (×2)               | 8     |
| E. Float swap — retroactive accept, corrected floater, still float, desk seat, destination notification | 5     |
| F. Permanent swap — `apply_permanent_swap` exists, transferred_count, two transfers, one skip, status   | 6     |

**Total: 55 assertions.**

---

## What This Phase Does NOT Cover

- **The swap Edge Functions' HTTP layer** — request parsing, auth-token → user
  resolution, response shaping, notification delivery (push/email/SMS). This
  phase ends at the pure decision surfaces, the atomic SQL contracts, and "a
  notification ROW was generated."
- **The hours-cap check on swap acceptance (§9).** Swaps DO add hours and are
  cap-checked in general, but the cap predicate is a §9 snapshot concern over
  weekly totals — a separate surface, not a swap-specific rule. The ONLY
  cap-related behavior pinned here is the §8.2 carve-out: a retroactive float
  swap performs NO cap re-check (pinned #12).
- **The float lookup / source-floor staffing recomputation.** The
  eligibility guard pins the per-receiver float-direction rule (single-staff
  cannot be a source); it does NOT recompute whether a specific source desk
  would drop below its headcount floor for a given window — that is the
  phase-06 float-lookup snapshot (`packages/core/src/float-lookup`), invoked
  unchanged where needed.
- **The recurring-occurrence resolver.** `scopePermanentSwapWeeks` takes the
  pre-resolved list of A's weekly occurrences; the SQL that enumerates a
  recurring slot's future blocks (house + day-of-week + block-start, within
  the semester period) is the §8.4 permanent-drop machinery the permanent-swap
  Edge Function reuses to build the input.
- **Proactive invalidation triggers.** §8.1 voids a pending swap the moment a
  span is dropped or auto-floated. Originally this phase tested only the
  acceptance-time backstop and deferred the proactive trigger. **Closed by the
  Phase-8→9 readiness audit:** a `shift_block_assignments` AFTER-UPDATE trigger
  (`void_pending_swaps_for_vacated_seat`) now voids any pending swap the instant
  one of its seats transitions to `vacant` / `pending_float_out` / `floated_out`
  — covering every Phase 5/7/8 drop/float write path at once. Tested in
  `phase-09-swaps.sql` §G (the acknowledged-float-OUT case the old vacant/allied
  span-check missed), with the tightened `accept_swap` span-check as backstop.
- **Permanent-swap bidirectionality fixtures.** §8.3 exchanges BOTH recurring
  slots; the pgTAP exercises the load-bearing ownership-guarded transfer in one
  direction (the symmetric direction is identical logic over the counterparty's
  occurrences). The pure week-scoping that decides each direction's affected
  set is covered in `permanent-swap-scope.test.ts`.

---

## Why TDD-Red (and how the contracts were validated)

Phase-06/07/08 established the TDD-red pattern: tests import a not-yet-existing
module path and fail at import; the implementation lands in a follow-up commit
and turns them green. Phase-09 follows it for ALL four files:

- `swap-eligibility.test.ts` and `permanent-swap-scope.test.ts` import
  `../../src/swaps/index.js`, which does not exist yet → red.
- `phase-09-swaps.sql` references `swap_requests` + `expire_pending_swaps` /
  `accept_swap` / `apply_permanent_swap`, none of which exist yet → red. Unlike
  phase-08 (whose pgTAP was GREEN because force-trigger reused existing tables),
  phase-09 introduces a NEW table and RPCs, so its pgTAP is necessarily TDD-red
  until the migration lands — the same role the Vitest TDD-red plays for the
  pure surfaces.

The pure-function contracts in this plan were verified implementable: a scratch
`packages/core/src/swaps/` implementation matching pinned decisions #1–#9
turned all 41 Vitest cases green and type-checked clean (`tsc --noEmit`
--strict), then was removed so the deliverable remains tests-only. The SQL
contracts (#10–#14) are pinned by the 60 pgTAP assertions and the schema /
RPC sketches above; the migration that satisfies them carries its own
green-on-landing verification.

**Post-audit addition (§8.3 break-profile enforcement).** The spec-adherence
audit found the regular_school_year restriction was implemented only in the pure
`scopePermanentSwapWeeks` partition, with no server-side enforcement. It is now
enforced at both guard points, mirroring the eligibility two-guard pattern: a
pre-creation guard in `create-swap` (via the `assignments_outside_regular_school_year`
helper) rejects a permanent swap that names a break-profile slot, and an
acceptance-time backstop in `apply_permanent_swap` skips any affected week whose
operating date is not regular_school_year (alongside the existing
`user_id = initiator` ownership predicate). Five pgTAP assertions cover both.
