# Phase 11 — Test Plan: Claim-Based Scheduling for Breaks

This plan enumerates every test for phase-11, the spec section each test covers,
the function/RPC contracts the tests pin (TDD-first), and the ambiguities
surfaced and resolved before implementation.

Phase-11 is **claim-based scheduling for winter break and short breaks**
(BEHAVIORAL_SPECIFICATION.md §4.4). Unlike the regular school year (SM-built,
phase-04), breaks have **no SM-built schedule and no preference deadline**.
Instead the calendar opens a self-service claim picker for a bounded window, then
hands whatever is left to the ordinary open-shifts feed:

- **T-14d** — the system clears the calendar for the whole break period and
  highlights it; the calendar claim picker opens.
- **T-14d → T-1d** — workers claim shifts from the calendar picker, FCFS; a
  dropped break shift returns to the **calendar claim pool**, re-claimable.
- **T-3d** — workers who have claimed nothing and did not opt out of break hours
  are nagged.
- **T-1d (exact)** — the picker closes for the **whole break at once**; unclaimed
  shifts move to the **open-shifts feed**; from then a drop goes to the feed and
  the T-2h cutoff (§5.3) governs.

**The defining invariant of this phase: every offset anchors to
`break_periods.start_date` — a single value per break — NOT to each individual
date within the break** (BSpec §4.4; ARCH §2.9). A five-day Thanksgiving break
(Wed–Sun) opens its picker 14 days before the Wednesday and closes it at the
moment T-1d before the Wednesday; the picker closing affects all five dates
simultaneously. The offset _durations_ live on
`operating_profiles.claim_phase_{open,alert,close}_offset` (`-14 days`/`-3 days`/
`-1 day` for both `short_break` and `winter_break`); `break_periods.start_date`
provides the anchor.

The phase spans two behavioral surfaces:

| Surface                                                              | Lives in                                                                  | Tested with |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| Phase-boundary math + phase classification + nag set + cap-by-type   | `packages/core/src/break-claim` (PURE) — **TDD-red**                      | Vitest      |
| T-14d clearing, calendar-pool ↔ open-shifts-feed routing, FCFS claim | phase-11 migration RPCs + `weekly_open_shifts_feed` rewrite — **TDD-red** | pgTAP       |

**Architecture split (the phase-07 audit's C6a anti-drift rule, carried from
phase-08/09/10).** Pure decision surfaces in TypeScript; atomic execution and
phase-gated routing in SQL; no duplicated logic across the two.

- **Pure decision surfaces in TypeScript** — the three boundaries from
  `(start_date, offsets)`, which phase a `now` is in, whether the highlight is
  on, who to nag at T-3d, and which cap a break type carries. These run in the
  break-claim Edge Functions / orchestrator jobs; they have no DB-side twin.
- **DB-side state + routing in SQL** — the T-14d bulk-clear, the calendar-pool
  query, the FCFS calendar claim (race-safe `WHERE status='vacant'`, the Harnwell
  gate, the cap re-check), and the break-aware feed exclusion. The SQL
  `break_claim_phase` re-derives the boundaries the pure function computed — the
  same re-check discipline phase-10's RPC WHERE-clauses use against
  `scopePermanentDrop`.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §4.4 (claim-based scheduling — the full T-14d/T-3d/T-1d lifecycle; "All time
  offsets in this section … are measured from the **first day of the break
  period** … All dates within the break share these same phase boundaries"; the
  T-14d clear + highlight; FCFS; the calendar claim pool vs the open-shifts feed;
  the T-3d nag predicate; the EXACT-T-1d simultaneous close; drop destination
  before vs after T-1d; "break shifts do not appear in the open-shifts feed"
  during the claim phase; the strictly-enforced cap), §3.2 (winter break and
  short-break profiles — 40h hard for thanksgiving/fall/spring/winter, 20h soft
  for spring fling; only Harnwell operates in winter break), §3.4 (closed houses
  have no shifts; their workers cannot opt in elsewhere), §5.3 (the T-2h cutoff
  that governs the feed after the picker closes), §9.3 (the cap-modification
  mechanism and spring-fling distinction)
