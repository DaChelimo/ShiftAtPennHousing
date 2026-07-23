# iOS Navigation Parity Plan

**Goal:** give the iOS worker app the same navigation model Android just got — a real back
stack, one guarded entry point for every move, and typed destinations — implemented the way
SwiftUI actually wants it, not by transliterating Kotlin.

**Status (verified against the tree on 2026-07-23):** Android is done and merged (6 commits,
`bb988a8~1..ccbed1b`). iOS is untouched and still uses the pattern Android replaced.

> **You are expected to do your own research.** This document tells you exactly what Android
> does and why, what iOS does today, and what "done" means. It deliberately does **not**
> prescribe the SwiftUI mechanism — `NavigationStack` with a hoisted path is the obvious
> candidate, but confirming that against current SwiftUI guidance (and deciding how it composes
> with a custom bottom bar and modal sheets) is your job. See §4.

Every code excerpt and line number below was read out of the working tree, not recalled. Where
this document previously disagreed with the code, the code won (see §3.6 for what changed).

---

## 1. Why this exists

Android's worker app had navigation as `var selectedIndex: Int` plus nine `TAB_*` constants,
with no back stack: the system back button exited the app from any tab. That was replaced with
Navigation 3. iOS has the _identical_ design, one-for-one, and the same consequences.

The user-visible payoff on iOS is smaller than on Android (iOS has no hardware back button), so
**this is not a straight port.** The real wins on iOS are:

1. **One guarded entry point.** Six code paths change the tab today and exactly one of them
   skips both the unsaved-edits guard and a required ViewModel sync (§3.3). That is a live bug.
2. **Typed destinations** instead of an `Int`-backed enum whose ordering is load-bearing.
3. **Killing a duplicated switch.** Tab-keyed tour auto-start exists **twice** on iOS, in two
   `switch tab` statements that must be kept in sync by hand (§3.5). Android collapsed the
   equivalent duplication into `rememberTourHost`.
4. **Closing a documented platform divergence** (§3.4) that makes the two apps behave
   differently for the same action.
5. **Edge-swipe back / a real navigation stack** where the flow is genuinely hierarchical —
   but read §4.3 before assuming this one is wanted at all.

---

## 2. How Android navigation works now — read this fully

Four files under `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/navigation/`
(69 + 80 + 54 + 132 lines), plus wiring in `ui/ShiftsScreen.kt` (813 lines) and
`ui/onboarding/TourHost.kt`.

### 2.1 `ShiftDestination.kt` — typed destinations

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
        val ALL: Set<ShiftDestination> = setOf(/* all nine */)
    }
}
```

`@Serializable` because Navigation 3 persists back stacks across process death by serializing
their keys. **`MORE_SELECTS` is the set that lights the "More" bar item as selected** — it
deliberately excludes `Assistant`, preserving exactly what the old ordinal range
`selectedIndex in TAB_UPDATES..TAB_SETTINGS` evaluated to. See §3.4: iOS disagrees here.

### 2.2 `ShiftNavigationState.kt` — one back stack per destination

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

`current` is held in `rememberSerializable(..., MutableStateSerializer(ShiftDestination.serializer()))`,
not plain `remember`, so the selected destination survives process death alongside the stacks.

Every destination is top-level today, so each stack holds one entry. The per-destination stacks
exist so a nested route (a detail screen under House) can be pushed later without restructuring.

### 2.3 `ShiftNavigator.kt` — the single guarded entry point

This is the part that matters most for iOS. The whole class:

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

Wired in `ShiftsScreen.kt:241`:

```kotlin
val navState = rememberShiftNavigationState()
val nav = rememberShiftNavigator(
    state = navState,
    canLeave = { from, _ -> from != ShiftDestination.Preferences || !preferencesVm.uiState.value.isDirty },
    onBlocked = { pendingTab = it },
)
val current = nav.current
```

**Why one entry point is the whole point.** Previously the unsaved-Preferences guard lived on the
forward-navigation helper only, so the system back button walked out of a dirty Preferences tab
and silently discarded the worker's painted edits. Because `goBack()` routes through
`navigate()`, the guard covers both directions and cannot be forgotten at a new call site. **iOS
has the same class of bug today (§3.3).**

Note the guard is a **predicate over `(from, to)`**, not a hardcoded Preferences check inside the
navigator. The navigator knows nothing about Preferences; the host supplies the rule. Preserve
that shape on iOS — it is what makes the navigator unit-testable without a view hierarchy.

### 2.4 `ShiftBottomNav.kt` — the bar as data

The four bar items became a table so a new destination cannot drift out of sync with its label,
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

Selection is `current == item.destination`; the bar's `onSelect` is bound straight to
`nav::navigate`. The "More" item is rendered separately, tagged `tab_more`, anchored
`MORE_TAB`, carries the unread badge, and lights with
`selected = current in ShiftDestination.MORE_SELECTS`. Its `onClick` opens the sheet
(`showMore = true`); it never navigates directly.

### 2.5 `ShiftsScreen.kt` — routing table and render

The old `when (selectedIndex) { TAB_MY -> …; TAB_OPEN -> … }` inside the Scaffold body became a
declarative provider hoisted out of the layout (line 358), rendered by one call:

```kotlin
val shiftEntryProvider = entryProvider<NavKey> {
    entry<ShiftDestination.MyShifts>   { CalendarTabContent(...) }
    entry<ShiftDestination.OpenShifts> { OpenShiftsTabContent(...) }
    // … one entry per destination, nine total
}

