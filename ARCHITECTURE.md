# Shift@PennHousing — Architecture Document (v2)

This document describes how the software is structured to guarantee the rules defined in the Behavioral Specification. The Behavioral Specification is the source of truth for what is correct; this document describes how the code, schema, and configuration enforce that truth.

This document is opinionated and prescriptive. It exists because the behavioral spec must be implementable in a way that handles change gracefully — specifically, change to season rules, threshold timings, staffing patterns, and configurable parameters without requiring code modifications.

Sections 1 through 12 cover the staffing engine. Sections 13 through 19 cover everything built on top of it: the Desk Assistant, the knowledge intake pipeline, the AI schedule agent, duty resolution and launch gating, house memberships, and mobile onboarding and widgets. These map onto behavioral spec Sections 16 through 22 and change nothing in the engine below them.

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
- The minimum float chunk size (currently 1 block = 30 minutes).
- The maximum Allied coverage secured per pass (currently 8 blocks = 4 hours).
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

The principle: configuration controls how the system _operates_; invariants control what it _cannot_ do regardless of configuration.

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

A date with no row in `operating_calendar` is "non-operating": no shifts, no orchestrator activity, no notifications. This is the mechanism by which any stretch of the year is turned off.

**Operating seasons (the summer authoring layer).** The academic-year config layers below are seeded by migration. A summer season is instead authored by the Administrator (behavioral spec Section 2.8) and compiled down into these same layers, so no runtime code special-cases summer:

1. **Authoring tables** (migration 20260702000003, admin-only RLS): `operating_seasons` (range + season-wide cap/enforcement/desk-hours/scheduling-mode), `season_house_windows` (per-house open windows + headcount, presence = open), `season_float_windows` (floating-on windows), `operating_config_audit`. Float routing is NOT authored — it is universal (any open multi-staffed house to any other open house, never into Harnwell) and derived by the compiler.
2. **A pure compiler** (`packages/core/src/operating-seasons`, `compileSeason`) derives PHASES — one per date on which any setting changes — and emits, per phase, a compiled `operating_profiles` row named `s_<slug>_<YYYYMMDD>` (phase start), its `staffing_patterns` rows, an auto-generated all-pairs `float_routing` (universal float, Harnwell never a destination, precedence by descending source headcount), and the `operating_calendar` date→profile assignments. It is deterministic and does no I/O.
3. **A reconciler RPC** (`apply_compiled_season`, migration 20260702000006, body replaced by 20260709000003) writes those config rows in one transaction and reconciles FUTURE blocks (`block_start_at > app_now()` only): generates newly-open blocks, adjusts `required_headcount`, and voids blocks whose house closed or whose desk hours shrank. Its `p_dry_run` mode runs the identical logic inside a rolled-back subtransaction to produce the preview impact, so preview and apply cannot drift.

   On a headcount **increase** it adds vacant seats. On a headcount **decrease** it trims vacant seats and then **cancels the excess occupants** (`cancelled_config`) — it does _not_ grandfather them. The cut order is deterministic: external floaters (`floated_in` / `pending_float_in`) first, then the shorter shift (ranked per `(worker, house, NY date)` by fewest occupied blocks, so the cut is coherent across an overlap), then `assignment_id`. Cancelled workers get a `shift_cancelled_config` notification and inbound floats on a cut seat are voided (`float_cancelled_config`), mirroring the house-close path. The `enforce_block_occupied_headcount` trigger (20260702000005) is unchanged and still only checks writes that _increase_ a block's occupied count, which is what keeps swaps and drops working on a transiently over-capacity block.

A block retired by a config change carries `shift_blocks.voided_at` (migration 20260702000005) and has its occupied assignments moved to `cancelled_config` and its vacant seats deleted, which makes it self-excluding on the status-filtered read paths; the orchestrator scan, `is_assignment_claimable`, and the house-schedule grids additionally filter `voided_at IS NULL` (migration 20260702000007). Changes are prospective only; past and in-progress blocks are immutable history.

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
[{ "block_start": "08:00", "block_end": "24:00", "headcount": 2 }]
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

**Scope clarification:** `float_routing` governs _floating only_. Cross-house _pickup_ (Behavioral Spec Section 5.3) does not consult this table. Pickup eligibility is a single algorithmic rule (Harnwell training requirement) enforced in the claim and permanent-pickup handlers — no config table, no precedence ordering. A worker eligible to pick up at any non-home house sees the union of those houses' open-shifts feeds in their cross-house tab.

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

The `hours_cap` column is constrained to 20-with-soft or 40-with-hard (`weekly_cap_overrides_value_pairing_check`, migration `20260528000011`). That constraint governs **manual overrides only**. A profile-derived cap has no such restriction: `apply_compiled_season` writes whatever `default_hours_cap` / `default_cap_enforcement` the administrator configured for the season, so the effective cap of a week may be any positive integer with either enforcement.

**Resolution is `effective_weekly_cap(week_start_date, block_start_at)`.** Precedence: a `weekly_cap_overrides` row for the week, else the week's `operating_calendar` days joined to `operating_profiles`, taking the tightest hard cap if any day is hard and otherwise the tightest cap present, else 20/soft. The `block_start_at` parameter is retained for signature compatibility and unused. Migration `20260724000001` restored the `operating_profiles` join after `20260528000011` had replaced it with a hardcoded `break_type` classification that fell through to 20/soft for anything it did not recognize — which silently ignored every compiled operating-season profile, since a season profile (`s_<slug>_<YYYYMMDD>`) matched none of the hardcoded break types.

**`effective_weekly_caps(from_week_start, to_week_start)`** (migration `20260729000004`) returns one row per Monday in the range, each delegating to `effective_weekly_cap`. It exists so a client can resolve every week it can navigate to in one round trip rather than one RPC per week, which would multiply the refetch amplification the mobile Realtime debounce exists to contain. Dates are snapped to their Monday with `date_trunc('week', ...)`; a reversed range returns no rows rather than raising, so a client clock skew cannot fail a snapshot read; a range wider than 53 weeks raises `invalid_parameter_value`. It is granted to `authenticated` and `service_role` and explicitly revoked from `anon` — the mobile worker app is the caller. The values are global schedule config, not user-scoped data, so client reachability is intentional. Tests: `supabase/tests/weekly-caps-range.sql` (11).

**Clients consume the cap; they never derive it.** This is the same rule the coverage lock follows for claimability, and for the same reason: the value is server config that no client can reconstruct. The mobile app carries the resolved per-week caps on its worker-week snapshot (`WorkerSnapshot.weeklyCaps`, sourced by `WeeklyCapRepository`) and keys them by NY Monday, so the hours chip and the claim meter follow week navigation; the web worker portal reads `effective_weekly_cap` for the current week in `lib/data/worker/openShifts.ts`. Both previously hardcoded 20/soft, which is why an administrator raising the summer cap through `/admin/operations` changed nothing a worker could see (fixed 2026-07-29).

### 2.6 Layer 6: HMOD Rotor

A table defining who serves as HMOD for each weekly slot.

```
hmod_rotor
  week_start_date   (primary key; the Friday of the duty week, 08:00)
  hmod_user_id      (foreign key to users; must hold hm or bm role)
```

The duty week runs Friday 08:00 (inclusive) → the following Friday 08:00 (exclusive). `resolve_hmod_on_duty(p_at)` snaps `p_at` (NY-local, minus 8h) back to the most recent Friday to find the rotor row.

**Academic-year scope.** Rotor entries exist only for weeks whose Friday falls within an academic semester. The rotor table has no row for any week falling entirely in summer. The final rotor entry of a spring semester represents an interval that ends at the end of the last spring operating day, **not** the following Friday 08:00 (per Behavioral Spec Section 2.5 "Academic-year scope of the rotor"). The HMOD-resolution function must:

1. Look up the rotor row for the current week.
2. If no row exists, return "no HMOD on duty". When summer is configured as an operating season (Section 2.1), its operating dates DO run the orchestrator, so a deployer who enables summer escalation must also populate `hmod_rotor` rows for the summer weeks (a go-live checklist item); an in-hours gap otherwise routes to the RSM per the normal resolution, and a missing rotor row surfaces as the terminal project-administrator fallback rather than silently dropping.
3. If a row exists, check whether the current moment falls within the rotor's effective interval. For the last rotor entry of a spring semester, the effective interval ends at the end of the last spring operating date (e.g., Sunday 23:59) rather than the following Friday 08:00. This truncation rule applies only to the spring-to-summer boundary; all other rotor entries run their full Friday-to-Friday week.

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

1. The server computes the _incoming chain_: all users whose active leave delegation currently resolves through the HM going on leave (walk all active leave rows and find chains that terminate at this HM).
2. The submitted `replacement_user_id` must not appear in the incoming chain. If it does, the insert is rejected.
3. This check runs inside a **serializable transaction** so that concurrent insertions cannot create a cycle between check-time and commit-time.

The selection UI excludes incoming-chain members from the picker as a UX guard. The server-side transaction check is the authoritative backstop.

**Replacement picker construction.** `getLeaveAdminData` (`apps/web/lib/data/leave.ts`) builds the picker with the service client, because an HM legitimately needs to read managers and active leave rows beyond their own-house RLS scope. It returns each candidate tagged `group: 'primary' | 'other'` — `primary` is the leaver's own-house managers plus the project administrator, `other` is every remaining house — together with the candidate's own active leave date ranges. The client (`HmLeaveForm`) shows `primary` on open and reveals `other` on request; it never re-queries. The availability hint is pure client-side date arithmetic in `apps/web/lib/leaveAvailability.ts`, comparing the leaver's entered window against each candidate's ranges as plain `date` strings (lexicographic compare, no `Date` parsing, so no timezone shift can move a day). Grouping and flagging are UX only: both groups post the same `replacement_user_id` to `submit_hm_leave`, and the server-side incoming-chain check remains the sole authoritative gate.

**Project administrator as terminal node.** `replacement_user_id = NULL` means "project administrator handles this." The project administrator may always be selected; they cannot themselves go on leave in this system. The picker always surfaces the project administrator as an option.

**"I'm back" early return.** When clicked, `status` is set to `cancelled_early` and `cancelled_at` is recorded. From that timestamp forward, the leave row is treated as inactive; the resolution walk stops at the original HM as if no leave record exists.

### 2.8 Layer 8: Acknowledgment Cadence Configuration

A per-house table tracking the HM/BM-configured 6h and 2h reminders. These are not per-worker preferences; they are house-level settings controlled by HMs, BMs, or the project administrator. The 1h, 30m, and 5m reminders are mandatory and not configurable (they are not stored here).

Each configurable reminder is governed by **two independent fields**: an `_enabled` flag that controls **whether** the reminder fires at all, and an `_offset` that controls **when** it fires. These are distinct concerns — do not conflate them:

- **Suppression is the `_enabled` flag.** Set `reminder_6h_enabled = false` to turn the 6h reminder off entirely for the house. The offset is irrelevant when disabled.
- **A null `_offset` is NOT suppression** — it means "use the system default" (-6h / -2h before the ack deadline). A reminder with `enabled = true` and a null offset still fires, at the default time.

```
ack_cadence_config
  house_id              (primary key; foreign key to houses)
  reminder_6h_enabled   (boolean, not null, default true; false = the 6h reminder
                         is suppressed entirely for this house)
  reminder_6h_offset    (interval; null = system default of -6h before ack deadline;
                         a value = the configured offset. null never means suppressed;
                         suppression is reminder_6h_enabled = false)
  reminder_2h_enabled   (boolean, not null, default true; same semantics as 6h)
  reminder_2h_offset    (interval; same semantics as reminder_6h_offset, default -2h)
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

**Companion table — `break_optouts`.** Records a worker's affirmative "no hours for this break" indication (Behavioral Spec §4.4) — the break analogue of the regular-year "no hours" preference (§4.1). Because break scheduling is claim-based and bypasses the `preferences` / `period_targets` tables entirely, the opt-out needs its own home; it cannot live on a `scheduling_periods`-scoped row.

```
break_optouts
  break_id      (foreign key to break_periods, ON DELETE CASCADE)
  user_id       (foreign key to users)
  opted_out_at  (timestamp with time zone; when the worker indicated zero hours)
  PRIMARY KEY (break_id, user_id)
```

- Scoped per `(break_id, user_id)` — opting out of one break says nothing about any other (a worker may sit out Thanksgiving but want spring-break hours).
- Read by the T-3d nag job to fill the `has_indicated_zero_hours` flag that recipient selection consumes. The orchestrator snapshots it via `worker_opted_out_of_break(user_id, break_id)`; the recipient rule itself is the pure `selectBreakClaimNagRecipients` (a worker is nagged iff they have claimed nothing **and** have no opt-out row).
- **Advisory only**: the opt-out suppresses the nag and signals intent; it does NOT gate claiming — a worker may opt out and later claim via the calendar picker (or the open-shifts feed after T-1d), exactly as §4.1 lets the regular-year opt-out worker pick up shifts.
- Populated/cleared by the worker via the "no break hours" control; gets RLS (own-row write, plus the standard service-role bypass) in the same migration that creates it.

**Calendar claiming (round 1) — read + write surface.** The break picker (Behavioral Spec §4.4) renders as a calendar over the break date range, reusing `house_schedule_grid` (the §11.4 read model) scoped to the break window: it already returns vacant + occupied seats per 30-min block with the claimant's name, RLS-scoped to the caller's home house. The block generator pre-creates `required_headcount` assignment rows per block, so the grid's row count at a given time **is** the block's capacity and the non-vacant rows are the fill — no separate coverage table is needed. The grid view carries `block_id` and `required_headcount` so the picker can address blocks and render "filled / required" coverage. The free-form drag claims through `claim_break_blocks(p_block_ids uuid[], p_user_id, p_as_of)`: per block it claims **one** still-vacant seat (lanes are interchangeable — "system-assigned lane"), applying the same guards as `claim_break_shift` (active user, Harnwell training, per-block time-conflict, incremental weekly hard cap). Blocks with no open seat — or already covered by the caller — are skipped; the function returns exactly the `(block_id, assignment_id)` pairs it claimed, which is the **server-side trim** the UI reconciles its optimistic drag against. The headcount trigger (`enforce_block_occupied_headcount`) is the backstop that makes over-claiming impossible. Round 2 (post-T-1d) needs no break-specific surface: `weekly_open_shifts_feed` already folds the unclaimed seats into the ordinary feed.

### 2.10 Layer 10: Scheduling Periods

A table that names each SM-built scheduling period as a first-class entity. This gives the `period_targets` and `preferences` tables a concrete entity to foreign-key against, and provides the single place to store the preference submission deadline that the behavioral spec (Section 4.2) assigns to the SM.

```
scheduling_periods
  period_id              (primary key)
  period_name            (text; e.g., "Fall 2025", "Spring 2026")
  profile_name           (foreign key to operating_profiles; any SM-built profile — a
                          'regular_school_year' term OR a compiled 's_%' season profile.
                          Widened by 20260702000006: summer is SM-built and needs a
                          period row of its own. Corrected 2026-07-29; this field was
                          previously documented as always 'regular_school_year')
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

`scheduling_periods` covers only SM-built periods — both `regular_school_year` terms and compiled `s_%` season profiles (summer is SM-built; see Section 2.13). Break periods are covered by `break_periods`; they use claim-based scheduling and have no preference deadline. The two tables are intentionally kept separate because their purposes and query patterns are distinct: `break_periods` is looked up by date range to anchor claim-phase timings; `scheduling_periods` is looked up by `period_id` to resolve preference submission state and target hours.

**Population:** an administrator creates a `scheduling_periods` row when setting up the academic calendar (alongside `operating_calendar` row population). The `preference_deadline` is initially null and is set by the SM via the schedule-build UI once they are ready to open preference submission.

**Usage:**

- `period_targets.period_id` and `preferences` rows are scoped to a specific `scheduling_periods` row. This ensures that when a new semester is built, the prior semester's preferences and targets are not overwritten — they remain in the database for historical reference, queryable by `period_id`.
- The preference submission reminder job (5d, 3d, 1d before deadline — Behavioral Spec Section 4.2) queries `scheduling_periods` for the active period's `preference_deadline` to compute reminder times.
- The permanent drop period-boundary algorithm (Section 7.1) resolves `semester_end_date` from `scheduling_periods.end_date` for the current-or-upcoming period, **whatever that period's profile**: `SELECT end_date FROM scheduling_periods WHERE :drop_date <= end_date ORDER BY start_date LIMIT 1`. This is a simpler and more reliable lookup than the recursive CTE walk. The CTE walk remains documented as the fallback if this lookup returns no row (data integrity error condition). **Corrected 2026-07-29:** this lookup previously carried `AND profile_name = 'regular_school_year'`, which made a permanent drop impossible inside a summer season — it raised `semester_boundary_not_found` for a date sitting inside the current period, and the worker's shift was released to nobody.

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
                          who holds an `hm`, `rsm`, or `bm` role — see Section 3.1 subscription guard.)

user_roles
  user_id           (foreign key)
  role              (enum: sw, sm, hm, rsm, bm)
  scope_house_id    (foreign key; for sm/hm/rsm/bm, the house their role covers)
