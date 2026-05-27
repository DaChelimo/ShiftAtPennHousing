# Phase 03 — Test Plan: Block Model and Calendar Generation

This plan enumerates every test for phase-03, the spec section each
test covers, and the resolutions for ambiguities that were surfaced
before implementation.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md` §1.4 (time conventions, date attribution, DST)
- `BEHAVIORAL_SPECIFICATION.md` §1.5 (30-min block atomicity, shift = list of blocks)
- `ARCHITECTURE.md` §1.6 (America/New_York anchor, timestamptz, DST handling)
- `ARCHITECTURE.md` §1.7 (block-based shift model)
- `ARCHITECTURE.md` §3.2 (Approach A: `shift_blocks` + `shift_block_assignments`)
- `ARCHITECTURE.md` §3.3 (`status` and `vacancy_origin` enums)

Test files:

- `supabase/tests/phase-03-blocks-schema.sql` — pgTAP, 83 assertions
- `supabase/tests/phase-03-calendar-generation.sql` — pgTAP, 59 assertions
- `packages/core/tests/phase-03/time.test.ts` — Vitest pure-logic suite

---

## pgTAP — `phase-03-blocks-schema.sql`

### §1. Tables exist (2)

`shift_blocks`, `shift_block_assignments` (ARCH §3.2 Approach A).

### §2. Enums (4)

- `shift_status_enum` and `vacancy_origin_enum` exist as Postgres types.
- All 8 + 6 labels match ARCH §3.3 exactly.

### §3. `shift_blocks` shape (12)

Columns (`block_id`, `house_id`, `block_start_at`, `required_headcount`),
their types (uuid, text, **timestamptz**, integer), primary key on
`block_id`, NOT NULL on every column.

`block_end_at` is intentionally absent — ARCH §3.2: "block_end_at is
implicit: block_start_at + 30 minutes."

### §4. `shift_block_assignments` shape (27)

All 9 columns from ARCH §3.2: `assignment_id`, `block_id`, `user_id`,
`status`, `vacancy_origin`, `is_float`, `is_cross_house_pickup`,
`source_house_id`, `parent_float_id`. Types pinned. `user_id`,
`source_house_id`, `parent_float_id` are nullable; the boolean flags
and `vacancy_origin` are NOT NULL.

A CHECK constraint enforces the ARCH §3.2 rule that `source_house_id`
is populated whenever a worker is at a non-home desk: `(is_float OR
is_cross_house_pickup) → source_house_id IS NOT NULL`. Two tests cover
this constraint:

- Insert with `is_float = true`, `source_house_id = NULL` is rejected.
- Insert with `is_float = true`, `source_house_id = 'harnwell'` is accepted.

### §5. Foreign keys (4)

- `shift_blocks.house_id → houses(id)`.
- `shift_block_assignments.block_id → shift_blocks(block_id)`.
- `shift_block_assignments.user_id → users(user_id)` (preserves
  historical attribution on fired-worker rows — see §12 of phase-02 plan).
- `shift_block_assignments.source_house_id → houses(id)`.

`parent_float_id` FK is **deferred to phase-06** (the `float_assignments`
table is created there). The column exists now and is nullable; the
FK constraint is added in the phase-06 migration. The PHASE_PLAN already
notes the equivalent pattern for `users.user_id → auth.users`.

### §6. RLS enabled (5)

`shift_blocks` and `shift_block_assignments` both have RLS on with a
`service-role bypass` policy. `shift_block_assignments` additionally
carries a `"users can select own assignments"` policy (USING `user_id =
auth.uid()`) so workers can read their own float-out and
cross-house-pickup rows on their personal calendar per BEH §11.2 — the
home-house policy does not cover assignments attached to non-home-house
blocks. Tests assert the existence of all three policies.

Beyond the own-assignment policy, the additional user-scoped policies
covering authenticated SELECT on home-house blocks and on house-admin
visibility arrive in later phases per AGENTS.md.

### §7. `block_start_at` is on a 30-min boundary (5)

The atomic unit is a 30-minute block on the half-hour (ARCH §1.7).
The schema MUST reject misaligned `block_start_at` values. Tests cover:

- `HH:00` and `HH:30` inserts succeed.
- `HH:15`, `HH:31`, and `HH:30:15` (non-zero seconds) inserts are rejected.

Mechanism unspecified — implementer may use a CHECK constraint with
`date_trunc('minute', block_start_at) = block_start_at AND
extract(minute from block_start_at)::int % 30 = 0`, or a trigger.

### §8. `required_headcount` must be positive (2)

A zero-headcount block contradicts ARCH §3.3 ("a house that is closed
has no row in `staffing_patterns`"). Tests reject `0` and `-1`.

### §9. Unique (`house_id`, `block_start_at`) (3)

One block per slot per house. A different house at the same instant is
permitted (multi-house simultaneous coverage). A second insert for the
same (`house_id`, `block_start_at`) is rejected — this is what makes
the generation function idempotent at the schema level.

### §10. Status / `vacancy_origin` invariants (3)

ARCH §3.3: "Non-vacant rows must have `vacancy_origin='none'`." Tests
exercise both directions:

- `vacant` + `never_assigned` is accepted.
- `scheduled` + `temporary_drop` is rejected (non-vacant cannot carry an origin).
- `vacant` + `none` is rejected (vacant must carry an origin).

### §11. `is_float` ⊕ `is_cross_house_pickup` (1)

ARCH §3.2: "the two flags are mutually exclusive." The schema rejects
the (true, true) combination.

### §12. Default flag values (2)

`is_float` and `is_cross_house_pickup` default to false (ARCH §3.2:
they describe a non-home-desk assignment; a freshly-generated vacant
row should not carry either flag).

### §13. `block_step_status` side table (12)

ARCH §4.1: the orchestrator's per-block step-firing tracker. Phase-03
creates the schema; phase-07 wires up the orchestrator that writes to
it. Coverage:

- Table exists, all 5 columns (`block_id`, `step_name`, `status`,
  `fired_at`, `updated_at`), composite PK on (`block_id`, `step_name`).
- `block_id` FK to `shift_blocks`.
- `fired_at` and `updated_at` are timestamptz.
- `status` column uses the named enum type `block_step_status_enum`
  (created in this phase with values `fired`,
  `completed_via_force_trigger`, `rolled_back`). The enum existence and
  type name are tested here; the value-semantics tests are deferred to
  phase-07.

### §14. No plain `timestamp` columns (1)

ARCH §1.6: every timestamp is timestamptz. Zero `timestamp without
time zone` columns may exist across the three new tables.

---

## pgTAP — `phase-03-calendar-generation.sql`

The tests describe the observable behavior of `generate_blocks_for_date(date)`.

### §0. Fixtures

Five `operating_calendar` rows are inserted for the dates the file
exercises. The phase-01 seed does NOT pre-populate calendar dates
(administrative concern); each test file owns its own fixtures.

| Date       | Day | Profile             | Why                              |
| ---------- | --- | ------------------- | -------------------------------- |
| 2026-02-02 | Mon | regular_school_year | regular weekday baseline         |
| 2026-02-07 | Sat | regular_school_year | regular weekend baseline         |
| 2025-12-22 | Mon | winter_break        | winter Harnwell-only             |
| 2026-03-08 | Sun | regular_school_year | DST spring-forward (2nd Sun Mar) |
| 2025-11-02 | Sun | regular_school_year | DST fall-back (1st Sun Nov)      |
| 2026-07-15 | Wed | (no row)            | summer — system dormant          |

### §1. Function signature (1)

`generate_blocks_for_date(date) → (blocks_inserted int, assignments_inserted int)` exists.

The function returns the count of rows inserted in each table for the
given date. On a date with no operating_calendar row (summer), it
returns `(0, 0)`. On a second call for the same date (idempotency),
it also returns `(0, 0)` because the ON CONFLICT DO NOTHING path
inserts nothing new.

**Implementation contract:** `shift_end_bound = '00:00'` in
`operating_profiles` represents 24:00 of the input date (midnight
end-of-day), not 00:00 of the same day. The generator must cast this
value as `input_date + INTERVAL '24 hours'` (or equivalent) before
comparing against block start times. Reading it naively as midnight
of the input date would yield zero blocks because 08:00 > 00:00. The
§2 block-count test (32 blocks) and the §5 last-block test (23:30)
will both fail immediately if this contract is violated.

### §2. Regular weekday counts (7)

- Harnwell: 32 blocks; 64 assignments (32 × 2).
- Quad: 32 blocks; 96 assignments (32 × 3).
- Single-staff (house-03): 32 blocks; 32 assignments.
- Total across all 13 houses: 13 × 32 = 416 blocks.

### §3. Status invariants on generated rows (1)

Every generated assignment has `status='vacant'`,
`vacancy_origin='never_assigned'`, `user_id IS NULL`, both flags false,
`source_house_id IS NULL`, `parent_float_id IS NULL`.

### §4. Multi-headcount → distinct seats (2)

Harnwell blocks each have exactly 2 distinct `assignment_id`s; Quad
blocks each have 3.

### §5. Block start-time boundaries (5)

- Every `block_start_at` is on a 30-min boundary in America/New_York.
- No block_start_at is before 08:00 local.
- No block_start_at lands in the next day's pre-08:00 window.
- First Harnwell block on a day is exactly 08:00 local.
- Last Harnwell block on a day is exactly 23:30 local — not 00:00 of
  date N+1 (BEH §1.4 date attribution).

### §6. Date attribution at block boundaries (2)

BEH §1.4: a block at 23:30 of date N belongs to date N. A block at
00:00 belongs to date N+1.

- The 23:30 block exists with `block_start_at = N + 23:30 local`.
- Generating date N produces zero `block_start_at = (N+1) + 00:00`.

### §7. Weekend baseline (4)

Regular Saturday (2026-02-07):

- Total across all 13 houses: 13 × 32 = 416 blocks.
- Harnwell: 64 assignments (32 × 2). Weekend seed row has headcount 2,
  identical to weekday.
- Quad: 96 assignments (32 × 3).
- Single-staff (house-03): 32 assignments (32 × 1).

### §8. Winter break (5)

- Harnwell: 32 blocks, 32 assignments (32 × 1), every block has
  `required_headcount = 1`.
- Quad: zero blocks (closed).
- All 12 non-Harnwell houses combined: zero blocks.

### §9. Summer (no calendar row) (3)

Calling `generate_blocks_for_date('2026-07-15')`:

- Does not error.
- Produces zero `shift_blocks` rows for the date.
- Returns `(blocks_inserted := 0, assignments_inserted := 0)`.

### §10. House-with-no-staffing-pattern (1)

Per-house verification that absence of a `staffing_patterns` row for
the profile in effect produces zero blocks.

### §11. DST spring-forward (4)

2026-03-08 (Sunday, regular_school_year). Our shift window (08:00–24:00)
does not straddle the 02:00 transition, but the invariants must hold:

- 32 blocks for Harnwell.
- Every adjacent block pair is exactly 30 min apart in UTC (interval
  arithmetic, ARCH §1.6).
- The 32 blocks span exactly 16 hours of UTC elapsed time.
- No duplicate (`house_id`, `block_start_at`).

### §12. DST fall-back (3)

2025-11-02 (Sunday, regular_school_year). Same three invariants — count,
no duplicates, adjacent-pair interval — apply.

### §12b. DST regression — bands that straddle the transition window (9)

§11 and §12 only exercise the seeded 08:00 profile, which never touches
the 02:00 transition. A naive wall-clock-minute iteration that converts
each minute to UTC via `timezone('America/New_York', naive_ts)` would
silently drop blocks on DST days (PG rolls non-existent spring-forward
times forward and picks one offset for ambiguous fall-back times, then
`ON CONFLICT DO NOTHING` swallows the collisions). The seeded tests
can't catch that bug because their bands start after the transition.

§12b injects a synthetic `dst-test-house` with a `00:00–24:00` weekend
staffing pattern and re-runs generation for both DST dates. The
duration-from-anchor implementation must yield:

- Spring-forward (2026-03-08): **46 blocks** for the synthetic house
  (the non-existent 02:00 and 02:30 wall-clocks are absent — NY day is
  23 wall-clock hours).
- Spring-forward: the gap-bracketing blocks `01:30 EST` (UTC 06:30) and
  `03:00 EDT` (UTC 07:00) both exist; UTC steps cleanly across the gap.
- Fall-back (2025-11-02): **50 blocks** for the synthetic house (the
  duplicated 01:00–02:00 hour produces extra blocks — NY day is 25
  wall-clock hours).
- Fall-back: wall-clock `01:00 NY` appears at two distinct UTC instants
  (`01:00 EDT` = UTC 05:00 and `01:00 EST` = UTC 06:00).
- Fall-back: wall-clock `01:30 NY` appears at two distinct UTC instants.
- Every block on each DST date lands on a 30-min NY wall-clock boundary.
- Every adjacent block pair is exactly 30 min apart in UTC.

The fixture inserts are inside the test's BEGIN/ROLLBACK, so the
synthetic house and pattern do not leak across test runs.

### §13. Idempotency (6)

Re-running `generate_blocks_for_date('2026-02-02')`:

- Does not error.
- Returns `(blocks_inserted := 0, assignments_inserted := 0)` — the
  ON CONFLICT DO NOTHING path inserts nothing on the second call.
- `shift_blocks` count is unchanged.
- `shift_block_assignments` count is unchanged.
- No (`house_id`, `block_start_at`) duplicate appears anywhere.
- The two count assertions above are checked after the second call
  by comparing against the values measured after the first call.

### §14. FK integrity post-generation (1)

Every generated block references a real `houses` row.

### §15. Cross-date no-leakage (2)

Generating 2026-02-02 produces zero rows for 2026-02-01 or 2026-02-03.

### §16. Enum-value sanity (2)

No row in `shift_block_assignments` has an unrecognized
`status` or `vacancy_origin` value.

### §17. `block_step_status` empty post-generation (1)

The generator does not pre-populate the orchestrator's step-firing
table. That side table is owned by phase-07.

---

## Vitest — `packages/core/tests/phase-03/time.test.ts`

Five pure functions in `packages/core/src/time/index.ts` (to be
implemented):

### `blockBoundary(date)` (7)

Snap to most recent 30-min boundary in America/New_York wall time.

- 17:51 → 17:30
- 17:30 → 17:30 (idempotent)
- 17:29 → 17:00
- 17:00 → 17:00 (idempotent at hour)
- 17:30:45 → 17:30 (seconds dropped)
- 00:15 → 00:00 (no day rollover)
- 00:00 → 00:00 (idempotent at midnight — must not snap back to 23:30
  of the previous day, since 00:00 is itself a valid block boundary
  belonging to the new date per BEH §1.4)

### `addBlocks(date, n)` (6)

Duration arithmetic — NOT wall-clock (ARCH §1.6). `n` must be a
non-negative integer; negative `n` is undefined behavior (no behavioral
spec operation requires backward block arithmetic — block dropping is
a DB status transition, not a time calculation).

- +1 = 30 min UTC elapsed.
- +2 = 60 min.
- 0 = identity.
- DST spring-forward: +1 across 02:00 EST→03:00 EDT is still 30 min UTC.
- DST fall-back: +1 across 02:00 EDT→01:00 EST is still 30 min UTC.
- +32 = 16 h (full Harnwell shift span).

### `weekStart(date)` (6)

Monday 00:00 in America/New_York of the calendar week containing `date`.

- Monday noon → that Monday 00:00 EST.
- Wednesday afternoon → preceding Monday 00:00 EST.
- Sunday 23:59 → preceding Monday (Sunday is the LAST day, BEH §1.4).
- Monday 00:00 → itself (rollover boundary).
- Sunday 23:30 and following Monday 00:00 are in different weeks.
- DST spring-forward week: Monday 00:00 is computed in EST (zone-aware).

### `weekContains(weekStart, date)` (5)

Inclusive lower, exclusive upper — Monday 00:00 to next Monday 00:00.

- Wednesday in week → true.
- Monday 00:00 itself → true (inclusive lower bound).
- Sunday 23:30 → true.
- Next Monday 00:00 → **false** (BEH §1.4 rollover).
- Prior Sunday 23:30 → false.

### `dayType(date)` (8)

'weekday' for Mon–Fri in America/New_York; 'weekend' for Sat–Sun.

- Monday/Friday → weekday; Saturday/Sunday → weekend.
- Friday 23:30 EST → weekday (date attribution at boundary).
- Saturday 00:00 EST → weekend (rollover honored).
- Zone-sensitive: 2026-02-08 00:00 UTC = Sat 19:00 EST → weekend.
- Zone-sensitive: 2026-02-07 04:00 UTC = Fri 23:00 EST → weekday.

---

## Deferred coverage (not in phase-03)

The following surfaces from the prompt's behavioral surface list are
deferred because the relevant migrations, tables, or logic do not
exist in phase-03:

| Surface                                                 | Deferred to | Reason                                                                                                     |
| ------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `parent_float_id` FK to `float_assignments`             | phase-06    | `float_assignments` table is created in phase-06; column is nullable in phase-03 and the FK is added then. |
| `block_step_status.status` enum value semantics         | phase-07    | The orchestrator owns the `fired` / `completed_via_force_trigger` / `rolled_back` lifecycle.               |
| Race condition: profile changes mid-generation          | phase-07    | Transaction-isolation question lives with the orchestrator that drives generation.                         |
| SM-published `scheduled` assignments overwrite `vacant` | phase-04    | `draft_block_assignments` → `shift_block_assignments` publish pipeline lives in phase-04.                  |
| Vacancy-origin transitions on drop/claim/etc.           | phase-05    | The drop and claim handlers that write these origins are in phase-05.                                      |

---

## Ambiguities — resolved

| #   | Surface                                                       | Resolution                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `generate_blocks_for_date` return type                        | **Returns `(blocks_inserted int, assignments_inserted int)`**. §1 signature test, §9 summer test, and §13 idempotency test updated to assert return values.                                                                                                                                                       |
| 2   | `generate_blocks_for_date` argument timezone                  | **Single `date` arg only.** No optional timezone parameter; the function always anchors to `America/New_York` internally. Tests pin behavior (block boundaries in America/New_York); the anchor zone is not a runtime input.                                                                                      |
| 3   | Multi-band staffing patterns                                  | **Deferred.** ARCH §2.3 supports multiple `{block_start, block_end, headcount}` ranges per house-day. Current seeds use a single flat band; multi-band coverage is deferred until a profile actually uses it.                                                                                                     |
| 4   | Behavior when staffing pattern has variable headcount mid-day | **Deferred** (see #3). No such pattern is seeded in phase-03.                                                                                                                                                                                                                                                     |
| 5   | Function idempotency on partial state                         | **ON CONFLICT DO NOTHING.** The UNIQUE(`house_id`, `block_start_at`) constraint drives this; the second call inserts 0 rows and returns `(0, 0)`.                                                                                                                                                                 |
| 6   | DST spring-forward blocks inside the 02:00 gap                | **Deferred.** Shift bounds 08:00–24:00 do not straddle the 02:00 transition. If a future profile opens the window earlier, the "generate based on schedule, not local clock gaps" rule becomes test-relevant.                                                                                                     |
| 7   | DST fall-back duplicate wall-clock blocks                     | **Not applicable at current bounds.** The §12 "no duplicate `(house_id, block_start_at)`" invariant is the correct general assertion. The DST-specific duplicate scenario only arises if the shift window opened pre-02:00.                                                                                       |
| 8   | What writes to `block_step_status`?                           | **Generator does not touch `block_step_status`**; the orchestrator (phase-07) owns writes to it. §17 asserts the table is empty after generation.                                                                                                                                                                 |
| 9   | `source_house_id` DB constraint                               | **Add CHECK constraint + schema test in §4.** Two new tests: `is_float=true` with `source_house_id=NULL` is rejected; `is_float=true` with a valid `source_house_id` is accepted. Constraint: `(is_float OR is_cross_house_pickup) → source_house_id IS NOT NULL`. Schema assertion count updated from 25 to 27.  |
| 10  | `block_step_status.status` column type                        | **Named enum `block_step_status_enum`** created in phase-03 with values `fired`, `completed_via_force_trigger`, `rolled_back`. Phase-03 §13 tests the type exists and that the `status` column uses it (`has_type` + `col_type_is`). Value-semantics tests deferred to phase-07. §13 count updated from 10 to 12. |
| 11  | `addBlocks` negative `n`                                      | **Removed.** No behavioral spec operation requires backward block arithmetic. Block dropping is a DB status transition; escalation offsets use standard timestamp interval arithmetic. Negative `n` is undefined behavior. The `−1` test case is removed; `addBlocks` count updated from 7 to 6.                  |
| 12  | `shift_end_bound = '00:00'` interpretation                    | **Contract note added to §1.** The generator must interpret `shift_end_bound='00:00'` as 24:00 of the input date (`input_date + INTERVAL '24 hours'`). A naive literal reading produces zero blocks. §2 and §5 tests catch the symptom; the §1 note makes the assumption explicit for implementers.               |
| 13  | Weekend §7 assignment counts                                  | **Added to §7.** Three new assertions: Harnwell 64, Quad 96, house-03 32. The weekend seed rows are identical in headcount to weekday; asserting assignment counts here confirms the `day_type='weekend'` lookup path is exercised end-to-end. §7 count updated from 1 to 4.                                      |
| 14  | `blockBoundary(00:00)` idempotency                            | **Added test case.** `00:00 → 00:00`. A careless implementation might snap midnight back to 23:30 of the previous day. Since 00:00 is a valid block boundary belonging to the new date (BEH §1.4), idempotency must hold. `blockBoundary` count updated from 6 to 7.                                              |

---

## How to run

```bash
# pgTAP (requires `supabase start` first)
supabase test db

# Vitest (will fail at import until time/index.ts exists — TDD-first)
pnpm --filter @shift/core test
```
