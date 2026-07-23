# Android port of the 5 new onboarding tours — handoff plan

**Status when this was written:** iOS side is 100% done, tested, and green. This doc is
for a **fresh session** to pick up the Android port without re-deriving context. Read
`docs/design/interactive-onboarding-pattern.md` first (the design spec both platforms
follow) — this doc assumes it.

## What exists already (do not rebuild)

**Shared Kotlin** (`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/`)
— all 6 tours' pure logic + ViewModels are DONE, committed, compiling, and unit-tested:

| Tour                 | Pure module                     | ViewModel                               | Test                                    |
| -------------------- | ------------------------------- | --------------------------------------- | --------------------------------------- |
| My Shifts (existing) | `onboarding/ShiftTour.kt`       | `viewmodel/ShiftTourViewModel.kt`       | `commonTest/.../ShiftTourTest.kt`       |
| Preferences          | `onboarding/PreferencesTour.kt` | `viewmodel/PreferencesTourViewModel.kt` | `commonTest/.../PreferencesTourTest.kt` |
| Break calendar       | `onboarding/BreakTour.kt`       | `viewmodel/BreakTourViewModel.kt`       | `commonTest/.../BreakTourTest.kt`       |
| Swap authoring       | `onboarding/SwapTour.kt`        | `viewmodel/SwapTourViewModel.kt`        | `commonTest/.../SwapTourTest.kt`        |
| House grid           | `onboarding/HouseGridTour.kt`   | `viewmodel/HouseGridTourViewModel.kt`   | `commonTest/.../HouseGridTourTest.kt`   |
| Open-shifts claim    | `onboarding/OpenClaimTour.kt`   | `viewmodel/OpenClaimTourViewModel.kt`   | `commonTest/.../OpenClaimTourTest.kt`   |

Verify all still compile/pass before starting:

```bash
cd apps/mobile
./gradlew :shared:compileKotlinIosSimulatorArm64  # sanity: shared module still fine
./gradlew :shared:testAndroidHostTest --tests "*Tour*"
```

**iOS reference implementation** (`apps/mobile/iosApp/iosApp/`) — fully built, wired,
and covered by 24 passing XCUITest cases. This is the **design/behavior reference** for
what each Android tour must do (step copy, step count, live controls, consequence
animations). Files: `ShiftTourView.swift` (pre-existing), `PreferencesTourView.swift`,
`BreakTourView.swift`, `SwapTourView.swift`, `HouseGridTourView.swift`,
`OpenClaimTourView.swift` (built this round), wired into `ContentView.swift` +
`SettingsView.swift`. Tests: `iosApp/iosAppUITests/*.swift`.