```

A user can hold multiple roles. The `hm`, `rsm`, and `bm` roles share identical **administrative** capabilities (overrides, force-triggers, notifications, leave, weekly-cap) but differ in **worker** behavior and in one role-specific carve-out (RSM cannot be HMOD). All three hold cross-house schedule authority as a tier; see the elevated-tier note below.

- A user holding `hm` may also hold `sw`/`sm` roles and act as a worker (scheduled shifts, claimed pickups, schedule preferences). However, the float lookup eligibility and broadcast subscription pipelines exclude any user with the `hm` role: HMs are never assigned floats and never receive open-shifts broadcasts. They may still manually browse the open-shifts feed and claim.
- A user holding `rsm` (Residential Services Manager — Behavioral Spec §2.3a) is below the HM and above the SM. The `rsm` role carries **every** HM power **except HMOD**: it is admitted to `user_has_house_admin_role` (own-house, scope-matched) and to `user_can_build_schedule`, so an RSM builds/overrides, administers people, sets the cap, and takes leave. Like an HM, an RSM holds shifts (claim pool) but is never auto-floated and never receives broadcast. As of migration `20260729000002`, an RSM is also assignable from the schedule-builder roster to their **own** house's desk, exempt from every hours check (see below). Two carve-outs: (a) an RSM is **never** placed on the `hmod_rotor` and is never a valid HMOD-transfer target; (b) an RSM has read visibility into _every_ house's live schedule via the `user_is_rsm(uuid)` predicate, which ORs into the schedule-visibility SELECT policies.

  **Scope of RSM writes (amended 2026-06-27, migration `20260627000002`).** The original rule that "every RSM write stays scope-matched to their own house" no longer holds for the schedule. `user_is_schedule_admin(uid)` is house-agnostic and true for `hm`/`bm`/`rsm` anywhere; `user_can_build_schedule` is redefined as `(user_is_schedule_admin OR sm-scoped-to-house)`. Every RPC gating on it — `publish_schedule` (3-arg, migration `20260614000002`), `admin_assign_worker`, `admin_remove_worker` — and the draft / `period_targets` / preferences admin RLS therefore become **cross-house** for the elevated tier. Publishing and overriding ride the same gate, so there is no house an elevated admin may override but not publish. `user_has_house_admin_role` is unchanged and still scope-matched for `hm`/`bm`/`rsm`, which is what keeps people administration, HM leave, and weekly-cap own-house; the lone exception is the top-level `admin` role, which ORs in unconditionally. **SM is untouched and stays own-house on both predicates.**

- A user holding `bm` is admin-only. The schema enforces this by treating `bm` as exclusive of worker roles for scheduling purposes: a user with `bm` is excluded from preference submission, schedule-builder rosters, claim eligibility, and float lookup. They may still hold the `bm` role alongside `hm` or other admin roles, but worker-facing pipelines treat them as inactive.

HMOD eligibility is implicit: any user with `hm` or `bm` role can appear in the `hmod_rotor`. The `rsm` role is **never** HMOD-eligible — the rotor population query and FK intent stay `hm`/`bm` only.

**`is_active` invariant.** Every pipeline that selects users as candidates for an active operation MUST filter on `users.is_active = true`. This includes (non-exhaustively): the float lookup eligibility query (§5.2), the broadcast-subscribed query (§4.2), the schedule-builder roster query, the claim-eligibility check, the swap counterparty selection, the HM-leave-replacement picker, the HMOD-rotor population UI, the cross-house feed visibility resolver, and the preference-submission reminder job. Historical references on already-existing rows (e.g., a fired worker's `user_id` retained on past `shift_block_assignments` rows) are preserved unchanged — the calendar still shows who was assigned in the past — but no new operation may select a deactivated user.

The single exception is the contact-lookup-from-shift-card surface (Behavioral Spec §11.4): tapping a past shift card may surface the contact info of a now-fired worker who held that shift. This is acceptable for historical reference; users have not had data deleted, only had `is_active` flipped.

**Broadcast subscription guard.** Broadcast subscription (`users.broadcast_subscribed`) is enforced at the write layer, not at dispatch time:

- The subscription toggle UI is not rendered for any user who currently holds an `hm`, `rsm`, or `bm` role. The toggle is only visible to users whose highest role is `sw` or `sm`.
- The backend subscription endpoint (`PATCH /users/{id}/broadcast_subscribed`) rejects any write that sets `broadcast_subscribed = true` for a user who holds an `hm`, `rsm`, or `bm` role, returning a 403 with a descriptive error.
- **Role promotion hook.** When a user is granted the `hm`, `rsm`, or `bm` role (a `user_roles` INSERT), the role-assignment handler atomically sets `broadcast_subscribed = false` for that user in the same transaction. This handles the case of an SM being promoted to HM mid-period while already subscribed. No broadcast notification is sent for this change; the UI will simply no longer show the toggle on the user's next session.
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

**The seats of a block are interchangeable, so seat allocation is server-side (Behavioral Spec §5.3/§4.4).** An `assignment_id` identifies a row, not a meaningful "lane": which of a block's rows a worker occupies carries no information. Every read model is per-seat (`worker_open_shifts` returns one row per vacant assignment), but the clients coalesce same-span seats of a multi-staff desk into one card with a count ("2 open") carrying a single representative seat's ids (`Coalesce.kt`, `coalesceOpenShifts`). Every client coalesces the same snapshot identically, so concurrent claimers on that card necessarily send the **same** `assignment_id`. Allocation therefore cannot live client-side: `claim_open_shift(assignment_id, user_id, as_of)` treats the id as naming the **block**, runs its guards, then selects one still-`vacant` seat on that block with `ORDER BY (vacancy_origin = 'permanent_drop'), (assignment_id = requested) DESC, assignment_id ... FOR UPDATE SKIP LOCKED LIMIT 1` and claims it. The leading sort term is the Behavioral Spec §5.3 seat-preference rule: ordinary vacancies drain before a seat that is open because its owner permanently dropped the slot, so the recurring slot stays available to `permanent_pickup_slot` as a whole recurrence for as long as the block offers any alternative seat. A `permanent_drop` seat is eligible at all only while its own week is inside the §5.1 30-day horizon (`block_start_at <= as_of + interval '30 days'`) -- the same condition that makes it a weekly card; taking one is the §5.3 single-occurrence temporary claim, and it clears `vacancy_origin` for that occurrence only, leaving every other week of the slot in the permanent openings feed. `claim_open_shift` is unambiguously the temporary path: permanent pickup never routes through it. `SKIP LOCKED` is what makes it true first-come-first-served under real concurrency: a competing transaction's uncommitted seat is stepped over rather than waited on, so claimer 2 takes a free seat immediately instead of blocking and then failing. `shift_unavailable` is raised only when the block has no open seat left. The RPC returns the `assignment_id` it **actually** claimed, which may differ from the one requested; the `claim-shift` Edge Function passes it back and both clients propagate it. `claim_break_blocks` (§4.4 drag) and `permanent_pickup_slot` (§7) already allocate per block the same way; the per-seat `claim_open_shift` was the last holdout and was corrected on 2026-07-24.

**Every seat write is a compare-and-swap under a row lock (Behavioral Spec §1.6).** A read-then-write on a seat with no lock in between is a TOCTOU race, and under `READ COMMITTED` both sessions pass the check before either commits. The concurrency audit of 2026-07-26 found four write paths shaped that way, three of which wrote with **no predicate at all** (`drop_shift` vacated `WHERE assignment_id = ANY(...)`; `accept_swap` transferred the same way; `admin_assign_worker` picked its seat with an unlocked `DISTINCT ON`), so the second writer silently overwrote the first and the loser still received HTTP 200. Migration `20260726000009` gives each of them (a) a `FOR UPDATE` acquisition **before** the validating read and (b) the validating predicate repeated on the write itself with a `ROW_COUNT` assertion, so a seat that changed hands becomes a no-op that raises (`drop_not_owned`, `span_invalidated`, `seat_not_assignable`) rather than an overwrite. `admin_assign_worker` uses the `LATERAL ... LIMIT 1 FOR UPDATE SKIP LOCKED` seat pick that `claim_open_shift` and `permanent_pickup_slot` already use: `SKIP LOCKED` (not plain `FOR UPDATE`) is what makes two admins assigning onto one multi-staff block take **different** seats, since a blocked plain `FOR UPDATE` wakes, re-checks, finds the row still inside its predicate, and overwrites the other admin's worker anyway.

**`admin_assign_worker` / `admin_remove_worker` may now edit a `this_week` seat of any age, unbounded past or future (Behavioral Spec §4.3, migration `20260729000001`).** Both RPCs previously carried an absolute `block_started` hard block (`block_start_at <= p_now` on any clicked seat), rejecting the write with no override path. It has been removed entirely from the `this_week` branch of both functions; the RPC's only remaining gate on WHO may reach this power is the existing `user_can_build_schedule` operator check (sm scoped to its own house; hm/bm/rsm/admin any house), so every schedule-admin role gained unbounded past-edit at once, not a new role tier. Every other hard block is unchanged: `cross_house_not_supported`, `worker_inactive`, `float_committed` (S1 remains OUT of float-committed seats — use decline/void), `seat_not_assignable`, `not_occupied_by_worker`, and the 40-hour hard cap (`hard_cap_exceeded`, still absolute, never overridable). `admin_assign_worker`'s `permanent` scope was never about past edits — it targets the recurring slot's future occurrences (`block_start_at > p_now`) by construction — and that filter is untouched; its "no future occurrence remains" case previously reused the `block_started` exception name and has been renamed to the self-describing `no_future_occurrences` now that `block_started` no longer exists as a concept. The pure mirror `packages/core/src/admin-override/index.ts` (`evaluateAdminAssignment` / `evaluateAdminRemoval`) had its `isStarted` check removed to match.

**`admin_assign_worker` also exempts the block's house RSM from the same-house guard and every hours check (Behavioral Spec §2.3a/§4.3/§13, migration `20260729000002`).** The function computes `v_is_rsm` as `EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_user_id AND role = 'rsm' AND scope_house_id = v_block_house_id)` (keyed on the RSM's role scope, not `users.home_house_id`, so the exemption stays own-house-only even if the two ever drift). When true: the target-worker same-house check (`v_worker.home_house_id <> v_block_house_id` → `cross_house_not_supported`) is bypassed; `admin_override_cap_assessment` is not even called, so the 40-hour hard cap, the 20-hour soft-cap advisory, and the `over_target` advisory are all skipped. The `cannot`/`opted_out` advisories are left as-is (an RSM has no `preferences`/`period_targets` rows, so they never fire in practice). `house_roster_as_of(house_id, as_of)` (migration `20260719000001`) gained a third output column, `is_rsm boolean`, returned via `bool_or` over a `UNION ALL` of the existing sw-membership branch and a new branch selecting the house's `role = 'rsm'` user; both `getBuilderData` (the manual builder) and `getAiScheduleContext` (§15/19, the AI scheduler) call this RPC, so `getAiScheduleContext` explicitly filters `is_rsm` rows back out — the AI agent still generates a preference-driven schedule for capped student workers only. The pure card view-model, `packages/core/src/scheduling/scheduleBuilderCard.ts` (`WorkerScheduleInfo.isRsm`), mirrors both exemptions client-side: `buildPhase2Roster` forces `advisories: []` / `wouldExceedTarget: false` for an `isRsm` worker, and `buildPhase1Card` routes `isRsm` workers around `groupWorkersForSpan` entirely into `available` (an RSM has no preference rows, so phase-04's grouping would otherwise always mark them `blocked: missing`, the opposite of "always assignable at their own desk").

**Lock order is global: `users` → `shift_block_assignments` (ascending `assignment_id`) → `swap_requests`.** `accept_swap` and `apply_permanent_swap` previously took `swap_requests` first, which inverted against `drop_shift` → the `void_pending_swaps_for_vacated_seat` trigger → `swap_requests`, and deadlocked a drop racing an accept. `accept_swap` now pre-reads the swap **unlocked** purely to learn its id arrays (they are immutable after creation), locks the seats, then locks and re-reads the swap row authoritatively. Note the trigger is keyed on a status **transition**, so it is blind to the user_id-only transfer an accept performs; the compare-and-swap, not the trigger, is what protects that path.

**Invariant #5 is enforced by the schema (migration `20260726000010`).** `shift_block_assignments_one_seat_per_worker` is a partial unique index on `(block_id, user_id)` where `user_id IS NOT NULL AND status IN ('scheduled','claimed','floated_in','pending_float_in')`. Before it, nothing in the schema prevented one worker holding two seats of a block: `enforce_block_occupied_headcount` only compares an occupied count to `required_headcount`, which two seats held by the same worker satisfy — which is how the `permanent_pickup_slot` double-seat bug (fixed 2026-07-24) reached a running database and had to be found by hand-reproduction. `admin_assign_worker` (both scopes) and `permanent_pickup_slot` carry an explicit "worker does not already occupy this block" filter so a legitimate flow degrades to assigning one fewer seat instead of failing with a raw `23505`. The index catches DUPLICATION, not substitution: the ownership-overwrite races above keep exactly one occupant per seat, so no unique constraint can see them, which is why both mechanisms are needed. `enforce_block_occupied_headcount` additionally counts its siblings `FOR UPDATE` now; the residual insert-insert phantom is not closed, because every runtime occupy is an UPDATE of an existing seat row and the only paths that INSERT occupied rows are the `publish_schedule` family, which already serialize on `scheduling_periods FOR UPDATE`.

**A single worker's concurrent claims serialize on their `users` row.** `claim_open_shift` and `claim_break_blocks` take `FOR UPDATE` on the claimer's `users` row. Their seat picks were already race-safe **between** workers, but the per-caller time-conflict and weekly-cap checks read only that worker's own rows and were unlocked, so one person double-tapping could book two desks at the same block start and overshoot the hard cap. Locking the user row costs nothing across different workers (they never contend) and preserves the global lock order above, since `fire_worker` and `apply_house_transfer` already take `users` before seats.

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

**The two feeds overlap; they are not a partition (corrected 2026-07-24).** Behavioral Spec §5.1 and §8.4.3 require a permanently-dropped occurrence to surface in the **weekly** feed as well, once that specific week crosses the 30-day horizon, so a worker can take one week of it without owning the rest. The client read model `worker_open_shifts` had instead partitioned the feeds with an exclusive `CASE WHEN vacancy_origin = 'permanent_drop' THEN 'permanent_opening' ELSE 'weekly' END`, which made the §5.3 single-occurrence claim unreachable: the occurrence never rendered as a weekly card, so no worker could originate the claim, and every week of an unwanted slot ran the full escalation chain to paid Allied coverage instead. The view now emits such an occurrence **twice** while it is inside the horizon, once per feed, both rows carrying the same `assignment_id` (migration `20260724000004`). The permanent branch is additionally restricted to **schedule-built** days (`operating_profiles.scheduling_mode = 'sm_built'`, exposed by the view as `schedule_built`), mirroring the permanent-pickup candidate filter so the feed never advertises a slot the pickup cannot take; a `permanent_drop` block on a claim-based day falls through to the weekly branch instead. **Widened 2026-07-29** from `profile_name = 'regular_school_year'`, so a summer season's recurring slots are pickable as a whole recurrence (migration `20260729000011`, with `permanent-pickup`'s `candidateBlocks()` and `semesterEndDate()` moved to the same rule in the same commit). Mode rather than name is load-bearing: a season compiles into several phase profiles, so no single name identifies it, while `sm_built` preserves the break-day exclusion the old equality actually bought.

**Each feed is bounded in time, and by different amounts (migration `20260726000001`).** `vacant_seats` previously selected every future `vacant` assignment across all 13 houses to the end of generated time, with no upper bound — the client supplies only a lower one (`start_at >= Monday-of-last-week`), and supabase-kt silently drops a second filter on the same column, so the bound has to live in the view. Measured under RLS as a real Harnwell worker, one mobile read cost **130,343 shared buffers and ~270 ms** (16,150 rows). The weekly branch is now bounded at **6 weeks**, covering the client's navigable window with headroom; the permanent branch at **26 weeks**, deliberately longer so a permanently-dropped slot whose next regular-school-year occurrence lands beyond six weeks is still pickable as a whole recurrence. Verified by diffing the full projection against the previous definition: identical inside the horizon (1,752,053 rows, zero differing), and the bound drops 27,972 weekly rows and **zero** permanent rows. `weeks_remaining` keeps its own **unbounded** scan (now one `GROUP BY` over the recurring-slot identity rather than a correlated count per output row), so the advertised count still spans the whole remaining recurrence and continues to match what `permanent_pickup_slot` can take.

Three further changes in the same migration, each measured, together taking the read to **1,483 buffers / ~47 ms**:

- `desk_covered` is now an **inline `EXISTS`** rather than a call to `block_has_present_worker()`. Identical predicate; the difference is that PostgreSQL never inlines a `SECURITY DEFINER` function, so the helper stayed an opaque per-row call (60,473 buffers) while the inline form collapses into a hashed SubPlan (817 buffers). The helper is unchanged and still correct everywhere it is a single-row lookup.
- `candidate_users` is `MATERIALIZED`. Inlined, its role `EXISTS` was pushed into the join and re-evaluated once per output row (31,796 buffers) even though it resolves to one row for a worker's own read.
- `houses` is joined **inside** `vacant_seats`, before the `CROSS JOIN`, so a 13-row table is hashed once instead of nested-loop probed 15,898 times (another 31,796 buffers).

Two changes that look obvious were tried, **measured, and rejected**; the migration header records them so they are not re-attempted. Hoisting the `regular_school_year` / `weekly_visible` predicates into a per-NY-date CTE looks like a 400x win (16,150 seats, 40 distinct dates) but the planner already turns both into hashed SubPlans, and the CTE only added materialisation (166,178 buffers, worse than baseline). Replacing `desk_covered` with a semi-join CTE was nested-loop-rescanned per output row whether inlined or `MATERIALIZED` (1.9 s), because no statistics exist for a CTE relation. The horizons are also deliberately **not** `system_config` values: the reader would have to be `SECURITY DEFINER` (that table is admin-only RLS), which reintroduces exactly the per-row opaque-call cost, and a non-definer reader would resolve differently for a worker than for an admin.

Because one `assignment_id` can now back two cards, **card identity is (feed, assignment_id), not assignment_id**. Any list that can hold both kinds at once must key on the pair: the cross-house tab groups weekly and permanent cards together (`OtherHousesTab.grouped`), so `OpenShift.feedKey` exists for exactly this purpose and the SwiftUI `ForEach`es and the web `OpenCard` list key on it. The original phase-05 SQL surfaces `weekly_open_shifts_feed` / `permanent_openings_feed` always modelled the overlap correctly and were never the source of the divergence, but nothing outside pgTAP calls them -- the clients read the view, so the function-level tests passing was not evidence that the behavior shipped.

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
                          swap_request, hm_leave_notice, sm_permanent_drop_alert [retired/unused],
                          sw_permanent_removal_alert)
  delivered_at      (timestamp; null if pending)
  scheduled_for     (timestamp; for future-cadence delivery)
  payload           (jsonb)
  acknowledged_at   (timestamp; null until the user opens the notification in the updates tab)
```

The notifications table no longer carries an `hm_digest_card` type, since stacked HM digests have been eliminated. A scheduler component processes pending notifications when their `scheduled_for` time arrives.

The `scheduled_for` field is still used for acknowledgment cadence reminders, which are scheduled at the moment a float is assigned and delivered when their offset is reached.

