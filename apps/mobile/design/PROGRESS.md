# Worker App — Reskin PROGRESS

Handoff log for the worker mobile-app reskin (Compose + SwiftUI over the shipped
Phase-13a ViewModels). Branch: `design/mobile` (worktree `shift-mobile`). The
contract is `DESIGN_TOKENS.md`; the visual source of truth is `worker-app.html`;
the selector contract is `apps/mobile/maestro/README.md`. Verify gate (from
`apps/mobile`): `:shared:testAndroidHostTest`, `:androidApp:assembleDebug`,
`:shared:compileKotlinIosSimulatorArm64`, `:shared:linkDebugFrameworkIosSimulatorArm64`.

## Done

### Foundation — `22032fb`

Token theme + shared component kit on both platforms (Color/Type/Shape/Tokens/Theme
+ `ui/kit/*` on Compose; `Theme/ShiftTheme.swift` + `Kit/*.swift` on SwiftUI). See
`DESIGN_TOKENS.md`. **Do not re-derive — reuse exactly.**

### Screen 1 — My Shifts (Scheduled · Picked-up · Dropped) + Drop sheet — `8fb966d`

Shared `MyShiftPresentation.toRow` (tested) + Compose/SwiftUI cards + the Drop sheet.
Selectors + §5.6 order preserved.

### Screen 2 — Open Shifts (My House / Other Houses) + Claim flow — **this session**

Reskinned Tab 2 (home open), Tab 3 (other houses), and the claim/pick-up flow on
**both** platforms over the existing `ShiftsScreenViewModel` (no VM/data changes).
Before, Tabs 2/3 + claim were raw-M3 stubs (rendering `Instant.toString()`); now they
use the canonical kit.

**Shared (`:shared`, tested — 16 new kotlin.test cases, all green):**

- `shifts/OpenShiftPresentation.kt` (new): `OpenShiftCardState {OPEN, UNPICKABLE,
  PERMANENT}`, `resolveOpenState(feed, claimable)` + `openShiftCardState(shift, now)`
  (single source of truth, §5.4 T-2h via `isClaimable`), `formatRecurringDayLabel`
  ("Every Wed"), `OpenShiftRow` + `OpenShift.toRow(claimable)`, and `ClaimMeter` +
  `claimMeter(currentWeeklyHours, addedHours, breakProfile)` (the "brings your week to
  Xh of Yh" meter; reuses `evaluateClaimCap` so the meter and the cap gating never
  diverge). Clock-free: the UI passes the VM's `claimable` verdict, mirroring how
  Screen 1's `toRow` takes a snapshot.
- `shifts/MyShiftPresentation.kt`: `DOW_SHORT` widened `private`→`internal` so the new
  recurring-day label can reuse it (no behavior change).

**Compose (`androidApp/.../ui/ShiftsScreen.kt`):**

- `OpenFeedCard` → kit `ShiftCard` (eyebrow = day, duration chip, house, state pill,
  trailing Claim/Pick-up). `ShiftSection` wrappers keep `home_weekly_feed` /
  `home_permanent_feed` always-rendering with empty placeholders.
- `ClaimSheet` (kit `ShiftBottomSheet`): shift summary + `ClaimHoursMeter` progress bar
  + soft/hard `ShiftBanner`s + Cancel/Claim. `PermanentRecurringNote` for pick-ups.
- Tab 3: `SectionHeader` per house + `OpenFeedCard`s, or the `EmptyState` (new
  `ShiftIcons.Building`). Cross-house cards claim too (design).
- Success: a top `ShiftToast` (tone Success) carrying `claim_success`; the sheet
  dismisses on confirm.

**SwiftUI (`iosApp/iosApp/ContentView.swift`):** the same, idiomatically — `ShiftSection`,
`openFeedCard` over `ShiftCard`, `ClaimFlowSheet` (`ShiftSheet`) with `ClaimHoursMeter`
+ `PermanentRecurringNote`, `EmptyState` (`ShiftIcons.building` = SF Symbol `building.2`),
top `ShiftToast`.