- `ARCHITECTURE.md`
  §2.9 (`break_periods` — `break_id`/`break_name`/`break_type`/`start_date`/
  `end_date`/`profile_name`; **start_date is the anchor**; the offset durations
  live on `operating_profiles`; `break_type` distinguishes the 20h-soft spring
  fling from the 40h-hard breaks), §2.11 step 7 (the claim-phase deadline lookup
  joins date → break_period by range)
- `AGENTS.md` — hard invariant #1 (Harnwell training — enforced at **every**
  assignment write point, the calendar claim included), #5 (30-minute blocks),
  #6 (timestamptz in America/New_York; **never** wall-clock arithmetic for a
  DST-crossing interval — the offsets are calendar days anchored to NY-local
  midnight, not 24h × N).

Test files:

- `packages/core/tests/phase-11/break-phase-timing.test.ts` — Vitest: the pure
  phase-boundary math (anchored to `start_date`; calendar-day → NY-local
  midnight; config-driven offsets; the DST edge), the half-open `[open, close)`
  phase classification, the T-14d highlight, the T-3d nag set, and the
  cap-by-break-type mapping. Imports `../../src/break-claim/index.js`, which does
  not exist yet → **TDD-red**. **30 cases.**
- `supabase/tests/phase-11-break-transitions.sql` — pgTAP: function existence,
  the start-anchored phase boundaries (incl. the half-open window and the DST
  edge), the anchored-to-start close (the last break day closes at the
  start-anchored T-1d), the T-14d clearing, the calendar-pool ↔ open-shifts-feed
  routing, FCFS + exact-T-1d-close rejection, the drop destination before vs
  after T-1d, the winter closed-house / Harnwell gate, and the cap-by-break-type
  (`effective_weekly_cap`). References functions the phase-11 migration has not
  yet added → **TDD-red**. **43 assertions.**

This plan does **not** add a `fixtures.ts` — the pure surface is small enough
that the one Vitest file holds its own builders inline (the phase-03 `time.test`
precedent), while it still imports the contract types from
`../../src/break-claim/types.js` so any drift surfaces as a TypeScript error (the
phase-06/07/08/09/10 discipline).

---

## The Function Contracts (TDD-first)

The implementation goes in `packages/core/src/break-claim/` and the phase-11
migration. Until they land, the test files that import/call them fail at the
first import line / first function call — the intended TDD-red state, identical
to phase-06/07/08/09/10.

### Pure decision surfaces

```ts
// packages/core/src/break-claim/types.ts
export type BreakType =
  | 'thanksgiving'
  | 'fall_break'
  | 'spring_break'
  | 'spring_fling'
  | 'winter_break'
  | 'other';

export interface BreakClaimOffsets {
  openOffsetDays: number; // 14
  alertOffsetDays: number; // 3
  closeOffsetDays: number; // 1
}
export interface BreakPeriodRef {
  breakType: BreakType;
  startDate: string; // YYYY-MM-DD, inclusive — THE anchor
  endDate: string; // YYYY-MM-DD, inclusive (never enters the timing math)
}
export interface BreakClaimPhaseInput {
  break: BreakPeriodRef;
  offsets?: BreakClaimOffsets; // default DEFAULT_BREAK_CLAIM_OFFSETS
}
export interface BreakClaimBoundaries {
  openAt: Date;
  alertAt: Date;
  closeAt: Date;
}
export type BreakClaimPhase = 'pre_open' | 'claim_window' | 'open_feed';
export interface BreakCap {
  capHours: number;
  capEnforcement: 'soft' | 'hard';
}
export interface BreakNagCandidate {
  userId: string;
  hasClaimedAnyShift: boolean;
  hasIndicatedZeroHours: boolean;
}

// packages/core/src/break-claim/index.ts
export const DEFAULT_BREAK_CLAIM_OFFSETS: BreakClaimOffsets = {
  openOffsetDays: 14,
  alertOffsetDays: 3,
  closeOffsetDays: 1,
};

export function computeBreakClaimBoundaries(input: BreakClaimPhaseInput): BreakClaimBoundaries;
//   each boundary = NY-LOCAL MIDNIGHT of (startDate − offsetDays), by CALENDAR-DAY
//   arithmetic on the date — NOT startDate-instant − offsetDays × 24h.

export function breakClaimPhaseAt(input: BreakClaimPhaseInput, now: Date): BreakClaimPhase;
//   pre_open: now < openAt ; claim_window: openAt ≤ now < closeAt ; open_feed: now ≥ closeAt.

export function isBreakHighlighted(input: BreakClaimPhaseInput, now: Date): boolean;
//   true iff now ≥ openAt (the field the calendar UI reads).

export function breakHoursCap(breakType: BreakType): BreakCap;
//   spring_fling | other → {20,'soft'} ; thanksgiving|fall_break|spring_break|winter_break → {40,'hard'}.

export function selectBreakClaimNagRecipients(candidates: BreakNagCandidate[]): string[];
//   userIds with !hasClaimedAnyShift && !hasIndicatedZeroHours, in input order.
```

