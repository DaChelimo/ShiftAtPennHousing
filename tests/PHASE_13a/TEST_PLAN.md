# Phase 13a — Test Plan: Worker Mobile App (Compose Multiplatform — Android + iOS)

This plan enumerates every test for phase-13a, the spec section each test covers,
the shared-logic / ViewModel / UI contracts the tests pin (TDD-first), and the
ambiguities surfaced and resolved before implementation.

Phase-13a is **the worker's mobile app** — the Shifts screen where a Student
Worker manages their week. It is the first phase whose deliverable is the Kotlin
Multiplatform app (`apps/mobile`), not the Postgres/Edge backend. Following the
Fruitties pattern the repo already adopts (AGENTS "Mobile"), all decision logic
lives once in `:shared` (`commonMain`) and both front ends — `:androidApp`
(Jetpack Compose) and `iosApp` (SwiftUI via SKIE) — render it. The tests therefore
split cleanly:

| Surface                                                                                   | Lives in                                              | Tested with              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------ |
| Tab grouping/ordering, claim cutoff/cap, drop options/rounding, ack-deadline math + state | `:shared` `commonMain` (PURE + thin VM) — **TDD-red** | kotlin.test (commonTest) |
| The rendered screens + navigation + the four end-to-end journeys                          | `:androidApp` / `iosApp` UI — **TDD-red**             | Maestro (Android + iOS)  |

It has four behavioral surfaces:

1. **The Shifts screen, three-tab layout** (§5.6). Tab 1 (My Shifts) splits the
   worker's week into picked-up (top) / dropped-still-open (middle) / their
   scheduled shifts (bottom). Tab 2 is the home-house weekly + permanent-openings
   feed. Tab 3 is the cross-house feeds grouped by house — empty when no eligible
   cross-house feed exists (e.g. winter break).
2. **The claim flow** (§5.3, §5.4). A shift is claimable strictly before its T-2h
   cutoff; a cross-house card names its destination house; a claim over the 20h
   soft cap warns (but is allowed) while a claim over the 40h break cap is blocked.
3. **The drop flow** (§5.2). Tapping a shift offers occurrence vs permanent drop
   (permanent suppressed for non-recurring shifts and during break profiles); a
   drop-from-now mid-shift rounds the gap start **down** to the 30-minute block; a
   drop whose gap starts within 20 minutes warns; confirming moves the shift from
   its section into Dropped, and reclaim reverses it.
4. **The float ack/decline modal** (§7.1, §7.2). The acknowledgment deadline is
   **T-10m before float start** (the same constant phase-12's cadence uses). The
   worker may acknowledge or decline only **strictly before** the deadline;
   acknowledging → success, declining → void, and after the deadline the modal is
   disabled showing "deadline passed".

**The defining discipline of this phase, carried from the backend phases: the
decision surface is a PURE, deterministic function of its inputs.** No screen reads
a system clock inside logic — `now` is injected (the screen's load instant; the
action instant for ack/decline), exactly as the TypeScript core forbids
`Date.now()`. The ViewModels are thin `StateFlow` wrappers (the existing
`MainViewModel` shape) over those pure functions; tests construct them from an
explicit snapshot + `now` and assert the emitted `uiState`. This is the mobile
analogue of phase-06/07/12's "pure decision surface in code, atomic state
elsewhere" split.

Sources of truth:

- `BEHAVIORAL_SPECIFICATION.md`
  §5.6 (the Shifts screen — Tab 1's three subsections top→bottom; Tab 2 home
  weekly + permanent; Tab 3 cross-house grouped by house; "Tab 3 is empty when no
  eligible cross-house feed is available — e.g., during winter break"), §5.1 (the
  weekly feed + the permanent-openings feed and its weeks-remaining), §5.2 (drop:
  occurrence vs permanent popup; the within-20-minute short-notice warning; the
  mid-shift drop-from-now rounds **down** to the 30-minute boundary — "A drop
  initiated at 17:51 of a shift ending at 19:00 produces a gap of 17:30–19:00";
  "Permanent drops do not apply during break profiles"; reclaim), §5.3 (claim
  eligibility; the cross-house destination on the card; "Claiming over the 20-hour
  … cap … is permitted with a warning. Claiming over the 40-hour break cap is
  prohibited"), §5.4 (the T-2h unpickable cutoff — "any claim attempt strictly
  after T-2 hours fails. If a claim is in progress at exactly T-2 hours, it fails.
  Only claims completed strictly before T-2 hours succeed"), §7.1 (ack deadline =
  T-10m before float start; the modal disables at the deadline), §7.2 (declining
  voids the float), §11.2 (the personal-calendar treatments the Tab 1 cards carry:
  float-out, pending-float, cross-house pickup destination, break golden border)
- `AGENTS.md` — hard invariant #1 (Harnwell training constraint), #5 (every
  operation is on 30-minute block boundaries — the drop-rounding contract), #6 (all
  timestamps `timestamptz` in America/New_York — the round-down floors in NY and the
  fixtures use explicit NY offsets); the "Mobile" conventions (shared logic in
  `:shared`; Android/iOS are native UI front ends; Maestro is the E2E tool driven by
  the `android` CLI)

