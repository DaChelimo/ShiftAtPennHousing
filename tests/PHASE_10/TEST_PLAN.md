# Phase 10 — Test Plan: Permanent Drop and Permanent Pickup

This plan enumerates every test for phase-10, the spec section each test
covers, the function/RPC contracts the tests pin (TDD-first), and the
ambiguities surfaced and resolved before implementation.

Phase-10 is **permanent operations on recurring slots** under SM-built
scheduling (regular school year only; break profiles are claim-based and have
no recurring slot). There are two user operations plus the SM/HM mirror
(BEHAVIORAL_SPECIFICATION.md §8.4):

- **Permanent drop (§8.4.1)** — a worker releases every FUTURE occurrence of a
  recurring slot they currently own, for the rest of the current semester.
- **SM/HM-initiated permanent removal (§8.4.2)** — same scope, performed on a
  worker by an operator; the worker is notified.
- **Permanent pickup (§8.4.3)** — a worker claims a permanently-dropped slot for
  the remaining weeks, with per-week time-conflict and hours-cap screening.

Both bulk operations execute **synchronously in a single DB transaction**
(ARCHITECTURE.md §7.5) — they are not orchestrator passes — because each needs
an immediate confirmation summary before the worker submits.

The phase spans four behavioral surfaces:

| Surface                                                   | Lives in                                                               | Tested with |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| Permanent-drop occurrence partition (affected vs skipped) | `packages/core/src/permanent-ops/drop-scope` (PURE) — **TDD-red**      | Vitest      |
| Float-commitment UI warning (report-only)                 | `packages/core/src/permanent-ops/drop-scope` (PURE) — **TDD-red**      | Vitest      |
| Permanent-pickup per-week conflict + cap evaluation       | `packages/core/src/permanent-ops/pickup-per-week` (PURE) — **TDD-red** | Vitest      |
| Atomic bulk drop / pickup + notifications + feed removal  | `permanent_drop_slot` / `permanent_pickup_slot` RPCs — **TDD-red**     | pgTAP       |

**Architecture split (the phase-07 audit's C6a anti-drift rule, carried from
phase-08/09).** Pure decision surfaces in TypeScript; atomic execution in SQL;
no duplicated logic across the two.

- **Pure decision surfaces in TypeScript** — the drop occurrence partition
  (which seats the bulk UPDATE will vacate, and why each excluded seat is
  excluded), the float-commitment warning (which live floats to flag), and the
  per-week pickup evaluation (which blocks to queue, and the confirmation-popup
  tallies). These run in the permanent-ops Edge Functions; they have no DB-side
  twin.
- **Atomic execution in SQL** — the single-transaction bulk UPDATEs, the
  `scheduling_periods` boundary lookup + missing-row error, the SM / SW
  notification inserts, and the race-safe pickup predicate live in SQL RPCs.
  The RPC WHERE-clauses are the SQL-side **re-check** of the same partition the
  pure functions computed at popup time (the ownership + future + regular +
  semester-boundary predicates for the drop; the `vacant`/`permanent_drop`
  predicate for the pickup).

The **transaction-time re-check** (§8.4.3 / ARCH §7.2 step 6) is therefore _not
a new surface_: it is `evaluatePermanentPickup` re-run against a fresh snapshot,
exactly as phase-09's acceptance guard re-runs `evaluateSwapEligibility`. A
pickup eligible in the popup can become ineligible at submit (the picker gained
a conflicting shift; the cap was lowered; another worker claimed a week). The
pure re-run drops the now-ineligible week; the SQL `vacant`/`permanent_drop`
predicate is the final backstop for the concurrent-claim race.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §8.4.1 (permanent drop — popup type choice; atomic bulk-vacate of every future
  occurrence the worker owns; "current semester's regular_school_year period,
  **not** the contiguous run between break interruptions"; exclusions: mid-shift,
  past-this-week, not-currently-owned; embedded short breaks naturally excluded;
  partial-slot drop; SM in-app notification; the worker's own updates-tab
  record), §8.4.2 (SM/HM removal — same scope; the worker receives an in-app
  notification identifying the slot, operator, and period), §8.4.3 (permanent
  pickup — per-week time-conflict (block-level skip; whole-week skip if all
  conflict) and hours-cap check (**whole-week skip whether soft or hard** — the
  conservative divergence from a temporary claim); confirmation summary;
  transaction-time re-check; feed removal regardless of completeness; skipped
  weeks enter the weekly feed individually), §8.4.4 (boundary cases — break-week
  exclusion; end-of-semester scoping; drop-then-re-pickup; zero-eligible-weeks;
  pick-up-then-temp-drop), §8.4.5 (distinctness from temp drop/claim/swap),
  §9.2 (the calendar week), §9.3 (soft = 20h / hard = 40h), §10 (SM in-app
  notification routing; worker in-app removal notification)
