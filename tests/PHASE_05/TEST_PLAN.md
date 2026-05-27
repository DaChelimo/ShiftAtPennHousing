# Phase 05 — Test Plan: Open Shifts Feed and Claiming

This plan enumerates every test for phase-05, the spec section each
test covers, and the ambiguities surfaced and resolved before
implementation.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md` §5.1 (open shifts feed — weekly +
  permanent openings)
- `BEHAVIORAL_SPECIFICATION.md` §5.2 (dropping a shift — feeds the
  weekly feed, drives escalation timing)
- `BEHAVIORAL_SPECIFICATION.md` §5.3 (claiming — cross-house matrix,
  T-2h cutoff, hours cap, time conflict, race resolution)
- `BEHAVIORAL_SPECIFICATION.md` §5.4 (escalation chain — T-2h boundary)
- `BEHAVIORAL_SPECIFICATION.md` §5.5 (one-way escalation; float-drop
  exception)
- `BEHAVIORAL_SPECIFICATION.md` §5.6 (Shifts screen 3-tab layout)
- `BEHAVIORAL_SPECIFICATION.md` §9 (hours — attribution, weekly
  window, caps)
- `ARCHITECTURE.md` §1.5 (Harnwell training algorithmic invariant)
- `ARCHITECTURE.md` §3.2/§3.3 (status enum, vacancy_origin enum)
- `AGENTS.md`

Test files:

- `supabase/tests/phase-05-feed-queries.sql` — pgTAP, 32 assertions
- `supabase/tests/phase-05-claim.sql` — pgTAP, 26 assertions
- `packages/core/tests/phase-05/hours.test.ts` — Vitest, 25 cases
- `packages/core/tests/phase-05/cross-house-eligibility.test.ts` —
  Vitest, 20 cases (full 13×13 matrix coverage)

---

## pgTAP — `phase-05-feed-queries.sql`

The tests describe the observable behavior of three feed surfaces:

```sql
weekly_open_shifts_feed(p_house_id text, p_as_of timestamptz)
  RETURNS SETOF shift_block_assignments

is_assignment_claimable(p_assignment_id uuid, p_as_of timestamptz)
  RETURNS boolean

permanent_openings_feed(p_house_id text)
  RETURNS TABLE (house_id text, day_of_week int,
                 block_start_time time, occurrence_count bigint)
```

### §0. Fixtures

One SM at Harnwell (auth user + public.users + user_roles). An
anchored test moment `test.phase05.as_of = '2026-06-01 12:00:00
America/New_York'` carried via `set_config` so every relative date
is reproducible. Blocks across a 60-day window covering: far-future
(45 d), near-horizon (10 d / 12 d / 5 d), pickable (+3 h), at-T-2h
boundary (+2 h), unclaimable (+1 h), Quad cross-house, and two
permanent_drop occurrences on the same weekday/time-of-day.

### §1. Function existence (3)

- `weekly_open_shifts_feed(text, timestamptz)` exists.
- `is_assignment_claimable(uuid, timestamptz)` exists.
- `permanent_openings_feed(text)` exists.

### §2. Weekly feed: 30-day horizon (4)

BEH §5.1: weekly feed shows vacant blocks within 30 days.

