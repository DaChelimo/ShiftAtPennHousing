# Break Redesign — PLAN

Rebuild the worker break experience from a **flat list of collapsed "break shift cards"**
into a **draggable, spatial calendar** (the House Schedule layout, scoped to the break),
where round 1 = FCFS calendar claiming and round 2 = leftovers fall into the regular
Open-Shifts feed.

Run as **plan-as-artifact** (mirrors `docs/web-remediation/` and `docs/parity/`).
See [STATUS.md](STATUS.md) for the live tracker.

> Source-of-truth hierarchy unchanged: BEHAVIORAL*SPECIFICATION.md → ARCHITECTURE.md →
> AGENTS.md → test names. This doc is the \_execution* plan.

---

## Why

Spec §4.4 + migration `20260531000002` already define the model the user wants:
`pre_open → claim_window (T-14d→T-1d, FCFS) → open_feed (T-1d onward)`, and
`weekly_open_shifts_feed` **already** folds unclaimed break seats into the regular feed at
T-1d. So "round 2 = regular open shifts" is **already wired server-side**.

The gap is presentation. Today the worker sees [BreakClaimScreen.kt](../../apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/BreakClaimScreen.kt)
— a flat `LazyColumn` of break-shift cards. Time-of-day is collapsed; you cannot reason
about "what hours on which day." The user wants the **House Schedule calendar** look
(single-staff split / multi-staff lanes, vertical time, day columns) with vacant coverage
made **drag-to-claim** during the window, read-only after.

## The unifying insight

**Break calendar = `house_schedule_grid` scoped to the break date range, with vacant
capacity drag-claimable during `claim_window`.** The grid view (migration
`20260612000001`) already returns vacant + occupied seats per 30-min block with worker
name/phone, RLS-scoped to the caller's home house. The block generator pre-creates
`required_headcount` assignment rows per block, so per-block capacity = grid-row count at
that time, and filled = non-vacant rows. No new read model is required — only an additive
column or two.

## Decisions (locked with the user 2026-06-15)

1. **Free-form drag claiming.** Worker drags any 30-min-aligned time range on an open day;
   the system claims one unit of coverage per block. Reuses the existing partial-claim
   planner + the headcount trigger guards (over-staffing already impossible at the DB).
2. **System-assigned lane.** The worker picks a _time range_, never a desk. Per block the
   system fills any open seat. **FCFS conflicts trim the range to the still-open part and
   report it** (e.g. "Claimed 4:00–6:00; 6:00–8:00 was already full"). _This trim/coverage
   behavior is the heart of B2 and the main thing the pure tests cover._
3. **Dedicated Break screen, rebuilt as a calendar.** Keep the Break entry; replace its
   flat list with the calendar. Promote it to a visible bottom tab while a break is active.
4. **Mobile worker app first** (Android + iOS). Web admin keeps today's read-only view.
5. **Multi-staff renders as lanes; read-only break cards show names** (consistent with the
   House tab + the full-directory RLS ruling). Single-staff = one lane.
6. **Can't over-claim coverage** — a block at `required_headcount` is full/read-only
   (already enforced by `enforce_block_occupied_headcount`).

## Non-negotiable invariants (re-checked every chunk)

From AGENTS.md:

1. **Harnwell training** — non-Harnwell workers never claim Harnwell, including break
   claiming (`claim_break_shift` / `claim_break_blocks` enforce it; the read is home-house
   scoped so it does not even surface).
