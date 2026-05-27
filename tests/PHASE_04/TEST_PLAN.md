# Phase 04 — Test Plan: Schedule Builder

This plan enumerates every test for phase-04, the spec section each
test covers, and the ambiguities that were surfaced and resolved
before implementation.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md` §4.1 (preference submission)
- `BEHAVIORAL_SPECIFICATION.md` §4.2 (submission deadline + reminders)
- `BEHAVIORAL_SPECIFICATION.md` §4.3 (3-phase schedule building)
- `ARCHITECTURE.md` §2.10 (`scheduling_periods` table)
- `ARCHITECTURE.md` §3.6 (`preferences`, `period_targets` schema)
- `ARCHITECTURE.md` §3.9 (`draft_block_assignments` + publish operation)
- `AGENTS.md`

Test files:

- `supabase/tests/phase-04-preferences.sql` — pgTAP, 79 assertions
- `supabase/tests/phase-04-publish.sql` — pgTAP, 31 assertions
- `packages/core/tests/phase-04/phase1-grouping.test.ts` — Vitest, ≈22 cases

---

## pgTAP — `phase-04-preferences.sql`

### §1. Tables exist (3)

`preferences`, `period_targets`, `draft_block_assignments`
(ARCH §3.6, §3.9).

### §2. Enums (2)

- `preference_status_enum` exists.
- Labels = `{preferred, available, cannot, none}` exactly (ARCH §3.6).

### §3. `preferences` shape (13)

Columns (`user_id`, `block_id`, `period_id`, `status`), all uuid /
`preference_status_enum`, all NOT NULL. Composite PK on the three
keying columns — one preference row per (worker, block, period).

### §4. `period_targets` shape (12)

Columns (`user_id`, `period_id`, `target_hours`, `opted_out`), types
uuid / uuid / integer / boolean, NOT NULL on everything except
`target_hours` (which is implicitly allowed to be NULL only by the
implementer's choice — but every test inserts a value, so the practical
contract is "specify or default"). Composite PK on (`user_id`, `period_id`).

### §5. Foreign keys (5)

- `preferences.user_id → users(user_id)`
- `preferences.block_id → shift_blocks(block_id)`
- `preferences.period_id → scheduling_periods(period_id)`
- `period_targets.user_id → users(user_id)`
- `period_targets.period_id → scheduling_periods(period_id)`

### §6. RLS enabled (4)

`preferences` and `period_targets` both have RLS on with a
`service-role bypass` policy. User-scoped policies (workers reading
their own preferences, SMs reading the house's preference roster)
are introduced in the same migration; the assertion here is only
on the existence of the service-role bypass and RLS-enabled flag.
The richer per-role read policies are exercised behaviorally in §9
via the deadline-enforcement assertions, which would fail loudly
if the trigger logic mis-scoped the period lookup.

### §7. `target_hours` bounds (4)

BEH §4.1 — target ranges from 0 to applicable cap (regular_school_year
= 20). Tests cover:

- `target_hours = 0` accepted (worker wants zero hours).
- `target_hours = -1` rejected (must be ≥ 0).
- `target_hours = 21` rejected (above cap).
- `target_hours = 20` accepted (exact cap).

Mechanism unspecified — implementer may use a CHECK or a trigger that
joins `operating_profiles` to look up the cap. The fixture only seeds
the `regular_school_year` profile, so the cap-aware check has a
deterministic value to compare against.

### §8. `opted_out` default (1)

`opted_out` defaults to false. A worker who never clicks "no hours"
should leave the column false. Clicking "no hours" flips it to true
(BEH §4.1).

### §9. Deadline enforcement (5)

BEH §4.2 — preferences cannot be changed after `preference_deadline`.
Tests cover:

- Insert succeeds on a period whose deadline is in the future.
- Update succeeds on a period whose deadline is in the future.
- Insert rejected on a period whose deadline has passed.
- `period_targets` insert rejected on a period whose deadline has passed.
- Insert succeeds on a period whose `preference_deadline IS NULL`
  (window not yet opened). This matches ARCH §2.10 ("Null until the SM
  sets it") — the lock fires AFTER deadline, not before SM has opened
  submission. BEH §4.2 says null-deadline → no reminders, but does not
  pre-emptively lock writes.

### §10. Re-submission after opt-out (2)

BEH §4.1 — a worker who clicked "no hours" remains claim-eligible and
may change their mind by submitting preferences before the deadline.
Tests cover:

- After `opted_out=true`, a preference INSERT still succeeds before deadline.
- The worker may also flip `opted_out` back to false in the same window.

### §11. Cross-period isolation (1)

Creating a new `scheduling_periods` row and writing preferences for it
leaves prior-period preference rows unchanged. The composite PK
ensures one (worker, block, period) — `period_id` is load-bearing for
isolation.

### §12. FK rejection on non-existent block (1)

A preference referencing a `block_id` not present in `shift_blocks`
is rejected. This is the basic FK assertion; it pins the data-integrity
contract that the schema-builder UI cannot insert a "ghost" preference.

### §13. `draft_block_assignments` shape (18)

All 6 columns: `draft_assignment_id`, `period_id`, `block_id`,
`user_id`, `created_at`, `created_by`. Types pinned. Primary key on
`draft_assignment_id`. **There is no `status` column** — every draft
row is implicitly a tentative scheduled assignment (ARCH §3.9: "carries
no status column"). A negative `hasnt_column` test pins this so the
migration does not slip a status enum in.

FKs to `scheduling_periods`, `shift_blocks`, and `users` (×2 — once
for the assignee `user_id`, once for `created_by`).

### §14. Draft uniqueness (3)

- First (period, block, user) draft row accepted.
- Duplicate (same period, block, user) rejected. The constraint is
  `UNIQUE(period_id, block_id, user_id)` — same worker cannot be
  drafted twice into the same seat.
- Different worker on the same block is allowed (multi-headcount blocks
  carry up to `required_headcount` draft rows). The "at most one per
  seat" wording in the prompt is interpreted here as "same worker can't
  occupy two seats of the same block"; per-block headcount enforcement
  is a draft-UI concern (the UI prevents drafting beyond headcount).
  See **Ambiguity 1** below.

### §15. Draft RLS (4)

- RLS enabled.
- service-role bypass policy exists.
- **No** authenticated-by-`user_id` SELECT policy exists. Workers MUST
  NOT see drafts (ARCH §3.9: "workers' calendar query never reads
  draft_block_assignments"). The test scans `pg_policies` for any
  policy whose `qual` text mentions `auth.uid` and `user_id` and
  asserts zero matches.
- A house-admin SELECT policy exists (SMs/HMs/BMs of the house can
  read the draft via the schedule-builder UI). The test does not
  pin the policy's name — only that one user-scoped, authenticated
  SELECT policy other than service-role bypass exists.

### §16. No plain timestamp columns (1)

ARCH §1.6 — every timestamp is timestamptz. Zero `timestamp without
time zone` columns across the three new tables.

---

## pgTAP — `phase-04-publish.sql`

The tests describe the observable behavior of the
`publish_schedule(p_period_id uuid)` Postgres function.

### §0. Fixtures

Two SM users, four SWs (two at Harnwell, two at Quad), one SM at
Harnwell. Two scheduling periods (A: open and ready for publish; B:
control period whose preference window is still open). Four shift
blocks: B1 (Harnwell 10:00, hc=2), B2 (Harnwell 10:30, hc=2), B3
(Quad 14:00, hc=3), C1 (Harnwell 2027 — belongs to period B). Drafts
in period A: B1×1, B3×3; B2 has zero drafts.

### §1. Function signature (1)

`publish_schedule(uuid) → void` exists. Return type not asserted —
implementer may return void, a count, or a row of counts. The
behavioral assertions in §4–§7 do not depend on the return value.

### §2. Pre-publish invariants (3)

Before publish:

- Zero `shift_block_assignments` rows reference period A's blocks.
- `scheduling_periods.published_at IS NULL`.
- Four draft rows exist for period A.

### §3. Publish executes (1)

`SELECT public.publish_schedule('period_A')` runs without error.

### §4. Drafted seats become scheduled assignments (4)

- 4 scheduled rows total (one per draft row).
- B1 has exactly one scheduled row for user-1.
- B3 has exactly 3 scheduled rows.
- All scheduled rows carry default flags: `vacancy_origin='none'`,
  `is_float=false`, `is_cross_house_pickup=false`,
  `source_house_id=NULL`.

### §5. Undrafted seats become vacant assignments (4)

- 3 vacant rows total (B1: 1 missing, B2: 2 missing, B3: 0 missing).
- B2 specifically: 2 vacant rows with `vacancy_origin='never_assigned'`
  and `user_id IS NULL`.
- B1: 1 vacant row with `vacancy_origin='never_assigned'`.
- Total assignment rows across period A blocks = 7 (= sum of headcounts
  across the three blocks: 2+2+3).

### §6. Draft cleanup (1)

`draft_block_assignments` for period A is empty after publish.

### §7. `published_at` is set (2)

- `published_at IS NOT NULL` after publish.
- `published_at` is approximately `now()` (within ±5 s of publish time)
  — pinning that step 4 runs in the same transaction, not deferred.

### §8. Period isolation (3)

Publishing period A does not affect period B:

- Period B drafts unchanged (still 1 row).
- Period B `published_at` still NULL.
- Period B blocks (C1) have no assignment rows.

### §9. Re-publish guard (3)

Re-invoking `publish_schedule('period_A')` after publish is either a
silent no-op or an explicit error. Either way:

- scheduled-row count for period A is unchanged.
- vacant-row count for period A is unchanged.
- `draft_block_assignments` for period A remains empty.

The test wraps the second call in an `EXCEPTION WHEN OTHERS` block so
both resolutions pass. The behavior the test is pinning is "no
duplication, no draft regression," not the specific choice of
error vs. no-op. See **Ambiguity 2**.

### §10. Atomicity (2)

A third period C has a pre-existing `shift_block_assignments` row on
one of its blocks (simulating an inconsistent state the publish must
either reconcile or refuse). The publish attempt is wrapped in
`EXCEPTION WHEN OTHERS`. The assertions:

- On failure: `draft_block_assignments` for period C is unchanged
  (atomic rollback — no partial draft deletion).
- On failure: `scheduling_periods.published_at` for period C remains
  NULL.

Both assertions are vacuous in the success branch (UPSERT-style
implementation); they constrain the failure branch only. The harness
does not assert which branch is taken because BEH §4.3 / ARCH §3.9 do
not mandate the disposition of stray pre-existing rows.

### §11. Worker visibility contract (1)

D2 (the only seat in period C with no pre-existing row, draft-only)
has zero `shift_block_assignments` after a failed publish. This pins
that the draft does NOT live in `shift_block_assignments` between SM
edit and publish — the workers' calendar query is safe to read
`shift_block_assignments` without a published-period filter on this
table alone. The published-period filter is still required at the
worker visibility layer (BEH §4.3 Phase 3) because of post-publish
manual overrides.

### §12. Zero-draft publish (4)

A period with zero draft rows publishes cleanly:

- `publish_schedule` runs without error.
- Every seat in every block becomes a vacant assignment row
  (2+3=5 across the two seeded blocks).
- Every such row has `vacancy_origin='never_assigned'` and
  `user_id IS NULL`.
- `published_at` is still set.

This is the "SM published an empty schedule" case from the prompt's
edge cases. The orchestrator picks up these vacant rows for normal
escalation processing.

### §13. Post-publish manual override path (1)

After publish, a new `shift_block_assignments` INSERT (scheduled,
no draft round-trip) succeeds. BEH §4.3 Phase 3: "the SM retains
override capability after publishing." ARCH §3.9: "post-publish
manual overrides write directly to `shift_block_assignments` (no
draft round-trip)."

### §14. Orchestrator-readable vacant rows (1)

The published vacant rows match the orchestrator's query shape
(`status='vacant'`). A `cmp_ok ≥ 3` confirms the count is at least the
expected number; we use `>=` rather than `=` because the publish in
§3 + zero-draft publish in §12 contribute together to the global
total of vacant rows in the test schema.

---

## Vitest — `packages/core/tests/phase-04/phase1-grouping.test.ts`

The Phase-1 card grouping algorithm is a pure function. The test file
exercises it across the three group destinations, the reason-attribution
contract for blocked workers, multi-worker ordering, and edge cases on
span size.

### Function contract

```ts
function groupWorkersForSpan(
  workers: Worker[],
  span: SpanBlock[], // length 2..12, ordered by blockStartAt
  preferences: PreferenceRecord[],
): GroupingResult;
```

`GroupingResult.{preferred,available,blocked}` each contain
`GroupedWorker[]`, sorted alphabetically by `worker.name`. A blocked
worker carries a `blockedReason` identifying the FIRST block in span
order that triggered the block — either `kind: 'cannot'` or
`kind: 'missing'`. The reason kind is determined by the triggering
block, not by precedence between kinds.

### Test groups

- **PREFERRED group (3 cases).** All-preferred, mixed preferred+available,
  and preferred-or-available with no cannot/missing → all land in preferred.
- **AVAILABLE group (2 cases).** All-available across span 2 and span 4
  → available, not preferred.
- **BLOCKED via cannot (3 cases).** Any cannot blocks the worker; reason
  identifies the first cannot block in span order; one cannot among 12
  blocks still blocks.
- **BLOCKED via missing (4 cases).** No preferences at all → blocked with
  missing reason on the first block; one missing block → blocked with
  missing reason on that block; cannot earlier than missing → reason is
  cannot; missing earlier than cannot → reason is missing (span order, not
  severity, drives reason).
- **Multi-worker (3 cases).** Three workers fan out into three groups;
  same-group workers ordered alphabetically; every input worker appears
  in exactly one output group (no drops, no duplicates).
- **Scoping (2 cases).** Preferences for blocks outside the span are
  ignored; preferences for other users do not leak into the target
  user's grouping.
- **Span size (2 cases).** Min span (2) and max span (12, = 6 hours per
  BEH §4.3) both group correctly.

Total: 19 test cases distributed across 7 `describe` blocks.

---

## Deferred coverage (not in phase-04)

| Surface                                                  | Deferred to | Reason                                                                                                                                                                     |
| -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preference reminder cron behavior (5d/3d/1d)             | phase-07    | The cron / scheduled-task layer is owned by the orchestrator. Phase-04 tests pin the deadline-driven write lock; the reminder filtering query lives with the orchestrator. |
| Phase-2 full-roster card UI logic                        | phase-09    | Phase 2 is a UI affordance over the same draft table; no new pure logic is required.                                                                                       |
| Post-publish notification fan-out                        | phase-08    | The notifications table and dispatcher are scoped to phase-08.                                                                                                             |
| Hours-cap warning popup ("would push over target hours") | phase-09    | Warning is a UI render; the underlying capacity calculation reuses §9.1 logic landed in phase-02.                                                                          |
| Permanent shift swap accept-reject UI (BEH §4.5)         | phase-08    | Permanent swaps mechanic lives in the swap system, which is phase-08.                                                                                                      |

---

## Ambiguities — resolved

| #   | Surface                                                                          | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Draft uniqueness — "same house + block_id can have at most one draft assignment" | Interpreted as **UNIQUE(period_id, block_id, user_id)** — a single worker cannot be drafted twice into the same seat at the same block. Multi-headcount blocks legitimately carry up to `required_headcount` draft rows for distinct workers; per-block headcount enforcement is a draft-UI concern (the prompt's wording would otherwise contradict ARCH §3.2 multi-headcount blocks). Test §14 covers both directions: duplicate (period, block, user) rejected; different user on the same block accepted. |
| 2   | Re-publish guard — error or no-op?                                               | The publish_schedule function may either silently no-op or raise an error on a second invocation against an already-published period. BEH/ARCH do not mandate either choice. Test §9 wraps the second call in `EXCEPTION WHEN OTHERS` and asserts only that scheduled/vacant row counts and draft emptiness are unchanged.                                                                                                                                                                                    |
| 3   | Publish atomicity scope — what triggers rollback?                                | Test §10 exercises the case where the period contains a pre-existing `shift_block_assignments` row (atypical, but possible if a buggy admin operation created one). The publish must either reconcile (UPSERT) or fail-and-rollback; both are acceptable. The test only asserts the rollback branch's atomicity (drafts intact, published_at NULL on failure) — both branches pass.                                                                                                                           |
| 4   | `preference_deadline IS NULL` — write-locked or unlocked?                        | **Unlocked.** ARCH §2.10 ("Null until the SM sets it") frames null as the pre-open state. BEH §4.2 ("preferences cannot be changed after the deadline") fires only after the deadline; pre-open is not "after." Test §9 last assertion pins this — null deadline accepts writes.                                                                                                                                                                                                                              |
| 5   | Workers' calendar visibility filter                                              | The published-period filter is enforced at the **read layer** (RLS or app-side query), not at the write layer. Phase-04 tests pin the DB invariant that the publish operation makes assignments queryable; phase-09 owns the calendar render's `published_at IS NOT NULL` filter.                                                                                                                                                                                                                             |
| 6   | Phase-1 grouping — "blocked reason" precedence between cannot and missing        | **First block in span order wins**, regardless of kind. A `cannot` earlier than a `missing` produces a `kind: 'cannot'` reason; a `missing` earlier than a `cannot` produces a `kind: 'missing'` reason. BEH §4.3 says "The card explicitly identifies which block triggered the block" — singular "block," implying first-by-position. Two Vitest cases (`cannot wins over missing when both present` and `missing earlier than cannot → reason is missing`) pin this.                                       |
| 7   | Reminder cron in phase-04?                                                       | **Deferred to phase-07.** The DB layer in phase-04 is the source of truth for `preference_deadline` — the cron consumer (a scheduled task or orchestrator step) reads it. The reminder-filtering query ("workers who have not submitted") is a SELECT that joins `preferences` and `period_targets` against `users`; that query is an orchestrator concern. Phase-04 covers the underlying DB invariants the reminder query depends on (cross-period isolation, opt-out flag, deadline write-lock).           |
| 8   | `period_targets.target_hours` upper bound mechanism                              | **CHECK constraint or trigger** — implementer's choice, but the cap must come from `operating_profiles.default_hours_cap` for the period's profile. The test seeds only `regular_school_year` (cap = 20) and asserts `21` rejected, `20` accepted. The implementer may either hard-code the regular_school_year cap or join on `operating_profiles`; both pass the test.                                                                                                                                      |
| 9   | Draft RLS — workers see nothing, but who reads it via `authenticated`?           | **House admins (SMs/HMs/BMs) only.** Test §15 asserts (a) no `auth.uid()=user_id` SELECT policy exists, and (b) at least one authenticated-role policy other than service-role bypass exists. The exact policy name and predicate are not pinned because they will use the `user_has_house_admin_role()` helper introduced in phase-02; the test only constrains "no worker-self read, yes house-admin read."                                                                                                 |

---

## How to run

```bash
# pgTAP (requires `supabase start` first)
supabase test db

# Vitest (will fail at import until src/scheduling/phase1Grouping.ts exists — TDD-first)
pnpm --filter @shift/core test
```