Test files:

- `apps/mobile/shared/src/commonTest/kotlin/com/pennhousing/shift/shared/viewmodel/ShiftsScreenViewModelTest.kt`
  — kotlin.test (commonTest, JVM host via `withHostTestBuilder`): Tab 1
  classification + grouping + top→bottom ordering, Tab 2 home-feed split, Tab 3
  group-by-house + ordering + the empty (winter-break) case, the T-2h claim cutoff
  boundary, the soft/hard cap verdicts, the drop options/rounding/short-notice, the
  drop→Dropped→reclaim transition, and tab selection. References
  `com.pennhousing.shift.shared.{model,shifts,viewmodel}` symbols that do not exist
  yet → **TDD-red** (fails to compile until the shared logic lands). **30 cases.**
- `apps/mobile/shared/src/commonTest/kotlin/com/pennhousing/shift/shared/viewmodel/AckDeclineViewModelTest.kt`
  — kotlin.test: the ack-deadline derivation (T-10m), the strictly-before
  boundary, the modal phases (pending → acknowledged / declined / deadline-passed),
  rejection at/after the deadline, idempotence, and terminal-state stability.
  References `com.pennhousing.shift.shared.{ack,model,viewmodel}` symbols that do not
  exist yet → **TDD-red**. **15 cases.**
- `apps/mobile/maestro/{01-view-my-shifts,02-claim-shift,03-drop-shift,04-acknowledge-float}.yaml`
  (+ `config.yaml`, `README.md`) — Maestro E2E, cross-platform (one flow set, run on
  both the Android emulator and the iOS simulator). The flows reference
  `testTag`/`accessibilityIdentifier` selectors the Compose/SwiftUI screens must
  expose; those screens are not built → **TDD-red** (fail at the first missing
  element). The selector contract is tabulated in `apps/mobile/maestro/README.md`.

The Kotlin tests hold their fixtures inline (the phase-11/12 precedent — the pure
surface is small) and construct instants with `kotlin.time.Instant.parse` at
explicit NY winter offsets (`-05:00`) so every boundary assertion is unambiguous.

This phase adds one enabling line to `apps/mobile/shared/build.gradle.kts` —
`languageSettings.optIn("kotlin.time.ExperimentalTime")` in the existing
`sourceSets.all { … }` block (alongside the `ExperimentalObjCName` opt-in). The
shared logic uses `kotlin.time.Instant`, the modern instant type; in
`kotlinx-datetime 0.7.1-0.6.x-compat` the legacy `kotlinx.datetime.Instant` is
deprecated, and `kotlin.time.Instant` is still `@ExperimentalTime` in Kotlin 2.2.x,
so the module-wide opt-in keeps both `commonMain` and `commonTest` free of
per-file annotations and deprecation noise.

---

## The Shared-Logic / ViewModel Contracts (TDD-first)