- 45 d out → NOT in feed (held until horizon).
- 10 d out → in feed.
- 3 h out (> T-2h) → in feed.
- At-or-after T-2h → still APPEARS in feed (visibility independent
  of claimability, BEH §5.1 wording: "remain in the feed... at which
  point they become unpickable").

### §3. Weekly feed: per-house scoping (3)

BEH §5.1, §5.6: each house has its own weekly feed.

- Quad block does NOT appear in Harnwell feed.
- Quad block appears in Quad feed.
- Harnwell blocks do NOT appear in Quad feed.

### §4. Weekly feed: only `status='vacant'` rows (2)

ARCH §3.3: feed reads `status='vacant'`. A multi-seat block with
both `scheduled` and `vacant` rows returns only the vacant one in
the feed.

### §5. Permanent-drop occurrences in BOTH feeds (2)

BEH §5.1: "A permanently-dropped slot's individual weekly occurrences
still surface in the weekly feed as they cross the 30-day horizon."

- Two permanent_drop blocks (5 d and 12 d out, both within horizon)
  appear in the weekly feed.
- `vacancy_origin='permanent_drop'` is preserved on the weekly-feed
  row.

### §6. `is_assignment_claimable`: T-2h boundary (5)

BEH §5.4: "Only claims completed strictly before T-2 hours succeed."

- 3 h out (> T-2h) → claimable.
- +2 h block evaluated 1 second before T-2h → claimable (boundary
  inclusive on the safe side).
- +2 h block evaluated AT T-2h → NOT claimable.
- 1 h out (well past T-2h) → NOT claimable.
- Non-vacant assignment → never claimable.

### §7. Permanent openings feed: only permanent_drop rows (4)

BEH §5.1: feed shows recurring slots grouped by (house, day-of-week,
block-start-time).

- Two same-day-of-week / same-time occurrences → 1 grouped row.
- Grouped row reports `occurrence_count=2`.
- Temporary-drop vacancies do NOT appear.
- Never-assigned vacancies do NOT appear.

### §8. Permanent openings feed: per-house scoping (2)

- Quad permanent_drop does NOT appear in Harnwell permanent openings.
- Quad permanent_drop appears in Quad permanent openings.

### §9. Held-until-horizon (1)

BEH §5.1, §5.2: drops > 30 days out are accepted and held; they
surface in the feed once their start crosses the horizon.

- Block 45 days out today surfaces in the feed 20 days later (now
  25 d out, within horizon) — same row, no fixture rewrite needed.

### §10. Past blocks filtered (2)

A vacant assignment whose block already started (block_start_at < as_of)
is not in the feed and is not claimable. The system is forward-looking
only.

### §11. Closed-house empty result (2)

A house with no vacant blocks (e.g., a single-staff house with all
seats scheduled, or a closed house) returns empty feed results
without error. Covers BEH §5.6 winter-break Tab 3 empty case at the
SQL layer.

### §12. Claim removes from permanent openings (2)

When one of two permanent_drop occurrences flips to `claimed` (the
phase-08-10 temporary occurrence-claim flow), the permanent openings
feed's `occurrence_count` drops to 1; the grouped row stays as long
as at least one occurrence remains vacant.

---

## pgTAP — `phase-05-claim.sql`

The tests describe the observable behavior of:

```sql
claim_open_shift(
  p_assignment_id uuid,
  p_user_id       uuid,
  p_as_of         timestamptz
) RETURNS uuid
```

Failure modes raise exceptions with these messages:

| Error                    | Trigger                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `shift_unavailable`      | Row no longer vacant (race resolution: first writer wins).       |
| `past_t2h_cutoff`        | At or after T-2h relative to `p_as_of`.                          |
| `cross_house_ineligible` | Harnwell-training rule violation.                                |
| `time_conflict`          | Worker already holds an overlapping assignment in the same week. |
| `hard_cap_exceeded`      | Claim would push worker over the week's hard cap.                |
| `user_inactive`          | Worker `is_active=false`.                                        |

Soft-cap exceedance is NOT a DB-layer reject. BEH §5.3: "Claiming
over the 20-hour regular school year cap is permitted with a
warning." The warning is surfaced by reading current hours BEFORE
invoking `claim_open_shift`; the DB function passes the claim
through.

### §0. Fixtures

Four workers (W_harn = Harnwell SW, W_quad = Quad SW, W_inact =
inactive Harnwell SW, W_harn2 = second Harnwell SW). Six anchored
blocks: H_safe_mon (+5 d), H_far_mon (+7 d, hard-cap exercise),
H_t2h_eq (+2 h boundary), H_t3h (+3 h pickable), Q_safe (+6 d cross-
house), Q_overlap (+5 d, same start as H_safe_mon → time-conflict
exercise).

### §1. Function existence (1)

`claim_open_shift(uuid, uuid, timestamptz)` exists.

### §2. In-house claim succeeds (6)

W_harn claims H_safe_mon. Assertions:

- `lives_ok` on the call.
- `status='claimed'`.
- `user_id` set to W_harn.
- `vacancy_origin='none'` (reset from `temporary_drop`).
- `is_cross_house_pickup=false`.
- `source_house_id IS NULL` (in-house — no source house).

### §3. Cross-house claim succeeds (3)

W_harn (Harnwell) claims Q_safe (Quad).

- `lives_ok` on the call.
- `is_cross_house_pickup=true`.
- `source_house_id='harnwell'` — the worker's home house.

### §4. Cross-house ineligibility rejected (2)

BEH §5.3 + ARCH §1.5: only Harnwell-trained workers may staff
Harnwell.

- W_quad → Harnwell shift raises `cross_house_ineligible`.
- After the rejection, the row stays `status='vacant'`.

### §5. T-2h cutoff (2)

BEH §5.4: claims strictly before T-2h succeed; at or after fail.

- W_harn claiming H_t2h_eq at `as_of` (= exactly T-2h boundary) →
  `past_t2h_cutoff`.
- W_harn2 claiming H_t2h_eq at `as_of - 1 second` → succeeds.

### §6. Race condition: `shift_unavailable` (2)

After §5's success, a second claim attempt on the same assignment
(now `claimed`) by a different worker → `shift_unavailable`. The
first claimer's `user_id` is unchanged. Pins first-writer-wins
semantics. See **Ambiguity 1** for the mechanism.

### §7. Inactive worker (1)

W_inact is `is_active=false`. Claim raises `user_inactive`.

### §8. Time conflict (1)

W_harn holds H_safe_mon (claimed in §2). Q_overlap is at the same
`block_start_at` at Quad. Claiming Q_overlap as W_harn → `time_conflict`.

### §9. Hard cap (2)

W_harn is built up to exactly 80 assignments (40 h) in the calendar
week containing H_far_mon. A sanity assertion confirms the fixture
state. Claiming H_far_mon (the 81st block) → `hard_cap_exceeded`.

### §10. Hours cap is week-scoped (1)

BEH §9.2: weekly window is Monday 00:00 → Sunday 23:59. W_harn2
holds H_t3h (1 block in `as_of` week) and successfully claims a
fresh +4 d Harnwell block — also in the `as_of` week. The hard-cap
check does NOT see the +7 d week's separate budget.

### §11. Soft cap NOT blocked at DB layer (2)

BEH §5.3 / §9.3: soft cap is UI-warning-only. W_harn2 is built up
to >=40 assignments (>=20 h) in the `as_of` week via direct INSERTs
of scheduled blocks. A new claim that pushes them past the soft cap
succeeds. The warning belongs to the application layer.

### §12. Atomicity on rejection (2)

After §8's rejected `time_conflict`, the Q_overlap row's status and
user_id are unchanged — no partial write, no draft state.

### §13. Drop-then-reclaim (1)

BEH §5.2: "A worker who has dropped a shift may reclaim it
themselves, provided no other worker has claimed it in the interim."
Simulate by flipping H_safe_mon back to vacant, then W_harn re-claims.

---

## Vitest — `packages/core/tests/phase-05/hours.test.ts`

Tests for two pure functions to be implemented in
`packages/core/src/scheduling/hours.ts`:

```ts
function computeWeeklyHours(assignments: AssignmentForHours[], week: WeekRef): HoursDecomposition;

function checkClaimAgainstCap(input: CapCheckInput): CapCheckResult;
```

### Test groups

- **computeWeeklyHours — basic counting (4 cases).** Zero, 1 block,
  2 blocks, 40 blocks (= 20 h soft-cap exact threshold).
- **computeWeeklyHours — decomposition by category (3 cases).** Mixed
  at-home + float-out + cross-house decomposes correctly. Float-out
  hours count toward total (BEH §9.1). Cross-house pickup hours count
  toward total at home house (BEH §9.1).
- **computeWeeklyHours — weekly window boundaries (5 cases).** Monday
  00:00 belongs to new week; Sunday 23:30 in-week; prior Sunday 23:30
  excluded; next Monday 00:00 excluded; mixed mix counted correctly;
  `weekStart` helper anchors to Monday-of-week.
- **checkClaimAgainstCap — soft cap (5 cases).** Various current +
  proposed combinations; the key edge case is `current=20 +
proposedClaimBlocks=1` → over → warning but proceed.
- **checkClaimAgainstCap — hard cap (5 cases).** Same shape but hard
  enforcement; the key edges are `current=39.5 + 1block` → exactly 40
  (allowed) and `current=40 + 1block` → 40.5 (rejected).
- **checkClaimAgainstCap — zero-block (2 cases).** Zero-block claim
  is always a no-op, even when current already exceeds the hard cap
  (defensive: data-drift after mid-week cap reduction per BEH §9.3).

Total: 25 test cases distributed across 6 `describe` blocks. The
core/time `weekStart` helper is exercised through the boundary cases
to confirm the cross-package contract; the implementation under
test must use that helper (or equivalent NY-anchored logic) to
resolve week boundaries.

---

## Vitest — `packages/core/tests/phase-05/cross-house-eligibility.test.ts`

Tests for two pure functions to be implemented in
`packages/core/src/scheduling/crossHousePickup.ts`:

```ts
function isEligibleForCrossHousePickup(
  homeHouseId: HouseId,
  destinationHouseId: HouseId,
): { eligible: boolean; reason?: string };

function listEligibleCrossHouseDestinations(
  homeHouseId: HouseId,
  allHouseIds: HouseId[],
): HouseId[];
```

### Test groups

- **Harnwell worker as source (3 cases).** Harnwell → Harnwell
  (in-house), Harnwell → Quad, Harnwell → every 11-single-staff.
- **Quad worker as source (3 cases).** Quad → Harnwell rejected with
  `harnwell_training_required`; Quad → Quad (in-house); Quad → every
  11-single-staff.
- **11-single-staff worker as source (4 cases).** All 11 → Harnwell
  rejected; all 11 → Quad allowed; all 11 → own home (in-house); all
  11 × all 11 (excluding home) allowed.
- **Harnwell-destination absolute rule (1 case).** Across all 13
  homes, only Harnwell home accepts Harnwell as destination; the
  other 12 are rejected.
- **Full 13×13 matrix (2 cases).** Exactly 157 of 169 pairs eligible,
  12 rejected; every rejection is `(non-Harnwell home, Harnwell dest)`.
- **Tab 3 resolved sets (4 cases — BEH §5.6).** Harnwell SW → 12
  destinations (Quad + 11); Quad SW → 11 destinations (11 single-
  staff, Harnwell excluded by training); 11-single-staff SW → 11
  destinations (Quad + 10 other singles); every 11-single-staff home
  yields a Tab-3 set of length 11.
- **Input subset semantics (3 cases — closed-house / winter break).**
  Harnwell SW with only Harnwell operating → empty Tab 3 (no other
  houses to display); Quad SW with only Harnwell+Quad operating →
  empty Tab 3 (Harnwell training-excluded); single-staff worker with
  home + 3 others operating → Tab 3 has the 3 others.

Total: 20 test cases distributed across 7 `describe` blocks. Several
`it` blocks iterate internally over the 11-single-staff array or the
13×13 matrix; the actual `expect()` count is substantially higher.

---

## Deferred coverage (not in phase-05)

| Surface                                                                  | Deferred to | Reason                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop function (`drop_shift`)                                             | phase-06    | The drop UX (popup, mid-shift snap, partial drop) is a substantial surface in its own right. Phase-05 tests assume the drop has already produced vacant rows with the correct `vacancy_origin`; the actual function that performs the drop is phase-06.          |
| Escalation chain firing (broadcast at T-3h, float_lookup at T-2h)        | phase-07    | The orchestrator that ticks every minute is phase-07. Phase-05 covers the data-shape side: the feed shows the right rows, and `is_assignment_claimable` reflects the T-2h gate. The chain steps that emit notifications and run the float lookup are downstream. |
| Cross-house pickup hours decomposition by destination (per-house report) | phase-09    | BEH §9.1 mandates a 3-category decomposition (`atHome`, `floatedOut`, `crossHousePickup`). Phase-05 covers the algorithm; phase-09 surfaces it in the worker's report.                                                                                           |
| Permanent pickup flow (claim_permanent_slot)                             | phase-10    | BEH §8.4.3 — partial pickup, skipped weeks, atomic bulk operation. Distinct enough to warrant its own phase. The permanent openings feed query is in phase-05; the action on it is phase-10.                                                                     |
| RLS policies on `claim_open_shift` (auth.uid vs p_user_id)               | phase-12    | The phase-05 function exposes a service-role-callable RPC. Worker-callable RLS that ties `auth.uid()` to `p_user_id` is a security-review surface and lives in phase-12 (security review of all phases).                                                         |
| Calendar-render visibility of claimed cross-house pickups                | phase-09    | BEH §11.1 / §11.2 visual indicators (light green, light purple, circle).                                                                                                                                                                                         |

---

## Ambiguities — resolved

| #   | Surface                                                     | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Race condition resolution mechanism                         | The `claim_open_shift` function MUST atomically UPDATE the row WHERE `status='vacant'` AND `assignment_id=p_assignment_id` and RAISE `shift_unavailable` if zero rows were affected. The specific mechanism (UPDATE…RETURNING vs SELECT FOR UPDATE + UPDATE) is implementer's choice; the behavioral assertion in §6 (second claimer fails, first wins, no row overwrite) passes either way.                                                                                                                                                              |
| 2   | T-2h boundary semantics                                     | **Strictly before T-2h succeeds; at or after fails.** This matches BEH §5.4 verbatim ("only claims completed strictly before T-2 hours succeed; if a claim is in progress at exactly T-2 hours, it fails"). The `is_assignment_claimable` function returns true iff `block_start_at > p_as_of + interval '2 hours'`; the `claim_open_shift` function uses the same predicate. Tests pin both directions: 1 s before → success; exactly at → failure.                                                                                                      |
| 3   | T-2h cutoff applies to BOTH in-house and cross-house claims | BEH §5.3: "The T-2h unpickable cutoff applies uniformly to in-house and cross-house claims." Tests exercise the cutoff via Harnwell in-house claim in §5; cross-house exposure is via the matrix tests in §3 (cross-house succeeds when > T-2h). No separate "cross-house at T-2h" test exists — the cutoff predicate is purely time-based and house-independent.                                                                                                                                                                                         |
| 4   | Soft cap at DB layer — block or pass?                       | **Pass.** BEH §5.3 ("permitted with a warning") explicitly allows the claim. The DB function only enforces the hard cap. The warning is the application layer's responsibility (read worker's current hours → compute decomposition → compare against profile-derived cap → show warning popup before issuing the RPC). Test §11 pins this.                                                                                                                                                                                                               |
| 5   | Permanent openings feed grouping key                        | **Group by (house_id, day-of-week, block-start-time-of-day in NY).** BEH §5.1: "shows recurring slots... grouped by (house, day-of-week, time band)." Time-of-day is the resolved time band for the recurring slot — same wall-clock start across weeks. The function returns `occurrence_count` to surface multiplicity; the actual recurring-slot definition (e.g., 19:00–24:00 contiguous run) is reconstructed by the consumer from contiguous block_start_time values, not by the feed function itself (deferred to UI).                             |
| 6   | Permanent openings feed visibility scope                    | The function is keyed by `p_house_id`; cross-house visibility (Tab 3) is the consumer's responsibility — they invoke the function once per eligible non-home house and union the results. This matches the BEH §5.6 layout (Tab 3 groups results by house). No single function returns "all houses I'm eligible for" because that requires the worker's identity, which belongs in a higher layer.                                                                                                                                                        |
| 7   | Held-until-horizon for drops > 30 days                      | The vacant row exists in `shift_block_assignments` immediately at drop time; the `weekly_open_shifts_feed` function filters by `block_start_at <= p_as_of + interval '30 days'`. The row surfaces in the feed once `p_as_of` advances enough. No separate "pending" table — held state is implicit in the filter predicate. Test §9 exercises this by advancing `p_as_of`.                                                                                                                                                                                |
| 8   | Hours-cap reconciliation when the cap is lowered mid-week   | Phase-05 enforces the cap currently in effect at claim time (read from `weekly_cap_overrides` → fallback to `operating_profiles.default_hours_cap`). BEH §9.3: existing assignments are not retroactively unassigned, but new claims are validated against the new cap. The cap-modification RPC is not in phase-05 (phase-12); test §12 pins that already-claimed rows survive a hypothetical reduction by exercising `proposedClaimBlocks=0` returning ok even when `currentWeeklyHours > cap`.                                                         |
| 9   | Hours decomposition categories on `shift_block_assignments` | Three boolean flags `is_float` and `is_cross_house_pickup` decompose the assignment's mechanism: `is_float=true AND is_cross_house_pickup=false` → float-out; `is_float=false AND is_cross_house_pickup=true` → cross-house pickup; both false → at-home. The exclusion constraint (`float_pickup_exclusive`) is enforced by the existing phase-03 CHECK constraint. The `computeWeeklyHours` core function reads these flags directly.                                                                                                                   |
| 10  | What counts as "weekly hours" — every status, or only some? | **Every assignment row in the calendar week where the worker is the `user_id`, EXCEPT `vacant` and `allied` rows** (which have `user_id IS NULL`). The `claim_open_shift` cap query joins `shift_block_assignments` ∩ `shift_blocks` on `block_start_at` within the calendar week, filtering `user_id = p_user_id AND status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')`. Float-OUT rows (`status='floated_out'`) are EXCLUDED from the home-house hours count to avoid double-counting against the matching `floated_in` destination. |

