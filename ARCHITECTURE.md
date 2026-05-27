# Shift@PennHousing — Architecture Document (v2)

This document describes how the software is structured to guarantee the rules defined in the Behavioral Specification. The Behavioral Specification is the source of truth for what is correct; this document describes how the code, schema, and configuration enforce that truth.

This document is opinionated and prescriptive. It exists because the behavioral spec must be implementable in a way that handles change gracefully — specifically, change to season rules, threshold timings, staffing patterns, and configurable parameters without requiring code modifications.

---

## 1. Core Architectural Principles

### 1.1 Configuration Over Code

Every rule that varies by season, threshold, or operational policy lives in data, not code. The set of rules that vary includes:

- Shift hour bounds per profile.
- Weekly hours cap per profile (and per-week overrides).
- Hard-vs-soft enforcement of the cap.
- Whether floating is enabled at the profile level.
- The escalation chain steps and their timings (T-3 broadcast, T-2 float lookup, T-2 HMOD on failure).
- Staffing pattern per (profile, house, day-of-week, time band).
- Float direction rules (which houses can float to which) — though the absolute Quad/Harnwell/single-staff constraints are also enforced as algorithmic invariants independent of config data.
- The 30-day drop horizon.
- The 14-day, 3-day, and 1-day claim-phase checkpoints.
- The acknowledgment cadence (6h, 2h, 1h, 30m, 5m); the 6h and 2h entries are configurable per house by HM/BM (Section 2.8) and may be disabled entirely. The 1h, 30m, and 5m entries are not configurable.
- The T-5 minute no-show trigger offset.
- The HM/HMOD on-duty windows.
- The minimum float chunk size (currently 2 blocks = 1 hour).
- The float-assignment retention window (currently 14 days post-shift).
- The swap expiry policies (shift swap, float swap, permanent swap).
- The shift block granularity (currently 30 minutes).
- The HMOD rotor.

If any of these change, the change is a row update in a config table, not a code deploy. This principle exists because the housing committee can and will revise thresholds, and the academic calendar shifts year to year. The project administrator manages these values centrally; individual workers do not edit them directly except for the two user-tweakable acknowledgment reminders (6h and 2h).

### 1.2 The Calendar Is the Source of Truth

The behavioral spec states the shift calendar is the source of truth. The implementation honors this by ensuring that every operation produces a final state update on the `shift_assignments` table. The current state is the only state. There is no append-only history; the calendar retains historical assignments by simply not deleting them.

### 1.3 Idempotency and Atomicity

Every operation touching multiple tables (e.g., a float assignment touches `shift_assignments` at source and destination, plus `float_assignments`) executes atomically. The system uses database transactions; partial state is never observable.

### 1.4 The Orchestrator Pattern

The escalation chain is not implemented as scattered if-then statements. A single orchestrator function evaluates open shifts on a schedule and applies the current profile's chain to each. The chain is data; the orchestrator is the engine.

### 1.5 Algorithmic Invariants vs. Configuration Data

Some rules are absolute and enforced as algorithmic invariants in code, in addition to being expressible in config data:

- **Float direction rules from Section 1.2 of the behavioral spec.** Workers at the 11 single-staff houses cannot be source houses. Quad workers cannot float to Harnwell. These are enforced as hard-coded eligibility checks in the float lookup algorithm, independent of the `float_routing` config table. A data-entry error in `float_routing` cannot bypass these constraints.
- **Harnwell training constraint (universal).** No worker without Harnwell training may staff the Harnwell desk under any assignment mechanism: scheduled, claimed in-house, claimed cross-house, floated_in, force-triggered float, or permanent pickup. This is enforced as a hard-coded eligibility check in the claim/pickup handlers and in the float lookup algorithm. Equivalently: any assignment whose `block.house_id = Harnwell` requires `user.home_house_id = Harnwell`.
- **Cross-house pickup eligibility.** The cross-house pickup matrix (Behavioral Spec Section 5.3) is enforced algorithmically in the claim and permanent-pickup handlers. The only structural rule is the Harnwell training constraint above; all other cross-house pickups are permitted.
- **Minimum float chunk size.** The float lookup algorithm explicitly checks the minimum-chunk rule at every selection point, including each tiebreaker check.
- **No-takeback rule for assigned floats.** Once assigned (pending or acknowledged), a float cannot be revoked by the system; the source-side gap is handled independently.

The principle: configuration controls how the system *operates*; invariants control what it *cannot* do regardless of configuration.

### 1.6 Time Zone

All wall-clock times in the system are anchored to `America/New_York`. The database stores timestamps with their time zone explicit (`timestamp with time zone` in Postgres). All escalation offsets, claim-phase checkpoints, HM working hours, and rotor handoffs are computed in this zone. The application layer never performs zone conversions for display because all users are co-located at Penn; the few external interfaces (mailto links, push notifications) use the user's device clock which is assumed to match.

DST transitions are handled by the underlying timestamp arithmetic library. A 30-minute block whose `block_start_at` straddles a DST transition still spans exactly 30 minutes of real elapsed time; its wall-clock end is one hour off from naive subtraction, but the block model never relies on that subtraction (block end is always `block_start_at + 30 minutes` computed as a duration, not as wall-clock arithmetic).

### 1.7 Block-Based Shift Model

The atomic unit of scheduled time in the database is the **block** — a 30-minute span on a 30-minute boundary. A logical "shift" is a collection of one or more contiguous block assignments. Operations that target a "shift" are translated by the application layer into operations on the relevant blocks.

This model makes partial drops, partial claims, multi-floater handoffs, and granular swaps natural at the data layer. It also means the UI re-aggregates contiguous blocks for display so users do not see 16 cards for an 8-hour shift.

---

## 2. The Configuration Model

### 2.1 Layer 1: The Operating Calendar

A single table mapping each operating date to one operating-rules profile.

```
operating_calendar
  date            (primary key)
  profile_name    (foreign key to operating_profiles)
```

Population is administrative: the SM/HM uses an admin UI to assign date ranges to profiles. The runtime queries individual dates.

Example rows:
```
2025-09-15  →  regular_school_year
2025-11-27  →  short_break
2025-11-28  →  short_break
2025-12-20  →  winter_break
2026-01-14  →  regular_school_year
2026-03-09  →  short_break
```

Summer dates (the gap between the end of spring semester and the start of fall semester) have no row in `operating_calendar`. The runtime treats the absence of a row as "non-operating": no shifts, no orchestrator activity, no notifications. Summer coverage is handled entirely off-platform per the behavioral spec Section 3.1.

### 2.2 Layer 2: Operating Profiles

A small table (currently 4 rows) defining the rules per profile.

```
operating_profiles
  profile_name              (primary key)
  shift_start_bound         (time of day; e.g., 08:00 for regular_school_year)
  shift_end_bound           (time of day; 24:00, stored as 00:00 of next day)
  default_hours_cap         (integer)
  default_cap_enforcement   (enum: soft, hard)
  scheduling_mode           (enum: sm_built, claim_based)
  float_enabled             (boolean)
  escalation_chain          (jsonb, ordered list of chain steps with timings)
  claim_phase_open_offset   (interval; null for sm_built profiles)
  claim_phase_alert_offset  (interval; null for sm_built profiles)
  claim_phase_close_offset  (interval; null for sm_built profiles)
```

Example: `regular_school_year`:
- shift_start_bound: 08:00
- shift_end_bound: 24:00
- default_hours_cap: 20
- default_cap_enforcement: soft
- scheduling_mode: sm_built
- float_enabled: true
- escalation_chain: `[{step: "broadcast", offset: "-3h"}, {step: "float_lookup", offset: "-2h"}, {step: "hmod_notify_allied", offset: "-2h", trigger: "on_float_failure"}]`
- claim_phase fields: null

Example: `winter_break`:
- shift_start_bound: 08:00
- shift_end_bound: 24:00
- default_hours_cap: 40
- default_cap_enforcement: hard
- scheduling_mode: claim_based
- float_enabled: false
- escalation_chain: `[{step: "broadcast", offset: "-3h"}, {step: "hmod_notify_allied", offset: "-2h"}]`
- claim_phase_open_offset: -14d
- claim_phase_alert_offset: -3d
- claim_phase_close_offset: -1d

Example: `short_break`:
- shift_start_bound: 08:00
- shift_end_bound: 24:00
- default_hours_cap: 40
- default_cap_enforcement: hard
- scheduling_mode: claim_based
- float_enabled: true
- escalation_chain: same as regular_school_year
- claim_phase_open_offset: -14d
- claim_phase_alert_offset: -3d
- claim_phase_close_offset: -1d

Both `winter_break` and `short_break` use `claim_based` scheduling. The runtime distinguishes them via `float_enabled` and via which houses are operational (determined by the presence of staffing pattern rows).

### 2.3 Layer 3: Staffing Patterns

Staffing patterns are keyed by profile and house, with a time-banded list of block-start-times per day-of-week. Time bands are expressed as enumerated lists of block-start times (each entry representing the start of a 30-minute block) with a required headcount for that block, OR as ranges with start_block and end_block. The implementation choice is enumerated lists for unambiguous block-level lookup.

```
staffing_patterns
  profile_name      (foreign key)
  house_id          (foreign key)
  day_type          (enum: weekday, weekend)
  block_headcounts  (jsonb, list of {block_start_time, required_headcount})
```

Example: `(regular_school_year, Harnwell, weekday)` expands to 30-minute block entries:
```json
[
  {"block_start": "08:00", "headcount": 2},
  {"block_start": "08:30", "headcount": 2},
  ...
  {"block_start": "23:30", "headcount": 2}
]
```

For compact storage, the table may use a compressed representation (a list of `{block_start, block_end, headcount}` ranges) that the application layer expands on read. The example above would compress to:
```json
[
  {"block_start": "08:00", "block_end": "24:00", "headcount": 2}
]
```

The schema's time-banded headcount design (multiple ranges per row) is deliberately preserved even though all currently-supported profiles use a single flat band per house-day. This capability exists to accommodate future profiles (or a future revival of the summer profile) that may staff differently across time bands within a single day without requiring a schema migration.

A house that is closed for a profile has no row in `staffing_patterns` for that profile. The runtime interprets the absence as closed.

Recommended approach: explicit per-house rows even when many houses are identical. Eleven rows for the eleven single-staff houses in regular school year is acceptable.

### 2.4 Layer 4: Float Routing

A table defining which source houses can float to which destination houses, scoped by profile.

```
float_routing
  profile_name           (foreign key)
  source_house_id        (foreign key)
  destination_house_id   (foreign key)
  precedence_order       (integer; lower = checked first)
```

For `regular_school_year` and `short_break`:
- `(profile, Quad, every house except Harnwell, precedence 1)`
- `(profile, Harnwell, every house including Quad, precedence 2)`

For `winter_break`, this table has zero rows.

**Important:** The `float_routing` table is consulted as an ordering/precedence mechanism, but the float lookup algorithm also enforces the absolute rules of Section 1.2 of the behavioral spec independently. Even if a row were erroneously inserted with a single-staff house as source, the algorithm rejects it.

**Scope clarification:** `float_routing` governs *floating only*. Cross-house *pickup* (Behavioral Spec Section 5.3) does not consult this table. Pickup eligibility is a single algorithmic rule (Harnwell training requirement) enforced in the claim and permanent-pickup handlers — no config table, no precedence ordering. A worker eligible to pick up at any non-home house sees the union of those houses' open-shifts feeds in their cross-house tab.

### 2.5 Layer 5: Weekly Cap Overrides

A table for per-week hours cap modifications by HMs/BMs.

```
weekly_cap_overrides
  week_start_date    (primary key; the Monday of the week)
  hours_cap          (integer; 20 or 40)
  cap_enforcement    (enum: soft, hard)
  modified_by        (foreign key to users)
  modified_at        (timestamp)
```

If a row exists for a given week, it overrides the profile-derived default for all 13 houses for that week. If no row exists, the default rules from the behavioral spec Section 9.3 apply (computed from the days in the week).

### 2.6 Layer 6: HMOD Rotor

A table defining who serves as HMOD for each weekly slot.

