# apps/mobile/ — Kotlin Multiplatform Worker App

Loaded when you work under `apps/mobile/`. Assumes you have read the root `AGENTS.md`.

Follows Google's Fruitties pattern: **shared logic, native UI per platform.** `:shared`
(commonMain / androidMain / iosMain) holds logic and ViewModels; `:androidApp` (Compose) and
`iosApp` (SwiftUI, consuming the `Shared` framework via SKIE) are the front ends.

App id `com.pennhousing.shift`, shared namespace `com.pennhousing.shift.shared`.
AGP 8.13.1 / Kotlin 2.2.21 / Gradle 9.2.1, version catalog.

This app is **worker-only**. There is no admin write surface; all filtering is server-side.

## Build and verify

```bash
./gradlew :androidApp:assembleDebug                     # Android (LIVE build: login screen)
./gradlew :androidApp:assembleDebug -PSUPABASE_URL=     # demo build: login bypass, DemoData
./gradlew :shared:compileKotlinIosSimulatorArm64        # fast KMP check (~seconds)
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64   # full framework + SKIE export (~50s)
./gradlew :shared:testAndroidHostTest                   # shared tests, JVM host
```

**Always run `:shared:compileKotlinIosSimulatorArm64` before assuming a shared change is
clean.** Android-only verification hides Kotlin/Native breakage. Emulator verification is
**iOS only**; `iosApp.xcodeproj` is present but gitignored, and
`xcodebuild ... "iPhone 17 Pro" build` is the real gate. See `iosApp/README.md`.

## KMP gotchas

- **`@Volatile` in `commonMain` must be `kotlin.concurrent.Volatile`** (import it
  explicitly). The bare `@Volatile` resolves to `kotlin.jvm.Volatile`, which compiles on
  Android/JVM but is an unresolved reference on Kotlin/Native. Android stays green while iOS
  silently breaks.
- SKIE renames collide with Swift: `BREAK` exports as `BREAK_SHIFT`, and Kotlin `Int` arrives
  as Swift `Int32`.
- App config reaches `commonMain` through the `AppConfig` holder (Android `BuildConfig` feeds
  it, iOS `Info.plist` feeds it). Never reference `BuildConfig` inside `commonMain`.
- supabase-kt is pinned via its BOM with ktor engines per platform (OkHttp in `androidMain`,
  Darwin in `iosMain`). The shared push POST uses a no-arg Ktor `HttpClient()` that resolves
  its engine from the classpath.
- The Realtime subscription deliberately carries **no** server-side user filter. RLS scopes
  rows to the authed worker and any change triggers a refetch, which also avoids the
  version-variable `postgresChangeFlow` filter DSL.
- supabase-kt drops a second filter on the same column. Restructure the query instead.

## Layering

`commonMain` imports **no** UI framework. Business rules never live in a Composable or a
SwiftUI View; if a view is deciding eligibility or claimability, it is in the wrong layer.

The tested surface is the pure decision layer: `shared/src/commonMain/.../{model,shifts,ack}`
plus the thin `viewmodel` StateFlow wrappers. The data and UI layers (`network/`, `data/`,
`platform/` expect-actual hooks, and the Compose/SwiftUI screens) are deliberately out of
scope for unit tests, the mobile analogue of the excluded Edge/HTTP layer. ViewModels take a
snapshot plus an injected `now`; never read a clock inside tested logic.

**Size ceilings apply here and these files already breach the 600-line limit** (verified
2026-07-23): `iosApp/iosApp/ContentView.swift` (~4,960, still by far the worst — down from
~5,500 the same day, after extracting the House tab into `HouseGridView.swift`, ~580 lines),
`shared/.../data/WorkerShiftsRepository.kt` (~1,490), `androidApp/.../ui/ShiftsScreen.kt`
(~1,100), `androidApp/.../ui/PreferencesScreen.kt` (~900), `androidApp/.../MainActivity.kt`
(~865). Do not grow them. New surface goes in a new file; when you make a substantial change
inside one, extract the section you touched on your way out — the House tab split is the
worked example: view code moved to `HouseGridView.swift` as an `extension ShiftsRootView`,
`@State`/`@StateObject`/static-constant storage stayed on the type in ContentView.swift
(Swift extensions cannot add stored properties) at `internal` access instead of `private` so
the extension file can reach it. The `.xcodeproj` uses classic `PBXFileReference`/
`PBXBuildFile` entries (not synchronized groups), so a new Swift file must be registered by
hand in `project.pbxproj` (file reference, build file, group membership, Sources phase) or
Xcode will not compile it. `androidApp/.../ui/house/HouseGrid.kt` is the pre-existing Android
analogue (already split out before this note).

## UI testing

**Invoke the `ui-testing` skill proactively right after any major UI change**, without
waiting to be asked to "add tests."

Major (skill required): a new screen; a new user-facing interactive gesture or control (drag,
hold-then-drag, multi-touch, a new picker or sheet); a changed multi-step user-facing flow;
removal of user-facing functionality.

Minor (skip): copy tweaks, colour/token/spacing changes, internal refactors with no change in
on-screen behavior.

The skill covers Android (Robolectric plus Compose UI testing, JVM-only, no emulator) and iOS
(XCUITest run headless via `xcodebuild test`), asserting only through the existing
`testTag` / `accessibilityIdentifier` contract. It also flags tests orphaned by removed or
changed UI, which is what keeps the suite from rotting.