All five functions are PURE: no I/O, no `Date.now()`, no DB. The break-claim
orchestrator jobs / Edge Functions snapshot the `break_periods` row + the profile
offsets and call them to decide which phase a moment is in, render the highlight,
pick the T-3d nag recipients, and select the cap. The DST-correct anchoring
(calendar-day → NY-local midnight) is the load-bearing detail — invariant #6.

### SQL contracts (documented here; implemented in the phase-11 migration)

```
-- Phase classification — re-derives the boundaries from break_periods.start_date
-- + operating_profiles.claim_phase_*_offset (anchored at NY-local midnight).
break_claim_phase(p_break_id uuid, p_as_of timestamptz) RETURNS text
  -- 'pre_open' | 'claim_window' | 'open_feed'; window is half-open [open, close).
break_is_highlighted(p_break_id uuid, p_as_of timestamptz) RETURNS boolean
  -- true iff p_as_of >= openAt (phase <> 'pre_open').

-- T-14d clearing — vacate the house's existing break assignments so the break
-- calendar is a clean claim pool. Idempotent.
open_break_claim_calendar(p_break_id uuid, p_house_id text) RETURNS integer
  -- For every shift_block_assignments row on a p_house_id block whose NY-date is
  -- in [start_date, end_date]: SET status='vacant', user_id=NULL,
  -- vacancy_origin='never_assigned', is_float=false, is_cross_house_pickup=false,
  -- source_house_id=NULL. RETURNS the count of rows that were previously NON-vacant.

-- The calendar picker pool — vacant break seats, surfaced ONLY during claim_window.
break_claim_calendar_pool(p_house_id text, p_as_of timestamptz) RETURNS SETOF shift_block_assignments
  -- vacant assignments on p_house_id break blocks whose break_claim_phase(.., p_as_of)
  -- = 'claim_window'. Empty during pre_open and open_feed (picker closed).

-- The FCFS calendar claim (the picker's submit).
claim_break_shift(p_assignment_id uuid, p_user_id uuid, p_as_of timestamptz) RETURNS uuid
  -- 1. resolve the block's break; if break_claim_phase <> 'claim_window'
  --    -> RAISE 'break_claim_window_closed' (covers BOTH pre_open and open_feed,
  --       incl. the EXACT-T-1d instant).
  -- 2. Harnwell precheck: block house='harnwell' ∧ claimer home <> 'harnwell'
  --    -> RAISE 'harnwell_training_required' (invariant #1).
  -- 3. time-conflict + hard-cap re-check (mirrors claim_open_shift; the cap is
  --    break-type-aware via effective_weekly_cap — hard 40 rejects, soft 20 warns).
  -- 4. UPDATE ... SET status='claimed', user_id=p_user_id, vacancy_origin='none'
  --    WHERE assignment_id=p_assignment_id AND status='vacant';
  --    if no row -> RAISE 'shift_unavailable' (FCFS loser).

-- Break-aware rewrite of the existing feed.
weekly_open_shifts_feed(p_house_id text, p_as_of timestamptz) RETURNS SETOF shift_block_assignments
  -- unchanged for non-break blocks; a break block is INCLUDED only when its
  -- break_claim_phase(.., p_as_of) = 'open_feed' (pre_open / claim_window break
  -- seats are EXCLUDED — §4.4 "break shifts do not appear in the open-shifts feed").
```

The drop destination needs **no new code**: `drop_shift` (phase-05) just vacates
the seat; whether it surfaces in the calendar pool or the open-shifts feed is
**derived** from `break_claim_phase` at read time — a shift dropped during the
window appears in the pool (phase=claim_window), one dropped after T-1d appears
in the feed (phase=open_feed). The single source of phase truth is
`break_claim_phase`; both the pool query and the feed exclusion consult it.