The implementation goes in `apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/`.
Until it lands, the two test files fail to compile at their first unresolved
reference — the intended TDD-red state, identical in spirit to phase-06..12's
import-of-a-missing-module. The Android/iOS screens that satisfy the Maestro flows
land in the same follow-up.

### Domain models — `model/` (PURE data)

```kotlin
package com.pennhousing.shift.shared.model
import kotlin.time.Instant   // the modern instant type (kotlinx.datetime.Instant is deprecated in 0.7.x)

data class House(val id: String, val name: String)

// How the worker relates to a shift this week — drives the My-Shifts section (§5.6)
// and the §11.2 personal-calendar treatment.
enum class AssignmentKind { SCHEDULED, PERMANENT_PICKUP, TEMP_PICKUP, FLOAT_OUT }

data class MyShift(
    val id: String,
    val house: House,
    val start: Instant,            // 30-min block boundary (invariant #5)
    val end: Instant,
    val kind: AssignmentKind,
    val crossHouse: Boolean = false,        // pickup/float at a non-home house → destination shown (§11.2)
    val pending: Boolean = false,           // force-triggered float not yet acked → "(Pending)" (§11.2)
    val breakShift: Boolean = false,        // short/winter break shift → golden border (§11.2)
    val droppedStillOpen: Boolean = false,  // personally dropped this week, still unclaimed (§5.6 #2)
)

enum class MyShiftsSection { PICKED_UP, DROPPED, SCHEDULED }

enum class OpenFeed { WEEKLY, PERMANENT_OPENING }

data class OpenShift(
    val id: String,
    val house: House,
    val start: Instant,
    val end: Instant,
    val feed: OpenFeed,
    val homeHouse: Boolean,                 // true → Tab 2; false → Tab 3
    val weeksRemaining: Int? = null,        // permanent openings only (§5.1)
)

data class FloatAck(val floatId: String, val destinationHouse: House, val floatStart: Instant)
```

### Pure decision surface — `shifts/` (no I/O, no clock)

```kotlin
package com.pennhousing.shift.shared.shifts

val NEW_YORK: kotlinx.datetime.TimeZone               // America/New_York (invariant #6)
val CLAIM_CUTOFF_BEFORE_START = 2.hours               // T-2h unpickable (§5.4)
val SHORT_NOTICE_WINDOW = 20.minutes                  // §5.2
val BLOCK = 30.minutes                                // invariant #5
const val SOFT_HOURS_CAP = 20.0                       // §5.3 regular / spring fling
const val BREAK_HOURS_CAP = 40.0                      // §5.3 break

// ----- Tab 1 -----
data class MyShiftsTab(val pickedUp: List<MyShift>, val dropped: List<MyShift>, val scheduled: List<MyShift>) {
    fun inDisplayOrder(): List<MyShift>               // pickedUp + dropped + scheduled (§5.6 top→bottom)
}
fun classifyMyShift(shift: MyShift): MyShiftsSection
//   droppedStillOpen → DROPPED ; else TEMP_PICKUP → PICKED_UP ; else SCHEDULED.
fun buildMyShiftsTab(shifts: List<MyShift>): MyShiftsTab
//   partition by classifyMyShift; each subsection sorted by start ascending.

// ----- Tab 2 -----
data class HomeOpenShiftsTab(val weekly: List<OpenShift>, val permanentOpenings: List<OpenShift>)
fun buildHomeOpenShiftsTab(openShifts: List<OpenShift>): HomeOpenShiftsTab
//   homeHouse == true only; split by feed; each sorted by start.

// ----- Tab 3 -----
data class HouseGroup(val house: House, val weekly: List<OpenShift>, val permanentOpenings: List<OpenShift>)
data class OtherHousesTab(val groups: List<HouseGroup>) { val isEmpty: Boolean }
fun buildOtherHousesTab(openShifts: List<OpenShift>): OtherHousesTab
//   homeHouse == false only; group by house; groups ordered by house.name; within a
//   group split by feed, each sorted by start. No cross-house shifts ⇒ empty groups.

// ----- Claim (§5.3/§5.4) -----
fun isClaimable(shift: OpenShift, now: Instant): Boolean    // now < shift.start − 2h (strictly)
enum class ClaimCapVerdict { OK, SOFT_CAP_WARNING, HARD_CAP_BLOCKED }
fun hoursBetween(start: Instant, end: Instant): Double
fun evaluateClaimCap(currentWeeklyHours: Double, addedHours: Double, breakProfile: Boolean): ClaimCapVerdict
//   break: total > 40 → HARD_CAP_BLOCKED else OK ; regular: total > 20 → SOFT_CAP_WARNING else OK.

// ----- Drop (§5.2) -----
data class DropOptions(val canDropOccurrence: Boolean, val canDropPermanently: Boolean)
fun dropOptionsFor(shift: MyShift, breakProfile: Boolean): DropOptions
//   occurrence always; permanent iff kind ∈ {SCHEDULED, PERMANENT_PICKUP} AND !breakProfile.
data class DropPlan(val gapStart: Instant, val gapEnd: Instant, val midShift: Boolean, val shortNotice: Boolean)
fun roundDownToBlock(instant: Instant): Instant   // floor to the 30-min block grid; = NY :00/:30
//   (NY's offset is always a whole number of hours, incl. across DST, so epoch-grid flooring equals
//    NY-local :00/:30 flooring — DST-safe instant arithmetic, never wall-clock arithmetic, invariant #6).
fun planTemporaryDrop(shift: MyShift, dropFromNow: Boolean, now: Instant): DropPlan
//   midShift = now ∈ [start, end). gapStart = (dropFromNow && midShift) ? roundDownToBlock(now) : start.
//   gapEnd = shift.end. shortNotice = gapStart <= now + 20m.
fun applyTemporaryDrop(shifts: List<MyShift>, shiftId: String): List<MyShift>   // set droppedStillOpen = true
fun reclaimDroppedShift(shifts: List<MyShift>, shiftId: String): List<MyShift>  // set droppedStillOpen = false
```