NavDisplay(
    entries = navState.decoratedEntries(shiftEntryProvider),
    onBack = { nav.goBack() },
)
```

### 2.6 Every navigation call site on Android — the complete list

This is the parity target. **Ten call sites, all through `nav`, zero direct writes to `current`.**

| #   | Trigger                            | Call                                                    | File:line                   |
| --- | ---------------------------------- | ------------------------------------------------------- | --------------------------- |
| 1   | Bottom-bar item tap (x4)           | `nav::navigate`                                         | `ShiftsScreen.kt` bottomBar |
| 2   | System back button                 | `nav.goBack()` via `NavDisplay(onBack=)`                | `ShiftsScreen.kt`           |
| 3   | "More" sheet rows (x5)             | `showMore = false; nav.navigate(…)`                     | `ShiftsScreen.kt:789-808`   |
| 4   | Break-window banner                | `nav.navigate(BreakShifts)`                             | `ShiftsScreen.kt` body      |
| 5   | Ask-Assistant FAB (My Shifts only) | `nav.navigate(Assistant)`                               | `ShiftsScreen.kt` FAB slot  |
| 6   | Updates screen "open swaps"        | `nav.navigate(Swaps)`                                   | `ShiftsScreen.kt:441`       |
| 7   | Settings tour-replay rows (x6)     | `nav.navigate(…)` then `…Vm.replay()`                   | `ShiftsScreen.kt:499-521`   |
| 8   | Guard sheet "Save & leave"         | `onSubmitPreferences(); nav.navigateUnchecked(target)`  | `ShiftsScreen.kt:769`       |
| 9   | Guard sheet "Discard & leave"      | `preferencesVm.revert(); nav.navigateUnchecked(target)` | `ShiftsScreen.kt:774`       |
| 10  | Guard sheet "Keep editing"         | `pendingTab = null` (no move)                           | `ShiftsScreen.kt:779`       |

Supporting behaviors keyed on the destination rather than moving it:

- **Break banner visibility:** rendered above `NavDisplay` when
  `current != BreakShifts && breakState.phase == CLAIM_WINDOW`.
- **FAB visibility:** `AskAssistantButton` renders only when `current == MyShifts`. It used to
  ride every tab; that was deliberately reverted.
- **Contextual tips:** `LaunchedEffect(current)` fires `TipTrigger.MY_SHIFTS` on `MyShifts` and
  `TipTrigger.INCOMING_SWAP` on `Swaps`. Open-Shifts, House and Break tips were superseded by
  their interactive tours and are deliberately absent.

### 2.7 `TourHost.kt` — how the six tours hook into navigation

Relevant because iOS's tour auto-start reads the tab directly, twice. Android's six tours each
repeated five effects (persist seen-set, auto-start on landing, raise the one-time pointer, fade
it). Those collapsed into `rememberTourHost(wiring, seen, active, autoStartWhen, onAutoStart)`,
and the auto-start condition is now **keyed on the typed destination**, not an index:

```kotlin
val shiftTour = rememberTourHost(
    wiring = TourWirings.Shift,
    seen = shiftTourState.seen,
    active = shiftTourState.active,
    autoStartWhen = current == ShiftDestination.MyShifts && welcomeDone,
    onAutoStart = shiftTourVm::autoStart,
)
```

Four tours key on a destination (`Shift` → MyShifts, `Preferences` → Preferences, `HouseGrid` →
House, `OpenClaim` → OpenShifts), each `&& welcomeDone`. `Break` keys on
`breakState.phase == BreakPhase.CLAIM_WINDOW` instead of a destination. `Swap` is driven from
inside the manage-shift sheet, is deliberately **not** welcome-gated, and only registers a
seen-writer at the root — a root-level overlay would render behind the modal sheet.

### 2.8 Behavior contract Android now guarantees

| Behavior                                          | Android                              |
| ------------------------------------------------- | ------------------------------------ |
| Start destination                                 | `MyShifts`                           |
| Back from any non-start destination               | returns to My Shifts                 |
| Back on My Shifts                                 | unhandled → OS exits the app         |
| Navigating to the destination you are on          | no-op, guard not consulted           |
| Per-destination `rememberSaveable` state          | preserved across switches            |
| Plain `remember` state (e.g. the Open sub-tab)    | **not** preserved — see §5 caveat    |
| Selected destination across process death         | preserved (serialized)               |
| Leaving dirty Preferences forward                 | guard sheet                          |
| Leaving dirty Preferences via back                | guard sheet (this was the bug fixed) |
| "More" lit for Updates/Preferences/Break/Settings | yes                                  |
| "More" lit for Assistant                          | **no** (§3.4)                        |

### 2.9 The test that carries this

`androidApp/src/test/java/com/pennhousing/shift/ui/navigation/ShiftNavigatorTest.kt` — 9 cases,
**no Compose, no Robolectric**. It builds `ShiftNavigationState` directly with
`backStacks = emptyMap()` (nothing it asserts touches `decoratedEntries`, the only composition-
dependent member) and a mutable `prefsDirty` flag, then asserts routing, the no-op case, back to
start, back at start, and the guard on **both** directions plus `navigateUnchecked` resolution.

That test is only possible because the navigator is a plain class taking a state object and two
closures. **Design the Swift type for the same property from the start** — it is much harder to
retrofit. `ui/ShiftNavigationTest.kt` (2 Robolectric cases) covers the rendered screen.

---

## 3. What iOS looks like today

All in `apps/mobile/iosApp/iosApp/ContentView.swift` (**4,963 lines**) unless noted.

### 3.1 The state

```swift
// line 365
private enum Tab: Int { case mine, openShifts, house, updates, preferences, breakShifts, settings, swaps, assistant }