**New shared component:** `Building` icon (Android stroked `ImageVector` in
`ui/kit/ShiftIcons.kt`; iOS `ShiftIcons.building` SF Symbol) for the cross-house empty
state. Nothing else added to the kit.

**Selectors preserved/added:** `tab_open_home`, `tab_open_other`, `home_weekly_feed`,
`home_permanent_feed`, `other_houses_tab`, `open_shift_card`, `claim_button`,
`soft_cap_warning_modal`, `soft_cap_confirm_button`, `claim_confirm_button`,
`claim_success`.

### Screen 3 — Float Acknowledgment (Pending · Acknowledged · Declined · Deadline-passed) — **latest**

Reskinned the float-ack hero on **both** platforms over the existing `AckDeclineViewModel`
(no VM/data change). Was a raw `Dialog` / plain `VStack` (rendered `Instant.toString()`); now
the design's "from Updates" sheet hero (worker-app.html `FloatAckSheet` / `FloatBody`).

- **Shared (`:shared`, tested — 8 new kotlin.test):** `ack/FloatAckPresentation.kt` —
  `FloatAckHero` + `floatAckHero(phase, destinationName, floatStart, deadline, now)`: per-phase
  eyebrow/headline ("You're needed at Quad" → "You're covering Quad" → "No problem" →
  "Reassigned"), the Desk/When/Starts-in strings, the pending countdown ("Respond by 17:50 ·
  1h 50m left", urgent < 30m), and the terminal status line. NY-anchored; `formatFloatWhen`
  shows "Today · HH:mm" same-day else the day label. Reuses the `shifts/` formatters; clock-free
  (the UI injects the load `now`).
- **Compose (`FloatAcknowledgmentScreen.kt`) + SwiftUI (`FloatAcknowledgmentView.swift`):** a
  centred float-OUT (purple) hero — 60dp icon circle (arrow-out / check / close / clock per
  phase) + uppercase eyebrow + 26/700 headline; the Desk/When/Starts-in card (kit `KeyValueRow`);
  the float-tint **"Your weekly hours don't change"** reassurance (invariant #4); pending →
  `CountdownChip` (Urgent tone < 30m) + Acknowledge (filled, check) / Decline (outlined); terminal
  → status line + Close (tonal). Hosted in the kit sheet (`ShiftBottomSheet` / `ShiftSheet`).
- **Decisions:** (a) **sheet host, not full-screen** — the design has both a full-screen
  `FloatAckSurface` (push-launched) and a `FloatAckSheet` (from Updates); we only have the Updates
  entry, so the hero lives in the sheet (preserving the `ack_modal` selector + the Maestro-04
  entry). (b) `ack_success` is the acked status line; the sheet stays open on the acked hero +
  Close (Maestro 04 asserts `ack_success`, never taps Close). (c) the static countdown / "starts
  in" are computed from the load `now` (the kit never ticks a clock — like the snapshot VM).
- **Data flag:** `FloatAck` carries only `floatStart` (no end), so the design's "21:00 – 23:00"
  range is **start-only** ("Today · 21:00"); the "Confirmed at 18:42" timestamp isn't stored
  → "Confirmed · read-only". No backend invented; no kit additions (reused `CountdownChip`,
  `KeyValueRow`, `ShiftBottomSheet`/`ShiftSheet`, `ShiftButton`).
- **Selectors preserved:** `ack_modal`, `ack_button`, `decline_button`, `ack_success`,
  `ack_deadline_passed` (+ the unchanged `tab_updates` / `pending_float_notification` entry).

## Decisions & deviations — Open Shifts (Screen 2)

- **Navigation:** kept the existing 4-tab scrollable row (My Shifts / Open in My House /
  Open in Other Houses / Updates). The design renders Open Shifts as a screen with a
  `Segmented [My House, Other Houses]` control, but `tab_open_home` / `tab_open_other`
  are **load-bearing Maestro tab selectors** — the top tabs ARE that switch. No
  redundant in-screen segmented control added; nav was not restructured (out of scope).
- **Success is a top toast, not the design's in-sheet success animation.** Maestro
  `02-claim-shift` asserts `claim_success` then taps `tab_my_shifts`; a modal in-sheet
  success would cover the tab bar. So on confirm the sheet dismisses and a top
  `claim_success` toast shows (the picked-up shift is already in My Shifts).
- **Soft-cap is a two-step confirm** (warning banner + `soft_cap_confirm_button` →
  `claim_confirm_button`) to satisfy the Maestro contract, vs the design's single
  "Claim anyway". The demo claim (8h + 2h = 10h) is under the 20h cap, so Maestro takes
  the no-warning path straight to `claim_confirm_button`.
- **Cross-house claim enabled** (design allows Claim/Pick-up on other-house cards);
  `ShiftsScreenViewModel.claim` already tags them cross-house.

## Data flags / not-built (no backend invented)

- **Partial-coverage trim** ("How much can you cover?" block-range selector in the design
  `ClaimSheet`) is **omitted** — there is no shared partial-claim logic and no VM/repo
  action for it; `ShiftsScreenViewModel.claim` claims the whole shift only. Building it
  would need a new partial-claim action (out of scope for a reskin). Flag if required.
- **Permanent-pickup detail:** the design's "Picking up 10 of 12 weeks · 2 skipped" is
  not data-backed (`OpenShift` carries only `weeksRemaining`); `PermanentRecurringNote`
  shows a simplified "Repeats weekly — N weeks remaining". The pick-up itself uses the
  existing optimistic `claim` (→ `TEMP_PICKUP`), unchanged.
- **Loading / error states:** `ShiftsScreenViewModel` is a pure snapshot VM with no
  loading/error fields — those live in the data layer (`data/`, out of the tested
  surface), exactly as in Phase 13a. `SkeletonShiftCard` + `EmptyState` are in the kit
  for when the data layer wires them; not surfaced through this VM.

## Verification

- JVM/KMP gate: **all four green** (shared tests incl. Screen-2's 16 + Screen-3's 8 new,
  `assembleDebug`, iOS compile, SKIE framework link). The only link warning is the
  pre-existing Ktor `description` rename, unrelated.
- **Manual (not the JVM gate):** Maestro `01-view-my-shifts`, `02-claim-shift`,
  `04-acknowledge-float` on a real emulator/simulator; Xcode build of `iosApp` (SwiftUI
  isn't gated by Gradle); an emulator render to eyeball against `worker-app.html`. SwiftUI
  was hand-verified against the kit signatures + SKIE patterns used by the (working)
  existing screens.

## Housekeeping

- `apps/mobile/local.properties` was created in this worktree (gitignored) pointing
  `sdk.dir` at the Android SDK — required for the Gradle gate here.
- **Pre-existing Spotless debt (not this screen):** `commonTest/.../ShiftsScreenViewModelTest.kt`
  has several >140-col lines from the Screen-1 session; ktlint `max-line-length` is not
  auto-fixable, so `spotlessApply`/`spotlessCheck` reports it. Left out of this diff
  (not my file); worth a separate wrap-only cleanup. My files are Spotless-clean.

## Next

- Done so far: foundation + My Shifts (existing) + Open Shifts/Claim (existing) + **Float
  Acknowledgment (existing)**. Remaining per `DESIGN_TOKENS.md` §6 are mostly **New (✦)**
  screens — Preferences submission, Break claim, Personal calendar, Settings/Profile —
  each of which needs the **data-availability check first** (and screens 10/11 "who's
  working" + desk/floater phone are ⛔ blocked: no backend). Next screen is user-directed
  in the same conversation.