The tests are written to accept multiple reasonable resolutions
within the ambiguity surface; the **Implementation notes for the
next agent** section below pins the exact resolution Codex MUST
adopt where ambiguities #1, #5, #10 overlap.

---

## Implementation notes for the next agent

These decisions resolve every ambiguity the test suite leaves
under-specified. They are binding for phase-05 implementation: the
tests are written to accept any reasonable choice, but the next agent
should pick the option below for consistency with downstream phases.

### 1. `claim_open_shift` — UPDATE…WHERE status='vacant' pattern

Use this exact pattern inside the function to enforce first-writer-
wins atomically without explicit locks:

```sql
UPDATE shift_block_assignments
   SET status = 'claimed',
       user_id = p_user_id,
       vacancy_origin = 'none',
       is_cross_house_pickup = (claimer.home_house_id <> block.house_id),
       source_house_id = CASE
                          WHEN claimer.home_house_id <> block.house_id
                          THEN claimer.home_house_id
                          ELSE NULL
                        END
 WHERE assignment_id = p_assignment_id
   AND status        = 'vacant'
RETURNING assignment_id INTO v_result;

IF v_result IS NULL THEN
  RAISE EXCEPTION 'shift_unavailable';
END IF;
```

Eligibility checks (T-2h, cross-house, time conflict, hard cap,
inactive) MUST run BEFORE the UPDATE and raise their respective
errors. The UPDATE itself is the atomic claim step that resolves
races; the prior checks reject obvious failures with descriptive
errors. The combination keeps the function single-transaction and
race-safe.