// line 502
@State private var tab: Tab = .mine
// line 504
@State private var openSub = 0        // 0 = My House, 1 = Others
// line 511
@State private var pendingTab: Tab?
// line 546
@State private var showMore = false
```

An `Int`-backed enum in the same order as Android's retired `TAB_*` constants. **There is no
`NavigationStack` or `NavigationView` anywhere in the file** (verified: zero occurrences).

### 3.2 The movement helpers

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

Two things Android's navigator does **not** do, which any refactor must preserve:

- **`navigateTo` syncs `model.vm.selectTab`.** Dropping this silently desynchronises the shared
  ViewModel from the visible tab.
- **`navigateTo(.openShifts)` reads `openSub`.** So a caller that wants the "Others" sub-tab must
  set `openSub` **before** navigating. The widget deep link (§3.2.1, path 5) relies on exactly
  that ordering.

#### 3.2.1 Every path that changes `tab` — the complete list

| #   | Trigger                                         | Code                                   | Line             | Guarded?                |
| --- | ----------------------------------------------- | -------------------------------------- | ---------------- | ----------------------- |
| 1   | Bottom-bar items (x5, "More" opens the sheet)   | `requestTab(…)`                        | 1323-1331        | yes                     |
| 2   | "More" sheet rows (x5)                          | `showMore = false; requestTab(which)`  | 1409 (`moreRow`) | yes                     |
| 3   | Settings tour-replay rows (x6)                  | `requestTab(…)` then `…Model.replay()` | 752-777          | yes                     |
| 4   | Ask-Assistant FAB (My Shifts only)              | `requestTab(.assistant)`               | 794              | yes                     |
| 5   | Widget deep link `deepLink.requestedRoute`      | `openSub = …; requestTab(…)`           | 963-973          | yes                     |
| 6   | **Break-window banner**                         | **`tab = .breakShifts`**               | **705**          | **NO**                  |
| 7   | Guard dialog "Save & leave" / "Discard & leave" | `navigateTo(target)`                   | 983-992          | intentionally unchecked |

Paths 1-5 are correct today. Path 6 is the bug (§3.3). Path 7 is the legitimate
`navigateUnchecked` equivalent.

There is **no back path at all** — nothing calls anything resembling `goBack()`, because
nothing can.

### 3.3 The live bug — the one path that bypasses everything

```swift
// line 705
if breakModel.state.phase == .claimWindow && tab != .breakShifts {
    BreakOpenBanner(breakName: breakModel.state.breakName) { tab = .breakShifts }
}
```

This sets `tab` **directly**. It skips `requestTab` (so a worker on a dirty Preferences tab loses
their painted edits with no prompt) _and_ skips `navigateTo` (so `model.vm.selectTab` never
runs — harmless for `.breakShifts` specifically, but the pattern is one edit away from mattering).
The banner renders on every tab except Break, including Preferences, so it is reachable.

Android had the same bypass and it was closed by routing everything through `ShiftNavigator`
(§2.6 row 4). **Fixing this is a required outcome of this work, not an optional extra.**

### 3.4 A real cross-platform divergence — RESOLVED 2026-07-23

```swift
// line 1312
private var isSecondary: Bool {
    tab == .updates || tab == .preferences || tab == .breakShifts || tab == .settings || tab == .assistant
}
```

iOS lit the "More" bar item for **Assistant**; Android's `MORE_SELECTS` did **not**. Same action,
different highlight, on the two platforms.

**Decision (user, 2026-07-23): both platforms light "More" while the Assistant is open.** iOS
already matched this (`isSecondary` above needed no change). Android's `MORE_SELECTS` has been
updated to include `Assistant` — see `ShiftDestination.kt`. Both platforms now agree.

### 3.4.1 Two more decisions from the same conversation, already implemented pre-refactor

Two more product decisions came out of the same round of questions and were small enough to ship
immediately, ahead of the full navigation refactor this document describes:

1. **The Assistant gets a back button, top-left, that returns to whatever screen the worker was
   on before opening it** — not hardcoded to My Shifts, since the Assistant is also reachable
   from the More sheet while on any tab. Implemented as `previousBeforeAssistant: Tab` (captured
   in a new `openAssistant()` wrapper, used by both the FAB and the Assistant row in `moreRow`)
   plus a back-chevron header in `AssistantTabView` (`AssistantScreen.swift`), mirroring Android's
   `AssistantReturnState` / `AssistantScreen.kt` back button.
2. **Confirmed, no change needed:** the Ask-Assistant FAB/chip only ever renders on My Shifts on
   both platforms (Android: `ShiftsScreen.kt` FAB slot gated on `current == MyShifts`; iOS:
   `ContentView.swift` FAB overlay gated on `tab == .mine`).

**This matters for the refactor in §6:** `previousBeforeAssistant` and `openAssistant()` are
built against the current flat `Tab` enum, not the typed `ShiftDestination`-equivalent this
document specifies. When the real refactor lands, re-express this state in terms of whatever
navigator type replaces `Tab` — do not leave two parallel navigation mechanisms. Add an eighth
call-site row for `openAssistant()` to the §3.2.1 table when you do (it wraps path 1's FAB and
one arm of path 2's `moreRow`, so those two rows change shape rather than a new row appearing).

### 3.5 Tour auto-start — the duplicated switch

iOS keys tour auto-start on the tab in **two places that must be kept in sync by hand**:

```swift
// line 689 — used for the INITIAL landing and for the welcome tour finishing
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