- `ARCHITECTURE.md`
  §7.1 (permanent drop procedure — the `scheduling_periods.end_date` point
  lookup; the no-row application-layer error; the exact bulk-UPDATE predicate;
  the `status NOT IN ('floated_out','pending_float_out')` no-takeback trailing
  clause; the float-commitment UI-warning query; the SM + SW notification
  inserts; the key safety properties), §7.2 (permanent pickup procedure —
  candidate identification; per-week skip-conflict / skip-cap; confirmation
  summary; the transaction-time re-run; the race-safe submit UPDATE with the
  `is_cross_house_pickup`/`source_house_id` field-setting and the Harnwell
  precheck; feed removal), §7.3 (re-permanent-drop after pickup), §7.4 (profile
  boundary), §7.5 (synchronous, not orchestrator-driven), §10 (atomicity)
- `AGENTS.md` — hard invariant #1 (Harnwell training — enforced at the pickup
  write point), #3 (no-takeback — a pending/acknowledged float survives the
  drop), #4 (float-out hours are still the worker's hours — `currentWeeklyHours`
  is float-neutral), #5 (30-minute blocks → 0.5h each), #6 (NY timestamptz).

Test files:

- `packages/core/tests/phase-10/fixtures.ts` — shared contract types + builders
  (drop-occurrence, drop-input, float-commitment, pickup-block / pickup-week /
  pickup-input builders, house + worker constants, the noon-anchored date
  helpers). Re-exports the contract types from
  `../../src/permanent-ops/types.js` so any drift between the implementation and
  the tests surfaces as a TypeScript error (the phase-06/07/08/09 discipline).
- `packages/core/tests/phase-10/drop-scope.test.ts` — Vitest: the permanent-drop
  occurrence partition (every exclusion + skip-reason precedence + the semester
  boundary + the null-boundary rejection) and the float-commitment UI warning.
  **TDD-red** until `scopePermanentDrop` / `findFloatCommitmentWarnings` land.
- `packages/core/tests/phase-10/pickup-per-week.test.ts` — Vitest: the per-week
  pickup evaluation (time-conflict partial/full skip; hours-cap **soft AND hard**
  whole-week skip; the strict-`>` cap boundary; conflict-before-cap ordering;
  the confirmation tallies; the transaction-time re-check; the zero-eligible
  edge). **TDD-red** until `evaluatePermanentPickup` lands.
- `supabase/tests/phase-10-bulk-ops.sql` — pgTAP: the `permanent_drop_slot` /
  `permanent_pickup_slot` RPCs — atomic bulk vacate/assign, the correct rows
  updated, the `scheduling_periods` missing-row error, the SM + SW
  notifications, the race-safe partial pickup, the cross-house field-setting,
  the Harnwell rejection, permanent-feed removal, and re-drop+re-pickup — 39
  assertions. **TDD-red** until the phase-10 migration adds the RPCs.

---

## The Function Contracts (TDD-first)

The implementation goes in `packages/core/src/permanent-ops/` and the phase-10
migration. Until they land, the test files that import them fail at the first
import line — the intended TDD-red state, identical to phase-06/07/08/09.

### Pure decision surfaces