**Android — My Shifts tour already ported** (a _separate, earlier_ session did this,
predating the current work — do not redo it): `androidApp/src/main/java/com/pennhousing/shift/ui/onboarding/ShiftTourView.kt`
(430 lines), wired into `ShiftsScreen.kt` (search `ShiftTourViewModel`/`shiftTourVm`),
tested by `androidApp/src/test/java/com/pennhousing/shift/ui/onboarding/ShiftTourViewTest.kt`.
**This is your primary Android-idiom reference** — mirror its structure exactly for the
5 new tours (SharedPreferences seen-key objects, `testTag` naming, plain Compose
visibility instead of iOS spring/stagger motion, `onGloballyPositioned` for the pointer
callout anchor instead of iOS's `anchorPreference`).

## What's left: port 5 tours to Jetpack Compose

Preferences, Break calendar, Swap authoring, House grid, Open-shifts claim. For each:

1. **New Compose file** `androidApp/src/main/java/com/pennhousing/shift/ui/onboarding/<Feature>TourView.kt`,
   mirroring `ShiftTourView.kt`'s exact shape:
   - `object <Feature>TourPrefs` — own `SharedPreferences` seen-key store, key
     `"<feature>_tour_seen_keys"` (own namespace, never shared with another tour).
   - `object <Feature>TourPointerStore` — own `"<feature>_tour_pointer_shown"` flag.
   - A help-button composable reporting its bounds via `onGloballyPositioned` (mirror
     `ShiftTourView.kt`'s help-button composable near the top).
   - The tour overlay composable itself: stage (sample UI + the real live control for
     that step) + coach card (kicker/title/body/progress/skip/back/next), taking
     `state: <Feature>TourUiState, onNext, onBack, onSkip` — same signature shape as
     `ShiftTourOverlay(state, onNext, onBack, onSkip)`.
   - A pointer-callout composable, positioned from the help button's reported bounds.
   - `testTag` on every interactive element, namespaced `<feature>_tour_*` — **use the
     EXACT same identifier strings as the iOS `accessibilityIdentifier` calls** in the
     matching `<Feature>TourView.swift` file (e.g. iOS `preferences_tour_paint_grid` →
     Android `testTag("preferences_tour_paint_grid")`). This keeps the cross-platform
     selector contract consistent (per `apps/mobile/maestro/README.md`'s convention) and
     means you can literally grep the iOS file for `accessibilityIdentifier(` to get the
     full list to replicate.

2. **Wire into `ShiftsScreen.kt`** (mirror the existing `shiftTourVm` wiring near line
   ~464-465 exactly, 5 more times):
   - Instantiate `remember { <Feature>TourViewModel(<Feature>TourPrefs.read(context)) }`.
   - `autoStart()` trigger at the right point: Preferences → on landing on the
     Preferences tab; Break → when the break claim window opens (mirror whatever
     `breakModel.state.phase == claimWindow`-style check the iOS side used, described
     below); House grid → on landing on the House tab; Open claim → on landing on the
     Open Shifts tab; **Swap → NOT a tab landing** — it only fires the first time the
     worker reaches the swap _page_ inside the manage-shift bottom sheet (after already
     choosing "Swap it" over "Drop the shift" on the prior page). Read
     `ContentView.swift`'s `ManageShiftSheet` struct (search `swapTourModel`) for the
     exact real trigger condition (`page == .swap`) and replicate that logic against
     whatever Android's equivalent manage-sheet page state is (search
     `ManagePageKind`/`ManagePageContent` equivalents in `ShiftsScreen.kt`).
   - Render the tour overlay + pointer callout, same layered-on-top pattern as
     `shiftTourVm`'s existing overlay block.
   - Supersede the old flat Tier-2 tip where one exists: Open-Shifts tip, House-grid
     tip, and Break-window tip should stop firing on Android once these land (mirror
     how iOS's `.onChange(of: tab)` stopped calling
     `onboardingModel.vm.triggerTip(trigger: .openShifts)`/`.houseGrid` and switched to
     `xTourModel.autoStart()` instead — find the equivalent tip-trigger calls in
     `ShiftsScreen.kt` and replace them the same way). The Swaps-tab **incoming-swap**
     tip is a _different_ surface from the swap-authoring composer tour — leave it
     alone, do not conflate them (this was a real point of confusion on iOS; the
     authoring tour and the incoming-swap tip are unrelated).

3. **Wire into `SettingsScreen.kt`**: add 5 more "Replay X tour" rows, mirroring
   whatever row pattern is used for the existing "Replay shift tour" row (find it by
   searching `ShiftTourViewModel`/`replay` in `SettingsScreen.kt`). Use `testTag`s
   `settings_replay_preferences_tour` / `_break_tour` / `_swap_tour` / `_housegrid_tour`
   / `_openclaim_tour` (matching the iOS `settings_replay_*_tour` identifiers exactly).

4. **Robolectric UI test** `androidApp/src/test/java/com/pennhousing/shift/ui/onboarding/<Feature>TourViewTest.kt`,
   mirroring `ShiftTourViewTest.kt`'s exact shape and gotchas:
   - `@RunWith(AndroidJUnit4::class)` + `@Config(sdk = [34], qualifiers = "w411dp-h891dp")`
     — **do not skip this qualifier**. Robolectric's default test window (320×470dp) is
     too small for these tour cards; content silently collapses to zero height and
     `performClick` on a "phantom" node passes without actually clicking anything. This
     bit the Android ShiftTour port once already (see the comment in
     `ShiftTourViewTest.kt`); it will bite every one of these 5 ports too if skipped.
   - Use `useUnmergedTree = true` on every `onNodeWithTag(...)` query. Compose's default
     _merged_ semantics tree collapses a container's `testTag` together with its
     children's own tags for accessibility-service consumption — the exact same failure
     mode as the iOS `.accessibilityIdentifier` container-shadowing bug this session
     spent significant time diagnosing and fixing (26 instances across 9 iOS files; see
     `apps/mobile/iosApp/iosApp/ContentView.swift`'s `shifts_screen`/`calendar_screen`
     comments for the full writeup of that bug if you want the iOS-side postmortem).
     `ShiftTourViewTest.kt` already uses `useUnmergedTree = true` correctly — copy that
     habit into every new test rather than re-discovering the problem the hard way. If
     a `onNodeWithTag` query still can't find a node even with `useUnmergedTree = true`,
     suspect a Compose container needing `Modifier.semantics(mergeDescendants = false)`
     (the Compose analogue of iOS's `.accessibilityElement(children: .ignore)` /
     non-wrapping-marker fixes) rather than assuming the tag is simply missing.
   - Test the REAL gesture per tour, not just presence (mirror
     `performTouchInput { swipeLeft(...) }` on the range slider): Preferences → drag
     down the paint timeline; Break → drag down a desk lane to claim, then a second
     drag over claimed hours to drop (assert the Drop button starts disabled); Swap →
     drag the give/take range, tap a free timeline segment; House grid → tap the house
     switcher, tap next/prev week; Open claim → drag the range, then tap "Permanent
     opening" and assert the summary text changes (this is the whole point of that
     tour — don't skip it).
   - For Swap specifically, also test that the summary text differs between Swap mode
     ("You give Xh · you get Xh") and Hand-off mode ("Giving NAME Xh · nothing comes
     back") — this was a deliberate design decision (see `SwapTour.kt`'s
     `summaryLine(mode, ...)` — it branches on mode, verify both branches).

5. **Verify per-tour, then the whole set**:
   ```bash
   cd apps/mobile
   ./gradlew :androidApp:testDebugUnitTest --tests "*PreferencesTourViewTest*"   # iterate per-tour
   ./gradlew :androidApp:assembleDebug                                          # full compile check
   ./gradlew :androidApp:testDebugUnitTest                                      # full suite, no regressions
   ```
   Per AGENTS.md convention: **do not** verify Android via emulator/simulator — that's
   explicitly the user's own Android Studio workflow, not this session's job. Robolectric
   (JVM, no emulator) + `assembleDebug` compile success is the complete verification bar
   here, mirroring how `:shared:testAndroidHostTest` is already used for the pure-logic
   layer.

## Recommended execution shape (mirrors what worked for iOS)

The 5 ports are close to independent (different files, shared only by two
already-existing files they all need to touch: `ShiftsScreen.kt`, `SettingsScreen.kt`).
Parallelizing worked well on iOS and should here too:

1. **Parallel phase** — 5 worktree-isolated agents (`Agent` tool, `isolation: "worktree"`),
   one per tour, each told explicitly: _only create new files_ (the `<Feature>TourView.kt`
   - its test file), _never touch_ `ShiftsScreen.kt`/`SettingsScreen.kt` — those get
     wired by the orchestrator afterward to avoid 5 agents colliding on the same two
     files. Give each agent this doc + the matching iOS `.swift` file's exact copy/step
     structure/identifiers to mirror, plus `ShiftTourView.kt`/`ShiftTourViewModel.kt`/
     `ShiftTourViewTest.kt` as the Android-idiom reference.
2. **Serial merge** — copy each worktree's 2 new files into the main tree directly
   (`cp`, not `git merge` — the iOS round found worktree base-commit divergence made
   plain merges unreliable; targeted file copies after verifying no path collisions
   worked cleanly).
3. **Serial wiring** — orchestrator (you, in the fresh session) does all of
   `ShiftsScreen.kt` + `SettingsScreen.kt` wiring personally, one tour at a time,
   compiling after each addition rather than batching all 5 then debugging one giant
   diff.
4. **Verify** — `assembleDebug` + full Robolectric suite, per-tour then combined.

## Known traps from the iOS round (avoid repeating time cost)

- **Container-level `testTag`/semantics shadowing** — see the Robolectric section above.
  Assume it will happen at least once; test with `useUnmergedTree = true` from the
  start rather than discovering it via a mysteriously-failing `onNodeWithTag`.
- **The Swap tour's trigger is NOT a tab switch** — it's nested inside the manage-sheet
  flow, gated on reaching the swap _page_ specifically. Get this wrong and the tour
  either never fires or fires on the wrong page (over the Drop/Swap intent chooser,
  re-teaching a decision `ShiftTour` already owns).
- **Manual emulator click-through is unreliable for verification** — this session spent
  a large amount of time on iOS Simulator coordinate-based tapping before abandoning it
  for XCUITest identifier-based automation, which was far more reliable. Don't repeat
  that detour on Android — trust Robolectric + `assembleDebug`, per AGENTS.md's existing
  "no Android emulator" convention anyway.
- **Compile the demo build, not the live build, if you ever do want to eyeball something**
  in Android Studio yourself — `-PSUPABASE_URL=` bypasses login into DemoData (per
  existing mobile memory `reference_mobile_emulator_verification`).

## Open-Shifts claim tour: the one thing that must not get simplified away

This tour's entire reason for existing (per the original ask) is teaching that some open
shifts can be claimed **permanently** (a standing weekly pickup), not just once. Its
step-3 copy uses the real screen's own section-name wording — confirmed during the iOS
build by reading `ContentView.swift`'s open-shifts feed sections — **"Weekly open
shift"** (claims once) vs **"Permanent opening"** (repeats every week), with sheet
titles **"Claim shift"** vs **"Pick up permanently"**. Android's `ShiftsScreen.kt` /
`OpenShiftPresentation.kt` use byte-identical copy (confirmed cross-platform during the
iOS build) — use it verbatim, do not paraphrase.
