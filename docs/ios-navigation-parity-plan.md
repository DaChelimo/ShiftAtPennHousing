# iOS Navigation Parity Plan

**Goal:** give the iOS worker app the same navigation model Android just got — a real back
stack, one guarded entry point for every move, and typed destinations — implemented the way
SwiftUI actually wants it, not by transliterating Kotlin.

**Status when this plan was written (2026-07-23):** Android is done and merged (6 commits,
`bb988a8~1..ccbed1b`). iOS is untouched and still uses the pattern Android replaced.

> **You are expected to do your own research.** This document tells you exactly what Android
> does and why, what iOS does today, and what "done" means. It deliberately does **not**
> prescribe the SwiftUI mechanism — `NavigationStack` with a hoisted path is the obvious
> candidate, but confirming that against current SwiftUI guidance (and deciding how it composes
> with a custom bottom bar and modal sheets) is your job. See "Research you must do first."

---

## 1. Why this exists

Android's worker app had navigation as `var selectedIndex: Int` plus nine `TAB_*` constants,
with no back stack: the system back button exited the app from any tab. That was replaced with
Navigation 3. iOS has the _identical_ design, one-for-one, and the same consequences.

The user-visible payoff on iOS is smaller than on Android (iOS has no hardware back button), so
**this is not a straight port.** The real wins on iOS are:

1. **One guarded entry point.** Today three different code paths change the tab, and one of them
   skips both the unsaved-edits guard and a required ViewModel sync (§3.3). That is a live bug.
2. **Typed destinations** instead of an `Int`-backed enum whose ordering is load-bearing.
3. **Edge-swipe back / a real navigation stack** where the flow is genuinely hierarchical, which
   is the iOS-native expectation the current flat tab state cannot express.
4. **Closing a documented platform divergence** (§3.4) that currently makes the two apps behave
   differently for the same action.

---

## 2. How Android navigation works now — read this fully

Six files, all under `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/`.

### 2.1 `navigation/ShiftDestination.kt` — typed destinations