### Pure decision surface — `ack/` (§7.1)

```kotlin
package com.pennhousing.shift.shared.ack
const val ACK_DEADLINE_LEAD_MINUTES = 10            // matches phase-12 (notification cadence)
enum class AckPhase { PENDING, ACKNOWLEDGED, DECLINED, DEADLINE_PASSED }
fun ackDeadline(floatStart: Instant): Instant       // floatStart − 10m
fun isPastAckDeadline(floatStart: Instant, now: Instant): Boolean   // now >= ackDeadline (inclusive)
fun canRespondToFloat(floatStart: Instant, now: Instant): Boolean   // now < ackDeadline (strictly)
```

### Thin ViewModels — `viewmodel/` (StateFlow wrappers, the `MainViewModel` shape)

```kotlin
package com.pennhousing.shift.shared.viewmodel

enum class ShiftsTab { MY_SHIFTS, OPEN_HOME, OPEN_OTHER }
data class ShiftsUiState(
    val selectedTab: ShiftsTab, val myShifts: MyShiftsTab,
    val homeOpen: HomeOpenShiftsTab, val otherHouses: OtherHousesTab,
)
class ShiftsScreenViewModel(
    myShifts: List<MyShift>, openShifts: List<OpenShift>, now: Instant,
    initialTab: ShiftsTab = ShiftsTab.MY_SHIFTS,
) : ViewModel() {
    val uiState: StateFlow<ShiftsUiState>
    fun selectTab(tab: ShiftsTab)
    fun claimable(shift: OpenShift): Boolean                       // isClaimable(shift, now)
    fun claimCap(shift: OpenShift, currentWeeklyHours: Double, breakProfile: Boolean): ClaimCapVerdict
    fun dropOptions(shift: MyShift, breakProfile: Boolean): DropOptions
    fun planDrop(shift: MyShift, dropFromNow: Boolean): DropPlan    // uses the construction-time `now`
    fun drop(shiftId: String)                                      // applyTemporaryDrop + re-emit
    fun reclaim(shiftId: String)                                   // reclaimDroppedShift + re-emit
}

data class AckDeclineUiState(
    val floatId: String, val destinationHouse: House, val floatStart: Instant,
    val deadline: Instant, val phase: AckPhase, val canRespond: Boolean, val modalVisible: Boolean,
)
class AckDeclineViewModel(float: FloatAck, now: Instant) : ViewModel() {
    val uiState: StateFlow<AckDeclineUiState>
    fun refresh(now: Instant)                 // re-resolve PENDING→DEADLINE_PASSED at the deadline
    fun acknowledge(now: Instant): Boolean    // true iff it transitioned to ACKNOWLEDGED
    fun decline(now: Instant): Boolean        // true iff it transitioned to DECLINED
}
```