---

## Pinned Decisions

The spec leaves several implementation choices implicit. The decisions below are
pinned by the test suite — the implementation MUST match them, and any future
reinterpretation requires updating both the tests and this plan.

| #   | Topic                              | Decision                                                                                                                                                                                                                                                                       | Why                                                                                                                                                       |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anchor is `start_date`, one value  | All three boundaries derive from `break_periods.start_date`; the `end_date` never enters the timing math. A 1-day and a 5-day break with the same start share identical open/alert/close.                                                                                      | BSpec §4.4 ("measured from the first day … All dates within the break share these same phase boundaries"); ARCH §2.9.                                     |
| 2   | Calendar-day offsets, NY midnight  | Each boundary = NY-LOCAL MIDNIGHT of `(start_date − offsetDays)`, by calendar-day arithmetic on the date. NOT `start_instant − offsetDays × 24h` (which lands an hour early across a DST transition). A Saturday-start break offsets straight across weekends.                 | AGENTS invariant #6; BSpec §4.4 "calendar days." The spring-break-after-spring-forward case is the regression pin.                                        |
| 3   | Half-open window `[open, close)`   | `openAt` is INCLUSIVE (the picker opens at the T-14d instant → claim_window); `closeAt` is EXCLUSIVE (a claim submitted AT the T-1d instant is already `open_feed` → rejected). One ms before close is still claim_window.                                                     | BSpec §4.4 ("closes … at the moment T-1d … Any shifts still unclaimed at this moment enter the open-shifts feed").                                        |
| 4   | Three phases                       | `pre_open` (before T-14d) / `claim_window` (the picker is open) / `open_feed` (the picker is closed; feed governs). One enum across the pure and SQL surfaces.                                                                                                                 | BSpec §4.4 lifecycle.                                                                                                                                     |
| 5   | Highlight = `now ≥ openAt`         | The break is visually highlighted from the T-14d instant onward (through the window and after it closes). `isBreakHighlighted` is the field the UI reads; equivalent to `phase <> 'pre_open'`.                                                                                 | BSpec §4.4 ("visually highlighted … to signal the special period").                                                                                       |
| 6   | T-3d nag predicate                 | Nag a worker iff they have claimed NO shift AND have NOT affirmatively indicated zero hours. ≥1 claim → no nag; opted-out → no nag. Input order preserved.                                                                                                                     | BSpec §4.4 ("alerts workers who have not claimed any shifts and have not affirmatively indicated they want zero hours").                                  |
| 7   | Cap by `break_type`                | `thanksgiving`/`fall_break`/`spring_break`/`winter_break` → 40h HARD; `spring_fling` → 20h SOFT; `other` → 20h SOFT (matches the `effective_weekly_cap` batch_b classification, which treats any non-listed break day as soft).                                                | BSpec §3.2 / §9.3; ARCH §2.9 / §2.11 step 3; the DB twin is `effective_weekly_cap` (batch_b).                                                             |
| 8   | T-14d clearing semantics           | `open_break_claim_calendar` vacates every existing break assignment for the house → `vacant` / `never_assigned` (the calendar is wiped to a clean claim pool), clearing float/pickup fields. Returns the count of previously-NON-vacant rows cleared. Idempotent.              | BSpec §4.4 ("clears the calendar … Existing assignments for those dates are removed"). `never_assigned` keeps the `valid_vacancy_origin` CHECK satisfied. |
| 9   | Calendar pool ⟺ phase=claim_window | `break_claim_calendar_pool` surfaces a vacant break seat ONLY while its break is in `claim_window`; it is empty during `pre_open` (calendar not yet cleared) and `open_feed` (picker closed).                                                                                  | BSpec §4.4 (the picker is open T-14d→T-1d only).                                                                                                          |
| 10  | Feed excludes claim-phase breaks   | `weekly_open_shifts_feed` EXCLUDES a break seat unless its break is in `open_feed`; non-break seats are unaffected. After T-1d the unclaimed break seats appear in the feed and the T-2h cutoff (`is_assignment_claimable`) governs.                                           | BSpec §4.4 ("break shifts do not appear in the open-shifts feed … to avoid cluttering it"; "enter the open-shifts feed for normal processing").           |
| 11  | Calendar claim is FCFS + gated     | `claim_break_shift` succeeds only during `claim_window`; otherwise `break_claim_window_closed`. It claims via `WHERE status='vacant'`, so a second claimer of a just-claimed seat gets `shift_unavailable`. Harnwell training is enforced here (`harnwell_training_required`). | BSpec §4.4 ("first-come-first-served"); AGENTS invariant #1 ("under any mechanism"). Mirrors `claim_open_shift`.                                          |
| 12  | Drop destination is derived        | A dropped break seat is just `vacant` (via the unchanged `drop_shift`); the calendar pool / open-shifts feed routing is derived from `break_claim_phase` at read time — pool during the window, feed after T-1d. No special drop path.                                         | BSpec §4.4 (drop before T-1d → calendar pool; drop after → feed). Single phase source of truth (C6a anti-drift).                                          |
| 13  | Closed houses have no break seats  | In winter break, only Harnwell has break blocks; a closed house's calendar pool is therefore EMPTY. The Harnwell pool is populated and gated.                                                                                                                                  | BSpec §3.2 / §3.4 ("all houses other than Harnwell are completely inactive").                                                                             |