```
hmod_rotor
  week_start_date   (primary key; the Monday of the week, 08:00)
  hmod_user_id      (foreign key to users; must hold hm or bm role)
```

**Academic-year scope.** Rotor entries exist only for weeks whose Monday falls within an academic semester. The rotor table has no row for any week falling entirely in summer. The final rotor entry of a spring semester represents an interval that ends at the end of the last spring operating day, **not** the following Monday 08:00 (per Behavioral Spec Section 2.5 "Academic-year scope of the rotor"). The HMOD-resolution function must:

1. Look up the rotor row for the current week.
2. If no row exists (summer date), return "no HMOD on duty" — the runtime treats this as an operational error if it is invoked at all (the orchestrator does not run during summer because no operating_calendar rows exist).
3. If a row exists, check whether the current moment falls within the rotor's effective interval. For the last rotor entry of a spring semester, the effective interval ends at the end of the last spring operating date (e.g., Sunday 23:59) rather than the following Monday 08:00. This truncation rule applies only to the spring-to-summer boundary; all other rotor entries run their full Monday-to-Monday week.

Populated by the HMs and BMs themselves before each semester. The HMOD on duty at any given time is determined by:
1. Look up the rotor entry for the current week.
2. Check whether the rotor's assigned HMOD is on leave (Section 2.7) **on the date the current HMOD interval starts** (not the current date). HMOD intervals are date-anchored to their start: an interval running Tuesday 17:00 → Wednesday 08:00 is attributed to Tuesday; the weekend interval Friday 17:00 → Monday 08:00 is attributed to Friday. If the rotor's HMOD is on leave on the interval's start date, look up their replacement.

This means an HMOD on leave for only part of their HMOD week transfers only the intervals whose start dates fall on a leave date. A Wed-Fri leave during an HMOD week transfers the Wednesday-night and Thursday-night intervals (which start at 17:00 on those days) to the replacement, but does **not** transfer the Tuesday-night interval (start Tuesday) even though it spills into Wednesday morning.

**Profile boundaries do not split HMOD intervals.** An interval whose start date falls on the last day of a semester and whose end date falls in winter break is attributed to the semester's final date. If that date is a leave date, the entire interval transfers to the replacement. The operating-profile transition does not change interval attribution or split the transfer rule.

### 2.7 Layer 7: HM/BM Leave

A table tracking HM/BM leave periods and their immediate replacements. Each row stores only a single-link pointer; the chain is resolved at query time via a recursive CTE, not stored denormalized.

```
hm_leave
  leave_id              (primary key)
  user_id               (foreign key; the HM/BM going on leave)
  start_date            (date; inclusive)
  end_date              (date; inclusive)
  replacement_user_id   (foreign key to users; the immediate replacement;
                         NULL = project administrator is the terminal replacement)
  status                (enum: active, cancelled_early)
  cancelled_at          (timestamp; populated when "I'm back" is clicked)
```

**Resolution algorithm.** To find the acting HM for a given (date, house):

1. Find the `hm_leave` row for the house's HM where the date falls in [start_date, end_date] and status = 'active'.
2. If no such row: the HM is active — done.
3. If a row exists and `replacement_user_id` IS NULL: the project administrator is the acting contact — done.
4. If a row exists and `replacement_user_id` is set: recurse with the replacement as the new target (check whether they too are on leave covering this date).
5. **Hard depth limit of 10.** If the recursive CTE exceeds depth 10, the system flags a configuration error, notifies every user in the detected chain exactly once plus the HMOD on duty, and returns the HMOD on duty as the fallback acting contact until manually resolved.

This walk is implemented as a single recursive CTE. The delegation graph is kept small (≤25 HMs/BMs); depth in practice is 1–2. The limit is a safety net, not an operational constraint.

**Cycle prevention at insertion.** Cycles are prevented structurally at insert/update time, not detected at resolution time. When an HM submits a new leave row:

1. The server computes the *incoming chain*: all users whose active leave delegation currently resolves through the HM going on leave (walk all active leave rows and find chains that terminate at this HM).
2. The submitted `replacement_user_id` must not appear in the incoming chain. If it does, the insert is rejected.
3. This check runs inside a **serializable transaction** so that concurrent insertions cannot create a cycle between check-time and commit-time.

The selection UI excludes incoming-chain members from the picker as a UX guard. The server-side transaction check is the authoritative backstop.

**Project administrator as terminal node.** `replacement_user_id = NULL` means "project administrator handles this." The project administrator may always be selected; they cannot themselves go on leave in this system. The picker always surfaces the project administrator as an option.

**"I'm back" early return.** When clicked, `status` is set to `cancelled_early` and `cancelled_at` is recorded. From that timestamp forward, the leave row is treated as inactive; the resolution walk stops at the original HM as if no leave record exists.

### 2.8 Layer 8: Acknowledgment Cadence Configuration

A per-house table tracking HM/BM-configured offsets for the 6h and 2h reminders. These are not per-worker preferences; they are house-level settings controlled by HMs, BMs, or the project administrator. The 1h, 30m, and 5m reminders are mandatory and not configurable.

```
ack_cadence_config
  house_id              (primary key; foreign key to houses)
  reminder_6h_offset    (interval; null = system default of -6h before ack deadline;
                         alternate value = configured offset; "disabled" = suppressed)
  reminder_2h_offset    (interval; same semantics)
  modified_by           (foreign key to users; last HM/BM who changed this)
  modified_at           (timestamp)
```

**Snapshot at assignment time.** When a float is assigned, the effective cadence offsets from `ack_cadence_config` for the destination house are snapshotted onto the scheduled notification rows at that moment. The notification scheduler delivers reminders based on the snapshotted values, not by re-querying `ack_cadence_config` at delivery time. This ensures that a cadence change does not affect float assignments that have already been created.

### 2.9 Layer 9: Break Periods

A small table that names each break period as a first-class entity. This supports two things the per-date `operating_calendar` cannot express alone: (1) the "first day of the break" anchor used for T-14d / T-3d / T-1d claim-phase offsets (Behavioral Spec Section 4.4), and (2) distinguishing spring fling (20-hour soft cap) from other short breaks (40-hour hard cap) when both share the `short_break` profile.

```
break_periods
  break_id           (primary key)
  break_name         (text; e.g., "Thanksgiving 2025", "Spring Fling 2026")
  break_type         (enum: thanksgiving, fall_break, spring_break, spring_fling, winter_break, other)
  start_date         (date; inclusive — the anchor used for T-14d/T-3d/T-1d offsets)
  end_date           (date; inclusive)
  profile_name       (foreign key to operating_profiles; short_break or winter_break)
```

Populated by an administrator at calendar setup time alongside `operating_calendar`. Each break-profile date in `operating_calendar` should correspond to exactly one `break_periods` row covering it; the runtime joins date → break_period via date range and profile.

**Usage:**

- Claim-phase orchestrator jobs anchor T-14d / T-3d / T-1d offsets against `break_periods.start_date` (single value per break), not against each individual date in `operating_calendar`. Every date within a given break shares the same phase boundaries.
- The default-cap computation in Behavioral Spec Section 9.3 distinguishes spring fling weeks by checking whether any date in the calendar week belongs to a `break_periods` row with `break_type = 'spring_fling'`.
- `operating_profiles.claim_phase_*_offset` values still drive the offset durations; `break_periods.start_date` provides the anchor.

### 2.10 Layer 10: Scheduling Periods

A table that names each SM-built scheduling period as a first-class entity. This gives the `period_targets` and `preferences` tables a concrete entity to foreign-key against, and provides the single place to store the preference submission deadline that the behavioral spec (Section 4.2) assigns to the SM.

```
scheduling_periods
  period_id              (primary key)
  period_name            (text; e.g., "Fall 2025", "Spring 2026")
  profile_name           (foreign key to operating_profiles; always 'regular_school_year')
  start_date             (date; inclusive — the first operating date of the semester)
  end_date               (date; inclusive — the last operating date of the semester,
                           matching the semester_end_date used by the permanent drop algorithm)
  preference_deadline    (timestamp with time zone; the SM-set deadline after which
                          preferences cannot be changed. Set by the SM via the schedule-build UI
                          before opening the preference window. Null until the SM sets it.)
  published_at           (timestamp with time zone, nullable; populated when the SM
                          publishes the schedule for this period. Null until publish.
                          Workers' calendars only show this period's assignments once
                          published_at IS NOT NULL.)
```

`scheduling_periods` covers only SM-built (`regular_school_year`) periods. Break periods are covered by `break_periods`; they use claim-based scheduling and have no preference deadline. The two tables are intentionally kept separate because their purposes and query patterns are distinct: `break_periods` is looked up by date range to anchor claim-phase timings; `scheduling_periods` is looked up by `period_id` to resolve preference submission state and target hours.

**Population:** an administrator creates a `scheduling_periods` row when setting up the academic calendar (alongside `operating_calendar` row population). The `preference_deadline` is initially null and is set by the SM via the schedule-build UI once they are ready to open preference submission.

**Usage:**

- `period_targets.period_id` and `preferences` rows are scoped to a specific `scheduling_periods` row. This ensures that when a new semester is built, the prior semester's preferences and targets are not overwritten — they remain in the database for historical reference, queryable by `period_id`.
- The preference submission reminder job (5d, 3d, 1d before deadline — Behavioral Spec Section 4.2) queries `scheduling_periods` for the active period's `preference_deadline` to compute reminder times.
- The permanent drop semester-boundary algorithm (Section 7.1) resolves `semester_end_date` from `scheduling_periods.end_date` for the period whose date range contains the drop date. This is a simpler and more reliable lookup than the recursive CTE walk: `SELECT end_date FROM scheduling_periods WHERE :drop_date BETWEEN start_date AND end_date AND profile_name = 'regular_school_year'`. The CTE walk remains documented as the fallback if this lookup returns no row (data integrity error condition).

**Relationship to `break_periods`.** A fall semester's `scheduling_periods` row has `end_date` = the last regular_school_year date before winter break. The winter break's `break_periods` row has `start_date` = the first winter_break date. There is no overlap; the boundary is clean. Short breaks embedded within a semester (Thanksgiving, spring fling) have `break_periods` rows but are not interruptions in the `scheduling_periods` row — the semester's `end_date` spans across them.

### 2.11 What's Looked Up at Runtime

When the orchestrator processes a coverage gap:

1. Query `operating_calendar` for the gap's date → get `profile_name`.
2. Query `operating_profiles` for `profile_name` → get the full rule set.
3. Query `weekly_cap_overrides` for the gap's week → resolve effective cap if claim is being attempted. If no override exists, compute the default cap from the calendar week's dates, consulting `break_periods` to identify spring fling weeks (20-hour soft) versus other 40-hour breaks.
4. If a staffing check is needed: query `staffing_patterns` for `(profile_name, house, day_type)` → get block headcounts.
5. If a float lookup is needed: query `float_routing` for `profile_name` → get the ordered list of source houses.
6. If an HM/HMOD notification is needed: resolve the current HMOD via `hmod_rotor` + `hm_leave`.
7. If a claim-phase deadline (T-14d/T-3d/T-1d) is being evaluated: look up the relevant `break_periods` row by date range; the offsets anchor against `break_periods.start_date`.
8. If a preference submission reminder is being sent (5d, 3d, 1d before deadline): look up the active `scheduling_periods` row by date range; the `preference_deadline` field provides the anchor.
9. If a permanent drop or permanent pickup is being executed: look up the active `scheduling_periods` row by date range to obtain `semester_end_date` (Section 7.1).

---

## 3. The Schema (Conceptual Outline)

### 3.1 Users and Roles

```
users
  user_id                (primary key)
  name
  email
  phone                  (for contact lookup from shift cards)
  home_house_id          (foreign key; immutable except by admin override)
  is_active              (boolean; firing flips this and triggers shift cleanup)
  broadcast_subscribed   (boolean; defaults to false; opt-in to T-3h open-shift notifications.
                          The backend enforces that this field cannot be true for any user
                          who holds an `hm` or `bm` role — see Section 3.1 subscription guard.)

user_roles
  user_id           (foreign key)
  role              (enum: sw, sm, hm, bm)
  scope_house_id    (foreign key; for sm/hm/bm, the house their role covers)
```

