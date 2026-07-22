# iOS: XCUITest (real, kept target)

No XCUITest target exists yet. `apps/mobile/iosApp/iosApp.xcodeproj` is generated from
`apps/mobile/iosApp/project.yml` via XcodeGen (see the header comment in that file explaining why
the scheme is hand-declared — the same reasoning applies here: add the target to `project.yml`, run
`xcodegen generate`, and commit both. Never hand-edit `project.pbxproj` directly; it will be
overwritten the next time anyone regenerates.

A prior XCUITest target existed once, as scratch work for a single SwiftUI hit-testing bug, and was
deleted after. This one is not scratch work — it stays in the repo permanently, alongside `iosApp`
and `ShiftWidgets`.

## First-time setup (do this once; skip if `iosAppUITests` already exists in `project.yml`)

Add a new target below the existing `ShiftWidgets:` target in `apps/mobile/iosApp/project.yml`:

```yaml
iosAppUITests:
  type: bundle.ui-testing
  platform: iOS
  sources:
    - path: iosAppUITests
  dependencies:
    - target: iosApp
```

Wire it into the existing `iosApp` scheme's `test:` action so `xcodebuild test -scheme iosApp` picks
it up:

```yaml
schemes:
  iosApp:
    build:
      targets:
        iosApp: all
    run:
      config: Debug
    test:
      config: Debug
      targets:
        - iosAppUITests
```

Create the source directory and a first test file at
`apps/mobile/iosApp/iosAppUITests/` (mirrors the sibling-target convention already used by
`ShiftWidgets`/`WidgetShared`).

Regenerate the project:

```bash
cd apps/mobile/iosApp && xcodegen generate
```

Commit `project.yml`, the regenerated `project.pbxproj`, and the new test source files together.

## Running tests

```bash
cd apps/mobile/iosApp
xcodebuild test \
  -project iosApp.xcodeproj \
  -scheme iosApp \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

This is scripted and headless — it boots/uses a simulator instance internally but does not require
(and must not use) the interactive Simulator control tools. Read the `xcodebuild test` output itself
to confirm pass/fail; do not screenshot the simulator to "check" the result.

To scope a run while iterating: append `-only-testing:iosAppUITests/ShiftTourUITests/testRangeStepAdvancesOnDrag`.

## Writing a test

Assert exclusively through `accessibilityIdentifier`, matching the exact string already set on the
SwiftUI view (e.g. `shift_tour_range`, `shift_tour_summary` on `ShiftTourView.swift`). Drive real
gestures with `XCUIElement` press-and-drag APIs, not just presence checks:

```swift
import XCTest

final class ShiftTourUITests: XCTestCase {
    func testRangeStepAdvancesSummaryOnDrag() {
        let app = XCUIApplication()
        app.launch()

        let rangeControl = app.otherElements["shift_tour_range"]
        XCTAssertTrue(rangeControl.waitForExistence(timeout: 5))

        let start = rangeControl.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5))
        let end = rangeControl.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: end)

        let summary = app.staticTexts["shift_tour_summary"]
        XCTAssertEqual(summary.label, "8:00 AM – 4:00 PM")
    }
}
```

Key points:

- `app.launch()` boots the real app target under test (DemoData build, since there is no backend in
  CI) — do not attempt to inject a fake ViewModel from the test target; XCUITest is black-box by
  design. If a flow needs specific fixture state, seed it via the app's existing DemoData paths, not
  by reaching into `:shared` internals from the test target.
- For a hold-then-drag gesture, use `press(forDuration:thenDragTo:)` (as above), not a raw `tap()`
  followed by a `swipe`.
- If a view has no `accessibilityIdentifier` yet, that's a one-line addition to the SwiftUI source,
  not a reason to match on `staticTexts["8:00 AM"]` or similar brittle content matching. Note the
  addition in your report.