### 2. `weekly_open_shifts_feed` — single SQL, no PL/pgSQL

The function should be a `LANGUAGE sql STABLE` function:

```sql
CREATE FUNCTION weekly_open_shifts_feed(
  p_house_id text, p_as_of timestamptz
) RETURNS SETOF shift_block_assignments
LANGUAGE sql STABLE AS $$
  SELECT a.*
    FROM shift_block_assignments a
    JOIN shift_blocks b USING (block_id)
   WHERE b.house_id = p_house_id
     AND a.status   = 'vacant'
     AND b.block_start_at >  p_as_of
     AND b.block_start_at <= p_as_of + interval '30 days';
$$;
```

The unpickable-but-visible rule (BEH §5.1) means the function does
NOT filter on the T-2h cutoff — it returns all visible rows, including
those that have crossed T-2h. Claimability is a separate check.

### 3. `permanent_openings_feed` — grouped by NY local time-of-day

The grouping key uses `block_start_at AT TIME ZONE 'America/New_York'`
to extract the local day-of-week and time-of-day. DST transitions
produce a 23-hour or 25-hour day on two days per year; the grouping
still works because the resolved time-of-day is the wall-clock start,
which is invariant across DST per ARCH §1.6.

```sql
CREATE FUNCTION permanent_openings_feed(p_house_id text)
RETURNS TABLE (
  house_id          text,
  day_of_week       int,
  block_start_time  time,
  occurrence_count  bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    b.house_id,
    EXTRACT(dow FROM b.block_start_at AT TIME ZONE 'America/New_York')::int,
    (b.block_start_at AT TIME ZONE 'America/New_York')::time,
    count(*)::bigint
  FROM shift_block_assignments a
  JOIN shift_blocks b USING (block_id)
  WHERE b.house_id     = p_house_id
    AND a.status       = 'vacant'
    AND a.vacancy_origin = 'permanent_drop'
    AND b.block_start_at >= now()  -- forward-looking
  GROUP BY 1, 2, 3;
$$;
```