---

## Test File Coverage Map

### `break-phase-timing.test.ts` (Vitest) — TDD-red

| Surface                                                                                                                             | Cases | Pinned decisions |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------- |
| `computeBreakClaimBoundaries` — default 14/3/1; default-offsets value; start-only; config-driven; calendar-days (Saturday start)    | 5     | #1, #2           |
| DST — open anchors to (start − 14d) NY midnight, not start − 14×24h; close anchors to spring-forward-day midnight                   | 2     | #2               |
| `breakClaimPhaseAt` — before open; at open (inclusive); at alert; before close; at close (exclusive); after close; inside the break | 7     | #3, #4           |
| `isBreakHighlighted` — off before open; on at open; stays on through/after the window                                               | 3     | #5               |
| `selectBreakClaimNagRecipients` — the predicate; ≥1-claim never; opted-out never; order; empty                                      | 5     | #6               |
| `breakHoursCap` — 40-hard ×4 (thanksgiving/fall/spring/winter); spring_fling 20-soft; other 20-soft                                 | 6     | #7               |
| Purity — deterministic boundaries + no input mutation; deterministic phase                                                          | 2     | —                |

**Total: 30 cases.**

### `phase-11-break-transitions.sql` (pgTAP) — TDD-red

| Section / Surface                                                                                                                                                                                         | Assertions |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A. Function existence — `break_claim_phase`, `break_is_highlighted`, `open_break_claim_calendar`, `break_claim_calendar_pool`, `claim_break_shift`                                                        | 5          |
| B. Phase boundaries — pre_open before open; claim_window at open / at alert / 1s before close; open_feed at close; highlight off→on at open                                                               | 7          |
| D. DST — spring-break open anchors to NY-midnight of (start − 14d): pre_open 1s before, claim_window at open                                                                                              | 2          |
| E. T-14d clearing — tg1 scheduled before; clears 2; tg1 vacant / user NULL / never_assigned; tg2 vacant                                                                                                   | 6          |
| C. Anchored-to-start — a last-break-day claim is closed once the START-anchored T-1d passes; phase inside the break is open_feed                                                                          | 2          |
| F. Pool ↔ feed + FCFS — pool has tg3 / feed excludes tg3 / feed has reg1 (window); claim tg1 (claimed/owner) + second claim rejected; pool drops tg3 / feed gains tg3 (closed); exact-T-1d claim rejected | 10         |
| G. Drop destination — drop in window → pool yes / feed no; drop after close → pool no / feed yes                                                                                                          | 4          |
| H. Winter closed-house / Harnwell — house-05 pool empty; Harnwell pool populated; non-Harnwell claim rejected (`harnwell_training_required`)                                                              | 3          |
| I. Cap by break_type — Thanksgiving week 40/hard; spring-fling week 20/soft (`effective_weekly_cap`)                                                                                                      | 4          |

**Total: 43 assertions.**

---

## What This Phase Does NOT Cover