**iOS gotcha:** `accessibilityIdentifier` on a container shadows its children. This caused 26
instances across 9 files before it was found. Put identifiers on leaves.

**iOS gotcha:** a tour/overlay observable must be `@ObservedObject` with `@Published` on
`MainActor`, or updates silently do not propagate.

## Maestro selector contract

`maestro/README.md` is load-bearing. Two constraints:

1. The My-Shifts section **containers** (`section_picked_up`, `section_dropped`,
   `section_scheduled`) must always render, with an empty-state placeholder, so
   `01-view-my-shifts` passes when a section is empty.
2. A fourth **Updates** tab (`tab_updates` → `pending_float_notification`) surfaces floats, so
   `04-acknowledge-float` can open the ack modal without it auto-covering the screen on every
   launch.

Maestro runs against a real emulator or simulator and is not verifiable from the JVM host.
It cannot launch on Baklava; drive it via `adb` there.

`DemoData` seeds My-Shifts on fixed **weekdays** of the current and next NY week so week
scoping is deterministic. Open shifts stay `now`-relative so they remain claimable.

## Cross-platform parity

Some rules exist **twice** and drift silently, recolouring or rewording one platform only:

- **Worker colours:** `apps/web/lib/workerColor.ts` and the Kotlin mirror
  `shared/.../house/WorkerColors.kt` must stay bit-identical. A worker's colour is a pure
  hash of their `user_id` with no storage anywhere. `WorkerColorsTest` pins the Kotlin copy
  against reference vectors generated from the TS one. If you change either, change
  `docs/design/worker-colors.md` and both copies.
- The colour applies **only** to the default scheduled look (`wearsWorkerColor()`). Float-in,
  pending, and vacant keep their state colours because those carry meaning; the "mine" ring
  composes on top rather than replacing the tint.
- **The 30-min block range slider** (drop / claim / swap sheets, and the three tour steps that
  teach them). `ContentView.swift`'s `BlockRangeSlider` is the reference; Android's
  `ui/kit/BlockRangeSlider.kt` is a port of it (6dp capsule track, 24dp white thumbs with a
  2dp blue ring, 32dp control, grab-a-thumb rather than press-anywhere). Android used to sit
  on Material 3's stock `RangeSlider`, whose expressive look (16dp bar track, 4x44dp handles,
  tick dots) read as a different control from the one iOS ships. Do not put it back: reaching
  for the platform's stock widget is exactly how these two drift apart.

## Onboarding tours

Six interactive tours (Shift, Preferences, Break, House grid, Open-claim, Swap). Read
`docs/design/interactive-onboarding-pattern.md` **before** building a new one.

**These six are the entire in-app teaching layer, and the list is closed.** The first-run
walkthrough of the bottom tabs (`Onboarding.WELCOME_TOUR`) and the six one-card contextual
tips (`Onboarding.CONTEXTUAL_TIPS`) were deleted 2026-08-03, along with the overlay chrome
on both platforms and the "Replay app tour" Settings row. Do not reintroduce a passive
one-card tier: a card that arrives uninvited, before the worker has a reason to care,
teaches nothing and trains the dismiss reflex the tours then inherit. A surface that needs
teaching earns a full interactive tour or a knowledge-base guide, and nothing in between.
BSpec §20.1 records the decision.

**The notification ask is an inline row, never a modal** (BSpec §20.2). Three placements:
standing on My Shifts while alerts are off (**no dismiss control** — only granting retires
it), and once each after a claim and after a swap or hand-off is sent. Copy is one line;
the old three-line body went unread. The action fires the OS dialog while `osCanPrompt`,
and deep-links to app notification settings after — required, because a row that persists
until granted outlives the one-shot OS prompt. Shared decision + copy in
`shared/.../onboarding/NotificationPriming.kt`; rendering in Android
`ui/onboarding/NotificationNudge.kt` and iOS `Onboarding.swift`.

All six dismiss on a scrim tap, gated per step. The scrim swallow is preserved **only** on
steps carrying a real continuous drag gesture: `Shift` / `OpenClaim` / `Swap` protect only
`AMOUNT` (range slider), `Preferences` protects only `PAINT` (press-and-drag canvas), `Break`
protects both `CLAIM` and `DROP`, and `HouseGrid` has no drag step so it is always
dismissible. A discrete-tap control (toggle, segmented control, tap-to-focus segment) does not
need protection; only continuous drags risk overshooting onto the scrim mid-gesture.

Tap-outside calls the same `skip()` the Skip button calls, but **also always** re-shows that
tour's pointer callout at the header "?", bypassing the once-ever `hasShown()` gate that
natural completion and the Skip button still respect. This is a deliberate product decision:
a quick tap-away should always remind the worker where to find the tour again. Do not fold it
into the natural-finish pointer path; they are two distinct triggers by design.

## Firebase

Deploy-time config, not committed. Android: `firebase-messaging` is a normal dependency but
the `com.google.gms.google-services` plugin is intentionally **not** applied (no
`google-services.json`), so `assembleDebug` stays green; FCM-token acquisition is wrapped in
`runCatching` and no-ops without a default FirebaseApp. iOS: `AppDelegate` guards Firebase
with `#if canImport(FirebaseMessaging)` so the app builds before the SPM package is added.
Both POST the **FCM** token (iOS derives it from APNs via Firebase) to `register-push-token`.