2. **Float direction** — unchanged (breaks don't float).
3. **No-takeback** — `open_break_claim_calendar` already refuses to clear a house holding a
   pending/acknowledged float; the redesign does not touch that.
4. **Hours cap** — 40h **hard** for thanksgiving/fall/spring/winter; 20h **soft** for
   spring fling. Re-checked per-block in `claim_break_blocks`.
5. **30-minute block atomicity** on boundaries — the drag operates on 30-min block indices.
6. **`timestamptz` America/New_York**, duration arithmetic across DST — block indices come
   from instants (`roundDownToBlock` / `BLOCK` math), never wall-clock.

After any migration: `supabase gen types typescript --local > packages/shared/src/database.types.ts`.

---

# Chunks

## B0 — Spec / contract delta · **S**

**Goal.** Make §4.4 reflect the calendar-claim UI + the drag/range-claim semantics + the
round-2 hand-off precisely (most of it confirms what exists; the new prose is the
drag/trim/coverage behavior and the "system-assigned lane" rule). Add an ARCHITECTURE.md
note pointing at the new read column + RPC.

**Deliverable.** BSpec §4.4 edit; ARCHITECTURE §2.9 note. No code.

## B1 — Backend: per-block FCFS range claim + grid read · **M**

**Goal.** The one new engine primitive. New migration:

- `CREATE OR REPLACE VIEW house_schedule_grid` adding `block_id` + `required_headcount`
  (additive; House-tab reads ignore them).
- `claim_break_blocks(p_block_ids uuid[], p_user_id uuid, p_as_of timestamptz)
RETURNS TABLE(block_id uuid, assignment_id uuid)` — for each distinct block, inside a
  break `claim_window`, claim **one** still-vacant seat applying the `claim_break_shift`
  guards (active user, Harnwell training, per-block time-conflict, incremental weekly hard
  cap). Blocks with no open seat (FCFS lost / full) are **skipped** (the server-side trim);
  the returned set is exactly what was claimed. Atomic (one function = one txn).
- Grants: service_role (called by the `break-claim` EF). Extend the `break-claim` EF to
  accept `block_ids` and call it, returning `{ claimed: [...], projected_hours }`.

**Behavior contract (pgTAP, `tests/phase-11/break-range-claim.sql`):**

- should claim every block when all are vacant (single-staff)
- should fill any open seat per block on a multi-staff house (lane-agnostic)
- should skip a full block and claim the rest (trim) — returns only the claimed
- should skip a block where the caller already has a seat (time-conflict trim)
- should reject the whole call outside `claim_window` (pre_open and open_feed)
- should refuse a Harnwell block for a non-Harnwell caller (Harnwell training)
- should stop at the weekly hard cap (40h) — claims up to the cap, trims the rest
- should be FCFS: two concurrent callers split the seats, neither over-claims

Then `supabase gen types`.

## B2 — Shared logic: break calendar + drag/trim/coverage (THE tested surface) · **L**

**Goal.** New pure module `apps/mobile/shared/.../breakclaim/BreakCalendar.kt` (package
`breakclaim`). Zero I/O, zero clock — `now`/`me`/phase injected. This is the **only**
rigorously tested surface (kotlin.test on the JVM host), per the project's
pure-decision-surface split.

**Model.**

- `BreakCalendarSeat(id, blockId, start, end, status, userId, workerName)` — one grid row.
- `BreakCalendarSnapshot(houseName, breakName, phase, requiredHeadcount, seats, meUserId,
windowStart/endDate, claimedHours, cap)`.
- `BreakBlockCoverage(blockStart, requiredHeadcount, filled, mineHere, openSeatIds)` — the
  per-block coverage derived by grouping seats by `block_start`.
- `BreakCalendarDay(dayIndex, blocks: List<BreakBlockCoverage>, claimedRuns, openRuns)` and
  a week/strip model reusing `calendar/Calendar.kt` (`buildCalendarWeek`, `shiftWeekAnchor`,
  week range scoped to the break's weeks).

**The drag/trim/coverage logic (main contract):**

- `planBreakDrag(day, fromBlockIdx, toBlockIdx, snapshot): BreakDragPlan` with:
  - `claimableBlockIds` — blocks in [from,to] with an open seat **and** not already mine,
  - `skippedFullBlockIds` / `skippedConflictBlockIds` — trimmed-away blocks,
  - `claimedSegments` / `trimmedSegments` — contiguous runs (an interior full block yields
    two claimed segments + one trimmed), each with NY-anchored range labels,
  - `projectedHours`, `capExceeded`, `capTrimmedBlockIds` — at the 40h hard cap the plan
    trims the tail beyond the cap,
  - `message` — the human summary ("Claimed 4:00–6:00 · 6:00–8:00 was already full").
- `applyBreakDrag(snapshot, plan): BreakCalendarSnapshot` — optimistic local: mark one open
  seat per claimable block as mine; recompute coverage.
- `buildBreakCalendarDay(...)` / `buildBreakCoverage(...)` — coverage + coalesced runs.
- phase gating: `pre_open` → nothing claimable; `claim_window` → draggable; `open_feed` →
  read-only + "see Open Shifts".

**Behavior contract (`BreakCalendarTest.kt`):**

- coverage counts per block ("1 of 2", full at headcount)
- single-staff: free range → all claimable; over a claimed range → all trimmed
- multi-staff: partial overlap → trimmed to the open sub-range, fills any open seat
- interior hole → two claimed segments + one trimmed segment, message lists both
- already-mine block in the range → skipped (conflict), rest claims
- hard cap: range crossing 40h → claims up to the cap, trims the tail, `capExceeded`
- phase: pre_open none claimable; open_feed read-only
- `applyBreakDrag` marks exactly the claimable seats mine and re-derives coverage
- DST day (spring-forward / fall-back): block indices stay correct (instant math)

## B3 — Live wiring: repository + viewmodel · **M**

**Goal.** Feed B2 with live data; keep writes optimistic-local (data layer, untested).

- `BreakCalendarRepository` (or extend `BreakRepository`): `fetchBreakGrid(window)` reads
  `house_schedule_grid` between the break window bounds → `BreakCalendarSeat`s;
  `fetchPhase(breakId)` → `break_claim_phase` RPC; `claimRange(blockIds)` → `break-claim`
  EF (block_ids form) returning claimed + projected hours; `drop` reuses `drop-shift`.
- `BreakCalendarViewModel` — phase-aware StateFlow over the B2 builders; `weekOffset`
  navigation across the break weeks; opt-out retained; cap meter from `reconcileHours`.
- iOS-compile gate (`:shared:compileKotlinIosSimulatorArm64`).

## B4 — Android UI · **L**

**Goal.** Rebuild `BreakClaimScreen` as `BreakCalendarScreen`: week strip + week picker
(scoped to the break), a **selected-day vertical time grid** with N lanes (1 single / 2
Harnwell / 3 Quad), vacant capacity drag-claimable via the preferences paint gesture
(long-press + drag), read-only filled cards with names, 40h cap meter, opt-out toggle,
phase states (pre_open placeholder / claim_window draggable / open_feed read-only banner).
Preserve/extend Maestro selectors.

## B5 — iOS UI · **L**

**Goal.** SwiftUI mirror of B4 via the SKIE-exported shared logic. Same states + gesture.

## B6 — Round 2 + nav promotion · **M**

**Goal.** (a) `open_feed` phase: Break screen read-only + "Claiming closed — remaining
shifts are in Open Shifts" banner; verify leftover break seats actually surface in the
regular Open-Shifts tab on mobile (backend already includes them — confirm the client read
isn't date-filtering them out). (b) Promote a **Break** bottom tab while a break is active
(pre_open/claim_window/open_feed-with-leftovers); otherwise it stays in the More overflow.

## B7 — Maestro + verification · **M**

**Goal.** Rewrite `06-claim-break.yaml` for the calendar flow (open Break tab → select a
day → drag a range → confirm → success; assert read-only-after states where seeded).
Emulator/simulator run per the verification checklist. Update `apps/mobile/maestro/README.md`
selector contract.

---

## Verification gate (before a chunk is "done")

- B1: `supabase` pgTAP for the new file green; `supabase gen types`.
- B2: `./gradlew :shared:testAndroidHostTest` green (+ the new tests counted);
  `:shared:compileKotlinIosSimulatorArm64` clean.
- B3/B4: `./gradlew :androidApp:assembleDebug` clean; iOS compile clean.
- B5: `./gradlew :shared:linkDebugFrameworkIosSimulatorArm64` clean; `xcodebuild … build`
  (per `reference_ios_local_build`).
- B7: Maestro run on a real emulator/simulator (cannot be proven from the JVM host).