`uiState` is a `MutableStateFlow(...).asStateFlow()` exactly like the existing
`MainViewModel`; the ViewModels launch no coroutines (no `viewModelScope`), so they
construct and emit synchronously on the JVM host test target.

---

## Pinned Decisions

The spec leaves several mobile-layer choices implicit. The decisions below are
pinned by the test suite — the implementation MUST match them, and any future
reinterpretation requires updating both the tests and this plan.

| #   | Topic                                            | Decision                                                                                                                                                                                                                   | Why                                                                                                                                                          |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | My-Shifts classification + precedence            | `droppedStillOpen` ⇒ DROPPED first; else `TEMP_PICKUP` ⇒ PICKED_UP; else (SCHEDULED / PERMANENT_PICKUP / FLOAT_OUT) ⇒ SCHEDULED. Dropped wins even for a dropped pickup.                                                   | §5.6: #1 = voluntary this-week pickups; #2 = personally-dropped-still-open; #3 = SM schedule + permanently-picked-up, "neither pickups nor drops".           |
| 2   | Permanent pickup & float-out are "their shift"   | `PERMANENT_PICKUP` and `FLOAT_OUT` classify as SCHEDULED, not PICKED_UP.                                                                                                                                                   | §5.6 #3 names permanently-picked-up slots explicitly; a float-out relocates scheduled hours (neither a voluntary pickup nor a drop, §11.2).                  |
| 3   | Section order is top→bottom                      | `MyShiftsTab.inDisplayOrder()` = pickedUp + dropped + scheduled. Within each, ascending by `start`.                                                                                                                        | §5.6 Tab 1 lists the subsections "from top to bottom": picked-up, dropped, their shifts.                                                                     |
| 4   | Tab 2 vs Tab 3 split is the `homeHouse` flag     | `buildHomeOpenShiftsTab` keeps `homeHouse == true`; `buildOtherHousesTab` keeps `homeHouse == false`. No leakage either direction.                                                                                         | §5.6 Tab 2 = "for the SW's home house"; Tab 3 = "every non-home house".                                                                                      |
| 5   | Tab 3 groups by house, ordered by name           | Cross-house shifts grouped by `house`, groups sorted by `house.name`; within each group split weekly/permanent, each sorted by start.                                                                                      | §5.6 Tab 3: "Shifts are grouped by house." Name ordering is the stable, deterministic presentation choice.                                                   |
| 6   | Tab 3 "empty" is the empty-feed case             | An empty cross-house feed ⇒ `OtherHousesTab.isEmpty`. The client does NOT re-derive cross-house eligibility; it renders the matrix-filtered feed it is given. Winter break is just the case where that feed arrives empty. | §5.6 ("Tab 3 is empty when no eligible cross-house feed is available — e.g., during winter break"). Eligibility lives server-side (see "not covered").       |
| 7   | Claim cutoff is strictly-before T-2h             | `isClaimable` ⇔ `now < shift.start − 2h`. At exactly T-2h, NOT claimable.                                                                                                                                                  | §5.4: "any claim attempt strictly after T-2 hours fails. If a claim is in progress at exactly T-2 hours, it fails. Only claims … strictly before … succeed." |
| 8   | Soft cap warns, hard cap blocks; "over" strict   | Regular/spring-fling: `total > 20` ⇒ SOFT_CAP_WARNING else OK (allowed). Break: `total > 40` ⇒ HARD_CAP_BLOCKED else OK. Exactly at the cap ⇒ OK.                                                                          | §5.3: "Claiming over the 20-hour … cap … is permitted with a warning. Claiming over the 40-hour break cap is prohibited." "Over" = strictly greater.         |
| 9   | Cross-house card carries the destination house   | Both a Tab 1 cross-house pickup card (`MyShift.house` + `crossHouse`) and a Tab 3 open-shift card (`OpenShift.house`) expose the destination house name.                                                                   | §5.6 #1 ("identifies the destination house"), §5.3, §11.2 ("The destination house is shown on the card").                                                    |
| 10  | Drop popup options depend on recurrence+profile  | `canDropOccurrence` always true; `canDropPermanently` iff `kind ∈ {SCHEDULED, PERMANENT_PICKUP}` AND `!breakProfile`. A `TEMP_PICKUP` and any break-profile shift offer occurrence only.                                   | §5.2: occurrence-vs-permanent popup; "Permanent drops do not apply during break profiles"; a single this-week pickup is not a recurring slot.                |
| 11  | Drop-from-now rounds the gap start DOWN          | A mid-shift drop-from-now sets `gapStart = roundDownToBlock(now)` (floor to the most recent :00/:30 in NY); `gapEnd = shift.end`. A whole-occurrence drop anchors `gapStart = shift.start`.                                | §5.2: "rounds down to the most recent 30-minute boundary … A drop initiated at 17:51 … produces a gap of 17:30–19:00." Invariants #5/#6.                     |
| 12  | Short-notice warning is gap-start ≤ now + 20m    | `DropPlan.shortNotice` ⇔ `gapStart <= now + 20m` (inclusive). Drives the §5.2 warning popup.                                                                                                                               | §5.2: "drop a shift starting within 20 minutes of the current time … shows a warning popup."                                                                 |
| 13  | Drop is an optimistic local section move         | `drop(id)` flips `droppedStillOpen = true` (shift leaves PICKED_UP/SCHEDULED, enters DROPPED) and re-emits; `reclaim(id)` flips it back to its original section.                                                           | §5.6 #2 (dropped-still-open lives in the Dropped subsection); §5.2 ("a worker … may reclaim it themselves"). Server reconciliation is out of scope.          |
| 14  | Ack deadline = T-10m before float start          | `ackDeadline = floatStart − 10m`; `ACK_DEADLINE_LEAD_MINUTES == 10`. The same lead phase-12's notification cadence measures its reminders from.                                                                            | §7.1: "the acknowledgment deadline, which is 10 minutes before the float start time." Consistency with phase-12.                                             |
| 15  | Respond strictly-before; deadline inclusive-past | `canRespondToFloat` ⇔ `now < deadline`; `isPastAckDeadline` ⇔ `now >= deadline`. At exactly the deadline the modal is disabled ("deadline passed").                                                                        | §7.1: must act "by the … deadline"; the modal disables at the deadline. Strict/inclusive split mirrors the T-2h claim boundary (#7).                         |
| 16  | Modal phases + terminal stability                | PENDING → (acknowledge) ACKNOWLEDGED \| (decline) DECLINED \| (deadline) DEADLINE_PASSED. Terminal states never change: an ACKNOWLEDGED float stays ACKNOWLEDGED after the deadline; a second acknowledge returns false.   | §7.1/§7.2 (acknowledge success, decline voids); a confirmed success must not silently degrade to "deadline passed".                                          |
| 17  | `now` is injected, never read from a clock       | Every time-dependent function and ViewModel takes `now: Instant`. No `Clock.System.now()` / `Date.now()` inside logic. Fixtures parse explicit NY offsets.                                                                 | The project-wide no-system-clock rule (phase-06/07/12); deterministic boundary tests; invariant #6.                                                          |

---

## Test File Coverage Map

### `ShiftsScreenViewModelTest.kt` (kotlin.test, commonTest) — TDD-red

| Surface                                                                                                                  | Cases | Pinned decisions |
| ------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------- |
| Tab 1 — partition into picked-up/dropped/scheduled; chronological within each; top→bottom display order                  | 3     | #1, #3           |
| Tab 1 — classification: permanent-pickup & float-out are "their shift"; temp-pickup is picked-up; dropped precedence     | 4     | #1, #2           |
| Tab 1 — cross-house pickup card retains the destination house                                                            | 1     | #9               |
| Tab 2 — home-only; weekly/permanent split & sort; weeks-remaining; cross-house excluded                                  | 3     | #4               |
| Tab 3 — group-by-house ordered by name + feed split; home excluded; empty (winter-break) case                            | 3     | #5, #6           |
| Claim — strictly-before T-2h (boundary ×3) + the VM `claimable` wiring; cross-house destination on the card              | 3     | #7, #9           |
| Claim — soft-cap warn / at-cap OK; break hard-cap block / at-cap OK; the VM `claimCap` derives added hours from the span | 3     | #8               |
| Drop — options (recurring → both; temp-pickup → occurrence-only; break → occurrence-only)                                | 3     | #10              |
| Drop — drop-from-now mid-shift rounding; `roundDownToBlock` floor cases; whole-occurrence anchor; short-notice flag      | 4     | #11, #12         |
| Drop — `drop` moves a shift into Dropped; `reclaim` returns it to its section                                            | 2     | #13              |
| Tab selection — defaults to My Shifts; `selectTab` updates without mutating tab data                                     | 1     | —                |

**Total: 30 cases.**

### `AckDeclineViewModelTest.kt` (kotlin.test, commonTest) — TDD-red

| Surface                                                                                              | Cases | Pinned decisions |
| ---------------------------------------------------------------------------------------------------- | ----- | ---------------- |
| Deadline math — `ackDeadline` = T-10m; `ACK_DEADLINE_LEAD_MINUTES == 10`                             | 2     | #14              |
| Boundary — `canRespondToFloat` strictly-before (×3); `isPastAckDeadline` inclusive-past (×2)         | 2     | #15              |
| Modal state — a pending float surfaces the modal (phase/canRespond/deadline/destination carried)     | 1     | #14, #16         |
| Transitions — acknowledge → success; decline → void                                                  | 2     | #16              |
| Deadline — load-after-deadline shows passed+disabled; `refresh` flips pending→passed at the deadline | 2     | #15, #16         |
| Rejection — acknowledge/decline at-or-after the deadline return false and land on DEADLINE_PASSED    | 2     | #15, #16         |
| Terminal stability — acknowledge idempotent; ACKNOWLEDGED survives a past-deadline refresh           | 2     | #16              |
| Boundary — acknowledge succeeds 1s before the deadline; fails exactly at the deadline                | 2     | #15              |

**Total: 15 cases.**

### Maestro flows (Android emulator + iOS simulator) — TDD-red

| Flow                        | Spec       | Asserts                                                                                |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `01-view-my-shifts.yaml`    | §5.6       | Three tabs present (titles); Tab 1's three subsections; Tab 2 weekly+permanent; Tab 3. |
| `02-claim-shift.yaml`       | §5.3, §5.4 | Claim an open shift (confirm through soft-cap if shown) → it appears under Picked-up.  |
| `03-drop-shift.yaml`        | §5.2       | Drop-occurrence (ack short-notice if shown) → it appears under Dropped.                |
| `04-acknowledge-float.yaml` | §7.1, §7.2 | Ack/decline modal present → acknowledge → success.                                     |

Selector contract (testTag / accessibilityIdentifier) is tabulated in
`apps/mobile/maestro/README.md`.

---

## What This Phase Does NOT Cover

- **The data/repository layer.** How `MyShift` / `OpenShift` / `FloatAck` snapshots
  reach the ViewModel — the Supabase client, Realtime subscription, auth, offline
  cache — is the app's data layer, the mobile analogue of the Edge/HTTP layer that
  phases 07–12 scoped out. The ViewModels take a snapshot + `now`; the tests pin the
  decision logic over that snapshot, not its sourcing.
- **Cross-house eligibility derivation.** Which non-home houses a worker may pick up
  at (the §5.3 matrix / Harnwell training constraint, AGENTS invariant #1) is
  enforced server-side and already lives in `packages/core/src/eligibility`. The
  client renders the matrix-filtered feed it receives and groups it by house
  (decision #6); it does not re-implement the matrix, so it cannot diverge from the
  canonical rule. The Harnwell training invariant is therefore NOT re-tested here.
- **The actual claim/drop/ack writes.** Committing a claim, a drop, or an
  acknowledgment to the backend (the RPCs/Edge Functions of phases 05–12) is not
  exercised; `drop`/`reclaim` are optimistic local section moves (decision #13) and
  the Maestro success states assert the UI outcome, not server state.
- **Pixel-level §11.2 visual treatments.** The light-purple float-out background,
  the picked-up circle, the "(Pending)" label, the golden break border — the
  `MyShift` flags that DRIVE them (`crossHouse`, `pending`, `breakShift`,
  `droppedStillOpen`) are modeled and grouped, but the colors/borders are rendering
  concerns verified by eye / screenshot, not by these tests.
- **The §7.3 no-ack auto-void (T-5m before deadline).** The server-side
  decline-equivalent that fires 5 minutes before the deadline is the backend's
  concern (phase-07/12). The modal's own hard stop is the deadline itself (decision
  #15); the client does not implement the T-5m trigger.
- **Break claim-pool / permanent-pickup flows.** The calendar claim picker (§4.4)
  and the permanent drop/pickup actions (§8.4) have their own phases (11 / 10); Tab 2
  merely surfaces the permanent-openings feed with its weeks-remaining (§5.1).
- **Notifications / push.** Delivery and the cadence are phase-12; this phase
  consumes a `FloatAck` and pins the modal's deadline behavior only.

---

## Why TDD-Red (and how the contracts were validated)

Phase-06..12 established the TDD-red pattern: tests reference a not-yet-existing
symbol and fail; the implementation lands in a follow-up commit and turns them
green. Phase-13a follows it on both surfaces:

- `ShiftsScreenViewModelTest.kt` / `AckDeclineViewModelTest.kt` import
  `com.pennhousing.shift.shared.{model,shifts,ack,viewmodel}` symbols the
  `commonMain` source set does not define yet → the `:shared` host-test compilation
  fails at the first unresolved reference (the Kotlin analogue of phase-12's
  import-of-a-missing-module). The existing `GreetingTest` still compiles and passes,
  so the suite's red is localized to the new files.
- The Maestro flows reference `testTag`/`accessibilityIdentifier` selectors the
  Compose (`:androidApp`) and SwiftUI (`iosApp`) screens do not expose yet → each
  flow fails at its first `assertVisible` when run against the current scaffold app.

The contracts in this plan were verified implementable and the expected values
verified correct against the toolchain in `apps/mobile`:

- A scratch `commonMain` implementation matching the pinned decisions (the `model` /
  `shifts` / `ack` / `viewmodel` files above) turned all **45** kotlin.test cases
  green on the JVM host target (`:shared:testAndroidHostTest`), then was removed so
  the deliverable remains tests-only — the same dry-run the phase-10/11/12 plans
  describe. `kotlin.time.Instant.parse` + `Instant − Duration` + the epoch-grid
  30-minute floor compiled clean against the project's
  `kotlinx-datetime 0.7.1-0.6.x-compat` (with the `kotlin.time.ExperimentalTime`
  opt-in noted above), and the ViewModels constructed and emitted on the host target
  without an Android runtime (no `viewModelScope`). After removing the scratch, the
  host-test compilation re-confirmed red with `Unresolved reference` on every
  contract symbol (`MyShift`, `buildMyShiftsTab`, `AckPhase`, `ackDeadline`, …),
  exactly as intended.
- The Maestro flows were validated as well-formed (`config.yaml` execution order;
  one `appId`; conditional `runFlow … when:` blocks for the optional soft-cap and
  short-notice warnings) and the selector contract cross-checked against the README
  table, then left red against the scaffold UI exactly as intended.