The `now()` lower bound is acceptable here because the feed is
"current state" — past occurrences are no longer actionable. If a
downstream consumer needs an `as_of` parameter (for testing or
backfill), the function can be extended.

### 4. Vitest module paths

Create:

1. `packages/core/src/scheduling/hours.ts` — exports
   `computeWeeklyHours`, `checkClaimAgainstCap`, and the supporting
   types `AssignmentForHours`, `HoursDecomposition`, `WeekRef`,
   `CapCheckInput`, `CapCheckResult`.
2. `packages/core/src/scheduling/crossHousePickup.ts` — exports
   `isEligibleForCrossHousePickup`, `listEligibleCrossHouseDestinations`,
   and the supporting type `HouseId`.
3. Add `export * from './scheduling/hours.js';` and
   `export * from './scheduling/crossHousePickup.js';` to
   `packages/core/src/index.ts`.

`hours.ts` MUST consume the existing `weekStart` helper from
`core/time/index.ts` to resolve Monday-of-week boundaries. The
boundary tests in `hours.test.ts` use NY-anchored timestamps; the
implementation must use `weekContains(week, t)` or equivalent
NY-aware logic, NOT naive `getTime()` arithmetic.

`crossHousePickup.ts` is a pure-data function — no I/O, no Supabase.
The Harnwell-training rule is hard-coded as the single algorithmic
invariant. Do NOT consult any config table to resolve eligibility;
ARCH §1.5 / §2.4 mandate the algorithmic enforcement specifically
to defend against data-entry errors.