// line ~940 — used for SUBSEQUENT tab changes, and additionally fires the tip
.onChange(of: tab) { newTab in
    switch newTab {
    case .mine:        if onboardingTourDone { shiftTourModel.autoStart() }
    case .openShifts:  if onboardingTourDone { openClaimTourModel.autoStart() }
    case .house:       if onboardingTourDone { houseGridTourModel.autoStart() }
    case .swaps:       onboardingModel.vm.triggerTip(trigger: .incomingSwap)   // only here
    case .preferences: if onboardingTourDone { preferencesTourModel.autoStart() }
    default: break
    }
}
```

`autoStartTourForCurrentTab()` is invoked from `.onAppear` (line 925) and
`.onChange(of: onboardingTourDone)` (line 933). The two-entry-point pattern exists because
SwiftUI's `onChange` never fires for the initial value, so the default landing tab would
otherwise never auto-start its tour. **Preserve that property** whatever you replace `tab` with;
it is documented in ARCHITECTURE §18 and has regressed before.

Collapsing these two switches into one destination-keyed rule is the iOS analogue of Android's
`rememberTourHost` and is squarely in scope. Note the asymmetries when you do:
`.swaps → triggerTip(.incomingSwap)` exists only in the `onChange` copy; `Break` keys on
`breakModel.state.phase == .claimWindow` in its own `onChange`, not on a tab; and the swap tour
fires from `ManageShiftSheet`'s page change, not from a tab at all.

### 3.6 Corrections to the previous revision of this document

If you read an earlier copy of this plan, three claims in it were wrong:

1. It said the More-sheet rows "set `showMore = false` then navigate", implying a second
   unguarded path. They call `requestTab` and **are** guarded.
2. It said there were "three movement paths." There are seven (§3.2.1), and only one bypasses
   the guard.
3. It omitted the widget deep-link path entirely, including its load-bearing
   `openSub`-before-navigate ordering.

---

## 4. Research you must do first

Do not start editing until you can answer these. Prefer current Apple documentation and the
SwiftUI release notes for the project's deployment target over blog posts.

1. **`NavigationStack` with a hoisted `path`** — is a value-typed path binding the right shape
   for a custom (non-`TabView`) bottom bar? How does it interact with `.sheet` presentations,
   given the More sheet, the manage-shift sheet and the guard `confirmationDialog` all present
   modally off the same view?
2. **One stack or one per tab?** Android gives each destination its own back stack. The iOS
   idiom for a tab bar is usually a `NavigationStack` per tab. Decide, and say why, given that
   every destination here is currently flat with no nested routes.
3. **Does iOS want back-to-home at all?** Android's "back returns to My Shifts" exists because
   Android has a hardware/gesture back that would otherwise kill the app. iOS's edge-swipe only
   pops a navigation stack. **Consider seriously that the correct iOS answer is _not_ to mirror
   back-to-home**, and that parity means "one guarded entry point + typed destinations", not
   "identical gestures". Bring a recommendation to the user.
4. **State restoration** — `@SceneStorage` is the iOS analogue of the serialized `current` in
   §2.2. Is it warranted here, and does it survive the demo/live build split?
5. **Deep links, twice over.** `pennshift://float-ack/{floatId}` drives `launchFloatAckId` and a
   full-screen ack surface presented over everything; separately `deepLink.requestedRoute` drives
   widget tile routing through `requestTab` (§3.2.1 path 5). Confirm your design breaks neither,
   and keep the `openSub`-then-navigate ordering.