The `sm_permanent_drop_alert` type is retired (2026-07-13): the enum value remains for backward compatibility, but no code path generates or displays it. SMs are no longer notified when a worker permanently drops a recurring slot (there is nothing actionable the SM does in response; the permanent openings feed is the SM's authoritative view). The `sw_permanent_removal_alert` type is used to notify a worker that an SM/HM has permanently removed them from a recurring slot. It is in-app only (no push); it displays on next app open and persists in the recipient's updates tab. The `acknowledged_at` field is populated when the recipient opens the updates tab and views the notification.

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

**Builder client structure** (`apps/web/components/builder/`). `gridModel.ts` is pure and React-free: it coalesces `blockId -> userIds` drafts into per-day contiguous runs, lane-packs them for multi-headcount houses, derives ghost seats, and resolves a click to a shift (`findShiftAt`, disambiguated by the pointer's fraction across the column) or a worker to their whole week (`workerWeekShifts`). `Grid.tsx` renders the day columns; `WorkerFocusPanel.tsx` renders the two focus cards; `ScheduleBuilder.tsx` holds state and the writes. The AI preview and the persisted drafts flow through the same model, so a proposed shift explains itself exactly like a drafted one.

The **drag versus click** split (BSpec §4.3) is decided at mouse-up: the gesture is tracked in a ref (not only in state) and the `mouseup` listener is registered once on mount, because a listener attached by an effect keyed on a `dragging` state flag misses a mouse-up that lands in the same task as the mouse-down. Same anchor and hover index over a drafted shift means focus (a pure view state, no write); anything else keeps the pre-existing span-selection path, which is what the e2e drag contract exercises. Full screen is a class on the builder root that takes it `position: fixed; inset: 0` out of the app shell; the AI panel is hidden with CSS rather than unmounted so an in-flight generation survives the toggle.

**Publish operation.** The schedule builder edits a single **template week** (the week
of the earliest block — the UI shows and drafts only that week). Drafts therefore
describe a **recurring weekly pattern**, not a one-off week. When the SM clicks Publish
(Phase 3 transition), per house, in a single transaction:

1. Derive the template = the drafts in the template week, keyed by their NY
   `(isodow, time-of-day)` and the drafted user(s).
2. For **every block in the period** (all weeks), look up the template users for that
   block's `(isodow, time-of-day)` slot and convert that many of the block's
   pre-created `vacant`/`never_assigned` seats to `status = 'scheduled'`,
   `vacancy_origin = 'none'`, `is_float = false`, `is_cross_house_pickup = false`,
   `source_house_id = NULL`. The remaining seats stay `vacant`/`never_assigned` — the
   slots the SM intentionally left open (claims, escalation, later hires). This is what
   makes the weekly pattern **repeat across the whole semester**; a slot must not be
   over-filled beyond `required_headcount`.
   - DST-safe: the slot key is NY `(isodow, time-of-day)`, not UTC, so 09:00 in June and
     09:00 in December map to the same slot across the November transition.
   - The block generator (`20260527000004`) pre-creates exactly `required_headcount`
     vacant seats per block, so publish normally only flips statuses (the function keeps
     excess-insert / vacancy-normalize branches for robustness).
3. Delete all `draft_block_assignments` rows for the house. The draft has been consumed.
4. Record the house in `period_house_publications`; once every house with blocks in the
   period is published, set `scheduling_periods.published_at`.

Implemented in `publish_schedule(period, publisher, house)`
(`20260614000002_publish_recurring_weekly_pattern.sql`, superseding the block-id-keyed
loop in `20260528000010`).

After publish, **per-week** changes happen on the live calendar (inline override): an
override is scoped either to **this week only** (the clicked block span) or **this week
onward** (the same `(house, isodow, time-of-day)` slot in every later week — the
permanent drop/pickup mechanics of §10). Overrides write directly to
`shift_block_assignments` (no draft round-trip). The draft table is empty for the period
until the next semester's schedule is being built.

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

**Step: float_lookup.** Mark the block as unpickable atomically via the coverage lock (see below). Invoke the float lookup algorithm (Section 5). If floaters are assigned, the affected blocks transition appropriately. If no floater is found, the step fails, and the orchestrator immediately fires the next chain step (`hmod_notify_allied`).

**Step: hmod_notify_allied.** Opens a tracked **Allied coverage request** via `open_allied_coverage_request` (migration `20260729000010`) rather than emitting a single notification. The request row (`allied_coverage_requests`) carries the house, the coverage window, the reason, the current ladder rung, and the close-out outcome. Block remains `vacant` until Allied is confirmed, at which point the block flips to `allied`.

Request lifecycle (Behavioral Spec §5.4a):

- **Open.** Rung 1 is always the house's RSM (`resolve_rsm_for_house`). A rung whose resolver returns NULL is skipped immediately rather than holding the request for its timeout; if every rung is unreachable the request falls to `system_config('project_administrator_user_id')`, and if that is unset a `RAISE WARNING` is emitted and no request is created.
- **Coalescing.** The chain step is inherently one fire per 30-minute block, so a contiguous stretch would page once per block. When the new window abuts or overlaps an already-open request for the same house, that request's window is EXTENDED and no second page is sent. The anchor `block_id` stays the first block, which keeps the `one_open_per_block` partial unique index valid.
- **Advance.** `advance_allied_coverage_ladder(now, limit)` runs once per orchestrator tick (alongside the existing off-hours-ladder advance; no new cron). Per open, unacknowledged request it either escalates to the next reachable rung, or re-pages the current holder on the reminder interval, or (on the terminal `hmod` rung) stands down and keeps reminding. It selects `FOR UPDATE SKIP LOCKED` so concurrent ticks cannot double-escalate.
- **Acknowledge / close.** `acknowledge_allied_coverage_request` stops the ladder; `close_allied_coverage_request` records one of four `allied_coverage_outcome` values and is the ONLY way a request leaves the active view. `desk_unstaffed` requires a note (enforced in the RPC, not only the UI). Both also stamp `acknowledged_at` on the request's outstanding `hmod_urgent` notifications so the alert is silenced on every surface at once.
- **System close.** `system_close_obsolete_coverage_requests` runs first in the same tick pass and closes as `no_longer_needed` any request whose block was voided or whose desk regained escalation coverage. This is a status write, not a coverage revocation, so hard invariant #3 (no-takeback) is untouched. It is the ONLY automatic close.

Notifications reuse the existing `hmod_urgent` type rather than adding an enum value, so every existing consumer keeps working; the payload gains `request_id`, `rung`, and `rung_deadline_at`.

**Grants.** `allied_coverage_requests` needs `GRANT SELECT ... TO authenticated` in addition to its RLS policy: table privileges are checked BEFORE any policy, so the policy alone yields a bare "permission denied for table" and the Action Inbox renders an empty state while real requests sit unactioned. `anon` holds nothing, and clients hold no INSERT/UPDATE (every write goes through a SECURITY DEFINER RPC). pgTAP runs as a superuser and cannot catch a missing grant, so `allied-coverage-ladder.sql` asserts the grants explicitly.

**A failed coverage read must degrade, not crash the console** (Behavioral Spec §5.4a; added 2026-07-29). `getCoverageData` (`apps/web/lib/data/coverage.ts`) deliberately **throws** rather than returning an empty result, so a broken read can never render as "All clear. No coverage needed". That is correct for `/inbox`, which has its own `error.tsx`. It is wrong for the shell, because `app/(app)/layout.tsx` renders **above** every error boundary in its own subtree: an uncaught throw there escapes to Next's built-in global error, which is a blank screen for the whole admin console on every route in production, and in dev an overlay that reloads the document, re-throws on the reload, and loops roughly twice a second with no window in which to navigate away. A stale PostgREST schema cache for `allied_coverage_requests` produced exactly that on 2026-07-29.

So the shell reads through `getShellCoverage`, which catches, logs `shell_coverage_read_failed`, and returns `{ data: null, unavailable: true }`. `AppShell` forwards `coverageUnavailable` to `CoverageAlert`, which renders an explicit "Coverage status could not be loaded" banner at full alert prominence — distinct from `actionRequiredCount === 0`, which renders nothing. `app/error.tsx` is the root backstop for the next unguarded layout failure; it exists so a layout-level throw renders a readable, retryable page instead of an unbreakable reload loop. Do not "simplify" `getCoverageData` to swallow its error, and do not call it directly from a layout.

`getCoverageData` is wrapped in React `cache()`, keyed on the `now` argument. The shell and `/inbox` both need it on the same render, and `simNow()` is itself `cache()`d so both pass the same `Date` instance; unmemoized, one `/inbox` navigation ran the whole read **twice** (requests select, rung-timeout config row, name lookup) for about one extra Supabase round trip of latency. Per-request only: the rows are RLS-scoped to the signed-in manager, so a process-wide cache here would leak one house's coverage to another's. The rung timeout is the one genuinely global value and uses the process-wide `cachedGlobal` memo instead. These reads also resolve identity through `getSessionUser()` rather than `supabase.auth.getUser()`, which is a GoTrue HTTP round trip on every call (the cost-audit F-07 rule).

The Allied confirmation is a manual in-app action. Until that action, the block is technically still vacant in the database.

**Coverage-conditional pickup lock (Behavioral Spec §5.3/§5.4/§5.5).** Both securing-tier steps (`float_lookup`, `hmod_notify_allied`, but **not** `broadcast` — T-3h stays claimable) call `lock_block_coverage(block_id, now)`, which sets `shift_blocks.coverage_locked_at` once (idempotent, one-way).

`lock_block_coverage` is an atomic **check-and-lock** returning `boolean` (migration `20260726000011`, concurrency audit F4). It locks the block's `shift_block_assignments` rows `FOR UPDATE`, re-evaluates `block_has_escalation_coverage(block_id)` under that lock, and stamps `coverage_locked_at` only when the desk is genuinely empty; it returns `false` when the desk has been staffed, and both `floatLookupStep` and `hmodNotifyAlliedStep` abort the step on `false`. `block_has_escalation_coverage` is a **separate** predicate from `block_has_present_worker` and carries the ESCALATION present-set (it counts `allied`); the two must not be collapsed, for the reason given below. It previously returned `void` and stamped unconditionally, trusting `desk_covered` from `orchestrator_vacant_seats` — a value read once per tick, in a different transaction, before all the per-block round trips that follow it. A desk staffed inside that window (an `admin_assign_worker` at T-2h is gated on `block_started`, not on T-2h) was still locked, permanently un-picking its remaining seats, and still drew a float or an Allied page it did not need; neither is automatically revocable under invariant #3. When `float_lookup` aborts this way the orchestrator also calls `releaseStep` to return `block_step_status` to `rolled_back`, since that step is claimed before `fireStep` runs and would otherwise be retired for good, so a later drop on the block could never re-escalate. `hmod_notify_allied` claims inside its own RPC, after the coverage check, so it has nothing to release.

A block reaching these steps is EMPTY at the moment the step runs, so locking it makes its remaining vacant seats unpickable from that point on — even after a floater or Allied later fills the desk (the secured window never re-opens). Claimability is therefore **server-authoritative**: `is_assignment_claimable` and `claim_open_shift` return claimable iff the seat is vacant, not yet started, `coverage_locked_at IS NULL`, AND (`block_start_at > now + 2h` OR a sibling on the block is real-present in `{scheduled, claimed, floated_in, pending_float_in}`). The "real-present" set deliberately **excludes** `allied` (unlike the escalation coverage floor, which counts it): a still-staffed multi-staff desk (e.g. double-Harnwell) keeps its dropped seat claimable until block start, but a secured-Allied window stays locked. `worker_open_shifts` exposes `desk_covered` + `coverage_locked` so the worker clients consume the verdict rather than re-deriving T-2h.

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
   - **If T-2h has already passed, the gap goes directly to HMOD-for-Allied.** In the no-ack case specifically, the deadline is at T-15m before float start, so T-2h is always already past at trigger time — the gap always goes directly to HMOD-for-Allied, regardless of whether the original float was automated or force-triggered. This is the only reliable path given 15 minutes of remaining lead time. If a worker happens to claim via the open-shifts feed in those 15 minutes (the gap is technically pickable until T-2h passes for that specific gap's escalation tracking — but in this case T-2h is already past, so the feed entry is unpickable for the _new_ T-2h evaluation that the rolled-back chain produces), the claim resolves the gap. In practice, the 15-minute window is too short for claims, so Allied is the realistic outcome.

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
3. **Allied coverage requests are no longer routed by hour** _(amended 2026-07-29)_. They enter the three-rung ladder of Behavioral Spec §5.4a, which always starts at the house's RSM (`resolve_rsm_for_house`), escalates to the house's HM (`resolve_hm_for_house`, which walks `hm_leave`), and terminates at the HMOD on duty (`resolve_hmod_on_duty`). The hours-dependent branch below still governs OTHER HM-action notifications; it no longer governs Allied procurement. The off-hours pilot ladder (`is_offhours_ladder_enabled()`, default false) still pre-empts the manager ladder when switched on.
4. For the remaining HM-action notifications: if current time is within HM working hours (Mon-Fri, [08:00, 17:00)) AND the block start time is within HM working hours AND the block's date is a weekday → resolve the house's **RSM** and notify them (`target = 'rsm'`), falling back to the HMOD on duty. A notification firing at exactly 08:00 is within HM hours; one firing at exactly 17:00 is within HMOD hours. Otherwise → resolve the current HMOD and notify them.

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
   - Workers holding the `hm`, `rsm`, or `bm` role are excluded from the source pool: HMs and RSMs may work scheduled shifts but are never selected as floaters; BMs hold no shift assignments at all.
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
   - They do not hold the `hm`, `rsm`, or `bm` role.
   - They have not previously declined a float whose window overlaps this gap at the same house (per the overlap-based exclusion in §3.8).

   The eligibility list above is computed by the **pure** algorithm over the orchestrator's snapshot. Two of its rules are additionally re-enforced **inside the write RPC**, under lock, because a snapshot cannot see a concurrent float (migration `20260726000011`, concurrency audit F5/F6). `process_float_lookup_assignment` and `force_trigger_float` both open with ONE ordered `FOR UPDATE` over every seat of every block the call touches (destination blocks and source blocks together, `ORDER BY assignment_id`) — one statement, so two floats whose destination and source sets overlap in opposite directions cannot deadlock — and then re-check: (1) **source floor**, no source block may be left with zero rows in `{scheduled, claimed, floated_in, pending_float_in}` once this call takes its sources, else `source_floor_violated`; (2) **single inbound float**, no destination block may already carry a `pending_float_in` on another seat, else `destination_has_pending_float_in`. The source floor previously lived ONLY in the pure algorithm's `sourceHasFloor` and the orchestrator's `sourceCanSpare` pre-filter, both reading unlocked snapshots, so two floats pulling from the same 2-worker desk each saw "2 present, can spare 1" and both committed — emptying the desk, violating hard invariant #2, and cascading a fresh escalation. The single-inbound check existed only on the force-trigger path and only as an unlocked count, so the automated path's uncommitted `pending_float_in` was invisible to it and both floats landed. Both guards refuse rather than partially apply, because invariant #3 forbids withdrawing a float once written. Note the source floor counts the pickup-lock present-set (real workers only): `allied` is paid external cover, not a worker who can hold the desk, so it must not satisfy the floor.

   b. **For each eligible worker, compute their largest consecutive coverage span within the remaining uncovered blocks.**

   c. **Identify the worker with the largest coverage span.** If their span is at least 1 block (30 minutes), tentatively assign them. The minimum chunk size is a single block, so a worker whose largest span is 1 block IS selected (previously they were not). If multiple workers tie on span length, apply the tiebreaker chain (Section 5.3).

   d. **Mark those blocks covered, remove the worker from the eligible pool, increment the per-block "tentatively-floating-out-from-source" counter, repeat** within the same source house until no more eligible workers can cover any remaining consecutive block.

   The headcount-floor check in (a) reads the running tentative counter in addition to persisted `pending_float_out` / `floated_out` statuses. This guarantees that a single lookup pass cannot over-float a source by selecting more workers in one iteration than the source can spare. Example: Quad (required headcount 3, currently 3 workers on shift) → first floater tentatively selected → tentative counter = 1 → remaining floor = 3 − 1 = 2 workers available → second floater tentatively selected → tentative counter = 2 → remaining floor = 1 → third worker is ineligible (would drop Quad to zero, below the absolute floor of 1).

   The tentative counter is in-memory state during the single lookup invocation. It is materialized as `pending_float_out` rows on `shift_block_assignments` when the algorithm commits its result inside the enclosing transaction (§5.5 Edge Case: Mid-algorithm eligibility changes).

   e. **Partial-coverage fallback.** If no worker can cover the full largest-consecutive run, fall back to selecting the worker who covers the _longest leading portion_ of the gap from the gap start (a single block is sufficient). Ties broken by §5.3. Allied procures the remaining tail.

4. **Advance to the next source house.** Once a source is exhausted, move to the next in precedence order and repeat step 3.

5. **Any remaining uncovered blocks go to Allied.** Generate a single `hmod_notify_allied` event covering the union of remaining blocks. If there are non-contiguous remaining runs, group them by contiguity and emit one Allied request per contiguous run.

> **Gap window cap (orchestrator, not the pure algorithm).** The pure float-lookup algorithm has no upper bound on the gap it is handed. The orchestrator bounds it: `loadVacantGap` builds a contiguous vacant gap of at most `MAX_ALLIED_COVERAGE_BLOCKS` (8 blocks = 4 hours) before snapshotting it into the algorithm input. So a single securing pass floats and, on failure, Allied-notifies at most 4 hours; the remainder stays vacant and re-escalates per block as its own escalation offsets arrive (Behavioral Spec §5.4). Because a float assignment's destination blocks are drawn from this capped gap, the no-ack void path (`process_no_ack_float`), which emits one Allied notification spanning the whole float, is transitively capped at 4 hours as well.

### 5.3 The Tiebreaker Chain

Tiebreakers are invoked once the chunking algorithm in §5.2 has identified the selected span (either the largest consecutive run, or — via the partial-coverage fallback in §5.2 step 3e — the longest leading portion). The candidate set begins as all eligible workers covering that exact span. If a check has multiple satisfiers, the set is narrowed and the next check runs on the narrowed set.

1. **Check 1 — Alignment at start.** A candidate whose shift starts at exactly the selected span's start. If exactly one candidate satisfies this, select them. If multiple, narrow the candidate set and advance to Check 2.

2. **Check 2 — Alignment at end.** Within the current candidate set: a worker whose shift ends at exactly the selected span's end. If exactly one satisfies, select them. If multiple, narrow and advance to Check 3.

3. **Check 3 — Arbitrary.** Pick one arbitrarily from the current candidate set.

The 1-block minimum from §5.2 step 4 is a precondition for being in the candidate set — a worker who cannot meet it is excluded before the tiebreaker chain runs. The previous Check 3 ("shift ends within float span") was moved out of this chain into the partial-coverage fallback in §5.2 step 3e, where it logically belongs as a fallback rather than a tiebreaker.

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

1. Resolve `semester_end_date` — the last operating date of the current operating period — using the `scheduling_periods` table (Section 2.10):

   ```sql
   SELECT end_date AS semester_end_date
   FROM scheduling_periods
   WHERE :drop_date <= end_date
   ORDER BY start_date
   LIMIT 1;
   ```

   If it returns a row, `semester_end_date = scheduling_periods.end_date`. The `scheduling_periods.end_date` was set at calendar-population time as the last operating date of the period, which is exactly the boundary needed.

   **The period's profile is not constrained** (corrected 2026-07-29). A `regular_school_year` term and a compiled `s_%` season are both SM-built periods with a `scheduling_periods` row, and a recurring slot in either is permanently droppable. Restricting this lookup to `regular_school_year` made summer recurrences undroppable: `semester_boundary_not_found` was raised for a date inside the current period, and the seats stayed assigned. Taking the earliest not-yet-ended period (rather than a `BETWEEN` point lookup) also keeps the resolution correct when the drop date falls just before a period opens or between periods.

   **Occurrence filter — exclude claim-based days, by mode not by name.** The bulk UPDATE joins `operating_calendar` through to `operating_profiles` and keeps only `scheduling_mode = 'sm_built'` dates. This is what excludes an embedded break occurrence (Behavioral Spec Section 8.4.1): a break day is claim-based and has no recurring slot to drop. Stating it as a mode rather than as `profile_name = 'regular_school_year'` is load-bearing — a season spans several phase profiles (`s_summer2026_20260601`, `s_summer2026_20260701`, …), so matching the period's own `profile_name` would vacate only the first phase.

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
      AND op.scheduling_mode = 'sm_built'  -- claim-based (break) dates have no recurring slot
  )
  AND sba.status NOT IN ('floated_out', 'pending_float_out');
```

(`op` is `operating_profiles`, joined from `oc.profile_name`.)

The `scheduling_mode = 'sm_built'` predicate ensures embedded break dates are naturally excluded (they are claim-based and have no recurring assignments). The `semester_end_date` boundary ensures the drop does not carry into the next period. **Corrected 2026-07-29:** this predicate was `profile_name = 'regular_school_year'`, which excluded break dates correctly but also excluded every summer-season date, so a season recurrence could not be dropped at all. See the mode-not-name note above.

The trailing AND-clause excludes blocks where the dropping worker is currently committed to a float — those commitments are firm and the no-takeback rule applies.

**UI warning for outstanding float commitments.** Before the confirmation popup is rendered, the perm-drop handler queries `float_assignments` for any `pending` or `acknowledged` row where the worker is the floater AND any of the float's source-side blocks intersect the recurring slot being dropped. If any such rows exist, the confirmation popup includes an explicit warning:

> "You have N pending/active float commitment(s) within this recurring slot. Those commitments will NOT be cancelled by this permanent drop — you are still expected to work them. Only the home-desk portion of those weeks is being released. Continue?"

This is purely a UI warning; the SQL backstop still skips `floated_out` / `pending_float_out` rows so the no-takeback rule cannot be accidentally violated.

4. (No SM notification.) The passive `sm_permanent_drop_alert` was retired (2026-07-13); the drop surfaces to the SM only via the permanent openings feed. No `notifications` row is written for the SM.

5. If the dropping operation was initiated by an SM/HM/BM acting on behalf of the affected worker (rather than the worker themselves), notify the affected worker: insert a row in `notifications` with `type = sw_permanent_removal_alert` and the operator's identity in the payload.

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

   **Which dates qualify (widened 2026-07-29).** `candidateBlocks()` keeps dates whose calendar profile is **schedule-built** (`operating_profiles.scheduling_mode = 'sm_built'`), and `semesterEndDate()` resolves the boundary from the current-or-upcoming `scheduling_periods` row **whatever its profile** — the same two rules `permanent_drop_slot` uses (Section 7.1) and the same rule `worker_open_shifts.schedule_built` uses (Section 5.x). Both previously read `profile_name = 'regular_school_year'`, so a summer season's recurrence could not be picked up as a unit and had to be claimed week by week. These three predicates must move together: the feed advertises, the count quantifies, and this step delivers, and any drift between them reintroduces the mismatch the symmetry rule (`20260617000004`) exists to prevent.

   The candidate set is **distinct by `block_id`**. `shift_block_assignments` holds one row per seat, so a multi-staff desk (Harnwell `required_headcount` 2, Quad 3) whose recurring slot was permanently dropped by both of its owners carries two `permanent_drop` vacancies on the same block — the mirror image of the one-seat-per-block claim in step 6. The seats of a block are interchangeable (Section 1.7), and an occurrence is 0.5 hours once, not once per seat, so a block listed per seat would double its contribution to the step 4c projection. Because a cap-exceeding week is skipped **in full**, that over-projection does not merely trim a block — it silently drops the whole week, and it emits duplicate ids in the queued and skipped sets.

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

The claim takes **at most one seat per block**. A multi-staff desk (Harnwell `required_headcount` 2, Quad 3) can hold several `permanent_drop` vacancies on the same 30-minute block at once — two owners of the same recurring slot each permanently dropped it, and Section 7.1 vacates one seat per owner. A set-update on `block_id IN (...)` alone would match both seats and put the picker on both, which violates the one-worker-one-seat-per-block rule of Section 1.7 (nothing else catches it: there is no unique index on `(block_id, user_id)`, and the occupied-headcount trigger only compares occupied seats to `required_headcount`, which two seats on a headcount-2 block satisfy no matter who holds them). So the seat is chosen per block, the same way `claim_open_shift` (Section 5.3) and `claim_break_blocks` (Section 4.4 of the Behavioral Spec) choose one:

```sql
WITH candidate_blocks AS MATERIALIZED (
  SELECT DISTINCT sba.block_id
  FROM shift_block_assignments sba
  WHERE sba.block_id IN :final_queued_block_ids  -- after in-transaction per-week re-check
    AND sba.status = 'vacant'
    AND sba.vacancy_origin = 'permanent_drop'
),
chosen AS MATERIALIZED (
  SELECT seat.assignment_id
  FROM candidate_blocks cb
  CROSS JOIN LATERAL (
    SELECT a.assignment_id
    FROM shift_block_assignments a
    WHERE a.block_id = cb.block_id
      AND a.status = 'vacant'
      AND a.vacancy_origin = 'permanent_drop'
    ORDER BY a.assignment_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ) seat
)
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
FROM chosen, shift_blocks sb
WHERE sba.assignment_id = chosen.assignment_id
  AND sb.block_id = sba.block_id
  AND sba.status = 'vacant'
  AND sba.vacancy_origin = 'permanent_drop';
```

`DISTINCT ON (block_id)` cannot carry the row lock itself (PostgreSQL rejects `FOR UPDATE` alongside `DISTINCT`), hence the LATERAL `LIMIT 1`.

The `status = 'vacant'` and `vacancy_origin = 'permanent_drop'` predicates ensure concurrent pickups of the same slot are race-safe: once the first transaction commits, the rows no longer satisfy these predicates and the second transaction silently skips them. `FOR UPDATE SKIP LOCKED` covers the not-yet-committed half of the same race, and because it locks exactly one seat per block, two workers picking up the two independently dropped seats of one multi-staff block **split** the seats — the second steps over the first's locked row instead of blocking on it and then finding nothing.

Because the update is one row per block, the returned `assigned_count` is a count of **occurrences** (weeks), which is what the confirmation summary of step 5 and the pickup evaluator both reason in.

The `is_cross_house_pickup` and `source_house_id` fields are set conditionally based on whether the slot's house matches the picker's home house.

7. The picked-up blocks now have `status = 'claimed'`. The picking worker is the current owner.

8. **Permanent feed removal.** Immediately after commit, the slot is removed from the permanent openings feed for this house. This applies regardless of whether the pickup was complete or partial. The permanent feed queries on `vacancy_origin = 'permanent_drop'`; once any block in the slot is claimed, the slot's feed entry reflects only remaining unclaimed occurrences. Skipped weeks are not re-exposed in the permanent feed; they surface individually in the weekly feed as they cross the 30-day horizon. Mechanically, the skipped weeks are re-flagged to `vacancy_origin = 'temporary_drop'` in the same transaction — one seat per block, by the same LATERAL pick as step 6. Scoping that retirement to one seat matters on a multi-staff desk: retiring _every_ `permanent_drop` seat of a skipped block would strand a co-tenant's independent drop, which no one had picked up and which would then be permanently unpickable.

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

### 8.5 Summer (Shipped 2026-07-02 — This Section Superseded)

**Corrected.** This section previously stated that summer was "deferred indefinitely" on the grounds that summer schedules are static and the float engine adds no value. Both the deferral and its premise are now wrong, and the section is retained only so the reversal is legible.

Summer shipped on 2026-07-02 as the **operating-seasons** layer (§2.1): the Administrator authors a season, a pure compiler in `packages/core/src/operating-seasons` derives one phase per change-point, and `apply_compiled_season` materializes those phases into the same four runtime config tables the academic year uses. The prediction that no code changes would be needed held for the _runtime_ — the orchestrator, block generator, and publish path have no summer special cases — but the authoring, compilation, and reconciliation layers above them are all new code.

The operational premise was also wrong. Summer is the **most** dynamic period, not the least: houses open on staggered dates as they take residents, a house may be single-staffed early and double-staffed later, staffing varies intraday, and floating is off early and on later. Floating in summer is **universal** (any open, multi-staffed house to any other open house, never into Harnwell) rather than absent. See behavioral spec Section 3.1 and hard invariant #2 in AGENTS.md.

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

**Delivery accounting (migration `20260726000004`).** `deliver_pending_notifications` runs once a minute and fires one `net.http_post` to `dispatch-push` per row returned by `pending_notification_deliveries`. A notification left that set **only** when `delivered_at` was stamped — the last statement of the `dispatch-push` handler — and the Firebase send in between was unguarded. `firebaseMessaging()` throws outright when `FIREBASE_SERVICE_ACCOUNT_JSON` is unset, so the throw propagated out of `Deno.serve`, the function 500'd, and the same notification was re-POSTed 60 seconds later, forever, with the stuck set only ever growing. Four columns and two RPCs close it:

- `delivery_attempts` / `last_attempt_at`, incremented by `begin_notification_delivery_attempt` **before** the send. Pre-send is deliberate: counting only in a `catch` leaves the loop unbounded against a runtime death no catch block observes (OOM, worker eviction, hard timeout).
- `last_delivery_error` / `dead_lettered_at`, written by `record_notification_delivery_failure` from the Edge Function's `catch`. Past `max_notification_delivery_attempts()` (12) the row is dead-lettered and leaves the queue permanently; `dead_lettered_notifications` surfaces it to an operator, because the failure is otherwise invisible — it can only occur for users with a registered device.
- `notification_retry_backoff(attempts)` gives capped exponential backoff (1, 2, 4 … 60 minutes). A never-attempted row has zero backoff, so first delivery is unchanged.
- `suppressed_at`, set by `sweep_suppressed_ack_reminders` in one set-based statement per pass. An ack reminder whose float is no longer pending was excluded from the queue but never stamped, so every acknowledged float left a tombstone the scan re-filtered every minute forever. Suppression is safe to stamp precisely because the row is being deliberately **not** sent, which is a different thing from stamping `delivered_at` before a send.

`delivered_at` is still written only after a successful send. At-least-once delivery is unchanged and non-negotiable (Behavioral Spec §10.4).

`notifications_delivery_queue_idx` is a partial index on `(scheduled_for, notification_id)` over the **live queue only** (`delivered_at IS NULL AND suppressed_at IS NULL AND dead_lettered_at IS NULL`). Its predicate matches the terminal states above, so a finished row physically leaves the index and its size tracks the queue rather than all history. Before it, the every-minute query had no usable index at all: the only candidate led with `recipient_user_id`, which the query does not filter on.

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

- **Operational retention (migration `20260726000005`).** Daily at 03:20, `purge_expired_operational_records` deletes non-pending `float_assignments` past both `expires_for_cleanup_at` and the 28-day `operational_retention_days` floor, and `notifications` in a terminal state (delivered, suppressed, or dead-lettered) older than the same floor. **This description used to appear here as though it were implemented and it was not**: `expires_for_cleanup_at` was `NOT NULL` and indexed, `float_retention_days` was a live config the orchestrator threaded into `process_float_lookup_assignment`, and a repo-wide grep for `DELETE FROM float_assignments` returned nothing. Every part of the mechanism existed except the job, so both tables grew forever and the every-minute scans behind Behavioral Spec §10.4 degraded monotonically. Three guards: a `pending` float is never deleted at any age (deleting one would revoke it, which no automated process may do — Section 6.3); a non-terminal notification is never deleted, because it is evidence of a delivery fault; and deletes are chunked at `retention_delete_batch_size` so the sweep never holds a long lock or emits one huge WAL record for Realtime to fan out. Deleting a float nulls `shift_block_assignments.parent_float_id` (`ON DELETE SET NULL`) — accepted explicitly when the 28-day horizon was chosen.
- **30-day horizon job.** Daily job scans for fired-worker shifts crossing the 30-day horizon and surfaces them in the open-shifts feed.
- **Swap expiry.** Owned by the `swap-expiry` pg_cron job. `orchestrator-tick` carried a second, identical `UPDATE` on its 1-minute tick — strictly more expensive, because its `.select('swap_id')` forced a `RETURNING` purely to populate a counter — so both ran every minute and whichever went second updated zero rows. The tick now calls `expire_pending_swaps_if_uncronned`, which defers to the cron when the job exists and does the work itself when it does not. The Edge Function copy could not simply be deleted: pg_cron is not installed on the local stack, where it is the only thing expiring a swap.

---

## 10. Risks and Mitigations

### 10.1 The Cycle 1 Configuration Trap

Mitigation: implement at least three profiles in cycle 1 and verify the orchestrator produces correct behavior for all three without code changes.

### 10.2 Race Conditions in Concurrent Claims

Mitigation: row-level locking. The first transaction to acquire the lock and commit wins.

**This was not uniformly true until 2026-07-26.** A concurrency audit that day found the locking correct in `claim_open_shift`, `claim_break_blocks`, `permanent_pickup_slot`, `process_float_lookup_assignment` and `force_trigger_float`, and absent in the paths beside them: `drop_shift`, `accept_swap`, `apply_permanent_swap` and `admin_assign_worker` all read-then-wrote with no lock, and the first three wrote with no predicate whatsoever. Every one of those failed **silent** — the losing session received HTTP 200 and kept a shift the server had given away — because `shift_block_assignments` carried no `UNIQUE` or `EXCLUDE` constraint and `enforce_block_occupied_headcount` counts occupancy, which an ownership swap leaves unchanged. Remediation is migrations `20260726000009` (compare-and-swap plus a global lock order, §3.2), `20260726000010` (the missing uniqueness constraint, §3.2) and `20260726000011` (check-and-lock coverage plus float write-point guards, §4.2 and §5).

Two habits keep this from recurring. First, a lock is only meaningful if the availability check happens **after** it and the write repeats the predicate; a `FOR UPDATE` followed by an unpredicated write is not a fix. Second, locking alone is not a design: prefer a constraint the database can enforce, because a constraint fails loudly on a code path nobody thought about, and every finding in this audit was invisible precisely because nothing was there to object.

Regression coverage is deliberately split. `supabase/tests/concurrency-audit-guards.sql` (pgTAP) covers everything observable from one session: the constraint, the coverage-lock return value, the float guard predicates. The four fixes whose whole substance is "hold a lock across two statements" cannot be shown there, because a lock is only observable when something contends for it and pgTAP is single-session; `scripts/concurrency/race-harness.sh` drives two real `psql` sessions and asserts the interleaving. That harness was verified to FAIL against the pre-fix function bodies before being accepted, which is the only thing that makes a passing run meaningful.

**Client-side reconciliation (concurrency audit F9).** Both worker clients move optimistically and reconcile from the server afterward. Realtime alone cannot close the loop: `postgres_changes` evaluates RLS against the NEW row, so when a concurrent writer reassigns a seat AWAY from a worker, the row leaves that worker's scope and **no event is delivered at all** — the optimistic card would survive indefinitely. Both platforms therefore pull after a write rather than waiting to be told: Android via `WorkerWeekRefresh` (a signal merged into the Realtime change stream in `observeWorkerWeek`, so the existing debounce and conflate still collapse a burst into one refetch), iOS via the `reconcile` path in `liveWrite`. A **partial** claim reverts the optimistic move as well: `claim-shift` is one POST per block, so losing the first-come-first-served race on some blocks of a coalesced card is the expected concurrent outcome, not an edge case.

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

Mitigation: the permanent pickup UPDATE statement (Section 7.2 step 6) includes `vacancy_origin = 'permanent_drop'` and `status = 'vacant'` as predicates. Once the first transaction commits, the rows have `status = 'claimed'` and the second transaction's predicate fails for those rows. The second worker gets a partial-success result, and the UI surfaces a mid-pickup notification: "X of Y blocks were already claimed by another worker; your pickup affected Z blocks." For the most common case (the entire slot was just picked up), the second worker sees zero affected blocks.

The `FOR UPDATE SKIP LOCKED` seat pick of step 6 handles the same race before either side commits, and it changes the outcome on a multi-staff desk holding two independently dropped seats on the same block: the two pickups take one seat each rather than one of them waiting on the other's lock and then finding nothing. Both workers get a full-success result on that block.

A similar issue could occur if a worker permanently drops a slot at the same moment another worker is in the middle of a permanent pickup of an earlier-state version. Mitigation: same predicate-based race guard. The pickup's predicate requires the blocks to currently be in `permanent_drop` state; if they've already been reassigned, the pickup skips them.

### 10.10 Permanent Drop UX Misuse

Risk: a worker permanently drops a slot they should have temporarily dropped. The recurring assignment is now gone for the rest of the period. Recovery requires either the worker themselves (or the SM/HM) to permanently pick it back up via the permanent openings feed, which is reversible in principle but operationally cumbersome.

Mitigation: the confirmation popup at permanent drop time explicitly shows the number of weeks affected, making the scope clear. UI design (a distinct visual treatment for the permanent drop button vs. the temporary drop button) reduces accidental clicks. Beyond UI design, no system enforcement.

---

## 11. What's Out of Scope

- Performance metrics dashboard. No tracking of last-minute drops, no-shows, or worker reliability scores.
- Cross-house worker pooling beyond the float mechanism.
- Mobile schedule creation. Drag-picker is desktop-only.
- Multi-campus support.
- General audit logging of who-did-what. Scoped audit trails do exist where a specific need drove one: `force_triggered_by`, HM leave, `operating_config_audit` for season changes, the `kb_intake` status trail (§14), and `da_page_deliveries` (§13.7). There is no system-wide change log.
- Allied as a Desk Assistant user, and digitization of the Allied coverage-request form.
- Direct physical-pager hardware integration (behavioral §15, pending items).
- Masked or app-mediated contact between workers.
- Cost and service-level reporting on Assistant usage.

**Amended.** This list previously said "external integrations beyond Penn's standard auth." That is no longer true and the line has been removed: the system integrates with Anthropic (generation, intake proposal, schedule proposal), Voyage (embeddings), and Firebase (push delivery for both FCM and APNs). Each is a deploy-time secret, each has its own key so cost is attributable, and each is behind a thin client that fails with a clear error rather than crashing when unconfigured.

The remaining items can be added later as cycle 3+ work if needs arise.

---

## 12. Open Questions and Future Decisions

Items not yet decided:

- **The exact UI for the calendar profile painter.** Not yet designed.
- **The recovery path for a corrupted swap state.** Recommendation: SM/HM can manually edit `shift_block_assignments` to any state via override; the swap system is one mechanism among several.
- **Notification retry on delivery failure.** Recommendation: leave this to the notification provider's default retry policy.
- **Additional system-wide configurable parameters the project administrator may want to add.** Section 14 of the behavioral spec will be updated as the project committee provides feedback.
- **Whether SMs should be able to modify the global weekly cap.** Currently restricted to HM/BM; the project administrator may revisit.
- **Whether the force-trigger should be auditable beyond the `force_triggered_by` field.** Currently no audit log; if misuse becomes a concern, a lightweight audit table may be added.
- **The real escalation ladder and issue-type routing table (§13.5).** `routing_rules` ships seeded with a placeholder. The real tier ladder, issue-type mapping, and season/day/time windows are an operational input from Housing leadership. Replacing them is a data change; `TIER_LADDER` itself is the invariant.
- **The page handoff channel (§13.7).** Assistant-drafted pages currently deliver through the app's own notification system. Whether the legacy pager channel must remain authoritative — in which case pages would instead be formatted for entry there — is undecided. No pager hardware integration exists either way.
- **Re-embedding on an embedding-model change.** `kb_chunks` pins 1024 dimensions at the column type, so switching embedding models requires a re-embed migration. No such migration exists yet.

---

## 13. The Desk Assistant

Behavioral spec Section 17. The Assistant follows the same shape as the rest of the system: **pure logic in `packages/core`, thin Edge Functions, Postgres for storage and retrieval.** It is strictly additive — it reads staffing state and never writes it.

### 13.1 Layout

- **Pure core**: `packages/core/src/desk-assistant/` — scope predicate, chunking, normalization, layout heuristics, temporal resolution, intake proposal, query classification, commit, per-house overlay, retrieval ranking, citations, guardrails, prompts, redaction, routing, page fields, page drafting, delivery. Zero Supabase imports, no clock (dates are injected), fully unit-tested.
- **Edge Functions** (thin): `da-ask` (retrieval + grounded generation), `da-route` (contact resolution), `da-draft-page`, `da-send-page`.
- **Web**: the `(assistant)` route group — an in-shell chat page that streams its answer over SSE, plus a kiosk `/assistant/desk` view for the monitor at the desk.
- **Mobile**: an Assistant screen backed by a shared ViewModel, reachable from a persistent affordance.

### 13.2 Storage

| Table                                   | Holds                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `kb_documents`                          | One row per approved source document, with scope and temporal validity              |
| `kb_chunks`                             | Embedded chunks (pgvector), scope and temporal columns denormalized from the parent |
| `kb_intake`                             | The intake pipeline row for a document under review                                 |
| `kb_incidents_raw`                      | Access-controlled raw incident records, **never indexed**                           |
| `da_conversations` / `da_messages`      | Conversation history                                                                |
| `routing_rules`                         | The issue-type-to-tier ladder (data, per §13.5)                                     |
| `da_page_drafts` / `da_page_deliveries` | Drafted pages and their delivery records                                            |

Enums: `da_sensitivity_enum` (`general` / `internal` / `restricted`), `da_source_type_enum` (`hm_guide`, `house_binder`, `summer_binder`, `incident_lesson`, `app_guide`, `fixture`), `da_temporality_enum` (`durable` / `until_superseded` / `expires`), `da_intake_status_enum`. Every table gets RLS in the migration that creates it, per the standing convention.

### 13.3 Retrieval Is One Function

`match_kb_chunks(requester, query_embedding, k, as_of_date)` is the **only** place retrieval happens. It applies the role/house/sensitivity scope predicate and the temporal filter **inside the function**, before ranking, so no caller can accidentally retrieve out of scope or cite an expired rule. The scope matrix it enforces is mirrored exactly by the pure `scope` predicate in core, so the same decision is unit-testable off-database.

**`house_scope` is `text[]`, not a single house id** (revised 2026-07-24, migration `20260724000002_kb_house_scope_multi`). `NULL` still means shared, applies to every house (unchanged, and cheaper than writing out all 13 ids); a non-null array is the explicit set of houses it applies to, one or more. `da_can_read_item` and its pure mirror `canReadItem` match when the requester's home house is `ANY` of the listed houses, or they hold house-admin over any listed house. Postgres cannot FK an array column's elements, so `validate_kb_house_scope` (a BEFORE INSERT OR UPDATE trigger on both `kb_documents` and `kb_chunks`) enforces every id is a real house and a non-null array is never empty, raising a specific "unknown house id" error rather than the opaque FK-violation an invalid id used to surface at commit time.

Embeddings are **Voyage `voyage-3`, 1024-dimensional** (`VOYAGE_API_KEY`). The dimension is fixed by the column type; changing the model requires a re-embed migration.

Generation is **Claude** (`claude-sonnet-5` by default, overridable per deploy). Grounded extraction over supplied context does not need a larger model; the reasoning burden is on retrieval, not generation. Two model-surface constraints are load-bearing and easy to reintroduce as bugs: `claude-sonnet-5` **removed the sampling parameters**, so sending `temperature` / `top_p` / `top_k` returns `400 temperature is deprecated for this model` (there is no determinism knob; steer with the prompt), and it runs **adaptive thinking when the request omits `thinking`**, with thinking tokens charged against `max_tokens` — the grounded path therefore asks for 2048 rather than the 1024 default so a long escalation answer cannot run out mid-list.

**Grounding is decided from the shape of the candidate distribution, not an absolute cutoff** (`isGroundedByDistribution`, in core and mirrored into `_shared/desk-assistant.ts`; revised 2026-07-22). A chunk grounds when its similarity clears a hard floor **and** either clears the outright-accept threshold or beats the **median of the whole candidate pool** by a margin. Measured against the Harnwell summer binder, an absolute cutoff provably cannot work: the identical correct chunk scored 0.5346 for a long question and 0.3688 for a short one, while an off-topic "wifi password" question scored an irrelevant chunk 0.4080 — higher than the valid short question, so no single cutoff separates them. Gap-to-background does: on-topic tops beat their pool median by 0.11 to 0.15, off-topic tops by only 0.03 to 0.07. The background statistic is the **median, deliberately not the runner-up**: once several documents genuinely bear on one question (a program's own row plus the house-wide definition of a term it uses), the runner-up is itself relevant and a top-vs-runner-up margin collapses toward zero, which would defer precisely the best-covered questions. The measured pools are pinned as regression fixtures in `retrieval.test.ts` and `mirror.test.ts`.

The grounded user message also carries the **current NY date and time** (BSpec §17.3a), sourced from `fetchAppNow` (`app_now()`, so the dev sim clock moves the Assistant's "now" too) and formatted with `nyParts`. It names the date in **both** spelled and ISO form, which is not cosmetic: the leakage guardrail below treats a date absent from the prompt as un-sourced, and the model writes prose dates even when handed an ISO string.

**Citations are transport, not prose** (BSpec §17.3). `GROUNDED_SYSTEM_PROMPT` forbids naming sources in the answer text; the citation list travels separately on the `meta` frame, and each client renders it as a collapsed control. Clients must therefore not parse citations out of `content` (nothing to parse) and must not treat an answer without inline references as uncited.

**Em and en dashes are removed in code, not merely forbidden by prompt** (BSpec §17.3c). `stripEmDashes` (core, mirrored into `_shared/desk-assistant.ts`) re-punctuates: an en dash between word characters is a range and becomes a hyphen, every other dash becomes a comma. `da-ask` applies it over the WHOLE accumulated answer and streams the diff, rather than per delta, so each dash is judged with full context; a dash sitting at the very end of the buffer is held back one chunk, because `Mon–` alone reads as a clause break while `Mon–Fri` is a range. The persisted `da_messages` row is sanitized too, since the thread is replayed from it on reload.

### 13.4 Question Classification

`classifyQuery` (pure) routes a question to one of three resolvers before any retrieval happens:

- `durable_knowledge` → `match_kb_chunks`.
- `duty_contact` → the routing engine (§13.5) against live duty state. This exists because a stored document cannot know who is on leave; answering a duty question from the vector store is the fabrication failure mode.
- `personal_schedule` → the `get_my_shifts` tool, backed by the `assistant_my_shifts` RPC (migration 20260713000003). **The user id passed to that RPC is the authenticated token subject, never a model-supplied value.** This is the load-bearing control: a tool call is model output, so trusting a model-supplied user id would let a crafted question read another worker's schedule.

Temporal references are resolved to an as-of date in UTC date-only math (no wall-clock interval arithmetic), so §1.6 holds. Misclassification degrades to retrieval plus defer.

### 13.5 The Routing Engine

`resolveRoute` in `packages/core/src/desk-assistant/routing.ts` is pure: no Supabase, no clock. The Edge Function snapshots live duty state and the current season/day/time, then calls it.

- `TIER_LADDER` is `['desk_sm', 'csmod', 'rsm', 'hmod', 'ba', 'project_admin']`. **This constant is the invariant; the rules are data.**
- A rule matches on issue type, season scope, day type, and an NY wall-clock window (windows may wrap midnight). The lowest `priority` wins; ties break on rule id so the same question always resolves identically.
- No match falls back to `hmod`, the historical catch-all.
- Resolution then **walks up** the ladder from the matched tier to the first filled slot and returns the walked chain, so the UI can explain why the worker was sent where they were sent. Every slot empty yields a null contact and a logged warning, never a fabricated one.

Duty slots are filled by the **existing** resolvers, not new ones: `resolve_hmod_on_duty`, `resolve_rsm_for_house`, `resolve_ba_for_house`, and the `project_administrator_user_id` config row. `resolve_ba_for_house` (migration 20260712000010) mirrors `resolve_rsm_for_house` exactly over `role = 'bm'`, scoped per house, and is leave-aware through the same `resolve_hm_for_user` chain — the Building Administrator is the existing `bm` role, not a new one.

`smod` and `csmod` are deliberately **not** resolved to a person: they are reached on a shared duty phone, so routing surfaces the tier plus the optional `smod_duty_phone` / `csmod_duty_phone` config values. As with `project_administrator_user_id`, `seed.sql` leaves these unset and deployers configure them.

### 13.6 Guardrails

`guardrails.ts` flags a query **before** generation so the Edge Function can inject the right framing:

- **Life safety** (fire / medical / emergency door) and **access decisions** are matched by high-recall keyword heuristics. High recall is intentional: a false positive adds a redundant safety preamble, a false negative omits the one that mattered.
- **Incident probes** ("what happened the other day") are refused at the ask, rather than relying on retrieval returning nothing.

The two flags inject **different kinds** of framing, and `da-ask` keeps them in separate lists (corrected 2026-07-30):

| Flag        | Constant                 | Where it goes                                                         | Worker sees it |
| ----------- | ------------------------ | --------------------------------------------------------------------- | -------------- |
| Life safety | `lifeSafetyPreamble()`   | `preambles` → leading synthetic SSE delta, persisted with the message | **Yes**        |
| Access      | `ACCESS_MODEL_DIRECTIVE` | `systemDirectives` → appended to the system prompt for that request   | **No**         |

A life-safety preamble is content the worker must read ("call the emergency line now"). An access directive only constrains how the model writes the answer, so it is an instruction, not copy. Both were originally pushed onto the same visible `preambles` list, which streamed the access instruction to the worker as the answer's first paragraph and persisted it into `da_messages` — the exact meta-narration BSpec §17.3b forbids. Putting the directive on the **system** prompt rather than the user turn also removes the echo risk, since the model does not relay system content. `GROUNDED_SYSTEM_PROMPT` additionally bans opening by classifying the question. da-ask has no Deno test, so the split is pinned from `packages/core/tests/desk-assistant/mirror.test.ts`, which reads the Edge Function's source and asserts that `preambles` receives nothing but `lifeSafetyPreamble` and that no instruction text is hardcoded inline.

The real control on incident disclosure is that raw incidents are never in the index (§13.2). The output filter is defense in depth, not the primary mechanism — if raw sensitive text lived in the vector store, a retrieval bug or an injection could surface it.

That output filter, `containsIncidentLeakage`, is **scoped to specifics the model produced from outside the prompt** (revised 2026-07-22; BSpec §17.4 rule 4). It runs on the growing answer buffer after every delta and, when handed the grounding text, counts a pattern hit as leakage only if the matched text is absent from that text. The grounding text passed is the **whole user message**, not just the retrieved chunks: everything in it is source text, the worker's own question, or the injected clock line, so echoing any of it discloses nothing new. Comparison folds month names to a three-letter prefix and collapses whitespace, so an answer's "Aug 8" still matches a source's "August 8".

This narrowing is a correctness fix, not a relaxation. The pattern set is shared with `validateLesson`, where "no dates, no phone numbers" is right because it vets a **de-identified incident lesson**; applied unscoped to _any_ answer it fails closed on the corpus's most important content, since the escalation flowcharts are made of phone numbers and the conference table is made of dates. Called with no grounding text the behaviour is unchanged, which is what the ingestion path still wants. Regression fixtures for both directions live in `redaction.test.ts`.

### 13.7 Paging

`page-fields` derives the required fields for an issue type; `page-draft` composes the draft; `da-draft-page` persists it to `da_page_drafts` for human review; `da-send-page` delivers it via the existing notification system and records `da_page_deliveries`. No new delivery channel and no pager hardware integration. The human review step is a hard gate, not a UI convenience.

---

## 14. The Knowledge Intake Pipeline

Behavioral spec Section 18.4. Intake is a **state machine** on `kb_intake`, whose statuses are the audit trail:

```
uploaded → normalizing → proposed → in_review → approved → embedding → live
                                         ↘ rejected        ↘ failed
```

1. **Upload and normalize.** The document is parsed to text. PDFs use a text extractor with a **vision fallback**: pages that extract empty or structurally suspect are re-read by Claude as images, so a scanned or heavily laid-out binder page does not silently ingest as blank.
2. **Propose.** A Claude pass proposes the metadata a human would otherwise hand-enter: source type, house scope, audience, sensitivity, temporality with its effective dates, and any redactions. `propose.ts` shapes the request and validates the response; the model proposes, it does not decide.
3. **Review.** A human approves, edits, or rejects in the web intake UI. **Nothing is indexed before approval.**
4. **Embed and go live.** `commit.ts` chunks (`chunking.ts`, layout-aware via `layout-heuristic.ts`), embeds via Voyage, and writes `kb_documents` + `kb_chunks` with scope and temporal columns denormalized onto every chunk so `match_kb_chunks` filters without a join.

Documents may later be withdrawn. Incident-derived content follows `redaction.ts`: the raw record lands in `kb_incidents_raw` (never indexed), and only a de-identified lesson is eligible to be proposed. Disciplinary and private incidents produce no lesson at all.

**Per-feature API keys.** Each AI usage has its own key so cost is attributable: `CLAUDE_AI_CHATBOT_DESK_ASSISTANT` (generation), `CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER`, `CLAUDE_AI_CHATBOT_PROPOSE`, `CLAUDE_AI_CREATE_SCHEDULE_KEY` (§15), and `VOYAGE_API_KEY`. There is deliberately **no** generic `ANTHROPIC_API_KEY` fallback — a bare shared key would make per-feature cost impossible to attribute. See the API-key convention in AGENTS.md.

---

## 15. The AI Schedule Agent

Behavioral spec Section 19. Lives in `packages/core/src/ai-schedule/` and is, like the float algorithm, a **pure function**: the web action snapshots roster, preferences, targets, and blocks into an input, runs the agent, and hands the result back as a draft. It writes nothing.

Pipeline: `grid` (block grid, contiguous runs, hours per worker) → `prompt` (system prompt, plan and proposal JSON schemas, repair prompt) → `loop` (plan, propose across perspectives, validate, repair) → `validator` → `scorer` → `finalize`.

- **`validator` is the hard gate.** Harnwell training, headcount, block boundaries, hours cap, and availability are validated as violations, not scored as preferences. An invalid candidate is repaired or dropped; it is never surfaced.
- **`finalize` is the shape gate** (BSpec §19.1). The two shift-shape rules are `warning`-severity violations in the validator, never `hard`: a misshapen candidate is still feasible, the warnings are fed back into the repair prompt, the scorer penalizes them, and `finalizeSchedule` is what _guarantees_ them on the output. Making them hard would fail whole candidates the prune step cannot repair (it only removes assignments), so the pipeline would return no schedule at all.
  - `alignment.ts` holds the boundary predicates, pure index arithmetic over one day's sorted blocks. A run may start at index `i` when `minuteOfDay % 60 == 0` **or** `i` opens a contiguous coverage segment, and may end at `i` when `(minuteOfDay + 30) % 60 == 0` **or** `i` closes one. Segment edges are exactly the desk's open and close, so the 05:30 summer opening (`operating_seasons.shift_start_bound`) is legal for free, with no config key and nothing hardcoded.
  - `finalize` runs three per-day passes: grow existing runs to two hours and onto legal boundaries; fill remaining open seats with maximal legal runs (`maxAlignedLen`); then trim any survivor to its largest legal sub-run (`largestLegalSubRun`), dropping it when there is none. Post-conditions: every run is `>= MIN_RUN_BLOCKS` (4 blocks = 2h) and boundary-legal.
  - The prompt teaches the same rule rather than relying on repair: the per-day slot table carries a `bound` column marking each slot `S` (may start), `E` (may end), `SE`, or `-`, so the model never has to derive the exception.
  - `AI_SCORE_WEIGHTS.halfHourBoundaryPenalty` (-5, per offending run end) sits above `idealRunBonus` (+2), so a misaligned run always scores below the same run snapped to the hour.
- **`scorer` + `weights` are the only tuning surface.** `AI_SCORE_WEIGHTS` centralizes every soft objective. The dominance that matters is pinned by a regression test: `fillableUnfilledSeat` at `-25` outweighs any achievable preference gain, so coverage can never be traded away for preference satisfaction.
- Unfilled seats are classified **fillable** vs **unfillable** and surfaced either way, so the SM sees what the draft could not do.
- The LLM is injected behind the `ScheduleLlm` interface, which keeps the agent testable without a network call.

Output is a **draft**. It flows into the existing schedule-builder draft storage (§3.9) and reaches workers only through the existing `publish_schedule` path, which enforces its own invariants regardless of how the draft was produced.

---

## 16. Duty Resolution, Launch Gating, and the Off-Hours Ladder

### 16.1 Off-Hours Allied Ladder (Pilot)

Behavioral spec Section 16.5. Migration 20260713000001. When a coverage-lock (T-2h) event fires **outside HM working hours** and the ladder is enabled, the orchestrator runs a rung ladder — dropper, then house SM, then everyone currently on that desk — instead of the single `hmod_urgent` notification to `resolve_hmod_on_duty`.

- New notification type `allied_page`; each rung is ackable.
- No acknowledgment within `allied_page_rung_timeout_minutes` (default 10) advances the rung. An acknowledgment resolves the ladder, so exactly one owner holds the duty and the chain never double-pages. Rung 3 is deliberately multi-recipient and terminal.
- Gated by `is_offhours_ladder_enabled()`, reading `system_config('offhours_ladder_enabled')`. **Absent or false means disabled**, so every existing seed, test, and environment keeps the historical HMOD-direct behavior and the suite is unchanged.
- **Inside** HM working hours routing is untouched (the RSM path).

Turning the switch off after HMOD adoption reverts to HMOD-direct routing with no code change. That is the point of the switch.

### 16.2 Staggered Launch

Behavioral spec Section 22. Migration 20260712000001.

- `houses.launch_state` is `'pre_launch' | 'live'`, defaulting to `pre_launch` with a `launched_at` audit stamp.
- `is_staggered_launch_enabled()` reads `system_config('staggered_launch_enabled')`; **absent means disabled**, so when the gate is off every house is effectively live.
- `house_is_live(house_id)` is the single predicate both platforms consult, which is what keeps web and mobile agreeing. Unknown house is not live.

Enforcement is at the **application** layer (a "your house is not live yet" placeholder for workers; admins bypass) per the product decision. The DB helpers are the source of truth both clients read, not a row-level gate — launch state is visibility, not authorization.

**One server-side rule does key off it, added 2026-07-26 (migration 20260726000003).** `orchestrator_vacant_seats(p_after, p_through)` — the discovery query `orchestrator-tick` now uses instead of an inline PostgREST select — joins `house_is_live(sb.house_id)` into the scan, so a pre-launch house's blocks are never returned and the escalation chain never fires for them. Previously `grep -n "launch" supabase/functions/orchestrator-tick/index.ts` returned nothing: the gate existed and the orchestrator did not consult it, so 12 dark houses' entirely-vacant seats were scanned and escalated every minute. Measured on the seeded stack, a Harnwell-only pilot takes a 30-day window from 10,461 seats across 13 houses to 61 seats in 1. Because `house_is_live` is true for every real house while the master switch is off, this is a no-op in every existing environment and the whole pgTAP suite is unaffected.

The same function returns a `desk_covered` flag per row, computed over the **escalation** present-set (which counts `allied`). That replaced a second round trip, not the check itself: `processVacantBlocks` still skips every covered block, which is the coverage-floor-of-one invariant, and `loadCoveredBlockIds` is unchanged and still guards the gap builder in `loadVacantGap`. Do not collapse this set with the pickup-lock present-set, which excludes `allied`.

`desk_covered` is a **scan-time** value and is treated as a cheap pre-filter, not as authority. It is read once per tick and the per-block round trips that follow take seconds, so a desk staffed inside that window still carries `desk_covered = false` here. The authoritative re-check happens at the securing step, inside `lock_block_coverage` under a row lock (§4.2, concurrency audit F4); this scan only decides which blocks are worth looking at.

---

## 17. House Memberships and Transfers

Behavioral spec Section 21. Migrations 20260719000001 and 20260719000002.

House membership is **season-scoped**: `user_house_memberships` holds one date-spanned row per user with at most one open-ended row, and a trigger enforces non-overlap. `users.home_house_id` is a **maintained cache** of the row covering today.

That cache is the reason this change was cheap. Every existing current-season read path — float eligibility, the Harnwell training invariant, the live calendar, the roster, RLS — keeps reading the scalar and is **unchanged**. Only forward-looking surfaces look ahead, via `membership_house_for_date(user, date)` and `house_roster_as_of(house, date)`: the preference board resolves house as of the target period start, and the builder rosters (including the AI payload of §15) resolve as of the build week, which is what makes pre-building a transfer-in correct.

`transfer_worker(initiator, user, dest, effective_date, note)` is the entry point. Either the source or the destination house's HM/BM may call it, or an admin — deliberately **not** tightened to own-house-only, since a receiving manager completing an agreed move is the common case.

- `effective_date` NULL means the next season boundary; today means immediate.
- An **immediate** move flips `home_house_id` now, reopens the worker's future old-house seats (recurring via `permanent_drop_slot`, with a direct vacate fallback outside a school-year semester, where `permanent_drop_slot` raises `semester_boundary_not_found` — **that fallback is required, do not remove it**), and voids their live floats.
- A **future** move records only the membership. The hourly `apply-house-transfers` cron (`apply_due_house_transfers` → `apply_house_transfer`) applies it on the day, setting a local `app.house_transfer` flag so the `prevent_home_house_update_without_admin_override` trigger permits the cache write from cron, where `auth.role()` is not `service_role`.

Transfer **out** of Harnwell vacates those seats here, so hard invariant #1 holds with no new enforcement. Voiding floats is a sanctioned manual admin action like `fire_worker`, not automated revocation, so the no-takeback invariant is not violated.

---

## 18. Mobile Onboarding and Widgets

Behavioral spec Section 20. Both follow the Fruitties split: **shared pure logic in `commonMain`, native UI per platform.**

### 18.1 Android Navigation (Navigation 3)

The Android worker app navigates with **Navigation 3** (`androidx.navigation3` 1.1.4). `ui/navigation/ShiftDestination.kt` is a sealed `@Serializable` `NavKey` hierarchy — one `data object` per surface — replacing the nine `TAB_*` integer constants the screen carried before, whose "the constant must match the tab's render position" invariant no type could enforce. `ShiftNavigationState` (Google's multiple-back-stacks recipe) gives each destination its own back stack and `SaveableStateHolder`, so a surface keeps its `rememberSaveable` state while the worker is elsewhere; the Scaffold body is an `entryProvider` rendered by `NavDisplay`.

Every move — forward taps and the system back button — routes through `ShiftNavigator.navigate` / `goBack`. Back returns to the start destination (My Shifts) and is left unhandled there so the OS exits the app. Because both directions share the one entry point, the §4 unsaved-Preferences guard (`canLeave`) is applied once and now covers back as well as forward; previously it hung off the forward path only, so the system back button silently discarded edits. Routing and the guard are unit-tested off the composition (`ShiftNavigatorTest`, JVM-only); the real back button is exercised through the shell in `ShiftNavigationTest`.

This is Android-only. iOS (`ContentView.swift`) still uses its tab state with no back stack; the SwiftUI equivalent (a hoisted `NavigationStack` path) is a pending TODO, so only Android currently has back navigation (behavioral §20.4).

- `shared/.../onboarding/` holds the pure modules — the six per-surface tours (`ShiftTour`, `SwapTour`, `OpenClaimTour`, `HouseGridTour`, `PreferencesTour`, `BreakTour`) and `NotificationPriming` — each with no clock and no I/O: seen-keys are injected and every function is a deterministic transform, which is what makes them unit-testable on the JVM host. **The `Onboarding` module (the first-run coach-mark walkthrough of the bottom tabs and the six one-card contextual tips) and its `OnboardingViewModel` were DELETED 2026-08-03**, along with the Android `OnboardingOverlay` / `OnboardingAnchors` / `Modifier.onboardingAnchor` and the iOS `OnboardingObservable` / `OnboardingOverlayView` / `OnboardingAnchorKey` that rendered them, the bottom-bar anchor registrations on both platforms, and the "Replay app tour" Settings row. Behavioral §20.1 states why. Do not reintroduce a passive one-card teaching layer; a new surface that needs teaching gets an interactive tour or a knowledge-base guide.
- **Persistence is a platform concern** (SharedPreferences on Android, UserDefaults on iOS). These are per-device UX flags, **not server state**, and they must never become scheduling state.
- **Notification priming** is presentation only: the in-app ask never touches the OS permission on its own, so ignoring it leaves the system prompt unspent. Which notifications are mandatory is unchanged (§4.6, behavioral §10.1). **Reshaped 2026-08-03** from a blocking full-screen card fired once at the tail of first-run onboarding into three inline rows (behavioral §20.2). The shared `NotificationPriming` object now exposes the per-surface one-line copy, two predicates — `shouldShowStandingNudge(granted)` and `shouldShowContextualNudge(granted, alreadyAsked)` — and `confirmLabel(osCanPrompt)`; the old `shouldShowPrimer(tourDone, osCanPrompt, alreadyResponded)`, `TITLE`, `BODY` and `DISMISS` are gone, as is the single `notif.primer.responded` flag. The standing My-Shifts row is gated on `granted` ALONE: there is deliberately no dismiss or responded input, so the only thing that retires it is the worker turning alerts on. Each platform renders it as `NotificationNudgeRow` (Android `ui/onboarding/NotificationNudge.kt`, iOS `Onboarding.swift`), reading live authorization rather than a stored answer — Android via `NotificationManagerCompat.areNotificationsEnabled()`, iOS via `UNUserNotificationCenter.getNotificationSettings`, both re-read on every tab change so a grant made in system settings takes effect without a relaunch. When `osCanPrompt` is false (iOS status is not `.notDetermined`; Android has stopped surfacing `POST_NOTIFICATIONS`) the action deep-links to the app's notification settings instead of firing a request the OS would ignore — required, because a row that persists until granted is guaranteed to outlive the OS dialog. The two contextual rows are latched into their own boolean for the life of the success toast they ride, and their once-per-install flags (`notif.asked.claim` / `notif.asked.swap`) are burned the moment the row appears; deriving visibility from the flag instead would erase the row in the same frame it rendered.
- Each per-surface tour auto-starts the first time its host screen is reached, independent of whether that screen is reached via a tab-change or is the app's default landing tab — a screen that is the default landing surface (`ShiftTour` on My Shifts on iOS) needs its auto-start checked on initial appearance as well as on a subsequent tab change, since SwiftUI's `onChange` never fires for an unchanged initial value. **A behavioral prompt to add a home-screen widget after repeated opens (formerly documented here) was removed 2026-07-23** — it fired before the interactive tour on iOS's default tab and was superseded by the tours; see behavioral §20.3.
- Each tour owns an independent seen-key store, not a shared one: its shared `{Tour}` object defines a `DONE_KEY` string constant (e.g. `ShiftTour.DONE_KEY = "tour.myshifts.done"`), the corresponding `{Tour}ViewModel` holds it in an in-memory `seen: Set<String>` and adds `DONE_KEY` to it only when the tour finishes or is skipped, and each platform persists that set under its own storage key (Android `{Tour}Prefs` over `SharedPreferences`; iOS `{Tour}Observable` over `UserDefaults`), so persisting one tour's progress never clobbers another tour's.
- Auto-start is wired per platform, not inside the shared `{Tour}ViewModel`. On Android, `ShiftsScreen.kt` drives all six through one shared holder, `rememberTourHost` (`ui/onboarding/TourHost.kt`), which collapses the five effects each tour used to repeat (persist the seen-set, auto-start, raise the one-time pointer, fade it) into a single reusable unit configured by a per-tour `TourWiring`. `ShiftTour`, `PreferencesTour`, `HouseGridTour`, and `OpenClaimTour` each auto-start when their surface is the current navigation destination (keyed on the typed `ShiftDestination`, not an Int tab index — see Section 18.1); `BreakTour` instead auto-starts when the break state machine reaches its claim window; `SwapTour` auto-starts when the in-sheet manage-shift composer reaches its swap page. On iOS, the five tab-hosted tours are centralized in `ContentView.swift`'s `autoStartTourForCurrentTab()`, invoked from `.onAppear` (the initial landing — needed because the default tab never fires `.onChange(of: tab)`) and `.onChange(of: tab)` (subsequent tab switches); `SwapTour` is wired the same way as Android, off the manage-shift sheet's own page state.
- Tapping outside a tour step's highlighted content skips the whole tour through the same path as the Skip control (marking the done-key immediately), except on the step or steps that demonstrate a real drag gesture — the range-drag step shared by `ShiftTour`, `SwapTour`, and `OpenClaimTour`, the paint-drag step in `PreferencesTour`, and both drag steps in `BreakTour` — where a per-step `dismissible` flag disables the scrim's tap handler so a stray tap mid-drag cannot lose the worker's place; `HouseGridTour` has no drag step and is always dismissible by an outside tap. Once a tour first finishes, by any of completion, Skip, or an outside tap, a one-time pointer callout points at the surface's help control before auto-fading, gated on its own per-tour "pointer shown" flag kept separate from the done-key, so it fires exactly once regardless of which of the three ways the tour ended. Every tour also has its own "Replay" row in Settings, which re-opens it from step one without needing to clear the done-key.

Widgets are **read-only snapshots** written by the app: iOS WidgetKit (`iosApp/ShiftWidgets/` — an upcoming-shifts widget and a house-configurable open-shifts widget via an AppIntent, fed through an App Group) and Android Glance (`androidApp/.../widget/` — `ShiftWidget` + `WidgetSync`). A widget performs no writes; tapping deep-links into the app. Widget content may lag the app, and no behavior may depend on a widget existing.

Two gotchas that have bitten before: the iOS configurable widget requires code signing even on the simulator, and its AppIntent must live in the app target.

---

## 19. What Is Deliberately Not Documented Here

Plans and scoping documents under `docs/**` (`docs/desk-assistant/V1_SCOPE.md`, `BUILD_PLAN.md`, `INTAKE_PLAN.md`, `docs/operating-seasons/PLAN.md`, and the rest) are **working documents, not specification**. They record how something was built and what was considered; they are not authoritative about current behavior and may describe options that were never taken.

When a plan lands, its settled behavior is promoted into the behavioral spec and this document, and the plan becomes history. A feature described only in `docs/**` is an undocumented feature. See the spec-governance rule in AGENTS.md.

---

## 20. Read-Path and Delivery Cost Controls

Added 2026-07-26 from the usage audit in `audits/supabase-usage-waste-audit.md`. The rest of that work is documented where it belongs — the open-shifts horizons in Section 3 (the two-feeds passage), push retry and dead-lettering in Section 9.3, retention and swap-expiry ownership in Section 9.6, the orchestrator launch gate in Section 16.2. This section holds what has no other home.

### 20.1 InitPlan Hoisting in the Hot RLS Policies

Migration `20260726000002`. Measured as a real worker under RLS, `worker_my_shifts` returned 394 rows for **30,478 buffers and ~149 ms**, with the house-admin arm of the `shift_block_assignments` SELECT policy executing `loops=5261`.

The expense was packaging, not logic. Every arm of every OR-ed policy re-derived
`(COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''), (NULLIF(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'sub'))::uuid`
**per row** — a jsonb parse of the whole JWT claims blob, once per arm, on four permissive policies. `user_is_rsm(auth.uid())` is `SECURITY DEFINER` and was likewise called per row despite depending only on that same constant.

The rewrite wraps each in a scalar subselect the planner hoists into a one-shot InitPlan — `(SELECT auth.uid())`, `(SELECT user_is_rsm((SELECT auth.uid())))` — and turns the home-house `EXISTS` into a comparison against an InitPlan scalar (`users.user_id` is the primary key, so it yields at most one row; a NULL result is not-true, exactly as the `EXISTS` was). `user_can_build_schedule(uid, house_id)` stays correlated because its second argument genuinely varies per row. Result: **~5 ms, 19,223 buffers**, with visibility verified byte-identical across seven role archetypes on three tables.

**All four `shift_block_assignments` SELECT policies remain four separate policies.** The own-assignment arm (`user_id = auth.uid()`) is load-bearing for float-out and cross-house-pickup rows, which attach to blocks outside the worker's home house and would otherwise vanish from the personal calendar. Collapsing them looks like a performance win and is a data-visibility bug. Only the expressions changed.

The same rewrite is applied to `float_assignments` and `float_exclusions`, which carry the identical shape.

### 20.2 Orchestrator Discovery Queries

Migration `20260726000003`. `orchestrator-tick` was the one Edge Function with an N+1: it iterated **assignment rows**, not distinct blocks, and per row issued `loadProfileForBlock` (two queries, unmemoised) plus `loadStepStatus` (one) — three round trips per vacant seat per minute, before any step fired.

- **Profile memo.** `loadProfileForBlockCached` keys on the block's NY-local date. Every row in a 3h05m window resolves to one or two dates, so the memo is exact rather than approximate. It is created per tick and discarded with the response, so a config change takes effect on the next tick. It stores the _promise_, which also collapses concurrent lookups for the same date.
- **Batched step status.** `loadStepStatusForBlocks` reads the whole window in `.in()` chunks of 100 — the same chunking `loadCoveredBlockIds` uses, because a full window of block ids in one filter returns HTTP 414. A block absent from the batch means no step has fired, which is what the per-block query returned for it.
- **No-ack discovery.** `processNoAckFloats` selected **every** pending, unacknowledged, undeclined float with no time bound, issued one round trip per float to fetch its destination blocks, and only then applied the lookahead in TypeScript — the cheap filter paid for after a round trip each. (Its comment claimed to pre-filter by lookahead; the query did not.) It was also a seq scan every 60 seconds, since `float_assignments`' only index leads with `user_id`. `pending_floats_due_for_no_ack(now, lookahead)` does the join to `shift_blocks` in SQL and returns only floats whose earliest destination block is inside the window, served by the partial index `float_assignments_pending_unacked_idx`. `process_no_ack_float` is unchanged and still re-validates under `FOR UPDATE`, so no-takeback is untouched; only candidate discovery got cheaper.

Measured end to end against the local edge runtime: an idle tick over 70 vacant blocks went from **210+ DB round trips to 9**.

The float-lookup subsystem (gap builder, DB snapshot, pure-algorithm call, and the step itself, plus `loadCoveredBlockIds` and `lockBlockCoverage`) moved to `supabase/functions/orchestrator-tick/floatLookup.ts` in the same change — `index.ts` was 1,346 lines, more than twice the size ceiling. Nothing changed behaviour in the move.

### 20.3 Overlap Serialization

Migration `20260726000007`. `cron.schedule` does not prevent a second run starting while the first is going. For `orchestrator-tick` the cron row itself cannot overlap (`net.http_post` is fire-and-forget), but the Edge Function invocations it triggers can, and a tick is a second or more of DB time. Correctness never depended on this — `block_step_status` upserts and the `FOR UPDATE` RPCs make double-firing a step impossible — but **the cost was duplicated**: both ticks scan, both resolve profiles, both read step status.

Both the tick and `apply_compiled_season` now take a **non-blocking, transaction-scoped** advisory lock (`pg_try_advisory_xact_lock`). Non-blocking is the point: a blocking lock would queue runs behind each other and turn a slow minute into a growing backlog, whereas skipping is correct because the next tick is 60 seconds away and re-evaluates from scratch. Transaction-scoped means the lock cannot leak — a leaked lock held by a crashed Edge Function would silently stop all escalation.

`apply_compiled_season` is now a thin guarded front over `apply_compiled_season_unguarded`, so the invariant-bearing body (including the headcount-decrease cut order) was not retyped. The **dry run takes the lock too**: a preview is a rolled-back subtransaction doing the same work as an apply — that is deliberate, so preview and apply share identical logic — so an unguarded preview racing a real apply doubles the most expensive operation in the system. A blocked caller gets `{ok: false, error: 'apply_in_progress'}` rather than an exception, because nothing was attempted.

### 20.4 Knowledge-Base Embedding Cache

Migration `20260726000006`. The approve path re-embedded **all** chunks on every approval with no dedupe guard, so re-approving a document re-paid the full bill and two documents sharing boilerplate paid twice. `kb_embedding_cache` is keyed on `(sha256(content), model)`; embeddings are deterministic per (input, model), so a hit is byte-identical to what the API would return — this changes spend, never results. Keying on the model matters: a model swap must not serve old vectors to a new index. There is no expiry, because an entry cannot go stale. `embedMetrics` still reports only tokens **actually billed**, so a fully-cached run correctly reports $0 and per-feature cost attribution stays honest.

---

## Appendix A: Schema Summary Diagram

The full schema in conceptual form:

```
users ─┬─ user_roles
       ├─ home_house_id → houses   (CACHE of today's user_house_memberships row)
       ├─ user_house_memberships (date-spanned, non-overlapping; §17)
       ├─ broadcast_subscribed (bool; enforced false for hm/bm at write time)
       ├─ ack_cadence_config
       └─ hm_leave (as user or replacement)

houses ─┬─ shift_blocks ─── shift_block_assignments ──┬── user_id → users
        │      (voided_at, coverage_locked_at)         ├── parent_float_id → float_assignments
        │                                              └── source_house_id → houses
        ├─ staffing_patterns (per profile)
        ├─ float_routing (per profile, as source or dest)
        └─ launch_state / launched_at (§16.2)

operating_calendar ── profile_name → operating_profiles
                                       (escalation_chain, defaults, claim phase offsets)

operating_seasons ─┬─ season_house_windows (weekday_bands / weekend_bands jsonb)
                   ├─ season_float_windows
                   └─ operating_config_audit
        (authored by admin → compileSeason → apply_compiled_season → the 4 config layers above)

weekly_cap_overrides (per Monday-week)
hmod_rotor (per Friday-week) → users
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

── Desk Assistant + knowledge base (§13, §14); additive, no FK into the engine ──

kb_intake ──(approve)──▶ kb_documents ─── kb_chunks (pgvector 1024d)
   (status state machine)     (scope: house / sensitivity / roles;
                               temporality: durable | until_superseded | expires)

kb_incidents_raw          (access-controlled; NEVER indexed)
routing_rules             (issue_type × day × time window × season → tier, priority)
da_conversations ─── da_messages ── user_id → users
da_page_drafts ─── da_page_deliveries ── recipient → users
```

## Appendix B: Configuration Defaults at Launch

Initial values for system-wide configurable parameters (per behavioral spec Section 14):

| Parameter                                                 | Value                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| Broadcast offset                                          | -3h (before float start)                                       |
| Float lookup offset                                       | -2h (before float start)                                       |
| HMOD notify (on float failure) offset                     | -2h (before float start)                                       |
| Acknowledgment deadline                                   | -10m (before float start) — decoupled from float lookup        |
| No-ack trigger                                            | -5m (before acknowledgment deadline = -15m before float start) |
| Acknowledgment reminder #1 (HM/BM configurable per house) | -6h before acknowledgment deadline                             |
| Acknowledgment reminder #2 (HM/BM configurable per house) | -2h before acknowledgment deadline                             |
| Acknowledgment reminder #3 (mandatory)                    | -1h before acknowledgment deadline                             |
| Acknowledgment reminder #4 (mandatory)                    | -30m before acknowledgment deadline                            |
| Acknowledgment reminder #5 (mandatory)                    | -5m before acknowledgment deadline                             |
| Claim phase open offset                                   | -14d                                                           |
| Claim phase alert offset                                  | -3d                                                            |
| Claim phase close offset                                  | -1d                                                            |
| Drop horizon                                              | 30 days                                                        |
| Block granularity                                         | 30 minutes                                                     |
| Float assignment retention                                | 14 days post-shift end                                         |
| Shift swap expiry                                         | T-3h of earlier shift                                          |
| Float swap expiry                                         | 24h after float end                                            |
| Permanent swap expiry                                     | 7 days after creation                                          |
| Minimum float chunk size                                  | 1 block (30 minutes)                                           |
| Maximum Allied coverage per securing                      | 8 blocks (4 hours)                                             |
| HM working hours                                          | Mon-Fri 08:00 to 17:00                                         |
| HMOD rotor cadence                                        | Weekly, Friday 08:00 handoff                                   |

All values are stored in a `system_config` table (one row per parameter) and may be updated by the project administrator. The application layer reads these on a short cache cycle (~1 minute, matching the orchestrator).

### Keys governing Sections 13 through 18

| `system_config` key                | Default        | Effect when absent                                                                                                             |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `project_administrator_user_id`    | **unset**      | Terminal routing has no recipient; urgent notification is logged, not delivered. **Every deployed environment must set this.** |
| `smod_duty_phone`                  | unset          | The SMOD tier is named without a number. Never substituted.                                                                    |
| `csmod_duty_phone`                 | unset          | The CSMOD tier is named without a number. Never substituted.                                                                   |
| `staggered_launch_enabled`         | absent = false | Launch gate off; every house behaves as live (§16.2).                                                                          |
| `offhours_ladder_enabled`          | absent = false | Historical HMOD-direct off-hours routing (§16.1).                                                                              |
| `allied_page_rung_timeout_minutes` | 10             | Rung timeout for the off-hours ladder.                                                                                         |

Every one of these defaults to the **historical behavior** when absent. That is deliberate: `seed.sql` sets none of them, so no development environment or test run is affected by a feature that production has turned on, and a missing config row can never silently change staffing behavior.

### Keys added by the cost-audit remediation (2026-07-26)

| `system_config` key                      | Default | Effect when absent                                                                                 |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `max_notification_delivery_attempts`     | 12      | Falls back to 12. Attempts before a push is dead-lettered (§9.3).                                  |
| `notification_retry_backoff_cap_minutes` | 60      | Falls back to 60. Ceiling on the exponential retry interval (§9.3).                                |
| `operational_retention_days`             | 28      | Falls back to 28. Age past which terminal notifications and non-pending floats are deleted (§9.6). |
| `retention_delete_batch_size`            | 5000    | Falls back to 5000. Rows per delete statement in the retention sweep.                              |

**`allow_time_travel` is retired** (migration `20260805000001`, superseding `20260726000008` below it in this section's own history). There is no `system_config` key governing the simulated clock any more; the gate moved from the environment to the acting user's role.

`20260611000007_dev_sim_clock.sql` ships to every environment, and `app_now()` is where `orchestrator-tick` sources the entire tick's notion of "now" and where `apply_compiled_season` gates future-block reconciliation — so anything that can set the offset moves every escalation deadline at once, in whatever environment it runs in. The original guard (`20260726000008`) denied a non-zero offset in every environment unless `system_config('allow_time_travel') = 'true'`, on the theory that production must never time-travel, full stop. Product decision 2026-08-05 reversed that: the project administrator must be able to exercise the time-driven escalation chain against production too, once the app is live there, so an environment-wide deny is no longer the right shape. `enforce_time_travel_gate` (redefined by `20260805000001`) is still a `BEFORE INSERT OR UPDATE` trigger on `dev_sim_clock`, but it now rejects a non-zero offset unless `NEW.set_by` is a user holding the `admin` role (`user_is_admin`, migration `20260702000002`) — checked against WHO the app claims performed the write, not what key it used to perform it, so the guard holds even though the actual write goes through the service-role client (`setSimClock` / `clearSimClock` in `apps/web/lib/actions/devClock.ts`, which also check `isAdmin` themselves for a clean error message before ever reaching the database). Resetting the offset to **zero is always permitted**, gate or no gate, so no database can get stuck in a time-travelled state it cannot leave. The web UI additionally surfaces a client-side confirmation step before writing a non-zero offset (BSpec §14) — a caution the administrator can proceed past, not a second permission gate. `seed.sql`'s local admin user already holds the `admin` role, so no extra config row is needed to make the local time-travel harness work.

### Deploy-time secrets

| Secret                                      | Used by                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE_AI_CHATBOT_DESK_ASSISTANT`          | Assistant generation (`da-ask`); model from `DA_GENERATION_MODEL`, default `claude-sonnet-5`                                         |
| `CLAUDE_AI_CHATBOT_UPLOAD_CHUNKER`          | Knowledge intake normalization and PDF vision fallback                                                                               |
| `CLAUDE_AI_CHATBOT_PROPOSE`                 | Knowledge intake metadata proposal                                                                                                   |
| `CLAUDE_AI_CREATE_SCHEDULE_KEY`             | AI schedule agent (§15)                                                                                                              |
| `VOYAGE_API_KEY`                            | Embeddings (`voyage-3`, 1024-dim)                                                                                                    |
| `FIREBASE_SERVICE_ACCOUNT_JSON`             | Push delivery (`dispatch-push`, both FCM and APNs)                                                                                   |
| `app.supabase_url` / `app.service_role_key` | Resolved via `app_runtime_setting()` by every pg_cron job that calls an Edge Function (`orchestrator-tick`, `deliver-notifications`) |

One key per feature, with **no generic fallback**, so per-feature cost is attributable. Each client fails with a clear 503 when its key is absent rather than crashing.

**`app.supabase_url` / `app.service_role_key` live in Supabase Vault, not a Postgres GUC.**
Hosted Supabase grants no role permission to set a custom `app.*` parameter (`ALTER DATABASE
... SET app.supabase_url = ...` → `42501 permission denied`), so a GUC-only design is
inert-by-construction on every hosted project. `app_runtime_setting(p_name)` (migration
`20260727000002`) resolves Vault first and falls back to a GUC, which is what keeps the
local stack (which sets neither) and any future self-hosted environment (which still can
set a GUC) working unchanged. The function is `SECURITY DEFINER` and granted to **no
role** — not even `service_role` — because it returns the secret; pg_cron executes it as
the owning `postgres` role, so the cron works while nothing else can call it.

**Incident (found 2026-08-05, root-caused and fixed 2026-08-06): the orchestrator had
never once run against the hosted Shift project.** Two independent causes stacked:

1. `seed.sql`'s cron-teardown block (see the "LOCAL ONLY" guard, `supabase/seed.sql`) was
   replayed against the hosted project during an earlier data load, unscheduling all seven
   jobs registered by `20260727000001`. `net._http_response` was empty — the database had
   never made a single outbound HTTP call — which is how a `SELECT * FROM cron.job` check
   would still have reported the environment healthy (nothing to compare against). Fixed
   by gating the teardown on `app_runtime_setting('app.supabase_url')` resolving to a real
   value: if it does, this database is configured to run the jobs for real (hosted, or a
   local stack deliberately rehearsing hosted behavior) and the teardown is skipped with a
   `RAISE WARNING` instead of silently deleting the registration.
2. Independently, five Edge Functions (`orchestrator-tick`, `force-trigger`, `create-swap`,
   `permanent-drop`, `permanent-pickup`) reached `@shift/core` with a **dynamic** import of
   a path outside the function directory: `await import('../../../packages/core/dist/...')`.
   That resolves under `supabase start`, because the local edge runtime bind-mounts the
   literal specifiers it discovers at start time. It does **not** survive `supabase
functions deploy`: the deploy bundler follows only **static** relative imports, and
   `packages/core/dist` is both outside the bundled tree and gitignored, so the deploy
   reported success and shipped a bundle missing core entirely. Every invocation then died
   at runtime with `Module not found: file:///var/tmp/sb-compile-edge-runtime/packages/
core/dist/orchestrator/evaluate.js`. Confirmed against the deployed `orchestrator-tick`
   bundle: it contained only `index.ts` and `floatLookup.ts`.

The fix vendors the reachable subset of `@shift/core` into `supabase/functions/_shared/
core/`, **committed** (not gitignored — a gitignored build artifact that had to exist at
deploy time is exactly what caused this, so leaving the vendored copy gitignored would
rebuild the same trap), and imported **statically**. `scripts/vendor-core-into-functions.mjs`
discovers entrypoints from the function sources themselves, walks the transitive closure
over `packages/core/dist` (`.js` and `.d.ts` together), fails loudly if the closure ever
reaches a bare specifier Deno cannot resolve (core's only runtime dependency,
`date-fns-tz`, is not reachable from any of the six entrypoints today), and — critically —
also fails if any file **uses** a `_shared/core` import alias without importing it in that
file. That second check exists because the first deploy attempt fixed the entrypoint files
but dropped one import line in a concurrent edit, which passed every check that verifies
imports that _exist_ resolve, and would have shipped the exact same "Module not found"
failure one function deeper. `pnpm vendor:core:check` runs in CI before lint; see
`supabase/functions/README.md` for the full mechanism. `supabase/AGENTS.md`'s "Required
deploy configuration" list was updated to name Vault as the delivery mechanism.

---

## Appendix C: Confirmed Decisions Captured in v2

Mirrors Appendix A of the Behavioral Specification:

1. Force-trigger source-side gap enters the open-shifts feed immediately (Section 4.5, 6.3).
2. Decline (or T-5 no-show) voids the float and re-opens the gap to standard escalation; no immediate cascade. Declining worker excluded from re-consideration via per-gap exclusion list (Section 4.4).
3. Acknowledgment reminders anchor to the **acknowledgment deadline**, not to the float start time. **[Errata]** Originally written "T-2h deadline"; the canonical deadline (§4.4 "no-ack trigger", and the implementation) is **T-10m before float start** (no-ack trigger fires at T-15m, i.e. 5m before the T-10m deadline).
4. Global weekly cap modification authority restricted to HM/BM, instant, no approval workflow (Section 2.5).
5. Permanent swap accept-reject flow is in-app, with 7-day expiry. SM is not the executor; the two affected workers approve directly (Section 3.5).
6. Float assignment auto-deletion after 14 days. The calendar (via `shift_block_assignments` with `is_float` and `source_house_id` retained) preserves the operationally-relevant float-shift record (Section 3.4, 9.6).
7. HMOD rotor stored as a dedicated table keyed by Friday-of-week (Friday 08:00 duty-week start; Section 2.6).
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
7. **Notifications:** The worker-facing `sw_permanent_removal_alert` carries the in-app passive removal indicator, persistent in the updates tab via the `acknowledged_at` field (Section 3.7). The companion `sm_permanent_drop_alert` type is retired (2026-07-13, enum value kept but unused): SMs receive no passive permanent-drop alert.
8. **No published-schedule snapshot:** The calendar's current state is the only state. No historical record of "this slot was originally Alice's" is retained beyond the live owner.
9. **Profile boundary:** Permanent vacancies that go unfilled simply cease to exist at the end of the operating profile. The next profile is scheduled fresh (Section 7.4).

---

## 21. Swap Liveness, Mandatory Swap Notifications, and Confirmed Writes

Added 2026-07-28 from pilot testing. Migration `20260728000001`.

### 21.1 Why Swaps Were Invisible

Three independent gaps compounded into "a swap request does not show up, and a decline
never reaches the other person":

1. **`swap_requests` was not in the `supabase_realtime` publication.** The only channel the
   worker app held was `shift_block_assignments`. Creating, accepting, declining,
   cancelling or expiring a swap touches `swap_requests` and (except on acceptance) no
   assignment row at all, so nothing on either client could hear any of it.
2. **The clients read swaps behind a key derived from the viewing worker's own actions.**
   Android used a `produceState` keyed on local action counters; iOS used a one-shot fetch
   behind a `!live` guard. Either way, a request somebody else sent was picked up only when
   an unrelated seat change happened to re-run the read.
3. **No swap produced a worker-facing notification.** The only `swap_request` notification
   in the system was the manager-facing corrected-float alert inside `accept_swap`. The two
   people in the exchange were told nothing.

### 21.2 The Mechanism

**Realtime.** `swap_requests` joins the publication with `REPLICA IDENTITY FULL`. FULL is
required rather than optional: Realtime RLS-checks each change against the row it ships,
and on an UPDATE (`pending` to `rejected`) the default identity carries only the primary
key, so neither party's own-row policy would match and the decline would be dropped.

**Notifications are a TRIGGER, not per-caller inserts.** `notify_swap_request_parties()`
fires `AFTER INSERT OR UPDATE OF status ON swap_requests`. Six callers move a swap through
its lifecycle (`create-swap`, `accept-swap` via `accept_swap` / `apply_permanent_swap`,
`reject-swap`, `void-swap`, the expiry cron, and `void_pending_swaps_for_vacated_seat`),
so a trigger is the only place the rule can be stated once. The actor is `auth.uid()`,
which is NULL under cron and service-role cascades: that is exactly the distinction the
`voided` branch needs, telling "the other party cancelled" apart from "the system withdrew
it". Copy is built from `format_swap_span(uuid[])`, which renders a side's NY-local span
(blocks are 30 minutes, so a side's end is `max(block_start_at) + 30 minutes`).

The trigger never consults `notification_preferences`. A swap request requires an answer,
so it is not an opt-out channel (BSpec §10.1a).

**Client.** `SwapActivityRepository` (mobile `commonMain`) holds ONE shared channel over
`swap_requests` **and** `notifications`, debounced 500 ms and conflated, fanned out to
every collector — the same sharing the worker-week flow uses, so an iOS client with two
collectors does not open two connections. It was extracted out of
`WorkerShiftsRepository`, which AGENTS.md quarantines as a God class. An edge-triggered
`refresh` signal is merged in alongside Realtime, because an accepted swap moves seats
between two people and one side's rows leave their RLS scope, where `postgres_changes`
reports nothing at all.

### 21.3 Configurable vs Mandatory Notifications

`notification_preferences` (`user_id` PK, `open_shifts_home_house` default true,
`open_shifts_other_houses` default false) stores the ONLY two configurable channels, and
stores nothing else on purpose: adding a mandatory notification can never accidentally
become opt-out-able because there is no column for it.

Read it through `wants_open_shift_notification(user_id, house_id)`, never the raw table, so
"never opened Settings" and "explicitly kept the defaults" behave identically. Write it
through `set_notification_preferences(boolean, boolean)`, which targets `auth.uid()` and
takes no user_id, so a client cannot aim it at somebody else.

`process_broadcast_step` was rewritten to consult it. Previously the shift-opened
notification rode on `users.broadcast_subscribed`, which defaults to FALSE and is presented
in Settings as an unrelated "General updates" switch, so in practice nobody was told a
shift had opened. The recipient set now mirrors `worker_open_shifts` eligibility exactly
(active, holds `sw`/`sm`/`hm`, not a `bm`) plus the Harnwell training invariant, because a
notification about a seat the worker cannot claim is worse than no notification. The
Kotlin defaults in `settings/NotificationPreferences` mirror the column defaults and the
function; **if you change one, change all three.**

### 21.3a The Instant Shift-Opened Notification

_(Added 2026-07-29, migrations `20260729000012` + `20260729000013`.)_

`notify_shift_opened(house_id, block_id, start_at, end_at, actor_user_id, now, recurring)`
emits ONE `shift_opened` notification per dropped SPAN. It is called by `drop_shift` and by
`permanent_drop_slot`, both already `SECURITY DEFINER`, so no client holds EXECUTE on it.

Three things about the design are load-bearing:

**One row per span, not per block.** A four-hour drop vacates eight `shift_block_assignments`
rows. Eight pushes for one human event is how a worker mutes the app at the OS level, which
would silently take the mandatory float-acknowledgment pushes down with it, since they share
the channel. The span's start and end ride in the payload instead.

**The recipient predicate is `home_house_id = p_house_id OR wants_open_shift_notification(...)`.**
The left side is what makes the home house mandatory: it short-circuits before the preference
is ever read. The right side, for a non-home house, resolves to `open_shifts_other_houses`
(default false). This is the ONLY place the two channels diverge from
`process_broadcast_step`, which consults the preference for both houses. `open_shifts_home_house`
therefore now governs the T-3h broadcast alone.

**The Harnwell guard sits ABOVE the opt-in**, as a separate `AND`. An opted-in non-Harnwell
worker must never be told about a Harnwell seat (hard invariant #1), and ordering it as part
of the preference clause would let the opt-in override it.

`drop_shift` calls it AFTER the compare-and-swap vacate, so a losing racer, which raises and
rolls back, cannot announce a seat it did not vacate. It skips the call when the block carries
`coverage_locked_at` (§5.5): that seat is not claimable and the copy says "Open the app to
claim it." `permanent_drop_slot` captures the earliest affected occurrence BEFORE its `UPDATE`,
while the rows still carry the dropping worker's `user_id`; that capture query mirrors the
`UPDATE`'s predicate exactly, including the `operating_profiles.scheduling_mode = 'sm_built'`
break exclusion, and **the two must be changed together** or the notification will describe a
different slot than the one vacated.

Payload copy (`title` / `body`) is composed in SQL and read verbatim by both clients through
`pushDisplayFromData` and the Updates feed, so the notification needs no client release to
render. Float-out seat reopening and admin removal deliberately do NOT call this; they still
rely on the feed plus the T-3h broadcast.

**The in-app toast was dead code until the same date.** `observeNotifications` streams
realtime INSERTs on `notifications` and mapped each record with a function that read
`row["title"]`. That is not a column: the row is `notification_id / recipient_user_id / type
/ delivered_at / scheduled_for / payload / acknowledged_at`, and every producer writes its
copy inside `payload`. The mapping returned null for every notification ever sent, so the
foreground toast never fired once on either platform. It now reads `payload` first, keeping
the top-level lookup as a fallback, and moved out of `WorkerShiftsRepository` (AGENTS §5.2
quarantine) into the pure `notifications/ToastNotification.kt`, where `ToastNotificationTest`
covers it.

### 21.4 Pending Swaps on the Live Calendars

`pending_swap_seat_marks` is one row per SEAT held in a pending, unexpired swap, resolving
both sides through `unnest`, so BOTH shifts in an exchange are labelled. It carries both
parties, both spans, and which side the seat is. Owner-rights, mirroring
`house_schedule_grid_any`: the grid already shows every occupant's name to any
authenticated worker, and a swap mark names the same two people.

Web reads it in `getHouseCalendar` keyed by `assignment_id`, chunked by
`selectByAssignmentIdChunks` for the same reason block ids are chunked (a week's ids in one
`.in(...)` is a 414 that silently returns zero rows).

### 21.5 Confirmed Writes Replace Optimistic Ones

Claim, drop and swap were optimistic: the ViewModel moved the card on tap and a failure was
walked back afterwards. `claim-shift` is one POST per 30-minute block and each landed block
emits a Realtime event that refetches the week, so a four-hour claim rendered as a card
that visibly assembled itself under an already-shown success toast.

The replacement is a pure projection plus a store:

- `shifts/PendingWrites.kt` (pure): `pendingAwareMyShifts` / `pendingAwareOpenShifts`
  project a snapshot through the in-flight set. A claim's tapped card is held WHOLE from
  `PendingWrite.card` while its blocks are consumed, and the half-written rows the read
  models emit meanwhile are hidden. A drop or swap leaves the shift in place, flagged busy.
- `data/PendingWriteStore` (state): session-scoped on purpose. Both platforms rebuild their
  ViewModels from each snapshot, so a store inside one would be destroyed by the very
  Realtime event the write causes.

`busyKind` lives on `MyShift` / `OpenShift` in `model/` rather than in `shifts/` so both can
name it without a package cycle, and it is part of both coalescing merge keys: a busy half
of a run must not merge into its settled neighbour. It is NEVER set from a read model.

The original optimistic movers (`claim`, `drop`, `dropToOpen`, `dropBlocks`, `reclaim`,
`SwapsViewModel.addOutgoing`) survive for the demo/tour build, which has no server to
confirm anything. The live hosts no longer call them.

### 21.6 Shift Reminders

Added 2026-07-28. Migrations `20260728000002` (the enum label, alone in its own file
because a new label cannot be used in the transaction that adds it) and `20260728000003`.

**This channel did not exist.** The Settings screen had listed "Shift reminders, always on
(before each shift)" since the screen was built, and nothing ever sent one: no
`notification_type`, no producer, no cron, no storage. `ack_reminder` is the float
acknowledgment reminder and is unrelated.

**Per shift, not per block.** `worker_shift_runs(from, to)` coalesces each worker's
contiguous same-house seats into runs, using a window function over `block_start_at` with
adjacency tested as `previous + 30 minutes = current` (instant arithmetic, so a run across
a DST transition stays one run). Without this, a four-hour shift would produce eight
notifications per lead time.

**Enqueue, do not send.** `enqueue_shift_reminders()` inserts each reminder with
`scheduled_for = run start - lead time` and the existing `deliver-notifications` cron fires
it at that moment. So the producer runs hourly (`shift-reminders`, `5 * * * *`) and a
30-minute reminder still lands on time. Idempotency is `shift_reminder_sends`, keyed
`(user_id, first_assignment_id, offset_minutes)` and mirroring `preference_reminder_sends`
down to pre-allocating the `notification_id`.

**Re-checked at send time.** `pending_notification_deliveries` gained a second suppression
arm alongside the ack-reminder one: a `shift_reminder` is withheld when the recipient no
longer holds that seat in `{scheduled, claimed, floated_in}`. A reminder is queued up to
eight days ahead, and in between the worker may drop it, swap it away, or have it cancelled
by a config change. The queued row is a statement about the past.

**Storage and defaults.** `notification_preferences.shift_reminder_offsets integer[]`,
default `{60}`, constrained to a duplicate-free subset of `{120, 60, 30}` via the IMMUTABLE
`is_valid_shift_reminder_offsets` (a CHECK constraint may not contain the subquery the
de-duplication test needs). Empty is a real value meaning "no reminders", which is why the
column is NOT NULL rather than nullable. Read through `worker_shift_reminder_offsets()`,
never raw. `set_notification_preferences` gained a third parameter where NULL means
"leave unchanged" and an empty array means "none" — the client always sends it explicitly,
because omitting it would make turning every reminder off impossible.

The default exists in three places that must agree: the column default, the
`worker_shift_reminder_offsets` fallback, and Kotlin's `NotificationPreferences`.

---

## 22. Worker Sign-In and the Mobile Auth Gateway

Added 2026-07-31, documenting a surface that shipped undescribed and revising its failure
handling (BSpec §23). No migration: this is entirely client-side over GoTrue.

### 22.1 The Split

Sign-in follows the same pure-logic/adapter split as the rest of `apps/mobile`:

- **`shared/.../auth/`** — pure, no I/O. `LoginReducer` is a total function of
  `(LoginUiState, LoginEvent)` over four phases (EDITING, SUBMITTING, AUTHENTICATED,
  ERROR); `LoginFormValidator` does field validation; `AuthGateway` is the interface the
  reducer's hosts call. Covered by `LoginReducerTest` / `LoginFormValidatorTest`.
- **`shared/.../data/SupabaseAuthGateway`** — the adapter over supabase-kt 3.1.1 Auth.
  Part of the data layer the unit suite scopes out; verified against a running backend.
- **The two hosts** — Android `LoginHost` + `LoginRoute` (Compose), iOS `LoginObservable`
  (SwiftUI). Each owns the in-flight call and feeds results back through the reducer.

There is no SSO flow. `signInWith(Email)` posts to GoTrue's `token?grant_type=password`;
there is no provider redirect and no passkey anywhere in the stack.

### 22.2 Every Path Out of `signIn` Terminates

This is the invariant the 2026-07-31 change added, and the one not to break.

`AuthError` has four buckets — `INVALID_CREDENTIALS`, `NETWORK`, `TIMEOUT`, `UNKNOWN` —
and the gateway maps to them in a **fixed catch order**:

1. `TimeoutCancellationException` → `TIMEOUT`. The outer `withTimeout(SIGN_IN_TIMEOUT)`.
2. `CancellationException` → **rethrown**. Must come before the `Throwable` arm, which
   would otherwise swallow it. Swallowing cancellation reports a bogus failure for a
   deliberate user action _and_ leaves the caller running inside a cancelled coroutine.
3. `HttpRequestTimeoutException` → `TIMEOUT`. supabase-kt's own per-request bound.
4. `IOException` → `NETWORK`. Catches supabase-kt's `HttpRequestException`, which extends
   `kotlinx.io.IOException` — connectivity failures arrive as that, not as a raw socket
   exception.
5. `RestException` → 400/401/403/422 to `INVALID_CREDENTIALS`, anything else `UNKNOWN`.
6. `Throwable` → `UNKNOWN`.

**`SIGN_IN_TIMEOUT` is 15 seconds** and is the outer backstop, deliberately wider than
supabase-kt's 10s `requestTimeout` so a genuine HTTP timeout still reports with its own
cause and this only fires when something _outside_ the request stalls. supabase-kt's
timeout covers only the POST; session persistence, the `sessionStatus` update, and
engine-level DNS sit outside it. Without the outer bound a stall leaves the reducer in
SUBMITTING forever, which is a dead end because SUBMITTING honours no other event.

Do not remove the bound on the grounds that the HTTP layer already has one. They cover
different spans, and the screen's only escape from SUBMITTING is a result or a cancel.

### 22.3 Cancellation

`LoginEvent.CancelRequested` is the one event SUBMITTING honours; it returns the machine to
EDITING with the credentials intact and no error set. The state change alone is not enough
— each host also tears down the in-flight call: Android holds the `submitJob` and cancels
it in `LoginHost.onEvent`; iOS holds `signInTask` and cancels it in `LoginObservable.cancel`.

**Late results are dropped structurally, not by a flag.** `AuthSucceeded` and `AuthFailed`
are honoured only from SUBMITTING, and a cancel has already left it, so a response landing
afterwards cannot sign the worker in or raise a stale banner. iOS reimplements the host in
Swift and so re-states the same rule as an explicit `guard !Task.isCancelled, submitting`
before it touches any published property.

`formErrorDetail` carries the raw diagnostic (HTTP status, exception class, the configured
URL) and is rendered **only** under `BuildConfig.DEBUG` / `#if DEBUG`. It is what
distinguishes a misconfigured `SUPABASE_URL` from a wrong password during development, and
it must never reach a release build — it contains the backend address.

### 22.4 The Post-Sign-In Home-House Gate Is Also Bounded

Added 2026-07-31. Sign-in succeeding is not the end of the wait: both hosts then resolve
the staggered-launch gate (§16) for the worker's home house before showing anything real,
behind the launch splash (Android: `MainActivity.LiveOrLoginRoot`'s `produceState<HomeHouseGate?>`,
which keeps `SplashOverlay` up while the value is null; iOS: `iOSApp.swift`'s equivalent
`gate` state). This used to be **three sequential Postgrest calls** (`fetchHomeHouseGate` in
`WorkerShiftsRepository`), each independently bounded only by supabase-kt's 10s HTTP
timeout and each `runCatching`-wrapped, so a slow or unreachable backend could strand the
splash for up to ~30s with nothing the worker could do about it — the same shape of failure
as the unbounded sign-in call in §22.2, just one screen later.

**`HomeHouseGateRepository`** (its own file, `shared/.../data/HomeHouseGateRepository.kt` —
extracted out of `WorkerShiftsRepository`, which AGENTS.md quarantines as a God class) fixes
both halves:

1. **Fewer round trips.** The `home_house_id` lookup and the house-name lookup are now ONE
   PostgREST call: `from("users").select("home_house_id,houses!inner(name)")`, an embedded
   join over the `users.home_house_id → houses.id` FK (own-row `users` RLS covers both
   sides of the join). Three sequential calls become two — the embedded read, then the
   `house_is_live` RPC, which still must run second because it needs the resolved house id.
2. **A hard bound.** The whole gate resolves inside `withTimeoutOrNull(HOME_HOUSE_GATE_TIMEOUT)`
   (8s, matching `WorkerBackend.BOOT_NETWORK_TIMEOUT`'s existing convention for a
   best-effort launch-time read). On expiry it resolves the same fail-open default every
   other step in the function already used — `HomeHouseGate(isLive = true, houseName =
"your house")` — so a stalled gate check degrades to "assume live" rather than an
   indefinite splash. Verified against a real Postgrest client pointed at a black-holed
   address: the call returns in ~8.0s with the fail-open result, not the ~20-30s the old
   three-call chain could take.

**What is still open.** The bound covers only the gate. After it resolves live, the app
still waits on the first worker-week emission with no bound and no cancel affordance
(`onWeekLoaded`/`onContentReady`). A slow backend can still produce a long wait at that
step; closing it is future work, not part of this change.

Launch-time session restore is separately bounded by `BOOT_NETWORK_TIMEOUT` (8s) in
`WorkerBackend`; on expiry `currentSession()` resolves to null and the app shows login
rather than stranding the splash.

## 23. Web Sign-In: Passwordless Email OTP

Added 2026-08-01 (Behavioral Spec §24). Mobile (§22 above) is unaffected by this section and
keeps password auth; only `apps/web` moved to passwordless in production.

**Mechanism.** Two GoTrue calls, both against the browser Supabase client
(`apps/web/lib/supabase/client.ts`):

- Request: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })`.
  `shouldCreateUser: false` is load-bearing — every real account is admin-provisioned into
  `auth.users` already (locally via `supabase/seed.sql`'s direct `crypt()` insert), so this
  flag is what turns an OTP request for an unrecognized email into a rejection instead of a
  silent self-registration.
- Verify: `supabase.auth.verifyOtp({ email, token, type: 'email' })`. `type: 'email'`
  verifies a bare token string (the typed 6 digits) — GoTrue issues the same underlying
  token whether the delivery channel is a code or a clickable link; the distinction is
  entirely in the email template (below), not the API.

Both calls are gated in `apps/web/app/login/page.tsx` behind `PASSWORDLESS_AUTH_ENABLED`
(`apps/web/lib/env.ts`), which renders `OtpLoginForm` in production and falls back to the
pre-existing `PasswordLoginForm` (`signInWithPassword`) otherwise. `apps/web/app/auth/forgot`
and `apps/web/app/auth/update-password` (the password-reset flow) redirect to `/login`
whenever the flag is on, since there is no password to reset there; both pages are otherwise
unchanged and still serve development.

**Email template.** GoTrue routes `signInWithOtp` mail through the `magic_link` template slot
regardless of code-vs-link delivery. `supabase/config.toml`'s
`[auth.email.template.magic_link]` override points at `supabase/templates/otp-login.html`,
which renders `{{ .Token }}` (the code) prominently and does not surface
`{{ .ConfirmationURL }}` as a clickable link — a link opened on a worker's phone would
authenticate the phone's browser, not the shared desk kiosk they are signing into.
`[auth.rate_limit] email_sent` is raised from GoTrue's default of 2/hour to 30/hour, since
every sign-in now sends an email rather than only occasional password resets.

**Deploy-time requirements** (mirrors the pattern in `supabase/AGENTS.md` "Required deploy
configuration" — every deployed environment must set these or behavior silently degrades):

- `NEXT_PUBLIC_AUTH_MODE=production` on the web deploy target only. Unset (or any other
  value) keeps password auth — this is the local/dev default and requires no configuration.
  Deliberately an environment variable, not a `system_config` row: it decides whether a
  password `<input>` exists in the rendered UI at all, and changing it must force a
  redeploy rather than being flippable by a runtime `UPDATE` (see Behavioral Spec §14).
- SMTP credentials for the production Supabase project's GoTrue (`[auth.email.smtp]` in
  `config.toml` is commented out; local dev relies on the bundled Inbucket catcher, port
  54324, instead of real SMTP).

**Deliberately not built in this change.** The production Supabase project's password auth
provider is not separately disabled at the dashboard/Management-API level — enforcement is
app-UI gating only for now (`signInWithPassword` would still technically succeed against a
seeded account if called directly). Mobile passwordless support (a parallel
`AppConfig.passwordlessAuthEnabled` flag feeding `SupabaseAuthGateway.kt`, mirroring the
existing `SUPABASE_ENV` build-flavor split) is scoped but not implemented.

**What did not change.** Role and scope resolution (`apps/web/lib/auth.ts`'s
`getSessionUser`) reads only the JWT's `sub` claim, so it is identical regardless of which
sign-in mode produced the session — this section adds no new authorization logic.

## 24. Harnwell Pilot: Manager-Directed Floating

Added 2026-08-01 (docs/harnwell-pilot/PLAN.md; behavior in BSpec §25). Mechanism for BSpec
§25's manager-directed float, plus the pilot-scope derivation and the Desk Assistant entry
point removal (BSpec §17).

### 24.1 No Pilot Flag

Neither pilot-scoped cut-down is config. `floatLookupStep` (`supabase/functions/
orchestrator-tick/floatLookup.ts`) calls the SQL function `count_live_houses()`
(`20260801000001_harnwell_pilot_scoping.sql`) immediately after the T-2h coverage lock and
short-circuits to `'no_float'` when it returns less than 2, so `block_step_status` and the
coverage lock are unaffected and broadcast/Allied escalation still fire normally.
`worker_open_shifts` gained a `house_is_live(sb.house_id)` predicate in its `vacant_seats`
CTE, matching the style already used by `orchestrator_vacant_seats` and
`worker_visible_houses`. Both derive from `houses.launch_state` / `house_is_live()`
(`20260712000001`), so launching a house is what widens the pilot; no separate flag exists to
forget.

### 24.2 Destination Blocks Are Minted On Demand

`shift_blocks.origin` (`'generated' | 'manual_float'`, default `'generated'`) marks a block
minted purely to host a manager-float destination seat. `mint_manual_float_blocks(house_id,
block_starts[])` is the single place that creates or reuses one: `INSERT ... ON CONFLICT
(house_id, block_start_at) DO NOTHING` against the existing `UNIQUE` constraint, then reuse
or create the block's single vacant seat (`required_headcount = 1`), refusing to mint into a
block that already exists with `origin = 'generated'` (a real staffed block). Because a
`manual_float` block always has exactly one seat, occupied by the float, it never enters
escalation or the open-shifts feed.

`reconcile_config_blocks` (the season-apply reconciler) gained an `AND sb.origin =
'generated'` predicate on its future-block scan, so a manually-minted destination — whose
house has no `staffing_patterns` row and would otherwise read a target headcount of zero —
is never voided out from under an in-progress float by an unrelated season apply. Publish
was checked and found not to be a threat: it only ever writes onto blocks that already exist
and guards on `voided_at IS NULL`, so it needs no equivalent guard.

`retire_manual_float_blocks(block_ids[])` is the unconditional inverse, used only by the edit
path (§24.4): it deletes a `manual_float` block regardless of occupancy — shrinking or
cancelling a float deliberately ends the block — relying on `shift_block_assignments.
block_id`'s `ON DELETE CASCADE` to remove the seat with it.

### 24.3 `manager_float_worker`

One SECURITY DEFINER transaction (`20260801000002_manager_directed_float.sql`):

1. Authorize the initiator via `user_can_build_schedule(initiator, 'harnwell')` — the same
   predicate the schedule builder and calendar override editor already use.
2. Reject Harnwell as a destination, and reject a worker whose `home_house_id <> 'harnwell'`
   — both re-checked server-side, never trusted from the client, per the existing
   never-trust-the-client convention for the Harnwell training and float-direction
   invariants.
3. Resolve the worker's existing `scheduled`/`claimed` Harnwell seats across the requested
   30-minute-aligned range into `source_assignment_ids`; if any block in the range is not
   currently held by that worker, abort.
4. Call `mint_manual_float_blocks` for the destination seats (§24.2).
5. Delegate everything else — TOCTOU-guarded destination/source validation, the seat writes,
   the source-seat reopen (§24.5), the ack-reminder snapshot, the personal notification — to
   the **existing, unmodified** `force_trigger_float` body
   (`20260623000002_float_source_seat_reopen.sql`), passing `initiated_by =
'force_triggered'` / `force_triggered_by` = the acting manager. This is a deliberate reuse:
   `force_trigger_float`'s existing schema CHECK and every downstream read path (notification
   payload shape, `block_step_status` pre-marks) keep working unmodified.

If `force_trigger_float` reports failure, `manager_float_worker` `RAISE EXCEPTION`s rather
than returning a soft failure, which rolls back the mint from step 4 alongside it — the "one
transaction" the plan calls for, achieved via Postgres's own rollback rather than manual
cleanup.

### 24.4 `manager_edit_float`

Takes the **desired final range**, not a delta — the server computes the diff against the
float's current destination blocks, so a client that raced a concurrent claim cannot
desynchronize. Diffing matches source and destination blocks **by time**
(`block_start_at`, same slot at different houses), not by array index, which is more robust
than relying on the two id arrays staying index-aligned.

- **Extend**: mint the additional destination seats, resolve the worker's Harnwell seats for
  the newly-added range (aborting if any is missing), write both sides to the float's
  in-progress ack state (`pending_float_in`/`pending_float_out` if still unacknowledged,
  `floated_in`/`floated_out` if already acknowledged), and call `reopen_float_source_seats`
  with only the newly-freed source ids — which is what fires the "shift opened" notification
  for exactly those blocks (§24.5), reusing the existing mechanism rather than adding a
  second one.
- **Shrink/cancel**: for each removed block, look for a gap seat `reopen_float_source_seats`
  may have created at that Harnwell block for this float. If it is still vacant, the worker's
  original source row resumes as `scheduled` and the gap seat is deleted. If a third worker
  has claimed it, the worker's original row goes to `vacant` / `vacancy_origin =
'displaced_decliner'` (visible again for pickup, per the claim-wins rule) rather than being
  silently deleted, and one span-collapsed notification is queued for the affected worker.
  The now-empty destination block is retired via `retire_manual_float_blocks`. Cancel is
  shrink applied to every remaining block; because `float_assignments` requires nonempty id
  arrays (an existing CHECK constraint), a full cancel sets `status = 'voided'` and leaves the
  arrays as the float's last live span — a historical record, the same convention
  `decline_float` and `process_no_ack_float` already use.

### 24.5 Directive Semantics: No Decline, No No-Acknowledgment Void

Two existing functions gained a scope to `initiated_by = 'automated'`, so a manager-directed
float is simply never selected by either:

- `pending_floats_due_for_no_ack` (the orchestrator's per-tick discovery query for the
  no-acknowledgment sweep) — a manager float is never discovered, so `process_no_ack_float`
  (unchanged) never runs against it, and by extension neither does the Allied escalation it
  would otherwise trigger.
- `decline_float` — returns `{declined: false, reason: 'directive_cannot_be_declined'}` for
  any `force_triggered` float rather than running its reconciliation body.

`reopen_float_source_seats` (the shared helper both `force_trigger_float` and
`process_float_lookup_assignment` call to reopen a floater's vacated Harnwell seat) now also
calls `notify_shift_opened` once per invocation — i.e. once per float, or once per edit's
newly-freed span — for the reopened block(s), span-collapsed exactly like `drop_shift`'s own
call site. `notify_shift_opened` already resolves recipients correctly (home-Harnwell only,
per the training invariant), so no new recipient logic was needed.

### 24.6 Swap Interaction

`swap_acceptance_ineligibility_reason`'s `block_in_pending_float` guard is scoped to
`fa.initiated_by = 'automated'` in its `EXISTS` clause (replacing the old unconditional
`status IN ('pending_float_in', 'pending_float_out')` check, which would otherwise have
blocked a pending manager float from ever being swapped, since force_trigger_float sets
those same statuses regardless of `initiated_by`). An automated float keeps the identical
protection it always had.

`accept_swap`'s float branch now loops per **distinct** `float_assignments` row the swap's
touched assignment ids overlap. When the touched destination ids equal the float's _entire_
`destination_assignment_ids`, the original single-row reassignment runs unchanged. When they
are a **strict subset**, the row splits:

1. Resolve the touched destination ids' corresponding source ids by time (same
   `block_start_at`, Harnwell side), and the remainder on both sides.
2. `INSERT` a new `float_assignments` row for the touched subset: `status = 'pending'`,
   `initiated_by`/`force_triggered_by` copied from the original row, fresh
   `acknowledged_at`/`declined_at`/`no_ack_at` (all `NULL`).
3. Repoint the touched seats' `parent_float_id` to the new row, and call
   `snapshot_float_ack_reminders` for it — the new floater's row starts unacknowledged with
   its own reminder cadence, per BSpec §25.5.
4. `UPDATE` the original row's arrays down to the remainder — it keeps its existing
   `user_id` and ack state untouched.

Everything else in `accept_swap` (the concurrency structure, the handoff branch, the
symmetric-swap seat transfer, the invalidation backstops) is unchanged from
`20260726000009`.

### 24.7 Web Surface

`floatWorker` and `editFloat` (`apps/web/lib/actions/override.ts`) are new server actions
alongside the existing `assignWorker`/`removeWorker`, sharing `authorizeForBlocks`'s
house-scoping. `ShiftOverrideEditor`'s action pill (`components/calendar/
ShiftOverrideEditor.tsx`) gained a third "Float" segment, shown only when the viewed house is
Harnwell and the seat is occupied, revealing a destination-house picker (Harnwell excluded)
in place of the worker-card list. The floaters view (BSpec §25.4) is a new route,
`app/(app)/floaters/`, reading through the service client (the same pattern SM builder
snapshots already use) rather than relying on `float_assignments`' destination-scoped RLS
policy, since a Harnwell manager needs visibility into floats going to _any_ destination
house.

### 24.8 Desk Assistant Entry-Point Removal

BSpec §17's status note. Every UI entry point (web nav, the worker-portal and kiosk desk
routes, the mobile Ask chip and screen on both platforms) was removed; the knowledge base,
the classification/answer pipeline, and every Edge Function behind it (`supabase/functions/
da-*`) are untouched. This is scoped as a permanent product removal rather than a
pilot-scoped one, so restoring it later is a UI-only change, not a backend rebuild.