### 5. Hours-cap query — week-scoped, status-filtered

The DB-layer cap query inside `claim_open_shift`:

```sql
SELECT count(*) * 0.5
  FROM shift_block_assignments a
  JOIN shift_blocks b USING (block_id)
 WHERE a.user_id = p_user_id
   AND a.status IN ('scheduled', 'claimed', 'floated_in', 'pending_float_in')
   AND b.block_start_at >= week_start(target_week_anchor)
   AND b.block_start_at <  week_start(target_week_anchor) + interval '7 days'
```

`week_start` is a SQL function (to be implemented) that takes a
timestamptz and returns the Monday 00:00 NY of the week containing
it. The semantics mirror the core/time `weekStart` TypeScript
helper.

`status='floated_out'` is intentionally excluded — those hours are
already counted at the destination via `floated_in`. Including them
would double-count.

`status='allied'` and `'vacant'` are excluded because they have no
`user_id`. `'pending_float_out'` is excluded for the same reason as
`'floated_out'`.

### 6. Cross-house pickup populates `source_house_id`

When `claim_open_shift` detects a cross-house claim
(claimer.home_house_id ≠ block.house_id), it sets:

- `is_cross_house_pickup = true`
- `source_house_id = claimer.home_house_id`

This matches the existing phase-03 CHECK constraint
`source_house_required_when_non_home`. The in-house case leaves
`source_house_id` NULL and both flags false.

---

## How to run

```bash
# pgTAP (requires `supabase start` first)
supabase test db

# Vitest (will fail at import until src/scheduling/{hours,crossHousePickup}.ts exists — TDD-first)
pnpm --filter @shift/core test
```