- **The break-claim Edge Functions' / orchestrator-jobs' HTTP & scheduling
  layer** — the cron that fires the T-14d clear, the T-3d nag delivery
  (push/email/SMS), the T-1d boundary job, request parsing, auth-token → user
  resolution, response shaping. This phase ends at the pure timing surface, the
  SQL state/routing contracts, and "the phase/pool/feed reflects the boundary."
  (The pure `breakClaimPhaseAt` is exactly what such a cron consults to decide
  whether a tick has crossed a boundary — the "exact midnight vs during the day"
  edge is subsumed by the boundary being a precise instant, tested in both
  suites.)
- **The block generator for break dates.** Both suites take the break blocks as
  given (the phase-03 calendar generator produces them from the break profile's
  `staffing_patterns`). Closed-house emptiness (§3.4) is exercised as "no
  Harnwell-only winter blocks for house-05," not as a generator test.
- **The cap RESOLUTION.** `effective_weekly_cap` (phase-05 / batch_b) already
  classifies break weeks by `break_type`; section I pins only that the resolution
  is break-type-aware (40-hard Thanksgiving vs 20-soft spring fling). How
  `claim_break_shift` CONSUMES the cap mirrors `claim_open_shift` (hard rejects,
  soft warns) and is not re-derived. The §9.3 manual `weekly_cap_overrides`
  mechanism is phase-05/batch_b, unchanged.
- **The "zero hours" opt-out storage.** §4.4 references workers who "affirmatively
  indicated they want zero hours for the break," but the spec does not pin WHERE
  that flag lives for a claim-based break (preference submission is regular-year
  only, §4.1). `selectBreakClaimNagRecipients` takes the resolved boolean
  (`hasIndicatedZeroHours`) as input; the opt-out UI/storage is a TODO for the
  implementation phase (flagged in AGENTS phase notes) and is out of scope here.
- **Float / escalation during breaks.** Short breaks permit floating and run the
  T-3h/T-2h escalation chain; winter break runs broadcast + HMOD-for-Allied with
  no float step (§3.2). Those are the phase-06/07 float-lookup and escalation
  machinery, unchanged — this phase covers only the claim lifecycle, not the
  day-of coverage chain.
- **The open-shifts feed after T-1d.** Once a break seat is in `open_feed`, the
  standard phase-05 claim (`claim_open_shift`, with its T-2h cutoff) and phase-07
  escalation apply unchanged; this phase pins only that the seat ROUTES into the
  feed at the start-anchored T-1d, not the feed's internal mechanics.

---

## Why TDD-Red (and how the contracts were validated)

Phase-06/07/08/09/10 established the TDD-red pattern: tests import a
not-yet-existing module path / call a not-yet-existing RPC and fail; the
implementation lands in a follow-up commit and turns them green. Phase-11 follows
it for both surfaces:

- `break-phase-timing.test.ts` imports `../../src/break-claim/index.js`, which
  does not exist yet → red at the import line.
- `phase-11-break-transitions.sql` calls `break_claim_phase` /
  `break_claim_calendar_pool` / `claim_break_shift` etc., which the phase-11
  migration has not yet added → red (the `has_function` checks fail; the first
  call of a missing function aborts the run, exactly as phase-10's pgTAP does on
  its missing RPCs).

The contracts in this plan were verified implementable and the expected values
verified correct against the live local schema:

- A scratch `packages/core/src/break-claim/` matching the pinned decisions turned
  all 30 Vitest cases green and type-checked clean against the workspace's strict
  config (`noUncheckedIndexedAccess`), then was removed so the deliverable
  remains tests-only — the same dry-run the phase-10 plan describes.
- The pgTAP fixtures were validated against the live local database: every INSERT
  succeeds; `break_periods_no_overlap` accepts the four disjoint breaks; the
  boundary anchors compute to `2026-11-11 00:00 EST` / `2026-11-24 00:00 EST`
  (Thanksgiving open/close) and `2026-02-23 00:00 EST` (spring-break open, the
  DST pin); `effective_weekly_cap` returns 40/hard for the Thanksgiving week and
  20/soft for the spring-fling week; the day-of-week sanity holds (Nov 25 = Wed,
  Nov 28 / Nov 14 = Sat, Apr 13 = Mon); and the suite runs red on the missing
  functions exactly as intended.
