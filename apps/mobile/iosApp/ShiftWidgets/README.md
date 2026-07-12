# ShiftWidgets — iOS home-screen widgets

WidgetKit extension for the worker app. Two widgets, display-only (every tile deep-links
into the app to act):

- **Upcoming shifts** (`UpcomingShiftsWidget`, static) — the worker's own next shifts
  (time, day, place). When floats are pending, a banner is pinned above the list:
  single float links to the ack screen; multiple floats link to Updates.
- **Open shifts** (`OpenShiftsWidget`, configurable) — claimable open shifts. The scope
  (My house / Other houses / Both) is an `AppIntent` the user picks in the widget's edit
  sheet; it shows as the tile title.

All three families (small / medium / large) are supported.

## How data reaches the widget

The widget is a **read-only cache**. The app writes a JSON snapshot to the shared App
Group on every data refresh (`WidgetSync` in the app target, driven off the Shifts UI
state and the float carousel); the widget reads the last-known snapshot
(`WidgetSnapshotStore`) and renders it. The contract lives in `WidgetShared/` and is
compiled into BOTH targets. If no snapshot exists yet, the widget falls back to
`WidgetSampleData` so the gallery preview still looks right.

## Required build configuration (non-obvious)

1. **App Group** `group.com.pennhousing.shift` — entitlement on BOTH the app
   (`iosApp/iosApp.entitlements`) and the extension
   (`ShiftWidgets/ShiftWidgets.entitlements`). This is the snapshot channel.

2. **Code signing is REQUIRED, even on the simulator.** The configurable Open Shifts
   widget uses an `AppIntent` for its scope. An *unsigned* build fails AppIntents
   resolution ("Couldn't communicate with a helper application" / "Unable to get LNAction
   from intent" / "No AppIntent in timeline(for:with:)") and the widget is stuck on its
   redacted placeholder. `project.yml` therefore ad-hoc signs (`CODE_SIGN_IDENTITY = "-"`)
   for the simulator. The static Upcoming widget works unsigned; the configurable one does
   not. (Device builds set a real identity in Xcode via `TEAM_ID` in `Config.xcconfig`.)

3. **The configuration `AppIntent` must be compiled into the app target too** (it lives in
   `WidgetShared/OpenShiftsConfigIntent.swift`). The system's intent helper is rooted in
   the containing app; if the intent exists only in the extension, the app emits no
   AppIntents metadata and resolution fails. It carries an explicit `perform()` because the
   app target is iOS 16 (the protocol's default `perform()` is iOS 17+).

4. **The widget extension targets iOS 17** (`AppIntentConfiguration`), while the app stays
   on iOS 16. A widget may target a higher OS than its host app.

## Verifying in the simulator

```
xcodegen generate
# demo build (login bypass + demo data) — exercises the widgets without a backend
xcodebuild -project iosApp.xcodeproj -scheme iosApp -sdk iphonesimulator \
  -configuration Debug -destination 'generic/platform=iOS Simulator' build SUPABASE_URL=""
xcrun simctl install booted "<build>/Shift PennHousing.app"
xcrun simctl launch booted com.pennhousing.shift   # pushes demo data into the App Group
```

Then add the widgets from the home-screen gallery (long-press → Edit → Add Widget →
search "Shift"). If a configurable widget is stuck on its placeholder, check the logs:
`xcrun simctl spawn booted log show --last 1m --predicate 'process CONTAINS "ShiftWidgets"'`.

## Known limitation

The Upcoming widget mirrors the app's current-week data (the repo fetch is week-scoped),
so late in the week it can show only the float banner with no remaining shifts. A
forward-looking fetch (next N shifts across week boundaries) is a future enhancement.

## Android

This is iOS only for now. The Android App Widget (Glance) is the planned follow-up; reuse
the same snapshot/deep-link shape.