A user can hold multiple roles. The `hm` and `bm` roles share identical **administrative** capabilities (overrides, force-triggers, notifications, leave) but differ in **worker** behavior:

- A user holding `hm` may also hold `sw`/`sm` roles and act as a worker (scheduled shifts, claimed pickups, schedule preferences). However, the float lookup eligibility and broadcast subscription pipelines exclude any user with the `hm` role: HMs are never assigned floats and never receive open-shifts broadcasts. They may still manually browse the open-shifts feed and claim.
- A user holding `bm` is admin-only. The schema enforces this by treating `bm` as exclusive of worker roles for scheduling purposes: a user with `bm` is excluded from preference submission, schedule-builder rosters, claim eligibility, and float lookup. They may still hold the `bm` role alongside `hm` or other admin roles, but worker-facing pipelines treat them as inactive.

HMOD eligibility is implicit: any user with `hm` or `bm` role can appear in the `hmod_rotor`.

**`is_active` invariant.** Every pipeline that selects users as candidates for an active operation MUST filter on `users.is_active = true`. This includes (non-exhaustively): the float lookup eligibility query (§5.2), the broadcast-subscribed query (§4.2), the schedule-builder roster query, the claim-eligibility check, the swap counterparty selection, the HM-leave-replacement picker, the HMOD-rotor population UI, the cross-house feed visibility resolver, and the preference-submission reminder job. Historical references on already-existing rows (e.g., a fired worker's `user_id` retained on past `shift_block_assignments` rows) are preserved unchanged — the calendar still shows who was assigned in the past — but no new operation may select a deactivated user.

The single exception is the contact-lookup-from-shift-card surface (Behavioral Spec §11.4): tapping a past shift card may surface the contact info of a now-fired worker who held that shift. This is acceptable for historical reference; users have not had data deleted, only had `is_active` flipped.

**Broadcast subscription guard.** Broadcast subscription (`users.broadcast_subscribed`) is enforced at the write layer, not at dispatch time:

- The subscription toggle UI is not rendered for any user who currently holds an `hm` or `bm` role. The toggle is only visible to users whose highest role is `sw` or `sm`.
- The backend subscription endpoint (`PATCH /users/{id}/broadcast_subscribed`) rejects any write that sets `broadcast_subscribed = true` for a user who holds an `hm` or `bm` role, returning a 403 with a descriptive error.
- **Role promotion hook.** When a user is granted the `hm` or `bm` role (a `user_roles` INSERT), the role-assignment handler atomically sets `broadcast_subscribed = false` for that user in the same transaction. This handles the case of an SM being promoted to HM mid-period while already subscribed. No broadcast notification is sent for this change; the UI will simply no longer show the toggle on the user's next session.
- The broadcast step handler (Section 4.2) queries `users WHERE broadcast_subscribed = true AND home_house_id = :house_id` and does NOT additionally filter by role. The subscription guard at write time guarantees that no HM or BM row will have `broadcast_subscribed = true`, so the role filter at dispatch is unnecessary and is intentionally omitted to keep the dispatch path simple.

### 3.2 Shifts and Block Assignments

The behavioral spec mandates blocks as the atomic unit. The schema reflects this directly. Two implementation approaches are equivalent:

**Approach A (recommended): Block-Per-Row.**
```
shift_blocks
  block_id          (primary key)
  house_id          (foreign key)
  block_start_at    (timestamp with time zone; on a 30-minute boundary)
  required_headcount (integer; resolved from staffing pattern, cached)
  -- block_end_at is implicit: block_start_at + 30 minutes

shift_block_assignments
  assignment_id          (primary key)
  block_id               (foreign key)
  user_id                (foreign key; null if covered by allied or vacant)
  status                 (enum: scheduled, claimed, floated_in, floated_out, pending_float_in, pending_float_out, allied, vacant)
  is_float               (boolean; true if this assignment is a float-in)
  is_cross_house_pickup  (boolean; true if this assignment is a cross-house claim from another house's open-shifts feed)
  source_house_id        (foreign key; populated whenever the worker is at a non-home desk — i.e., when is_float = true OR is_cross_house_pickup = true. Stores the worker's home_house_id.)
  parent_float_id        (foreign key to float_assignments; null if not a float)
```

The `is_float` and `is_cross_house_pickup` flags are mutually exclusive. Both describe "worker at non-home desk" but distinguish the mechanism: `is_float` = system-assigned (or force-triggered), tied to a `float_assignments` row via `parent_float_id`; `is_cross_house_pickup` = voluntarily claimed from another house's open feed, with no float record. The `source_house_id` field is populated identically in both cases so that destination-side display logic can render "non-home worker visiting from X" without needing to consult `users`.

Each 30-minute block at each house with required headcount > 0 has its own row in `shift_blocks`. For a Harnwell weekday from 12:00 to 24:00 with headcount 2, there are 24 block rows × 2 assignments per block = 48 assignment rows per day for that band.

**Approach B (storage-optimized but harder to reason about): Range-with-Contiguity-Inference.** Stores ranges and infers blocks at query time. Rejected here in favor of A because the user explicitly prioritized correctness, understandability, and functionality over space.

The system uses Approach A. Storage cost is mitigated by the float-assignment retention policy and by partitioning `shift_block_assignments` by month if growth becomes a concern.

### 3.3 The Status Enum

The status enum on `shift_block_assignments`:

- `scheduled`: assigned to a worker via SM-built schedule or SM/HM manual override (Sections 4.3, 4.5 of behavioral spec). The normal case.
- `claimed`: a worker has claimed this previously-open block from the open-shifts feed, calendar picker, or via permanent pickup (Section 7.2). The `claimed` status is mutually exclusive with `scheduled` — the two distinguish origin (schedule-built vs claim) for reporting and feed-removal logic. If the claimer's `home_house_id` differs from the block's `house_id`, the row also has `is_cross_house_pickup = true` and `source_house_id = claimer.home_house_id`. Otherwise (in-house claim), `is_cross_house_pickup = false` and `source_house_id` is null.
- `floated_in`: a worker from another house is covering this block at this house (acknowledged).
- `floated_out`: this worker's home assignment is currently being covered elsewhere (they are floating).
- `pending_float_in`: a force-triggered float assigning a worker to this block, not yet acknowledged.
- `pending_float_out`: this worker's home assignment is currently committed to a pending float to another house.
- `allied`: the block is covered by Allied Security. Terminal.
- `vacant`: the block has no assigned worker and is in the open-shifts feed (or in the calendar claim pool for break shifts pre-T-1d).

A separate column on `shift_block_assignments` tracks the **vacancy origin** for blocks in `vacant` status:

```
vacancy_origin   enum(none, temporary_drop, permanent_drop, never_assigned, expired_claim, displaced_decliner)
```

The `vacancy_origin` field is populated whenever the block transitions to `vacant`. The values mean:

- `none`: block is not vacant (the field is meaningless when status != vacant).
- `temporary_drop`: a worker temporarily dropped this specific occurrence. Also used for the in-progress block vacated on firing and for non-recurring assignments vacated on firing.
- `permanent_drop`: this block is part of a recurring slot that has been permanently dropped or permanently removed; it should surface in the permanent openings feed.
- `never_assigned`: the SM never assigned the block during schedule building (e.g., low-coverage periods, or a slot the SM intentionally left open).
- `expired_claim`: a break shift was unclaimed at T-1d.
- `displaced_decliner`: a force-triggered floater declined after their source-side slot was already claimed by another worker or covered by Allied. The floater has no assignment at all for the float-window blocks — they are displaced from both source and destination. This block represents the floater's now-vacant source seat. It does NOT surface in the permanent openings feed (it is not a recurring slot vacancy); it enters the weekly feed as a standard temporary vacancy and proceeds through normal escalation.

Firing is implemented as `permanent_drop` (for recurring slots) plus `temporary_drop` (for the in-progress block and non-recurring assignments). There is no distinct fired-worker origin value; the firing event is tracked via the worker's account deactivation, not via a separate `vacancy_origin`.

The `permanent_drop` value is what powers the permanent openings feed. The feed query selects blocks with `status = vacant` AND `vacancy_origin = permanent_drop`, grouped by (house, day-of-week, block-start-time) to present them as recurring slots rather than individual blocks.

The `vacant` status is what the orchestrator scans for to identify gaps needing escalation. There is no intermediate `awaiting_allied` status; once HMOD is notified and the HMOD confirms Allied is procured, the block flips to `allied`. Between HMOD notification and HMOD confirmation, the block remains `vacant` (the HMOD's pending action is tracked via the notification, not via the block status). Allied is assumed to be reliable: once HMOD has been notified, Allied is treated as a virtual certainty.

### 3.4 Float Assignments

```
float_assignments
  float_id                     (primary key)
  user_id                      (foreign key)
  source_assignment_ids        (array of FKs to shift_block_assignments; the user's original home seat-assignments)
  destination_assignment_ids   (array of FKs to shift_block_assignments; the seat-assignments they're floating to)
  status                       (enum: pending, acknowledged, declined, voided, completed)
  created_at                   (timestamp)
  acknowledged_at              (timestamp, nullable)
  declined_at                  (timestamp, nullable)
  initiated_by                 (enum: automated, force_triggered)
  force_triggered_by           (foreign key to users; null unless initiated_by = force_triggered)
  expires_for_cleanup_at       (timestamp; max(destination block end times) + 14 days)
```

A multi-floater handoff produces multiple `float_assignments` rows, each linking one worker to a subset of destination seat-assignments.

**Why assignment_id, not block_id.** Multi-headcount blocks (Harnwell with headcount 2, Quad with headcount 3) have multiple `shift_block_assignments` rows per `shift_blocks` row — one per seat. A float must target a specific seat: floating "a Harnwell worker out" doesn't make sense without identifying which of the two Harnwell seats is being vacated. The same applies to destinations. Operations are therefore keyed by `assignment_id`. The block-level relationships are still derivable via the join through `shift_block_assignments.block_id`.

The decision to use arrays for `source_assignment_ids` and `destination_assignment_ids` (rather than a separate join table) prioritizes correctness and readability per the user's stated preference. The total row count is bounded by the auto-deletion policy.

The `expires_for_cleanup_at` field drives the 14-day post-shift retention cleanup. A daily job deletes float_assignments rows past this timestamp. The corresponding `shift_block_assignments` rows retain their `is_float`, `source_house_id`, and historical user_id; the calendar continues to display the historical assignment correctly.

### 3.5 Swaps

```
swap_requests
  swap_id                       (primary key)
  swap_type                     (enum: shift_swap, float_swap, permanent_swap)
  initiator_user_id             (foreign key)
  counterparty_user_id          (foreign key)
  initiator_assignment_ids      (array of FKs to shift_block_assignments)
  counterparty_assignment_ids   (array of FKs to shift_block_assignments; null/empty for permanent_swap before resolution)
  recurring_pattern             (jsonb; populated for permanent_swap with the recurring shift definition)
  status                        (enum: pending, accepted, rejected, expired, voided)
  created_at                    (timestamp)
  expires_at                    (timestamp; per swap_type policy)
```

Like floats, swap operations identify specific seat-assignments (not blocks) so that multi-headcount blocks can be swapped unambiguously.

Expiry policies:
- `shift_swap`: T-3h of the earlier of the two block sets.
- `float_swap`: 24 hours after the float end time.
- `permanent_swap`: 7 days after `created_at`.

The orchestrator scans `swap_requests` with `status = pending` and flips them to `expired` when `expires_at` is reached.

### 3.6 Preferences

```
preferences
  user_id           (foreign key to users)
  block_id          (foreign key to shift_blocks)
  period_id         (foreign key to scheduling_periods; scopes this preference to a specific semester)
  status            (enum: preferred, available, cannot, none)

period_targets
  user_id           (foreign key to users)
  period_id         (foreign key to scheduling_periods)
  target_hours      (integer; 0 to applicable cap)
  opted_out         (boolean; true if user clicked "no hours")
```

The composite primary key on `preferences` is `(user_id, block_id, period_id)`. The `period_id` column scopes each preference row to a specific semester so that when a new `scheduling_periods` row is created for the next semester, the prior semester's preferences remain intact and queryable. `period_targets` uses `(user_id, period_id)` as its composite primary key for the same reason.

Preferences and period_targets exist only for periods using SM-built scheduling (`regular_school_year`). Winter break and short break do not use preferences.

### 3.7 Notifications

```
notifications
  notification_id   (primary key)
  recipient_user_id (foreign key)
  type              (enum: personal_shift, broadcast, hmod_urgent, ack_reminder,
                          swap_request, hm_leave_notice, sm_permanent_drop_alert,
                          sw_permanent_removal_alert)
  delivered_at      (timestamp; null if pending)
  scheduled_for     (timestamp; for future-cadence delivery)
  payload           (jsonb)
  acknowledged_at   (timestamp; null until the user opens the notification in the updates tab)
```

The notifications table no longer carries an `hm_digest_card` type, since stacked HM digests have been eliminated. A scheduler component processes pending notifications when their `scheduled_for` time arrives.

The `scheduled_for` field is still used for acknowledgment cadence reminders, which are scheduled at the moment a float is assigned and delivered when their offset is reached.

The `sm_permanent_drop_alert` type is used to notify an SM that a worker at their house has permanently dropped a recurring slot. The `sw_permanent_removal_alert` type is used to notify a worker that an SM/HM has permanently removed them from a recurring slot. Both notifications are in-app only (no push); they display on next app open and persist in the recipient's updates tab. The `acknowledged_at` field is populated when the recipient opens the updates tab and views the notification.

### 3.8 Float Exclusion List

When a worker declines or fails to acknowledge a float, they are excluded from re-consideration for that specific gap. This exclusion is recorded:

```
float_exclusions
  exclusion_id      (primary key)
  user_id           (foreign key; the excluded worker)
  window_start_at   (timestamp; start of the excluded time window)
  window_end_at     (timestamp; end of the excluded time window)
  destination_house_id (foreign key; the house of the original gap)
  reason            (enum: declined, no_acknowledgment)
  excluded_at       (timestamp)
```

The float lookup algorithm consults this table during eligibility checks (Section 5.2 step 3a). Exclusions are scoped to a **time window at a destination house**, not to specific block IDs. This matches the behavioral spec rule in Section 6.1 ("they have not previously declined a float that overlaps the same window"): a decliner is excluded from any subsequent float lookup whose destination blocks overlap the original declined window at the same house, even if the replacement gap covers a subset or different blocks. Unrelated future gaps (different time windows or different houses) are unaffected.

Exclusions are auto-deleted along with their corresponding `float_assignments` records on the 14-day post-shift cleanup cycle.

---

### 3.9 Draft Schedule Storage

During Phase 1 (preference-assisted build) and Phase 2 (manual override) of SM-built scheduling — Behavioral Spec Section 4.3 — the SM is constructing a draft schedule that workers must NOT see and that does not yet drive any orchestrator behavior. To keep the draft cleanly separated from live state, the draft lives in its own table:

```
draft_block_assignments
  draft_assignment_id    (primary key)
  period_id              (foreign key to scheduling_periods)
  block_id               (foreign key to shift_blocks)
  user_id                (foreign key to users; the worker the SM has tentatively assigned)
  created_at             (timestamp)
  created_by             (foreign key to users; the SM who placed this draft assignment)
```

`draft_block_assignments` mirrors the minimal shape of `shift_block_assignments` but carries no `status` column — every row represents a tentative scheduled assignment. The table has no row for vacant draft blocks; the SM's UI computes "still unassigned" by comparing the dragged span against existing rows for the relevant `period_id` and blocks.

**Visibility.** The workers' calendar query never reads `draft_block_assignments`. Only the schedule-builder UI (scoped to SMs/HMs/BMs of the house) reads it. The orchestrator never reads it (orchestrator operates only on `shift_block_assignments.status = vacant`).

**Publish operation.** When the SM clicks Publish (Phase 3 transition):

1. In a single transaction, copy every row in `draft_block_assignments` for the period into `shift_block_assignments` with `status = 'scheduled'`, `vacancy_origin = 'none'`, and `is_float = false`, `is_cross_house_pickup = false`, `source_house_id = NULL`.
2. For every `(block_id, seat)` in the period's `shift_blocks` that has NO matching draft row, insert a `shift_block_assignments` row with `status = 'vacant'`, `vacancy_origin = 'never_assigned'`. These are the slots the SM intentionally left empty (low-coverage periods, hires expected later, etc.).
3. Delete all `draft_block_assignments` rows for the period. The draft has been consumed.
4. Mark the `scheduling_periods` row as published (a `published_at timestamp` column — add to §2.10 schema).

After publish, post-publish manual overrides write directly to `shift_block_assignments` (no draft round-trip). The draft table is empty for the period until the next semester's schedule is being built.

**Why a separate table, not a status enum value.** Adding `draft` to `shift_block_assignments.status` would require every consumer (orchestrator, feeds, calendar render, claim handler, float lookup) to remember to filter it out. A separate table cleanly partitions concerns; the orchestrator's query (`status = 'vacant'`) cannot accidentally see drafts. The cost is one extra table; that cost is acceptable per the user's stated correctness-over-storage preference (§1.6/§3.2 Approach A rationale).

### 3.10 System Configuration

A small table holding system-wide configurable parameters (Behavioral Spec Section 14, Appendix B):

```
system_config
  config_key       (primary key; e.g., "drop_horizon_days", "ack_deadline_offset_minutes",
                    "no_ack_trigger_offset_minutes", "min_float_chunk_blocks",
                    "float_retention_days", "shift_block_minutes",
                    "shift_swap_expiry_anchor", "float_swap_expiry_hours",
                    "permanent_swap_expiry_days", "hm_working_hours_start",
                    "hm_working_hours_end", "claim_phase_open_offset_days",
                    "claim_phase_alert_offset_days", "claim_phase_close_offset_days")
  config_value     (text; parsed by the consumer per the key's expected type)
  value_type       (enum: integer, interval, time_of_day, enum; informs parsing)
  modified_by      (foreign key to users; the project administrator's user_id)
  modified_at      (timestamp)
  notes            (text, nullable; e.g., reason for last change)
```

**Read pattern.** The application layer loads the entire table on startup and refreshes every ~60 seconds (matching the orchestrator tick). Consumers read from the cache. A bumped row takes effect on the next orchestrator tick at the latest.

**Profile-scoped parameters** (escalation chain offsets, hours-cap defaults, claim-phase offsets) are NOT stored in `system_config` because they vary by profile; they live in `operating_profiles` (§2.2). `system_config` holds the truly system-wide values that are profile-independent.

**Per-house parameters** (the 6h and 2h ack reminder offsets per Behavioral Spec Section 7.1) live in `ack_cadence_config` (§2.8), not here.

**Snapshot semantics.** Float-assignment-time and claim-time records snapshot the values they consumed (e.g., `ack_cadence_config` already snapshots offsets at float-assignment time per §2.8). `system_config` writes affect only new records; existing in-flight state retains the values it snapshotted at creation.

### 3.11 Allied Coverage Records

When the HMOD confirms Allied has been procured for a block, the relevant `shift_block_assignments` rows are flipped to `status = allied` with `user_id = NULL`. The calendar displays these as Allied-covered. A small `allied_procurements` table optionally records the procurement event for HM reference:

```
allied_procurements
  procurement_id    (primary key)
  assignment_ids    (array of foreign keys to shift_block_assignments; the specific seat-assignments
                     being covered by Allied — not block IDs, because multi-headcount blocks have
                     multiple assignments per block and Allied must target a specific seat)
  procured_by_user_id (foreign key; the HMOD or HM who confirmed)
  procured_at       (timestamp)
  notes             (text, nullable)
```

This table is informational only; the calendar's `allied` status is sufficient for operations.

---

## 4. The Orchestrator

### 4.1 What the Orchestrator Does

The orchestrator runs every 1 minute and is the engine that drives escalation. On each tick, it:

1. Queries all `shift_block_assignments` with status `vacant` whose blocks start within a relevant lookahead window (currently the next 3 hours plus a small buffer).
2. For each vacant block, looks up the date's profile and the profile's escalation chain.
3. For each chain step, evaluates whether the step's offset has been reached.
4. Fires any chain steps whose offset has been reached and which have not yet been processed for this block.
5. Also scans `swap_requests` with `status = pending` for expirations and flips them to `expired`.
6. Also scans `float_assignments` with `status = pending` or `acknowledged` for the T-5 minute no-show check.

A `block_step_status` side table tracks which chain steps have fired for which blocks, to prevent double-firing:

```
block_step_status
  block_id          (foreign key to shift_blocks; part of composite PK)
  step_name         (text, matching a step name from the profile's escalation_chain JSON,
                     e.g. "broadcast", "float_lookup", "hmod_notify_allied"; part of composite PK)
  status            (enum: fired, completed_via_force_trigger, rolled_back)
  fired_at          (timestamp; when the step was first executed)
  updated_at        (timestamp; last status change, e.g. on rollback or force-trigger completion)
```

Primary key is `(block_id, step_name)`. The orchestrator's "not yet processed" check is: no row exists for `(block_id, step_name)` OR the row exists with `status = rolled_back`.

**Rollback semantics.** When a force-triggered float is declined or no-acknowledged, the source-side handler sets `status = rolled_back` for all `block_step_status` rows associated with the destination blocks that were marked `completed_via_force_trigger`. The orchestrator then treats those steps as not-yet-fired and re-evaluates the chain from the current time against the chain offsets. This rollback write happens inside the same transaction as the float status flip to `voided` and the destination block status flip back to `vacant`. Partial rollback (e.g., only rolling back `float_lookup` but not `broadcast`) is supported by setting `status = rolled_back` on only the specific step rows that need re-firing.

**Cleanup.** Rows in `block_step_status` are deleted when their corresponding `shift_blocks` row is deleted or when **every** `shift_block_assignments` row for that `block_id` has transitioned to a terminal status (`allied`, `claimed`, `scheduled`, `floated_in`). For multi-headcount blocks (Harnwell, Quad), the cleanup waits until none of the per-seat assignments is `vacant` — as long as one seat is still vacant, the chain is potentially still firing for that block, so step-status rows must remain. No separate retention policy is needed; the table's size is bounded by the number of currently-open blocks.

### 4.2 Chain Step Implementations

Each chain step is a named handler. The orchestrator looks up the step name from the profile's `escalation_chain` JSON and invokes the corresponding handler.

**Step: broadcast.** Query `users WHERE broadcast_subscribed = true AND home_house_id = :house_id AND is_active = true`. Because broadcast subscription is enforced at write time (Section 3.1 subscription guard), no role filter is needed here — `broadcast_subscribed` is structurally guaranteed to be false for all HMs and BMs. Generate notifications for each matched user. Done.

**Step: float_lookup.** Mark the block as unpickable atomically. Invoke the float lookup algorithm (Section 5). If floaters are assigned, the affected blocks transition appropriately. If no floater is found, the step fails, and the orchestrator immediately fires the next chain step (`hmod_notify_allied`).

**Step: hmod_notify_allied.** Resolve the current HMOD via `hmod_rotor` and `hm_leave`. Determine whether the current time is within HM working hours AND whether the block's start time is within HM working hours; if so, also (or instead) notify the relevant house's HM. Per behavioral spec Section 10, HM working hours notifications go to the HM directly; outside HM hours, only the HMOD is notified. Generate the notification. Block remains `vacant` until the HMOD confirms Allied, at which point the block flips to `allied`.

The HMOD confirmation is a manual in-app action: "I've called Allied for these blocks." Until that action, the block is technically still vacant in the database.

### 4.3 Why Every Minute

A 1-minute orchestrator tick keeps escalation gaps small. For the T-2 hour float lookup, a 15-minute delay would eat into the floater's prep and transit time. 1-minute uniform polling is uniform and trivially cheap.

### 4.4 The No-Ack Trigger

The orchestrator tracks `float_assignments` with `status = pending`. The no-ack trigger fires at 5 minutes before the **acknowledgment deadline** (which is 10 minutes before float start) — that is, at 15 minutes before float start. If at this moment neither `acknowledged_at` nor `declined_at` is set, the orchestrator treats the float as effectively declined and applies the decline pathway:

1. Flip the float's status to `voided`.
2. Exclude the unresponsive worker from any subsequent float lookup whose window overlaps this gap at the same house (recorded in `float_exclusions`, scoped by time window per §3.8).
3. Return the destination blocks to `vacant` status, re-entering the open-shifts feed.
4. **For force-triggered floats:** perform the source-side reconciliation described in §4.5 (the floater is either restored to their original seat or displaced entirely, depending on whether the source-side gap has been claimed/Allied'd in the interim).
5. Resume the standard escalation chain for the destination blocks per Behavioral Spec Section 6.6 #7:
   - If T-3h has not yet been reached, the broadcast fires at T-3h normally.
   - If T-3h has passed but T-2h has not, broadcast is skipped and float lookup fires at T-2h with the decliner excluded.
   - **If T-2h has already passed, the gap goes directly to HMOD-for-Allied.** In the no-ack case specifically, the deadline is at T-15m before float start, so T-2h is always already past at trigger time — the gap always goes directly to HMOD-for-Allied, regardless of whether the original float was automated or force-triggered. This is the only reliable path given 15 minutes of remaining lead time. If a worker happens to claim via the open-shifts feed in those 15 minutes (the gap is technically pickable until T-2h passes for that specific gap's escalation tracking — but in this case T-2h is already past, so the feed entry is unpickable for the *new* T-2h evaluation that the rolled-back chain produces), the claim resolves the gap. In practice, the 15-minute window is too short for claims, so Allied is the realistic outcome.

The 15-minute pre-shift timing balances giving the floater a real acknowledgment window against the need for Allied dispatch lead time. The 5-minute pre-deadline offset is a system-wide configurable parameter.

**Note on chain rollback.** For force-triggered floats, the standard chain steps (`broadcast`, `float_lookup`) were marked `completed_via_force_trigger` in `block_step_status` (§4.5). The no-ack handler rolls those rows back to `status = rolled_back` so the chain re-evaluates. The re-evaluation always concludes "T-2h is past → HMOD-for-Allied" at the T-15m trigger moment, so a fresh `hmod_notify_allied` row is written and that step fires.

### 4.5 The Force-Trigger Pathway

A force-trigger is initiated by an SM/HM/BM via a dedicated endpoint. The orchestrator does not initiate force-triggers; it processes their downstream effects.

Force-trigger flow:

1. Validate: the initiator has SM/HM/BM role at the destination house, and the destination block's escalation has not yet reached T-2h.
2. Invoke the float lookup algorithm immediately.
3. For each floater identified:
   - Create a `float_assignments` row with `initiated_by = force_triggered`, `force_triggered_by = initiator`, `status = pending`.
   - Set the destination block's `shift_block_assignments` row to `status = pending_float_in` with `user_id = floater`.
   - Set the source block's `shift_block_assignments` row to `status = pending_float_out`.
   - If this leaves the source house understaffed at any block during the float window, immediately create new `shift_block_assignments` rows with `status = vacant` for the source-side gap and enqueue them for orchestrator processing.
4. If float lookup returns no floater, immediately fire `hmod_notify_allied` for the destination blocks.

When the force-trigger **succeeds** (a floater is assigned and ultimately acknowledges), the standard T-3h/T-2h chain is suppressed for those blocks. Specifically, for every destination block in the float assignment, the force-trigger handler inserts two rows in `block_step_status` in the same transaction as the float assignment:

- `(block_id, step_name = 'broadcast', status = 'completed_via_force_trigger', fired_at = NOW())`
- `(block_id, step_name = 'float_lookup', status = 'completed_via_force_trigger', fired_at = NOW())`

The `hmod_notify_allied` step is NOT pre-marked: it would still need to fire if Allied procurement becomes necessary later (e.g., on a decline that arrives after T-2h). Leaving `hmod_notify_allied` without a row preserves the orchestrator's ability to fire it when the chain rolls back.

When the force-trigger **fails** (floater declines or no-acknowledges), the standard chain resumes from the beginning per behavioral spec Section 6.6 #7: if T-3h has not yet been reached, the broadcast fires at T-3h normally; if T-3h has passed but T-2h has not, the broadcast is skipped and float lookup fires at T-2h with the decliner excluded; if T-2h has passed, the gap goes directly to HMOD-for-Allied.

**Rollback procedure.** On decline or no-ack of a force-triggered float, in the same transaction that voids the float and reverts the destination blocks to `vacant`:

1. For each affected destination `block_id`, update the matching `block_step_status` rows: set `status = 'rolled_back'` and `updated_at = NOW()` for the `broadcast` and `float_lookup` step rows that were previously `completed_via_force_trigger`.
2. The orchestrator's "not yet processed" check (§4.1) treats `rolled_back` rows as if no row existed, so it will re-evaluate the chain offsets against the current time on its next tick.
3. If T-2h has already passed at rollback time (the no-ack case), the orchestrator will not re-fire `broadcast` or `float_lookup` (their offsets are in the past per the spec's "skip past steps" rule); it will instead fire `hmod_notify_allied` directly. A fresh `(block_id, 'hmod_notify_allied', 'fired')` row is written when that step actually executes.

**Source-side reconciliation on decline.** When the pending float was created, the source-side `shift_block_assignments` rows for the floater were set to `pending_float_out`, and if this dropped the source below required headcount, source-side gap rows were created as `vacant` and enqueued. On decline, the source-side handler:

1. For each affected source-side seat: check whether the originally-displaced row (the floater's `pending_float_out` row) is still effectively vacant — meaning no other worker has claimed the equivalent source-side gap and Allied has not been procured for it.
2. If still vacant: revert the floater's row from `pending_float_out` back to `scheduled` (their original assignment). Cancel any source-side `vacant` rows created for this gap that have not been claimed/Allied'd.
3. If the source-side gap was claimed by another worker or covered by Allied: leave the claimer/Allied in place and set the floater's seat to `vacant` with a special `vacancy_origin = 'displaced_decliner'` flag (or simply leave it removed from the floater's schedule). The floater has no assignment at all for the float-window blocks — they are displaced from both source and destination because their decline came after the source-side reassignment.

The transactional model ensures the source-side claim's state at the moment of decline determines the outcome atomically. The floater sees the result on their calendar immediately.

### 4.6 Notification Routing Logic

When `hmod_notify_allied` (or any HM-action notification) fires:

1. Determine the block's start time.
2. Determine the current time.
3. If current time is within HM working hours (Mon-Fri, [08:00, 17:00)) AND the block start time is within HM working hours AND the block's date is a weekday → resolve the house's **HM only** (via `hm_leave` → effective contact at current moment) and notify them. The BM is not separately notified; if the HM is on leave, leave-resolution returns the BM (or further chain) as the effective contact. A notification firing at exactly 08:00 is within HM hours; one firing at exactly 17:00 is within HMOD hours.
4. Otherwise → resolve the current HMOD (via `hmod_rotor` → effective HMOD at current moment) and notify them.

This implements the behavioral spec's Section 10.1 routing rules exactly. There are no stacked digests; if neither the HM nor HMOD is currently on duty for the routing, the notification still fires (it must, because action is required), but only to whichever role is on duty.

For the edge case of a block whose escalation fires during HMOD time but whose start time is during HM time (e.g., a Sunday-night drop for a Monday-morning shift), the routing depends on when escalation fires: at T-2h, if that moment is still HMOD time, the HMOD is notified. The HM is not separately notified later. The HMOD secures Allied; the HM sees the result on the calendar when they arrive Monday morning.

---

## 5. The Float Lookup Algorithm

This is the implementation of Section 6 of the behavioral spec.

### 5.1 Input

A coverage gap consisting of (destination_house_id, list of contiguous block_ids).

### 5.2 Procedure

1. **Validate eligibility constraints (algorithmic invariants):**
   - The destination must not be Harnwell unless the gap originated from Harnwell itself. (Harnwell-destination float lookups always return empty per Behavioral Spec §6.1; the algorithm short-circuits and the gap goes straight to HMOD-for-Allied.)
   - Workers at the 11 single-staff houses are excluded from the source pool unconditionally.
   - Workers holding the `hm` or `bm` role are excluded from the source pool: HMs may work scheduled shifts but are never selected as floaters; BMs hold no shift assignments at all.
   - Workers with `is_active = false` (fired / deactivated) are excluded.
   - **Hours caps are NOT checked.** A float relocates a worker's already-scheduled hours from their home desk to the destination; total weekly hours are unchanged. See Behavioral Spec §6.1 "Hours cap is not checked at float assignment." The float lookup therefore omits any cap-check predicate, even for workers currently at 39 hours (hard cap) or 19 hours (soft cap).

2. **Get the source priority order.** Query `float_routing` for the current profile. Iterate source houses in `precedence_order` (Quad before Harnwell).

3. **For each source house:**

   a. **Find eligible workers.** A worker is eligible if:
      - They are at a permitted source house (enforced again as invariant).
      - They are scheduled at this source house during any of the gap's blocks.
      - Their departure would leave at least one worker remaining at the source desk for those blocks (the floor is one worker, not the staffing pattern's required headcount), accounting for any other workers in `pending_float_out` or `floated_out` status during that block.
      - They are not already in an assigned float (`pending` or `acknowledged`) overlapping the gap window.
      - They are not currently assigned to a cross-house pickup (`is_cross_house_pickup = true`) overlapping the gap window.
      - They do not hold the `hm` or `bm` role.
      - They have not previously declined a float whose window overlaps this gap at the same house (per the overlap-based exclusion in §3.8).

   b. **For each eligible worker, compute their largest consecutive coverage span within the remaining uncovered blocks.**

   c. **Identify the worker with the largest coverage span.** If their span is at least 2 blocks (1 hour), tentatively assign them. **Always enforce the 2-block minimum at this step** — a worker whose largest span is 1 block is not selected at all. If multiple workers tie on span length, apply the tiebreaker chain (Section 5.3).

   d. **Mark those blocks covered, remove the worker from the eligible pool, increment the per-block "tentatively-floating-out-from-source" counter, repeat** within the same source house until no more eligible workers can cover any remaining consecutive 2-block-or-longer runs.

      The headcount-floor check in (a) reads the running tentative counter in addition to persisted `pending_float_out` / `floated_out` statuses. This guarantees that a single lookup pass cannot over-float a source by selecting more workers in one iteration than the source can spare. Example: Quad (required headcount 3, currently 3 workers on shift) → first floater tentatively selected → tentative counter = 1 → remaining floor = 3 − 1 = 2 workers available → second floater tentatively selected → tentative counter = 2 → remaining floor = 1 → third worker is ineligible (would drop Quad to zero, below the absolute floor of 1).

      The tentative counter is in-memory state during the single lookup invocation. It is materialized as `pending_float_out` rows on `shift_block_assignments` when the algorithm commits its result inside the enclosing transaction (§5.5 Edge Case: Mid-algorithm eligibility changes).

   e. **Partial-coverage fallback.** If no worker can cover the full largest-consecutive run, fall back to selecting the worker who covers the *longest leading portion* of the gap from the gap start, provided that portion is at least 2 blocks. Ties broken by §5.3. Allied procures the remaining tail.

4. **Advance to the next source house.** Once a source is exhausted, move to the next in precedence order and repeat step 3.

5. **Any remaining uncovered blocks go to Allied.** Generate a single `hmod_notify_allied` event covering the union of remaining blocks. If there are non-contiguous remaining runs, group them by contiguity and emit one Allied request per contiguous run.

### 5.3 The Tiebreaker Chain

Tiebreakers are invoked once the chunking algorithm in §5.2 has identified the selected span (either the largest consecutive run, or — via the partial-coverage fallback in §5.2 step 3e — the longest leading portion). The candidate set begins as all eligible workers covering that exact span. If a check has multiple satisfiers, the set is narrowed and the next check runs on the narrowed set.

1. **Check 1 — Alignment at start.** A candidate whose shift starts at exactly the selected span's start. If exactly one candidate satisfies this, select them. If multiple, narrow the candidate set and advance to Check 2.

2. **Check 2 — Alignment at end.** Within the current candidate set: a worker whose shift ends at exactly the selected span's end. If exactly one satisfies, select them. If multiple, narrow and advance to Check 3.

3. **Check 3 — Arbitrary.** Pick one arbitrarily from the current candidate set.

The 2-block minimum from §5.2 step 4 is a precondition for being in the candidate set — a worker who cannot meet it is excluded before the tiebreaker chain runs. The previous Check 3 ("shift ends within float span") was moved out of this chain into the partial-coverage fallback in §5.2 step 3e, where it logically belongs as a fallback rather than a tiebreaker.

### 5.4 Output

Zero or more `float_assignments` records. Possibly an Allied request for residual blocks.

### 5.5 Edge Cases

- **No eligible workers anywhere.** Empty result; entire gap goes to Allied.
- **All eligible workers can only cover sub-hour spans.** Empty result for those blocks; they go to Allied.
- **Mid-algorithm eligibility changes** (a worker accepts a different float while the algorithm runs). Prevented by transaction isolation: the algorithm acquires a lock on relevant `shift_block_assignments` and `float_assignments` rows.

---

## 6. The Force-Trigger Endpoint

A dedicated endpoint allows SMs/HMs/BMs to force-trigger a float lookup before the standard timing.

### 6.1 Request

Input: `(destination_house_id, list of block_ids, initiator_user_id)`.

### 6.2 Validation

1. The initiator must be authorized for the destination house. Authorization is satisfied by **either** of:
   - holding `sm`, `hm`, or `bm` role scoped to the destination house, OR
   - being the currently-on-duty HMOD (resolved via `hmod_rotor` + `hm_leave` at request time). Per Behavioral Spec §2.5 the HMOD holds HM permissions across all 13 houses while on duty, which includes force-trigger authority. The HMOD check is performed in addition to, not in place of, the role-scope check, so an HM who is also the current HMOD is doubly authorized for their own house and singly authorized for the other 12.
2. Each block must currently be `vacant`.
3. The earliest block's start time must be more than 2 hours in the future. Otherwise, the standard escalation will already fire (or has fired) and force-triggering is redundant.
4. No block in the request may already have a `pending_float_in` assignment.
5. The block's date must belong to a profile with `float_enabled = true`. Force-trigger is rejected during winter break or any other non-floating profile (no source pool exists; the standard chain's broadcast → HMOD-for-Allied is the only available route).

If any check fails, the request is rejected with a descriptive error.

### 6.3 Execution

Per Section 4.5 of this document. Atomic: all source-side and destination-side updates happen in one transaction.

### 6.4 Visibility

Pending float assignments are visible on:
- The destination house's calendar with "(Pending)" label.
- The source house's calendar with "(Pending)" label.
- The pending floater's personal calendar with "(Pending)" label.

---

## 7. Permanent Drop and Permanent Pickup Operations

The permanent drop and permanent pickup workflows (Behavioral Spec Section 8.4) are bulk operations on `shift_block_assignments`. They execute synchronously in a single database transaction; they are not orchestrator background passes.

### 7.1 Permanent Drop Procedure

**Input:** (dropping_user_id, slot_definition, partial_block_subset_or_full)

Where `slot_definition` is the recurring slot identifier — a tuple of (house_id, day_of_week, set_of_block_start_times). For a full-slot drop, the set of block-start-times is every block in the recurring slot. For a partial drop, the set is a contiguous subset.

**Procedure:**

1. Resolve `semester_end_date` — the last operating date of the current semester — using the `scheduling_periods` table (Section 2.10):

   ```sql
   SELECT end_date AS semester_end_date
   FROM scheduling_periods
   WHERE :drop_date BETWEEN start_date AND end_date
     AND profile_name = 'regular_school_year';
   ```

   This is a single point lookup. If it returns a row, `semester_end_date = scheduling_periods.end_date`. The `scheduling_periods.end_date` was set at calendar-population time as the last regular_school_year date of the semester, which is exactly the boundary needed.

   **Fallback if the lookup returns no row (data integrity error).** If no `scheduling_periods` row covers the drop date, the system must not silently proceed with an unbounded drop. Instead, raise an application-layer error: "Cannot determine semester boundary for this date. Contact the administrator to verify the scheduling_periods table." Do not fall back to the recursive CTE silently. The CTE walk remains documented below as the source of truth for what `scheduling_periods.end_date` should equal, and may be used by an administrator to diagnose and repair a misconfigured `scheduling_periods` entry.

   **Documented CTE (for administrative verification and calendar-population tooling):**

   ```sql
   WITH RECURSIVE semester_walk AS (
     SELECT :drop_date::date AS d
     UNION ALL
     SELECT (sw.d + INTERVAL '1 day')::date
     FROM semester_walk sw
     WHERE EXISTS (
       SELECT 1 FROM operating_calendar oc
       WHERE oc.date = (sw.d + INTERVAL '1 day')::date
         AND oc.profile_name != 'winter_break'
     )
   )
   SELECT MAX(d) AS semester_end_date FROM semester_walk;
   ```

   This CTE walks forward one day at a time, stopping at the first day that is either absent from `operating_calendar` (summer gap) or has `profile_name = 'winter_break'`. It is the authoritative definition of what `scheduling_periods.end_date` should contain. The calendar-population tool should run this CTE when creating each `scheduling_periods` row and write the result into `end_date`. Note: Postgres's default recursion depth limit is 100 iterations; a semester is at most ~140 days, so set `SET LOCAL max_recursive_iterations = 200` when running this CTE, or compute it in application code over `operating_calendar` rows loaded into memory.

2. Compute the cutoff timestamp: the start time of the dropping operation. Call this `drop_initiated_at`.

3. Execute, within a single transaction:

```sql
UPDATE shift_block_assignments sba
SET
  user_id = NULL,
  status = 'vacant',
  vacancy_origin = 'permanent_drop'
WHERE sba.user_id = :dropping_user_id
  AND sba.block_id IN (
    SELECT sb.block_id
    FROM shift_blocks sb
    JOIN operating_calendar oc ON oc.date = sb.block_start_at::date
    WHERE sb.house_id = :slot_house_id
      AND EXTRACT(DOW FROM sb.block_start_at) = :slot_day_of_week
      AND TO_CHAR(sb.block_start_at, 'HH24:MI') IN :slot_block_start_times
      AND sb.block_start_at > :drop_initiated_at
      AND sb.block_start_at::date <= :semester_end_date
      AND oc.profile_name = 'regular_school_year'  -- short-break dates in the semester have a different profile and no recurring slot
  )
  AND sba.status NOT IN ('floated_out', 'pending_float_out');
```

The `profile_name = 'regular_school_year'` predicate ensures embedded short-break dates within the semester are naturally excluded (they have a different profile and no recurring assignments under SM-built scheduling). The `semester_end_date` boundary ensures the drop does not carry into the next semester's regular_school_year period across a winter_break or summer interruption.

The trailing AND-clause excludes blocks where the dropping worker is currently committed to a float — those commitments are firm and the no-takeback rule applies.

**UI warning for outstanding float commitments.** Before the confirmation popup is rendered, the perm-drop handler queries `float_assignments` for any `pending` or `acknowledged` row where the worker is the floater AND any of the float's source-side blocks intersect the recurring slot being dropped. If any such rows exist, the confirmation popup includes an explicit warning:

> "You have N pending/active float commitment(s) within this recurring slot. Those commitments will NOT be cancelled by this permanent drop — you are still expected to work them. Only the home-desk portion of those weeks is being released. Continue?"

This is purely a UI warning; the SQL backstop still skips `floated_out` / `pending_float_out` rows so the no-takeback rule cannot be accidentally violated.

4. Notify the SM of the affected house: insert a row in `notifications` with `type = sm_permanent_drop_alert`, `delivered_at = NULL`, `scheduled_for = NOW()`. The notification is displayed in-app on the SM's next session and persists in their updates tab.

5. If the dropping operation was initiated by an SM/HM/BM acting on behalf of the affected worker (rather than the worker themselves), additionally notify the affected worker: insert a row in `notifications` with `type = sw_permanent_removal_alert` and the operator's identity in the payload.

6. Return the count of affected blocks for the user-facing confirmation summary.

**Key safety properties:**

- The `user_id = :dropping_user_id` predicate ensures the bulk update only affects blocks the dropping worker currently owns. Weeks where ownership has already passed to another worker (via swap, temporary claim, prior pickup) are not touched.
- The `block_start_at > :drop_initiated_at` predicate excludes past and in-progress occurrences. A mid-shift drop does not affect the shift currently being worked.
- The `block_start_at::date <= :profile_end_date` predicate scopes the drop to the current operating profile.
- The transaction is atomic; either all affected rows are updated or none are.

### 7.2 Permanent Pickup Procedure

**Input:** (picking_user_id, slot_definition)

The slot_definition identifies blocks currently in `vacant` / `permanent_drop` state for the same recurring slot pattern.

**Procedure:**

1. **Cross-house eligibility precheck.** If the slot's `house_id` differs from `picking_user.home_house_id`, verify the cross-house pickup matrix (Behavioral Spec Section 5.3). Specifically: if the slot's house is Harnwell and the picker's home house is not Harnwell, reject the request with an "ineligible: Harnwell training required" error. All other cross-house permutations are permitted. This check is the algorithmic invariant from Section 1.5 and is enforced regardless of how the request reached this handler.

2. Resolve the current operating profile's end date.

3. Identify candidate blocks: all blocks matching `vacancy_origin = 'permanent_drop'`, the slot's recurring pattern (house_id, day-of-week, block-start-time), date strictly after the moment of the pickup operation, and date within the current operating profile.

4. For each future week in scope:

   a. Group the slot's blocks for that specific week.

   b. **Time conflict check:** For each block in the week's group, check whether the picking worker has any other shift block assignment for that same `block_id` (the worker can only occupy one position at a time per block). If a block conflicts, mark that block as `skip-conflict`.

   c. **Hours cap check:** Compute the picking worker's projected weekly hours for that calendar week:
      - Start with their current assigned hours for that week (sum of all `shift_block_assignments` where user_id = picking_user, block_start_at is within the calendar week, status in valid worked categories). Float-out assignments do not change the total — they are hours-neutral per Behavioral Spec §6.1 — and are counted as the worker's hours regardless of where the work is physically performed.
      - Add the non-conflicting blocks from this week's slot occurrence (0.5 hours per block).
      - Resolve the effective cap for that week via `weekly_cap_overrides` (or profile default).
      - If the projected hours > cap, mark all of this week's slot blocks as `skip-cap`. **This applies whether the cap is `hard` or `soft`** — permanent pickup is treated more conservatively than one-off temporary claims because the user is committing to many weeks in one action, and silently exceeding soft cap across many weeks is undesirable (Behavioral Spec §8.4.3). The worker can still pick up specific weeks individually via the weekly feed if they explicitly want to override soft cap on a per-week basis.

   d. For blocks not marked skip, queue them for assignment.

5. Compute the confirmation summary: total weeks in scope, weeks fully assigned, weeks fully skipped (with reason), weeks partially assigned (with reason for skipped portion). Return to the UI for user confirmation.

6. On user confirmation, execute within a single transaction. The transaction **re-runs time-conflict and cap checks per-week against the live database state** at the time of the transaction, not against the state shown in the confirmation popup. If any week has become ineligible since the popup was shown (e.g., the picker was assigned a conflicting shift between popup and submit, or the cap was lowered), those weeks are silently removed from the queued set before the UPDATE executes. A post-commit summary surfaces any additional skips.

```sql
UPDATE shift_block_assignments sba
SET
  user_id = :picking_user_id,
  status = 'claimed',
  vacancy_origin = 'none',
  is_cross_house_pickup = (:slot_house_id != :picking_user_home_house_id),
  source_house_id = CASE
    WHEN :slot_house_id != :picking_user_home_house_id THEN :picking_user_home_house_id
    ELSE NULL
  END
WHERE sba.block_id IN :final_queued_block_ids  -- after in-transaction per-week re-check
  AND sba.status = 'vacant'
  AND sba.vacancy_origin = 'permanent_drop';
```

The `status = 'vacant'` and `vacancy_origin = 'permanent_drop'` predicates ensure concurrent pickups of the same slot are race-safe: once the first transaction commits, the rows no longer satisfy these predicates and the second transaction silently skips them.

The `is_cross_house_pickup` and `source_house_id` fields are set conditionally based on whether the slot's house matches the picker's home house.

7. The picked-up blocks now have `status = 'claimed'`. The picking worker is the current owner.

8. **Permanent feed removal.** Immediately after commit, the slot is removed from the permanent openings feed for this house. This applies regardless of whether the pickup was complete or partial. The permanent feed queries on `vacancy_origin = 'permanent_drop'`; once any block in the slot is claimed, the slot's feed entry reflects only remaining unclaimed occurrences. Skipped weeks are not re-exposed in the permanent feed; they surface individually in the weekly feed as they cross the 30-day horizon.

**Key safety properties:**

- The skip-conflict logic prevents the same worker from being scheduled to two simultaneous blocks.
- The skip-cap logic prevents hard-cap violations on a per-week basis while still permitting the pickup to apply to non-violating weeks.
- The atomic update ensures partial failures do not leave the calendar in an inconsistent state.
- The race-safe `WHERE` predicate on submit ensures no stale-state writes.

### 7.3 Re-Permanent-Drop After Pickup

A worker who has permanently picked up a slot may later permanently drop it. The procedure is identical to Section 7.1: the bulk-update walks future occurrences where `user_id = the_re-dropper` and sets them back to `vacant` / `permanent_drop`. The slot re-appears in the permanent openings feed. The history of prior owners is not retained beyond the current `user_id` on each block.

### 7.4 Profile Boundary

When the current operating profile ends (e.g., end of fall semester), the permanent openings feed for that profile is emptied. Any remaining `permanent_drop` vacancies that did not get picked up exist as historical vacant blocks on the calendar but no longer surface in any feed. The next profile is built fresh through preference submission and SM-built scheduling (or claim-based, for break profiles).

### 7.5 Why Synchronous, Not Orchestrator-Driven

The bulk operations described here are user-initiated and require an immediate confirmation summary in the UI before the worker submits. This is incompatible with an asynchronous orchestrator pass. The operations are executed as synchronous database transactions in the request-handling layer. Each operation is bounded in scope (one recurring slot, one operating profile, at most ~30 future weeks) so transaction times are manageable.

The notifications generated by these operations (SM in-app passive indicator, SW permanent removal alert) are inserted into the `notifications` table and processed by the standard notification delivery pipeline.

---

---

## 8. The Two-Cycle Build Plan

### 8.1 Cycle 1: The Full In-Scope System

Cycle 1 delivers the complete in-scope system covering regular school year, winter break, and short breaks. Summer is explicitly out of scope (Behavioral Spec Section 3.1) and is not addressed in either cycle.

Cycle 1 includes:

- User accounts, roles (including HM and BM), authentication.
- Schema for users, shift_blocks, shift_block_assignments, float_assignments, swap_requests, preferences, notifications, weekly_cap_overrides, hmod_rotor, hm_leave, ack_cadence_config, float_exclusions.
- Configuration tables: operating_calendar, operating_profiles, staffing_patterns, float_routing, break_periods, scheduling_periods.
- The orchestrator with broadcast, float_lookup, and hmod_notify_allied chain step handlers.
- The float lookup algorithm with multi-floater chunking and minimum-chunk enforcement.
- The force-trigger endpoint.
- Drop (temporary and permanent), claim (temporary and permanent — in-house AND cross-house), and swap workflows for SWs (operating on blocks). Cross-house pickup eligibility enforced via the Harnwell training invariant.
- The Shifts screen UI: three-tab layout (My Shifts, Open Shifts in My House, Open Shifts in Other Houses) per Behavioral Spec Section 5.6.
- Schedule building UI for SMs (drag-picker with three phases, operating on 30-minute granularity).
- Claim-based scheduling for short breaks AND winter break (same workflow).
- The calendar UI with all color-coded shift displays (light green float-in, light purple float-out, pending labels, circle indicator for picked-up, golden border for break shifts, Allied label, permanent-drop indicator).
- Notification routing (real-time HM during HM hours, HMOD otherwise; no stacked digests). Includes SM in-app passive indicator for permanent drops.
- Preferences submission UI for SWs (regular school year only).
- Hours tracking and cap enforcement (soft and hard, with per-week global override).
- HM/BM leave UI with replacement selection and email drafting.
- HMOD rotor configuration UI.
- Contact lookup from shift cards.
- Pending float visualization.
- Permanent openings feed (separate tab in the open-shifts UI).
- Permanent drop and permanent pickup workflows with confirmation summaries.

Summer dates simply have no row in `operating_calendar`; the system is dormant for those dates (no shifts, no orchestrator activity, no notifications). All three in-scope profiles are exercised by cycle 1.

### 8.2 Cycle 2: Post-Launch Tuning

Cycle 2 begins after the first full operating cycle (a fall semester, the following winter break, and a spring semester) has been observed. During cycle 2:

- Additional winter break operational specifics observed in production are populated into config (staffing pattern refinements, escalation chain tweaks).
- Any short-break-specific quirks discovered during fall/spring breaks are captured.
- Hours cap defaults, escalation timings, and other Section 14 parameters are tuned based on real-world data.

Cycle 2 should not require any code changes. If it does, the cycle 1 implementation has hardcoded something that should have been config.

### 8.3 What Cycle 1 Must Get Right to Enable Cycle 2

1. **The orchestrator must read chain steps from the profile, not hardcode them.**
2. **The `staffing_patterns` table must support time-banded headcounts at block granularity** (even though no in-scope profile currently uses banding, future profile additions or post-launch tuning may).
3. **`float_enabled` must be a profile flag AND a runtime headcount check.**
4. **All system-wide configurable parameters (Section 14 of behavioral spec) must be stored in a config table or in `operating_profiles`, not in code constants.**
5. **The block-based shift model must be in place from day one;** retrofitting block-granularity onto a range-based schema would be a major refactor.
6. **The `vacancy_origin` field on `shift_block_assignments` must be populated correctly from day one;** the permanent openings feed depends on it.

### 8.4 Things That Cannot Be Postponed

- **Regular school year staffing pattern.** Already specified.
- **Winter break staffing pattern.** Already specified (Harnwell only, single-staffed).
- **Short break staffing pattern.** Already specified.
- **Hours cap toggle mechanism.** Global per-week override UI ships in cycle 1.
- **Calendar profile assignment UI.** Ships in cycle 1.
- **HMOD rotor configuration UI.** Ships in cycle 1.
- **HM/BM leave UI.** Ships in cycle 1.
- **Block-based shift model and partial drop/claim UI.** Ships in cycle 1.
- **Force-trigger endpoint and UI.** Ships in cycle 1.
- **Permanent drop and pickup workflows.** Ship in cycle 1.

### 8.5 Summer (Deferred Indefinitely)

Summer is left for a possible future implementation. The current architecture supports its eventual addition without schema changes: adding a `summer` row to `operating_profiles` with appropriate `escalation_chain`, `shift_start_bound`, `default_hours_cap`, etc., plus per-house rows in `staffing_patterns` (where time-banded headcounts may be useful), plus relevant `float_routing` rows, plus mapping summer dates in `operating_calendar` would suffice. No code changes are anticipated for an eventual summer rollout — this is a deliberate property of the configuration model.

The reasons for deferring summer are operational, not technical: summer schedules at Penn Housing are essentially static, Harnwell does not float in summer, the Quad is closed, only a few houses are intermittently double-staffed, and coverage failures escalate immediately to HMOD/Allied without any meaningful float-lookup step. The system's primary value does not apply. See Behavioral Spec Section 3.1.

---

## 9. Performance, Scale, and Operational Notes

### 9.1 Database Size

- `operating_calendar`: ~365 rows per year. Trivial.
- `staffing_patterns`: ~3 profiles × 13 houses × 2 day types = ~78 rows (closed-house combinations have no row, so actual count is lower).
- `shift_blocks`: ~32 blocks/day × 13 houses × 365 days × avg headcount ~ 200,000 rows per year. With block-per-row storage and headcount > 1 expansion, this is significant but manageable; indexing on `(house_id, block_start_at)` keeps queries fast.
- `shift_block_assignments`: same order of magnitude as `shift_blocks`.
- `float_assignments`: bounded by 14-day retention; even at high float volume, the table stays small.

Both `shift_blocks` and `shift_block_assignments` should be indexed on `(house_id, block_start_at)` for calendar queries and on `(status, block_start_at)` for orchestrator scans.

### 9.2 The Orchestrator Tick Frequency

A 1-minute tick processing open blocks within the next 3 hours queries a small subset of `shift_block_assignments`. Cheap with proper indexing.

### 9.3 Notification Scheduler

The `notifications` table has a `scheduled_for` column. The scheduler component processes pending notifications when their `scheduled_for` time arrives. This is how acknowledgment cadence reminders work.

### 9.4 The Calendar Render

The calendar view at any house for any date range queries `shift_block_assignments` joined to users, filtered by `house_id` and `block_start_at` range. The application layer aggregates contiguous blocks into displayed shift cards.

### 9.5 Transaction Boundaries

- **Claim (in-house or cross-house):** lock and update the target `shift_block_assignments` rows atomically. Re-check hours cap and run a system-wide time-conflict check (no overlap with the claimer's other assignments at any house in any status) inside the transaction. For a cross-house claim, the handler first verifies the Harnwell training invariant (Section 1.5): reject if `block.house_id = Harnwell` and `claimer.home_house_id != Harnwell`. On commit, populate `is_cross_house_pickup = true` and `source_house_id = claimer.home_house_id` if the claim is cross-house; otherwise both remain at their defaults (false / null). A cross-house pickup makes the claimer unavailable at their home house for the overlapping blocks (they cannot also be scheduled there, be floated to a third house, or pick up another cross-house shift overlapping the window); if their home house's headcount falls below required as a result, a home-side gap surfaces and proceeds through normal escalation independently.
- **Temporary drop:** update the affected `shift_block_assignments` rows to `vacant` with `vacancy_origin = 'temporary_drop'`, then enqueue orchestrator jobs to evaluate escalation. The drop itself is one transaction.
- **Firing:** account deactivation and shift cleanup execute atomically. The in-progress block (if any) is vacated immediately with `vacancy_origin = 'temporary_drop'`; the system checks whether the desk is now unmanned and enqueues an immediate float lookup if so. Future recurring slots are vacated with `vacancy_origin = 'permanent_drop'`. Future non-recurring assignments are vacated with `vacancy_origin = 'temporary_drop'`. Voided float assignments trigger an immediate float lookup for their destination blocks with the fired worker excluded.
- **Permanent drop:** bulk-update all future occurrences of the recurring slot owned by the dropping worker within the current operating profile, setting `status = 'vacant'` and `vacancy_origin = 'permanent_drop'`. Insert SM notification row. One atomic transaction (Section 7.1).
- **Permanent pickup:** bulk-update the picked-up blocks atomically (Section 7.2). Race-safe via the `vacancy_origin = 'permanent_drop'` predicate on the final UPDATE.
- **Float assignment (automated):** insert `float_assignments` row, update source-side and destination-side `shift_block_assignments`, all in one transaction.
- **Force-triggered float:** same as automated, plus immediate creation of source-side gap rows if the source becomes understaffed.
- **Shift swap acceptance:** swap user_id between block sets atomically.
- **Float swap acceptance:** swap user_id between affected blocks and float_assignments atomically.
- **Permanent swap acceptance:** swap user_id across all future recurring blocks atomically.
- **HM leave start/end:** insert or update `hm_leave` row atomically; replacement resolution recomputes on next read.
- **Global weekly cap override:** insert or update `weekly_cap_overrides` row atomically.

### 9.6 Cleanup Jobs

- **Float assignment cleanup.** Daily job deletes `float_assignments` rows where `expires_for_cleanup_at < now()`. Idempotent.
- **30-day horizon job.** Daily job scans for fired-worker shifts crossing the 30-day horizon and surfaces them in the open-shifts feed.
- **Swap expiry.** Handled by the orchestrator on its 1-minute tick.

---

## 10. Risks and Mitigations

### 10.1 The Cycle 1 Configuration Trap

Mitigation: implement at least three profiles in cycle 1 and verify the orchestrator produces correct behavior for all three without code changes.

### 10.2 Race Conditions in Concurrent Claims

Mitigation: row-level locking. The first transaction to acquire the lock and commit wins.

### 10.3 The Orchestrator Falling Behind

Mitigation: the orchestrator is idempotent — when it catches up, it processes all pending steps for all blocks, regardless of how far back they go.

### 10.4 The Profile Boundary Weekly Cap

Per behavioral spec Section 9.3, default rules are deterministic (40 hours if any 40-hour break day appears in the week, otherwise the default). The `weekly_cap_overrides` table allows HM/BM modification.

### 10.5 Block Storage Growth

Mitigation: indexes on the two most-queried columns. If `shift_blocks` exceeds 5 million rows, consider monthly partitioning. Float retention (14 days) keeps `float_assignments` small.

### 10.6 Force-Trigger Misuse

Risk: an SM could force-trigger floats unnecessarily, creating churn at source houses. Mitigation: the action is logged in the `float_assignments.force_triggered_by` field; if observed in operations, a usage report can be generated from this field. No system enforcement of "appropriate use."

### 10.7 Layered Leave Cascades

The delegation graph is enforced acyclic at insertion time via the incoming-chain exclusion check (Behavioral Spec Section 2.6, Architecture Section 2.7). This eliminates cycles structurally. Residual risks and mitigations:

- **No eligible replacement.** If all HMs/BMs are excluded by the cycle-prevention rule, the project administrator is the mandatory fallback. The picker always surfaces the project administrator as an option regardless.
- **Depth limit breach.** If the recursive CTE reaches depth 10 during resolution, the system flags the chain, notifies everyone in it plus the HMOD on duty, and routes all notifications to the HMOD on duty. This should not occur in correct operation and indicates a data integrity issue that bypassed the insertion check.
- **Concurrent insertion creating a cycle.** Prevented by running the incoming-chain check inside a serializable transaction. If two HMs concurrently create leaves that would form a cycle, one succeeds and one fails with a conflict error; the failing party is prompted to re-select a replacement.

### 10.8 Pending Float Source Starvation

Risk: a force-trigger creates a pending float; the source desk now treats the floater as gone; a second emergency at the source occurs and no eligible local worker can fill it; Allied is called for the source. This is by design — the no-takeback rule applies even to pending floats — but operationally it means a force-trigger that no one wants creates real cost.

Mitigation: pending floats are visible on three calendars (Section 6.4). Workers who see a pending float assigned to them and intend to decline are encouraged to do so promptly so that the gap can re-enter standard escalation with maximum lead time. The T-5-pre-deadline trigger is the system's backstop.

### 10.9 Concurrent Permanent Operations

Risk: two workers simultaneously attempt to permanently pick up the same recurring slot. Both see the slot in the permanent openings feed, both review the confirmation popup, both submit. Without protection, one would overwrite the other.

Mitigation: the permanent pickup UPDATE statement (Section 7.2 step 5) includes `vacancy_origin = 'permanent_drop'` and `status = 'vacant'` as predicates. Once the first transaction commits, the rows have `status = 'claimed'` and the second transaction's predicate fails for those rows. The second worker gets a partial-success result, and the UI surfaces a mid-pickup notification: "X of Y blocks were already claimed by another worker; your pickup affected Z blocks." For the most common case (the entire slot was just picked up), the second worker sees zero affected blocks.

A similar issue could occur if a worker permanently drops a slot at the same moment another worker is in the middle of a permanent pickup of an earlier-state version. Mitigation: same predicate-based race guard. The pickup's predicate requires the blocks to currently be in `permanent_drop` state; if they've already been reassigned, the pickup skips them.

### 10.10 Permanent Drop UX Misuse

Risk: a worker permanently drops a slot they should have temporarily dropped. The recurring assignment is now gone for the rest of the period. Recovery requires either the worker themselves (or the SM/HM) to permanently pick it back up via the permanent openings feed, which is reversible in principle but operationally cumbersome.

Mitigation: the confirmation popup at permanent drop time explicitly shows the number of weeks affected, making the scope clear. UI design (a distinct visual treatment for the permanent drop button vs. the temporary drop button) reduces accidental clicks. Beyond UI design, no system enforcement.

---

## 11. What's Out of Scope

- Performance metrics dashboard. No tracking of last-minute drops, no-shows, or worker reliability scores.
- Cross-house worker pooling beyond the float mechanism.
- Mobile schedule creation. Drag-picker is desktop-only.
- External integrations beyond Penn's standard auth.
- Multi-campus support.
- Audit logging of who-did-what (beyond what's captured in the schema for force-triggers and HM leave).

These can be added later as cycle 3+ work if needs arise.

---

## 12. Open Questions and Future Decisions

Items not yet decided:

- **The exact UI for the calendar profile painter.** Not yet designed.
- **The recovery path for a corrupted swap state.** Recommendation: SM/HM can manually edit `shift_block_assignments` to any state via override; the swap system is one mechanism among several.
- **Notification retry on delivery failure.** Recommendation: leave this to the notification provider's default retry policy.
- **Additional system-wide configurable parameters the project administrator may want to add.** Section 14 of the behavioral spec will be updated as the project committee provides feedback.
- **Whether SMs should be able to modify the global weekly cap.** Currently restricted to HM/BM; the project administrator may revisit.
- **Whether the force-trigger should be auditable beyond the `force_triggered_by` field.** Currently no audit log; if misuse becomes a concern, a lightweight audit table may be added.

---

## Appendix A: Schema Summary Diagram

The full schema in conceptual form:

```
users ─┬─ user_roles
       ├─ home_house_id → houses
       ├─ broadcast_subscribed (bool; enforced false for hm/bm at write time)
       ├─ ack_cadence_config
       └─ hm_leave (as user or replacement)

houses ─┬─ shift_blocks ─── shift_block_assignments ──┬── user_id → users
        │                                              ├── parent_float_id → float_assignments
        │                                              └── source_house_id → houses
        ├─ staffing_patterns (per profile)
        └─ float_routing (per profile, as source or dest)

operating_calendar ── profile_name → operating_profiles
                                       (escalation_chain, defaults, claim phase offsets)

weekly_cap_overrides (per Monday-week)
hmod_rotor (per Monday-week) → users
hm_leave → users (target), users (replacement)

float_assignments ─── source_assignment_ids, destination_assignment_ids → shift_block_assignments
swap_requests ── initiator_assignment_ids, counterparty_assignment_ids → shift_block_assignments
break_periods ─── profile_name → operating_profiles
scheduling_periods ─── profile_name → operating_profiles
preferences ── (user_id, block_id, period_id) → users, shift_blocks, scheduling_periods
period_targets ── (user_id, period_id) → users, scheduling_periods

notifications ── recipient_user_id → users
block_step_status ── block_id → shift_blocks

allied_procurements ── assignment_ids → shift_block_assignments
```

## Appendix B: Configuration Defaults at Launch

Initial values for system-wide configurable parameters (per behavioral spec Section 14):

| Parameter | Value |
|-----------|-------|
| Broadcast offset | -3h (before float start) |
| Float lookup offset | -2h (before float start) |
| HMOD notify (on float failure) offset | -2h (before float start) |
| Acknowledgment deadline | -10m (before float start) — decoupled from float lookup |
| No-ack trigger | -5m (before acknowledgment deadline = -15m before float start) |
| Acknowledgment reminder #1 (HM/BM configurable per house) | -6h before acknowledgment deadline |
| Acknowledgment reminder #2 (HM/BM configurable per house) | -2h before acknowledgment deadline |
| Acknowledgment reminder #3 (mandatory) | -1h before acknowledgment deadline |
| Acknowledgment reminder #4 (mandatory) | -30m before acknowledgment deadline |
| Acknowledgment reminder #5 (mandatory) | -5m before acknowledgment deadline |
| Claim phase open offset | -14d |
| Claim phase alert offset | -3d |
| Claim phase close offset | -1d |
| Drop horizon | 30 days |
| Block granularity | 30 minutes |
| Float assignment retention | 14 days post-shift end |
| Shift swap expiry | T-3h of earlier shift |
| Float swap expiry | 24h after float end |
| Permanent swap expiry | 7 days after creation |
| Minimum float chunk size | 2 blocks (1 hour) — non-negotiable |
| HM working hours | Mon-Fri 08:00 to 17:00 |
| HMOD rotor cadence | Weekly, Monday 08:00 handoff |

All values are stored in a `system_config` table (one row per parameter) and may be updated by the project administrator. The application layer reads these on a short cache cycle (~1 minute, matching the orchestrator).

---

## Appendix C: Confirmed Decisions Captured in v2

Mirrors Appendix A of the Behavioral Specification:

1. Force-trigger source-side gap enters the open-shifts feed immediately (Section 4.5, 6.3).
2. Decline (or T-5 no-show) voids the float and re-opens the gap to standard escalation; no immediate cascade. Declining worker excluded from re-consideration via per-gap exclusion list (Section 4.4).
3. Acknowledgment reminders anchor to the T-2h **acknowledgment deadline**, not to the float start time.
4. Global weekly cap modification authority restricted to HM/BM, instant, no approval workflow (Section 2.5).
5. Permanent swap accept-reject flow is in-app, with 7-day expiry. SM is not the executor; the two affected workers approve directly (Section 3.5).
6. Float assignment auto-deletion after 14 days. The calendar (via `shift_block_assignments` with `is_float` and `source_house_id` retained) preserves the operationally-relevant float-shift record (Section 3.4, 9.6).
7. HMOD rotor stored as a dedicated table keyed by Monday-of-week (Section 2.6).
8. Winter break uses same claim-phase checkpoints as short break: T-14d / T-3d / T-1d (Section 2.2).
9. "I'm back" attribution: prior actions during leave stay attributed to the replacement; HM resumes from the moment of click forward (Section 2.7).
10. Force-trigger spans snapped to 30-minute blocks (Section 1.6).

## Appendix D: Permanent Drop and Permanent Pickup (v3 Architecture Notes)

The following architectural decisions support the permanent drop and permanent pickup workflows added in v3:

1. **Schema mechanism:** A `vacancy_origin` column on `shift_block_assignments` distinguishes permanent-drop vacancies from temporary-drop vacancies (Section 3.3). The permanent openings feed queries on this field.
2. **No recurring template table:** Permanent drops bulk-update `shift_block_assignments` directly using a date-range + day-of-week + ownership predicate. No separate template-table abstraction is introduced (Section 7.1).
3. **Synchronous bulk operations:** Permanent drop and pickup execute as single database transactions in the request-handling layer, not as orchestrator background passes. This is required for the immediate confirmation summary in the UI (Section 7.5).
4. **Race safety:** Permanent pickup's final UPDATE includes `vacancy_origin = 'permanent_drop'` and `status = 'vacant'` predicates, ensuring concurrent pickups are race-safe via last-write-wins per row (Section 10.9).
5. **Bulk-update scope:** Permanent drops are scoped to (a) the dropping worker as current owner, (b) blocks strictly after the operation moment, (c) blocks within the current operating profile (Section 7.1). Past, in-progress, swap-transferred, or other-owner-held weeks are skipped naturally.
6. **Per-week conflict resolution at pickup:** Time conflicts cause individual blocks to be skipped for that specific week (partial pickup); hours cap violations cause the entire week to be skipped (Section 7.2). The overall pickup proceeds with whatever weeks remain.
7. **Notifications:** Two new notification types (`sm_permanent_drop_alert` and `sw_permanent_removal_alert`) carry the in-app passive indicators. Persistent in the updates tab via the `acknowledged_at` field (Section 3.7).
8. **No published-schedule snapshot:** The calendar's current state is the only state. No historical record of "this slot was originally Alice's" is retained beyond the live owner.
9. **Profile boundary:** Permanent vacancies that go unfilled simply cease to exist at the end of the operating profile. The next profile is scheduled fresh (Section 7.4).