---

## 5. Caveats learned on Android — do not rediscover these

- **`SaveableStateHolder` only preserves saveable state.** A test asserting the Open-Shifts
  sub-tab survives a round trip _failed_, because that sub-tab is plain
  `remember { mutableIntStateOf(...) }`, not `rememberSaveable`. The iOS equivalent is `@State`
  on a view that leaves the hierarchy. Do not promise state preservation you have not converted
  the state to support. (`openSub` is exactly this trap, and it is read by `navigateTo`.)
- **Modal sheets are hostile to UI tests.** Robolectric hit-tested the More sheet's rows
  unreliably (a tap landed on the scrim, dismissing rather than navigating), so Android's
  More-sheet coverage was left to Maestro on a real device. Expect XCUITest to be _better_ here,
  but verify rather than assume — and if it is flaky, prefer the pure-logic test below.
- **Test the navigator, not just the screen.** §2.9. Make the navigation type a plain
  `@Observable`/`ObservableObject` constructible and drivable in a unit test with no view
  hierarchy, taking the guard as a closure rather than reaching for `prefsModel` itself.
- **iOS already solved container shadowing here.** `more_sheet` is deliberately a 1x1
  `Color.clear` overlay marker, not an identifier on the wrapping `VStack`, because the latter
  shadowed `tab_updates`/`tab_preferences`/`tab_break`/`tab_settings`/`tab_assistant` in the
  XCUITest tree. Do not "tidy" that back.