```ts
// packages/core/src/permanent-ops/types.ts
export type DropOccurrenceProfile = 'regular_school_year' | 'short_break' | 'winter_break' | string;
export type DropFloatStatus = 'none' | 'floated_out' | 'pending_float_out';

export type DropOccurrence = {
  assignmentId: string;
  weekStartDate: string;
  occurrenceStartAt: Date; // block_start_at (timestamptz)
  occurrenceDate: string; // block_start_at's NY-local YYYY-MM-DD
  currentOwnerUserId: string | null;
  profile: DropOccurrenceProfile;
  floatStatus: DropFloatStatus;
};

export type PermanentDropScopeInput = {
  droppingUserId: string;
  dropInitiatedAt: Date;
  semesterEndDate: string | null; // scheduling_periods.end_date; null = lookup miss
  occurrences: DropOccurrence[];
};

export type PermanentDropSkipReason =
  | 'past_or_in_progress'
  | 'beyond_semester'
  | 'break_profile'
  | 'not_owned'
  | 'float_committed';

export type DroppedWeek = { assignmentId: string; weekStartDate: string };
export type DropSkippedWeek = DroppedWeek & { reason: PermanentDropSkipReason };
export type PermanentDropScopeResult = { affected: DroppedWeek[]; skipped: DropSkippedWeek[] };

export type FloatCommitmentRef = {
  floatId: string;
  status: 'pending' | 'acknowledged' | 'declined' | 'voided' | 'completed' | string;
  sourceAssignmentIds: string[];
};
export type FloatCommitmentWarning = { floatId: string; status: 'pending' | 'acknowledged' };

export type PickupBlock = { blockId: string; conflictsWithExisting: boolean };
export type PickupWeek = {
  weekStartDate: string;
  blocks: PickupBlock[];
  currentWeeklyHours: number; // float-neutral (invariant #4)
  capHours: number; // effective_weekly_cap → 20 | 40
  capEnforcement: 'soft' | 'hard'; // carried for fidelity; the cap decision IGNORES it
};
export type PermanentPickupInput = { weeks: PickupWeek[] };

export type PickupWeekStatus = 'fully_assigned' | 'partially_assigned' | 'skipped';
export type PickupSkipReason = 'time_conflict' | 'hours_cap';
export type PickupWeekOutcome = {
  weekStartDate: string;
  status: PickupWeekStatus;
  assignedBlockIds: string[];
  skippedBlockIds: string[];
  skipReason: PickupSkipReason | null; // null only for fully_assigned
};
export type PermanentPickupResult = {
  weeks: PickupWeekOutcome[];
  assignedBlockIds: string[]; // flattened final queued set
  totalWeeksInScope: number;
  weeksFullyAssigned: number;
  weeksPartiallyAssigned: number;
  weeksSkipped: number;
};

// packages/core/src/permanent-ops/index.ts
export function scopePermanentDrop(input: PermanentDropScopeInput): PermanentDropScopeResult;
//   throws if input.semesterEndDate is null (ARCH §7.1: do NOT proceed unbounded).

export function findFloatCommitmentWarnings(input: {
  slotAssignmentIds: string[];
  floatCommitments: FloatCommitmentRef[];
}): FloatCommitmentWarning[]; // pending/acknowledged ∧ source intersects slot; input order

export function evaluatePermanentPickup(input: PermanentPickupInput): PermanentPickupResult;
```

`scopePermanentDrop` is PURE: no I/O, no clock, no DB. It partitions the dropping
worker's recurring-slot occurrences into `affected` (the seats the bulk UPDATE
will vacate) and `skipped` (each tagged with the dominant reason for the popup).
The Edge Function snapshots the slot's occurrences + the resolved
`semester_end_date` and calls it to render the confirmation popup, then hands
`affected`'s assignment ids to `permanent_drop_slot`. The SQL WHERE-clause
re-checks the same predicates at execution time.