Replaced nine integer constants whose invariant was enforced by a comment ("the constants MUST
match each tab's render position"). Nine `data object`s in a sealed hierarchy:

```kotlin
@Serializable
sealed interface ShiftDestination : NavKey {
    @Serializable data object MyShifts : ShiftDestination      // start destination
    @Serializable data object OpenShifts : ShiftDestination
    @Serializable data object House : ShiftDestination
    @Serializable data object Swaps : ShiftDestination
    @Serializable data object Updates : ShiftDestination
    @Serializable data object Preferences : ShiftDestination
    @Serializable data object BreakShifts : ShiftDestination
    @Serializable data object Settings : ShiftDestination
    @Serializable data object Assistant : ShiftDestination

    companion object {
        val START: ShiftDestination = MyShifts
        val BOTTOM_BAR = listOf(MyShifts, OpenShifts, House, Swaps)
        val MORE_SELECTS = setOf(Updates, Preferences, BreakShifts, Settings)  // NB: no Assistant
        val ALL = setOf(/* all nine */)
    }
}
```

`@Serializable` because Navigation 3 persists back stacks across process death by serializing
their keys. **`MORE_SELECTS` is the set that lights the "More" bar item as selected** — it
deliberately excludes `Assistant`, preserving exactly what the old ordinal range
`selectedIndex in TAB_UPDATES..TAB_SETTINGS` evaluated to. See §3.4: iOS disagrees here.

### 2.2 `navigation/ShiftNavigationState.kt` — one back stack per destination

Follows Google's
[multiple-back-stacks recipe](https://developer.android.com/guide/navigation/navigation-3/recipes/multiple-backstacks).
Every destination owns its own `NavBackStack` and its own `SaveableStateHolder`:

```kotlin
internal class ShiftNavigationState(
    val startRoute: ShiftDestination,
    current: MutableState<ShiftDestination>,
    val backStacks: Map<ShiftDestination, NavBackStack<NavKey>>,
) {
    var current: ShiftDestination by current

    @Composable
    fun decoratedEntries(entryProvider: (NavKey) -> NavEntry<NavKey>): List<NavEntry<NavKey>> {
        val decorated = backStacks.mapValues { (_, stack) ->
            rememberDecoratedNavEntries(
                backStack = stack,
                entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator()),
                entryProvider = entryProvider,
            )
        }
        // THE KEY LINE: the start destination stays underneath the current one.
        val inUse = if (current == startRoute) listOf(startRoute) else listOf(startRoute, current)
        return inUse.flatMap { decorated[it].orEmpty() }
    }
}
```

**The mechanism in one sentence:** the rendered entry list is `[start]` when you are home and
`[start, current]` otherwise, so the platform's own back handling sees a two-deep stack and pops
to the start destination — and when the list is one deep, nothing handles back and the OS exits
the app. That single line is the entire back-navigation behavior.

Every destination is top-level today, so each stack holds one entry. The per-destination stacks
exist so a nested route (a detail screen under House) can be pushed later without restructuring.

### 2.3 `navigation/ShiftNavigator.kt` — the single guarded entry point

This is the part that matters most for iOS.

```kotlin
internal class ShiftNavigator(
    private val state: ShiftNavigationState,
    private val canLeave: (from: ShiftDestination, to: ShiftDestination) -> Boolean,
    private val onBlocked: (ShiftDestination) -> Unit,
) {
    val current: ShiftDestination get() = state.current

    fun navigate(to: ShiftDestination) {
        if (to == state.current) return
        if (canLeave(state.current, to)) state.current = to else onBlocked(to)
    }

    /** Back goes home; at home it does nothing so the OS exits. */
    fun goBack() {
        if (state.current != state.startRoute) navigate(state.startRoute)
    }

    /** Only for resolving a move the guard already blocked, after the worker chose. */
    fun navigateUnchecked(to: ShiftDestination) { state.current = to }
}
```

Wired in `ShiftsScreen.kt` as:

```kotlin
val nav = rememberShiftNavigator(
    state = navState,
    canLeave = { from, _ -> from != ShiftDestination.Preferences || !preferencesVm.uiState.value.isDirty },
    onBlocked = { pendingTab = it },
)
```

**Why one entry point is the whole point.** Previously the unsaved-Preferences guard lived on the
forward-navigation helper only, so the system back button walked out of a dirty Preferences tab
and silently discarded the worker's painted edits. Because `goBack()` now routes through
`navigate()`, the guard covers both directions and cannot be forgotten at a new call site. **iOS
has the same class of bug today and one worse instance of it (§3.3).**

### 2.4 `navigation/ShiftBottomNav.kt` — the bar as data

The five bar items became a table so a new destination cannot drift out of sync with its label,
icon, test tag or onboarding anchor:

```kotlin
private data class BarItem(
    val destination: ShiftDestination, val icon: ImageVector,
    val label: String, val tag: String, val anchor: OnboardingTarget,
)
private val BAR_ITEMS = listOf(
    BarItem(ShiftDestination.MyShifts,   ShiftIcons.Calendar, "My Shifts", "tab_my_shifts",   OnboardingTarget.MY_SHIFTS_TAB),
    BarItem(ShiftDestination.OpenShifts, ShiftIcons.Plus,     "Open",      "tab_open_shifts", OnboardingTarget.OPEN_TAB),
    BarItem(ShiftDestination.House,      ShiftIcons.Building, "House",     "tab_house",       OnboardingTarget.HOUSE_TAB),
    BarItem(ShiftDestination.Swaps,      ShiftIcons.Refresh,  "Swaps",     "tab_swaps",       OnboardingTarget.SWAPS_TAB),
)
```

The "More" item is rendered separately with `selected = current in ShiftDestination.MORE_SELECTS`.

### 2.5 `ShiftsScreen.kt` — routing table and render

The old `when (selectedIndex) { TAB_MY -> …; TAB_OPEN -> … }` inside the Scaffold body became a
declarative provider hoisted out of the layout, rendered by one call:

```kotlin
val shiftEntryProvider = entryProvider<NavKey> {
    entry<ShiftDestination.MyShifts>   { CalendarTabContent(...) }
    entry<ShiftDestination.OpenShifts> { OpenShiftsTabContent(...) }
    // … one entry per destination
}

NavDisplay(
    entries = navState.decoratedEntries(shiftEntryProvider),
    onBack = { nav.goBack() },
)
```

### 2.6 `onboarding/TourHost.kt` — how the six tours hook into navigation

Relevant because iOS's tour auto-start reads the tab directly. Android's six tours each repeated
five effects (persist seen-set, auto-start on landing, raise the one-time pointer, fade it).
Those collapsed into `rememberTourHost(wiring, seen, active, autoStartWhen, onAutoStart)`, and
the auto-start condition is now **keyed on the typed destination**, not an index:

```kotlin
val shiftTour = rememberTourHost(
    wiring = TourWirings.Shift,
    seen = shiftTourState.seen,
    active = shiftTourState.active,
    autoStartWhen = current == ShiftDestination.MyShifts && welcomeDone,
    onAutoStart = shiftTourVm::autoStart,
)
```

`BreakTour` keys on `breakState.phase == BreakPhase.CLAIM_WINDOW` instead of a destination, and
`SwapTour` is driven from inside the manage-shift sheet and is deliberately not welcome-gated.

### 2.7 Behavior contract Android now guarantees

| Behavior                                       | Android                              |
| ---------------------------------------------- | ------------------------------------ |
| Back from any non-start destination            | returns to My Shifts                 |
| Back on My Shifts                              | unhandled → OS exits the app         |
| Per-destination `rememberSaveable` state       | preserved across switches            |
| Plain `remember` state (e.g. the Open sub-tab) | **not** preserved — see §5 caveat    |
| Leaving dirty Preferences forward              | guard sheet                          |
| Leaving dirty Preferences via back             | guard sheet (this was the bug fixed) |

---

## 3. What iOS looks like today

All in `apps/mobile/iosApp/iosApp/ContentView.swift` (**4,963 lines**) unless noted.

### 3.1 The state

```swift
// line 365
private enum Tab: Int { case mine, openShifts, house, updates, preferences, breakShifts, settings, swaps, assistant }

// line 502
@State private var tab: Tab = .mine
// line 511
@State private var pendingTab: Tab?
// line 546
@State private var showMore = false
```

An `Int`-backed enum in the same order as Android's retired `TAB_*` constants. **There is no
`NavigationStack` or `NavigationView` anywhere in the file** (verified: zero occurrences).

### 3.2 The three movement paths

```swift
// line 1427 — applies the move AND syncs the shared ViewModel
private func navigateTo(_ which: Tab) {
    tab = which
    switch which {
    case .mine:       model.vm.selectTab(tab: .myShifts)
    case .openShifts: model.vm.selectTab(tab: openSub == 0 ? .openHome : .openOther)
    case .house, .updates, .swaps, .preferences, .breakShifts, .settings, .assistant: break
    }
}

// line 1437 — the guard, wrapping navigateTo
private func requestTab(_ which: Tab) {
    if tab == .preferences, which != .preferences, prefsModel.state.isDirty {
        pendingTab = which
    } else {
        navigateTo(which)
    }
}
```

The bottom bar (line ~1323) calls `requestTab`; the More sheet rows (line ~1409) set
`showMore = false` then navigate. The guard dialog is a `.confirmationDialog` at line ~978
resolving `pendingTab`.

Note that iOS's `navigateTo` carries an extra responsibility Android's does not: **syncing
`model.vm.selectTab`**. Any refactor must preserve that.

### 3.3 The live bug — a third path that bypasses everything

```swift
// line 705
if breakModel.state.phase == .claimWindow && tab != .breakShifts {
    BreakOpenBanner(breakName: breakModel.state.breakName) { tab = .breakShifts }
}
```

This sets `tab` **directly**. It skips `requestTab` (so a worker on a dirty Preferences tab loses
their painted edits with no prompt) _and_ skips `navigateTo` (so `model.vm.selectTab` never
runs). This banner renders on every tab except Break, including Preferences, so it is reachable.

Android had the same bypass and it was closed by routing everything through `ShiftNavigator`.
**Fixing this is a required outcome of this work, not an optional extra.**

### 3.4 A real cross-platform divergence to resolve

```swift
// line 1312
private var isSecondary: Bool {
    tab == .updates || tab == .preferences || tab == .breakShifts || tab == .settings || tab == .assistant
}
```

iOS lights the "More" bar item for **Assistant**; Android's `MORE_SELECTS` does **not**. Same
action, different highlight, on the two platforms.

This is a product question, not a mechanical one. **Surface it to the user and get a decision
before encoding either behavior.** Android's exclusion was inherited from an ordinal range and
was preserved deliberately as a no-behavior-change refactor — it is not necessarily the
_intended_ design. Whichever wins, both platforms must then match and the specs must say so.

### 3.5 Tour auto-start

```swift
// line 689
private func autoStartTourForCurrentTab() {
    guard onboardingTourDone else { return }
    switch tab {
    case .mine:        shiftTourModel.autoStart()
    case .openShifts:  openClaimTourModel.autoStart()
    case .house:       houseGridTourModel.autoStart()
    case .preferences: preferencesTourModel.autoStart()
    default: break
    }
}
```

Invoked from `.onAppear`, `.onChange(of: tab)`, and `.onChange(of: onboardingTourDone)` — the
three-call pattern exists because SwiftUI's `onChange` never fires for the initial value, so a
default landing tab would otherwise never auto-start its tour. **Preserve that property**
whatever you replace `tab` with; it is documented in ARCHITECTURE §18 and has regressed before.

---

## 4. Research you must do first

Do not start editing until you can answer these. Prefer current Apple documentation and the
SwiftUI release notes for the project's deployment target over blog posts.

1. **`NavigationStack` with a hoisted `path`** — is a value-typed path binding the right shape
   for a custom (non-`TabView`) bottom bar? How does it interact with `.sheet` presentations,
   given the More sheet and the manage-shift sheet both present modally?
2. **One stack or one per tab?** Android gives each destination its own back stack. The iOS
   idiom for a tab bar is usually a `NavigationStack` per tab. Decide, and say why, given that
   every destination here is currently flat with no nested routes.
3. **Does iOS want back-to-home at all?** Android's "back returns to My Shifts" exists because
   Android has a hardware/gesture back that would otherwise kill the app. iOS's edge-swipe only
   pops a navigation stack. **Consider seriously that the correct iOS answer is _not_ to mirror
   back-to-home**, and that parity means "one guarded entry point + typed destinations", not
   "identical gestures". Bring a recommendation to the user.
4. **State restoration** — `@SceneStorage` is the iOS analogue of Nav3's serialized back stack.
   Is it warranted here, and does it survive the demo/live build split?
5. **Deep links.** `pennshift://float-ack/{floatId}` currently drives `launchFloatAckId` and a
   full-screen ack surface presented over everything. Confirm your design does not break it.

---

## 5. Caveats learned on Android — do not rediscover these

- **`SaveableStateHolder` only preserves saveable state.** A test asserting the Open-Shifts
  sub-tab survives a round trip _failed_, because that sub-tab is plain
  `remember { mutableIntStateOf(...) }`, not `rememberSaveable`. The equivalent iOS trap is
  `@State` on a view that leaves the hierarchy. Do not promise state preservation you have not
  converted the state to support.
- **Modal sheets are hostile to UI tests.** Robolectric hit-tests the More sheet's rows
  unreliably (a tap landed on the scrim, dismissing rather than navigating), so Android's
  More-sheet coverage was left to Maestro on a real device. Expect XCUITest to be _better_ here,
  but verify rather than assume — and if it is flaky, prefer the pure-logic test below.
- **Test the navigator, not just the screen.** The highest-value Android test is
  `ShiftNavigatorTest` — 9 cases, no Compose, constructing the navigator over an empty back-stack
  map and asserting routing plus the guard on both directions. It is fast, deterministic, and
  covers the actual bug. Find the Swift equivalent: make the navigation type a plain
  `ObservableObject`/`@Observable` that can be constructed and driven in a unit test without a
  view hierarchy. **Design for that from the start** — it is much harder to retrofit.

---

## 6. Scope

### In scope

1. Typed destination type replacing `enum Tab: Int`.
2. A single guarded navigation entry point; **all three current paths route through it**,
   including the §3.3 break-banner bypass.
3. Whatever `NavigationStack`/back model your research settles on, with a recommendation to the
   user before implementing if it diverges from Android's behavior.
4. Preserve `model.vm.selectTab` syncing (§3.2) and the three-call tour auto-start (§3.5).
5. Resolve the §3.4 `isSecondary`/`MORE_SELECTS` divergence (ask the user).
6. Tests: a unit test for the navigator; XCUITest for whatever navigation behavior is
   user-visible.
7. Spec updates in the same commit (§8).

### Out of scope

- Splitting the rest of `ContentView.swift`. It is 4,963 lines and **is** the next problem, but
  it is a separate piece of work. Only navigation moves out here. (A prior session already
  extracted `HouseGridView.swift`, 580 lines, as the worked example of how to do that.)
- Any change to `:shared`. Android's whole refactor touched zero shared code; keep that property
  so this cannot regress Android.
- Web.

---

## 7. Constraints — these break the build or the suite if ignored

- **Every `accessibilityIdentifier` must survive byte-identical.** The load-bearing ones:
  `tab_my_shifts`, `tab_open_shifts`, `tab_house`, `tab_swaps`, `tab_more`, `tab_updates`,
  `tab_preferences`, `tab_break`, `tab_settings`, `tab_assistant`, `tab_open_home`,
  `tab_open_other`, `more_sheet`, `shifts_screen`. Android's refactor verified this by diffing
  the sorted selector list before and after; do the same.
- **`accessibilityIdentifier` on a container shadows its children.** This bit the project 26
  times across 9 files. Put identifiers on leaves. (`apps/mobile/AGENTS.md`.)
- **A tour/overlay observable must be `@ObservedObject` with `@Published` on `MainActor`**, or
  updates silently do not propagate.
- **New Swift files must be registered by hand in `project.pbxproj`** — file reference, build
  file, group membership, and Sources phase. The project uses classic
  `PBXFileReference`/`PBXBuildFile` entries, not synchronized groups, so Xcode will simply not
  compile a file you only created on disk.
- `.onboardingAnchor(OnboardingAnchorId.*)` must stay on the same bar items.
- Onboarding anchors and the Maestro selector contract (`apps/mobile/maestro/README.md`) are
  shared with Android; do not rename anything.

---

## 8. Definition of done

- [ ] `xcodebuild build` green.
- [ ] `xcodebuild test -project apps/mobile/iosApp/iosApp.xcodeproj -scheme iosApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro'` green, including the 8 existing UITest files, which must pass **unmodified** except where navigation behavior intentionally changed.
- [ ] Sorted `accessibilityIdentifier` list diffed before/after — no unintended change.
- [ ] The §3.3 break-banner bypass is gone; no path mutates the destination outside the navigator.
- [ ] `:shared` untouched (`git diff --stat apps/mobile/shared` is empty), so Android cannot regress. Re-run `./gradlew :androidApp:testDebugUnitTest` once to confirm — it should be 62 passing.
- [ ] §3.4 divergence resolved and both platforms match.
- [ ] `BEHAVIORAL_SPECIFICATION.md` §20.4 updated: it currently ends "iOS does not yet mirror this back-button behavior; bringing it to iOS is pending." Replace with what iOS actually does.
- [ ] `ARCHITECTURE.md` §18.1 updated: it currently ends "iOS (`ContentView.swift`) still uses its tab state with no back stack; the SwiftUI equivalent (a hoisted `NavigationStack` path) is a pending TODO." Replace with the real mechanism.
- [ ] Invoke the `ui-testing` skill (AGENTS.md requires it for a changed multi-step flow) and let it flag orphaned tests.
- [ ] Commits follow the repo convention: one per change-set, conventional-commit subject, specs in the same commit as the behavior they describe.

---

## 9. Suggested commit sequence

Mirrors the Android sequence, which kept every step independently green and reviewable:

1. `refactor(mobile)` — typed destination type + single guarded navigator, no behavior change,
   including the §3.3 bypass fix. Existing tests prove no regression.
2. `feat(mobile)` — the `NavigationStack`/back model your research chose, with its tests.
3. `docs(spec)` — BSpec §20.4 + ARCH §18.1.

Keep step 1 behavior-neutral: it is the one that touches the most call sites, and having the
existing suite pass unmodified is what makes it safe to review.

---

## 10. Reference

- Android implementation: `git log -p bb988a8~1..ccbed1b` (6 commits). The Nav3 adoption commit
  `0ab012b` has the fullest rationale in its message.
- Android files: `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/navigation/`
  (4 files), `ui/onboarding/TourHost.kt`, `ui/onboarding/TourWirings.kt`.
- Android tests: `androidApp/src/test/java/com/pennhousing/shift/ui/navigation/ShiftNavigatorTest.kt`
  (9, pure JVM — the model to copy) and `.../ui/ShiftNavigationTest.kt` (2, Robolectric).
- Specs: `BEHAVIORAL_SPECIFICATION.md` §20.4, `ARCHITECTURE.md` §18 and §18.1.
- Repo rules: `apps/mobile/AGENTS.md` (KMP gotchas, size ceilings, iOS gotchas, Maestro
  contract), root `AGENTS.md` (specs-are-ground-truth, commit conventions).
- Navigation 3 recipe Android followed:
  <https://developer.android.com/guide/navigation/navigation-3/recipes/multiple-backstacks>