---

## 6. Scope

### In scope

1. Typed destination type replacing `enum Tab: Int`.
2. A single guarded navigation entry point; **all seven current paths route through it**,
   including the §3.3 break-banner bypass. The guard stays a `(from, to) -> Bool` closure
   supplied by the host, not a Preferences check baked into the navigator.
3. Whatever `NavigationStack`/back model your research settles on, with a recommendation to the
   user before implementing if it diverges from Android's behavior.
4. Preserve `model.vm.selectTab` syncing and the `openSub`-before-navigate ordering (§3.2).
5. Collapse the two tab-keyed tour switches into one destination-keyed rule, preserving the
   initial-landing auto-start that `onChange` alone cannot deliver (§3.5).
6. ~~Resolve the §3.4 `isSecondary`/`MORE_SELECTS` divergence~~ — done, see §3.4. Re-verify it
   still holds once the typed destination type lands (Android's `MORE_SELECTS` now includes
   `Assistant`; iOS's replacement for `isSecondary` must too).
7. Re-express `previousBeforeAssistant` / `openAssistant()` (§3.4.1) in terms of the new
   navigator type instead of the retired `Tab` enum.
8. Tests: a unit test for the navigator mirroring `ShiftNavigatorTest`'s 9 cases (extend it to
   cover Assistant-return, mirroring Android's `AssistantReturnStateTest`); XCUITest for
   whatever navigation behavior is user-visible.
9. Spec updates in the same commit (§8).

### Out of scope

- Splitting the rest of `ContentView.swift`. It is 4,963 lines and **is** the next problem, but
  it is a separate piece of work. Only navigation moves out here. (A prior session already
  extracted `HouseGridView.swift`, ~580 lines, as the worked example of how to do that.)
- Any change to `:shared`. Android's whole refactor touched zero shared code; keep that property
  so this cannot regress Android.
- Web.

---

## 7. Constraints — these break the build or the suite if ignored

- **Every `accessibilityIdentifier` must survive byte-identical.** The load-bearing ones:
  `tab_my_shifts`, `tab_open_shifts`, `tab_house`, `tab_swaps`, `tab_more`, `tab_updates`,
  `tab_preferences`, `tab_break`, `tab_settings`, `tab_assistant`, `tab_open_home`,
  `tab_open_other`, `more_sheet`, `shifts_screen`, plus `assistant_back` (the §3.4.1 back
  button, added 2026-07-23). Android's refactor verified this by diffing the sorted selector
  list before and after; do the same. Note most `tab_*` ids reach the tree through the
  `barItem(_:_:_:selected:badge:_:)` and `moreRow(_:_:_:_:)` helpers, so grepping for a literal
  `accessibilityIdentifier("tab_house")` finds nothing — grep the helper call sites.
- **`accessibilityIdentifier` on a container shadows its children.** This bit the project 26
  times across 9 files. Put identifiers on leaves. (`apps/mobile/AGENTS.md`.)
- **A tour/overlay observable must be `@ObservedObject` with `@Published` on `MainActor`**, or
  updates silently do not propagate.
- **New Swift files must be registered by hand in `project.pbxproj`** — file reference, build
  file, group membership, and Sources phase. The project uses classic
  `PBXFileReference`/`PBXBuildFile` entries, not synchronized groups, so Xcode will simply not
  compile a file you only created on disk.
- **Swift extensions cannot add stored properties.** If you move view code to a new file as an
  `extension ShiftsRootView`, the `@State`/`@StateObject` storage stays on the type in
  `ContentView.swift` at `internal` (not `private`) access. This is how `HouseGridView.swift` did it.
- `.onboardingAnchor(OnboardingAnchorId.*)` must stay on the same bar items:
  `myShifts`/`open`/`house`/`swaps`/`more`.
- Onboarding anchors and the Maestro selector contract (`apps/mobile/maestro/README.md`) are
  shared with Android; do not rename anything.

---

## 8. Definition of done

- [ ] `xcodebuild build` green.
- [ ] `xcodebuild test -project apps/mobile/iosApp/iosApp.xcodeproj -scheme iosApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro'` green, including the 8 existing UITest files (`AskChipPlacement`, `BreakTour`, `HouseGridTour`, `OpenClaimTour`, `PreferencesPaint`, `PreferencesTour`, `ShiftTour`, `SwapTour`), which must pass **unmodified** except where navigation behavior intentionally changed.
- [ ] Sorted `accessibilityIdentifier` list diffed before/after — no unintended change.
- [ ] The §3.3 break-banner bypass is gone; **no path mutates the destination outside the navigator**, verifiable by grep: the only writes are inside the navigator type.
- [ ] A navigator unit test exists and covers the §2.9 cases, including the guard on both directions.
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
   including the §3.3 bypass fix and its unit test. Existing tests prove no regression.
2. `refactor(mobile)` — collapse the duplicated tour-auto-start switches onto the typed
   destination (§3.5).
3. `feat(mobile)` — the `NavigationStack`/back model your research chose, with its tests.
4. `docs(spec)` — BSpec §20.4 + ARCH §18.1.

Keep step 1 behavior-neutral: it is the one that touches the most call sites, and having the
existing suite pass unmodified is what makes it safe to review.

---

## 10. Reference

- Android implementation: `git log -p bb988a8~1..ccbed1b` (6 commits). The Nav3 adoption commit
  `0ab012b` has the fullest rationale in its message.
- Android files: `apps/mobile/androidApp/src/main/java/com/pennhousing/shift/ui/navigation/`
  (`ShiftDestination.kt`, `ShiftNavigationState.kt`, `ShiftNavigator.kt`, `ShiftBottomNav.kt`),
  `ui/ShiftsScreen.kt`, `ui/onboarding/TourHost.kt`, `ui/onboarding/TourWirings.kt`.
- Android tests: `androidApp/src/test/java/com/pennhousing/shift/ui/navigation/ShiftNavigatorTest.kt`
  (9, pure JVM — the model to copy) and `.../ui/ShiftNavigationTest.kt` (2, Robolectric).
- iOS: `apps/mobile/iosApp/iosApp/ContentView.swift`, plus `HouseGridView.swift` as the
  extraction pattern.
- Specs: `BEHAVIORAL_SPECIFICATION.md` §20.4, `ARCHITECTURE.md` §18 and §18.1.
- Repo rules: `apps/mobile/AGENTS.md` (KMP gotchas, size ceilings, iOS gotchas, Maestro
  contract), root `AGENTS.md` (specs-are-ground-truth, commit conventions).
- Navigation 3 recipe Android followed:
  <https://developer.android.com/guide/navigation/navigation-3/recipes/multiple-backstacks>