`findFloatCommitmentWarnings` is PURE and **report-only**: it returns the live
floats to flag in the popup ("…will NOT be cancelled…"). It never mutates a
float — the no-takeback rule (invariant #3) is enforced by leaving those seats
out of the bulk UPDATE (`float_committed`), not by the warning.

`evaluatePermanentPickup` is PURE. The Edge Function calls it for the popup, then
RE-CALLS it against a fresh snapshot at transaction time; the now-ineligible
weeks silently fall out of `assignedBlockIds` before `permanent_pickup_slot`
runs.

### SQL contracts (documented here; implemented in the phase-10 migration)

```
-- Permanent drop / SM-HM removal — ONE transaction (ARCH §7.1).
permanent_drop_slot(
  p_dropping_user_id uuid, p_house_id text, p_day_of_week integer,
  p_block_start_locals text[], p_drop_initiated_at timestamptz,
  p_operator_user_id uuid          -- NULL = worker self-initiated; else SM/HM/BM
) RETURNS jsonb
  -- 1. semester_end_date := scheduling_periods.end_date WHERE :drop_date BETWEEN
  --    start_date AND end_date AND profile_name='regular_school_year'.
  --    If NO row -> RAISE EXCEPTION 'semester_boundary_not_found' (do NOT proceed).
  -- 2. UPDATE shift_block_assignments SET user_id=NULL, status='vacant',
  --      vacancy_origin='permanent_drop'
  --    WHERE user_id = :dropping_user
  --      AND block matches (house, NY-DOW, NY-HH24:MI ∈ block_start_locals)
  --      AND block_start_at > :drop_initiated_at
  --      AND NY-date(block_start_at) <= semester_end_date
  --      AND operating_calendar.profile_name = 'regular_school_year'
  --      AND status NOT IN ('floated_out','pending_float_out');   -- no-takeback
  -- 3. INSERT sm_permanent_drop_alert for each SM of p_house_id.
  -- 4. IF p_operator_user_id IS NOT NULL AND <> p_dropping_user_id:
  --      INSERT sw_permanent_removal_alert for the worker (payload.operator_user_id).
  -- 5. RETURNS {affected_count:int, semester_end_date:date}.

-- Permanent pickup — ONE transaction, race-safe (ARCH §7.2).
permanent_pickup_slot(p_picking_user_id uuid, p_block_ids uuid[]) RETURNS jsonb
  -- 1. Harnwell precheck: if ANY block's house is 'harnwell' and the picker's
  --    home_house_id <> 'harnwell' -> RAISE EXCEPTION 'harnwell_training_required'
  --    (whole request rejected; no partial write — invariant #1).
  -- 2. UPDATE shift_block_assignments SET user_id=:picker, status='claimed',
  --      vacancy_origin='none',
  --      is_cross_house_pickup = (block.house_id <> picker.home_house_id),
  --      source_house_id = CASE WHEN cross-house THEN picker.home_house_id ELSE NULL END
  --    WHERE block_id = ANY(p_block_ids)
  --      AND status='vacant' AND vacancy_origin='permanent_drop';  -- race-safe
  -- 3. RETURNS {assigned_count:int}.  (count reflects only rows still vacant
  --    at submit; weeks claimed away between popup and submit are skipped.)
```

`p_block_ids` is `evaluatePermanentPickup(fresh snapshot).assignedBlockIds` — the
queued set after the transaction-time re-run. The `vacant`/`permanent_drop`
predicate is the SQL backstop for the concurrent-claim race; the per-week
conflict/cap logic is not re-implemented in SQL (C6a anti-drift). The permanent
openings feed (`permanent_openings_feed`, phase-05) queries
`vacant`/`permanent_drop`, so a picked-up (or claimed-away) week leaves the feed
automatically — no explicit feed-removal write.

---

## Pinned Decisions

The behavioral spec and architecture leave several implementation choices
implicit. The decisions below are pinned by the test suite — the implementation
MUST match them, and any future reinterpretation requires updating both the
tests and this plan.

| #   | Topic                                     | Decision                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                                  |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Drop partition                            | `affected` = occurrences that are FUTURE (start `>` dropInitiatedAt, strictly) ∧ within semester (NY-date `<=` semesterEndDate) ∧ `regular_school_year` ∧ owned by the dropper ∧ NOT float-committed. Everything else is `skipped` with a reason.                                                                            | BSpec §8.4.1 / ARCH §7.1 bulk-UPDATE predicate. Mirrors phase-09's `scopePermanentSwapWeeks` partition shape.                                                                                        |
| 2   | Strictly-future / mid-shift               | The boundary is `start > dropInitiatedAt`. An occurrence starting exactly at the drop moment (mid-shift) or earlier (past this week) is `past_or_in_progress`; `+1ms` is affected.                                                                                                                                           | BSpec §8.4.1 ("does not include the shift currently being worked … future occurrences are affected"); ARCH §7.1 `block_start_at > :drop_initiated_at`.                                               |
| 3   | Semester boundary is fetched, not walked  | `semesterEndDate` is `scheduling_periods.end_date` for the period whose date range contains the drop date — a point lookup, INCLUSIVE (an occurrence on the boundary date is affected). The pure function RECEIVES it; it never walks `operating_calendar`.                                                                  | ARCH §7.1 ("a single point lookup … simpler and more reliable than the recursive CTE walk"); the CTE is admin-tooling only. BSpec §8.4.1 "current semester … not the contiguous run between breaks." |
| 4   | Missing boundary → error, not unbounded   | A null `semesterEndDate` makes `scopePermanentDrop` THROW (`/semester boundary/i`); `permanent_drop_slot` RAISEs `semester_boundary_not_found` when the `scheduling_periods` lookup returns no row. Neither silently proceeds with an unbounded drop.                                                                        | ARCH §7.1 ("the system must NOT silently proceed with an unbounded drop … raise an application-layer error"). Pinned at BOTH the pure layer and the SQL layer.                                       |
| 5   | Skip-reason precedence                    | When several skip conditions apply to one occurrence the reported reason is deterministic: `past_or_in_progress` > `beyond_semester` > `break_profile` > `not_owned` > `float_committed`.                                                                                                                                    | A fixed order lets tests use equality and stabilizes the popup copy. Temporal scope is the most fundamental gate; float-commitment is last (it presupposes ownership). Mirrors phase-09 pinned #9.   |
| 6   | No-takeback survives the drop             | A seat the worker is committed to float (`floated_out` / `pending_float_out`) is `float_committed`-skipped (pure) and excluded by the `status NOT IN (...)` SQL backstop. The home-desk portion of other weeks is released; the float commitment is not.                                                                     | AGENTS invariant #3; BSpec §8.4.1; ARCH §7.1 trailing clause + UI-warning paragraph.                                                                                                                 |
| 7   | Float warning is report-only              | `findFloatCommitmentWarnings` returns the `pending`/`acknowledged` floats whose source side intersects the slot, in input order — for the popup. `declined`/`voided`/`completed` are not flagged. It NEVER cancels a float.                                                                                                  | ARCH §7.1 ("…will NOT be cancelled by this permanent drop … purely a UI warning"); invariant #3. Mirrors phase-09's read-only `findConflictingPendingSwaps`.                                         |
| 8   | Notification routing                      | A permanent drop always inserts ONE `sm_permanent_drop_alert` per SM of the house. The dropping worker is NOT sent a removal alert when self-initiated. An SM/HM-initiated removal (operator ≠ worker) additionally inserts an `sw_permanent_removal_alert` whose payload names the operator.                                | BSpec §8.4.1 / §8.4.2 / §10; ARCH §7.1 steps 4–5. The operator-identity payload satisfies "identifies … the operator who initiated the removal."                                                     |
| 9   | Pickup: conflict (4b) before cap (4c)     | Per week, conflicting blocks are removed first; the cap is then computed on the NON-conflicting remainder (`currentWeeklyHours + 0.5 × non-conflicting`). So removing a conflict can keep a week under cap (a PARTIAL assignment, not a cap skip).                                                                           | ARCH §7.2 step 4 ordering; BSpec §8.4.3 ("only the non-overlapping blocks are picked up … projected total after the non-conflicting blocks are added").                                              |
| 10  | Soft cap ALSO skips the week              | If projected hours `>` cap, the ENTIRE week is `hours_cap`-skipped — whether the cap is soft or hard. `capEnforcement` is carried on the input for fidelity but the cap decision deliberately ignores it. This is the conservative divergence from a one-off temporary claim (which would warn-and-allow on soft).           | BSpec §8.4.3 ("regardless of whether the cap is soft or hard … more conservatively than one-off temporary claims"); ARCH §7.2 step 4c. THE crux of this phase.                                       |
| 11  | Cap boundary is strict `>`                | Projected EXACTLY at the cap is allowed (fully/partially assigned); one block over is skipped. Matches the phase-05 claim predicate `(blocks+1)*0.5 > cap`.                                                                                                                                                                  | §9.3; consistency with `claim_open_shift`. 0.5h per block (invariant #5).                                                                                                                            |
| 12  | Partial ⇒ time_conflict only              | A `partially_assigned` week's `skipReason` is always `time_conflict` — a cap violation skips the WHOLE week, never part of it. `fully_assigned` ⇒ `skipReason` null.                                                                                                                                                         | ARCH §7.2 (cap is per-week all-or-nothing; conflict is per-block). BSpec §8.4.3 confirmation summary distinguishes "partially assigned (with reason for skipped portion)."                           |
| 13  | Re-check = re-run on a fresh snapshot     | The transaction-time re-check is `evaluatePermanentPickup` re-run on a fresh input. A week that gained a conflict or whose cap was lowered between popup and submit silently drops from `assignedBlockIds`. The SQL `vacant`/`permanent_drop` predicate handles the concurrent-claim race (another worker claimed the week). | BSpec §8.4.3 / ARCH §7.2 step 6. No second copy of the conflict/cap rule (C6a anti-drift), exactly like phase-09's acceptance-guard re-run.                                                          |
| 14  | Pickup is race-safe + atomic              | `permanent_pickup_slot` claims a block only while it is still `vacant`+`permanent_drop`; `assigned_count` reflects the rows actually claimed (partial when a week was claimed away). Zero eligible weeks still succeeds (`assigned_count` 0). The slot leaves the permanent feed regardless of completeness.                 | ARCH §7.2 step 6 race-safe predicate + step 8 feed removal; BSpec §8.4.3 ("removed from the permanent openings feed regardless of whether complete or partial"). §10 atomicity.                      |
| 15  | Cross-house + Harnwell at the write point | A pickup whose slot house ≠ picker home sets `is_cross_house_pickup=true` / `source_house_id = picker home`. A non-Harnwell-home picker picking a Harnwell slot is REJECTED (`harnwell_training_required`), whole request, no partial write.                                                                                 | ARCH §7.2 steps 1–2; AGENTS invariant #1 ("under any mechanism"). Mirrors the phase-05 claim cross-house field-setting.                                                                              |
| 16  | Drop ⇆ re-pickup is allowed               | A worker may drop a slot then re-pick-up the same slot while it is still `vacant`+`permanent_drop` and unclaimed by another. The procedure is the standard pickup (ARCH §7.3 reverse of §7.1).                                                                                                                               | BSpec §8.4.4 boundary case; ARCH §7.3.                                                                                                                                                               |

---

## Test File Coverage Map

### `drop-scope.test.ts` (Vitest) — TDD-red

| Surface                                                                                                   | Cases | Pinned decisions |
| --------------------------------------------------------------------------------------------------------- | ----- | ---------------- |
| Drop partition — typical mix; all-affected                                                                | 2     | #1               |
| Future boundary — mid-shift (exactly-at); +1ms in scope                                                   | 2     | #2               |
| Semester boundary — inclusive on-boundary; next semester; fall→spring; null→throw                         | 4     | #3, #4           |
| Embedded-break exclusion — short break; slot resumes after the break                                      | 2     | #1               |
| Ownership exclusion — other-owner; vacant week                                                            | 2     | #1               |
| Float-commitment preservation — floated_out; pending_float_out; none-is-affected                          | 3     | #6               |
| Skip-reason precedence — past>own; beyond>break; break>own; break>float                                   | 4     | #5               |
| Empty occurrence set                                                                                      | 1     | #1               |
| Purity — stable output, no input mutation                                                                 | 2     | —                |
| `findFloatCommitmentWarnings` — flag pending/ack; skip dead statuses; no intersection; empty; report-only | 5     | #7               |

**Total: 27 cases.**

### `pickup-per-week.test.ts` (Vitest) — TDD-red

| Surface                                                                                       | Cases | Pinned decisions |
| --------------------------------------------------------------------------------------------- | ----- | ---------------- |
| Fully-assigned week                                                                           | 1     | #9, #11          |
| Time conflict — partial; full-week skip                                                       | 2     | #9, #12          |
| Hours cap — SOFT skip; HARD skip; strict-`>` boundary; cap-on-remainder; remainder-still-over | 5     | #9, #10, #11     |
| Multi-week confirmation summary — full+partial+cap-skip+conflict-skip tallies                 | 1     | #10, #12         |
| Transaction-time re-check — gained conflict; cap lowered                                      | 2     | #13              |
| Zero eligible weeks                                                                           | 1     | #14              |
| Empty week set                                                                                | 1     | —                |
| Purity — stable output, no input mutation                                                     | 2     | —                |

**Total: 15 cases.**

### `phase-10-bulk-ops.sql` (pgTAP) — TDD-red

| Section / Surface                                                                                                                                                                                         | Assertions |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A. Function existence — `permanent_drop_slot`, `permanent_pickup_slot`                                                                                                                                    | 2          |
| B. Permanent drop (self) — affected_count + semester_end_date; w1/w4 vacated; past/in-progress/other-owner/float/break/next-semester all skipped; SM notified; worker not notified                        | 15         |
| C. SM/HM-initiated removal — affected_count; vacant+permanent_drop; sw_permanent_removal_alert; operator payload                                                                                          | 4          |
| D. Semester-boundary error — `semester_boundary_not_found` throw on missing `scheduling_periods` row                                                                                                      | 1          |
| E. Permanent pickup — feed-before; race-safe partial (1 of 2); claimed/owner/origin/cross-house fields; raced-away week intact; feed-after removal; cross-house field-set; Harnwell rejection + untouched | 13         |
| F. Re-drop + re-pickup — re-drop vacates; back in feed; re-pickup; worker owns again                                                                                                                      | 4          |

**Total: 39 assertions.**

---

## What This Phase Does NOT Cover

- **The permanent-ops Edge Functions' HTTP layer** — request parsing, auth-token
  → user resolution, the popup type-choice prompt ("this week only / permanently"),
  response shaping, notification delivery (push/email/SMS). This phase ends at the
  pure decision surfaces, the atomic SQL contracts, and "a notification ROW was
  generated."
- **The recurring-occurrence resolver.** Both pure functions take a pre-resolved
  list (the drop's occurrences; the pickup's per-week blocks + current hours +
  cap). The SQL that enumerates a recurring slot's future blocks (house + NY
  day-of-week + NY block-start, within the semester period) is exercised inside
  `permanent_drop_slot`'s WHERE-clause in the pgTAP suite, with a single fixed
  recurring slot; the pure `scopePermanentDrop` partition is over the resolved
  occurrence list, not the enumeration SQL.
- **The hours snapshot and `effective_weekly_cap`.** `evaluatePermanentPickup`
  receives `currentWeeklyHours` (float-neutral per invariant #4) and `capHours`
  / `capEnforcement` already resolved by `effective_weekly_cap` (phase-05). This
  phase does not re-test that resolution; it pins only how the pickup CONSUMES
  the cap (soft and hard alike → skip).
- **Skipped-week weekly-feed re-entry.** §8.4.3 says skipped weeks surface
  individually in the weekly feed as they cross the 30-day horizon and undergo
  standard escalation. That is the phase-05 feed / phase-07 escalation
  machinery, unchanged; this phase pins only that the skipped weeks are NOT
  re-exposed in the PERMANENT feed (feed-removal-regardless-of-completeness).
- **Partial-slot drop block enumeration.** §8.4.1 allows dropping a contiguous
  block subset (e.g. 22:00–24:00 of a 19:00–24:00 slot). The pure partition
  operates per-occurrence regardless of how many blocks the slot has; the
  contiguous-subset selection is the Edge Function's `p_block_start_locals`
  argument, exercised in pgTAP via the single-time-band slot. The
  contiguity/UI-selection rule itself is out of scope.
- **Profile-boundary feed teardown (§7.4).** When a profile ends, the permanent
  feed empties and the next profile is built fresh. That is calendar-population
  / period-rollover tooling, not a permanent-ops transaction.
- **Permanent SWAP (§8.3).** A distinct, atomic two-party exchange — covered by
  phase-09. Permanent drop + permanent pickup are two independent operations
  with an open period between them; that distinctness (§8.4.5) is documented,
  not re-tested here.

---

## Why TDD-Red (and how the contracts were validated)

Phase-06/07/08/09 established the TDD-red pattern: tests import a not-yet-existing
module path and fail at import; the implementation lands in a follow-up commit
and turns them green. Phase-10 follows it for all three test surfaces:

- `drop-scope.test.ts` and `pickup-per-week.test.ts` import
  `../../src/permanent-ops/index.js`, which does not exist yet → red.
- `phase-10-bulk-ops.sql` references `permanent_drop_slot` /
  `permanent_pickup_slot`, which do not exist yet → red. Like phase-09 (a NEW
  table + RPCs), the pgTAP is necessarily TDD-red until the migration lands.

The pure-function contracts in this plan were verified implementable: a scratch
`packages/core/src/permanent-ops/` implementation matching pinned decisions
#1–#16 turned all 42 Vitest cases green and type-checked clean against the
workspace's strict config (`noUncheckedIndexedAccess`), then was removed so the
deliverable remains tests-only. The pgTAP fixtures were validated against the
live local schema (every INSERT succeeds; the recurring slot resolves to 8
weekly blocks at one house/DOW/time; `scheduling_periods.end_date = 2026-08-09`
correctly places w4 (`2026-08-06`) in-semester and w_next (`2026-08-13`) beyond;
the embedded-break date maps to `short_break`), and the suite runs red on the
two missing RPCs exactly as intended — the same role the Vitest TDD-red plays
for the pure surfaces.
