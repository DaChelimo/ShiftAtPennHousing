import XCTest

/// Coverage for the interactive Preferences (availability paint) tour.
final class PreferencesTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Reaches Preferences via the real More-sheet path, then taps its always-present
    /// header "?" to force a replay. Settings used to carry a dedicated "Replay preferences
    /// tour" row for this (removed 2026-08-06, see AGENTS.md); the header "?" was always the
    /// tour's real, permanent entry point and still is.
    private func openTour(_ app: XCUIApplication) {
        app.launch()
        let moreTab = app.buttons["tab_more"]
        XCTAssertTrue(moreTab.waitForExistence(timeout: 10))
        moreTab.tap()
        let preferencesRow = app.buttons["tab_preferences"]
        XCTAssertTrue(preferencesRow.waitForExistence(timeout: 5))
        preferencesRow.tap()

        // First-ever reach of this surface auto-starts the tour, in which case its
        // overlay is already covering the help button and tapping "preferences_tour_help" would hit
        // the overlay's own scrim instead (dismissing an already-showing tour on any
        // dismissible step). A later run in the same test target has already marked the
        // tour seen, so auto-start does not refire and the help button is reachable.
        // Force it only when the tour is not already showing, so both orders are safe.
        if !app.otherElements["preferences_tour"].waitForExistence(timeout: 2) {
            let helpButton = app.buttons["preferences_tour_help"]
            XCTAssertTrue(helpButton.waitForExistence(timeout: 5))
            helpButton.tap()
        }
    }

    func testReplayShowsFirstStepWithBrushSelector() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["preferences_tour"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Pick a mode"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["preferences_tour_brush_preferred"].waitForExistence(timeout: 2),
                      "Step 1 should show the real three-brush selector")
        XCTAssertTrue(app.buttons["preferences_tour_brush_available"].exists)
        XCTAssertTrue(app.buttons["preferences_tour_brush_cannot"].exists)
    }

    func testPaintGestureUpdatesSummary() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["preferences_tour_next"].tap()
        let grid = app.otherElements["preferences_tour_paint_grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))

        let summary = app.staticTexts["preferences_tour_paint_summary"]
        let before = summary.exists ? summary.label : ""

        // Drag down the vertical timeline via a real multi-point touch path (not a single
        // `press(forDuration:thenDragTo:)`, which XCUITest can deliver as one coarse
        // begin/end pair that the raw UIKit touchesBegan/Moved handler under
        // `PreferencesTourPaintSurface` doesn't register as a drag). Synthesizing several
        // intermediate touch-move points mirrors how a real finger actually drags.
        let steps = 6
        var touchDown = true
        for i in 0...steps {
            let dy = 0.1 + (0.8 * Double(i) / Double(steps))
            let point = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: dy))
            if touchDown {
                point.press(forDuration: 0.05)
                touchDown = false
            } else {
                point.press(forDuration: 0.02)
            }
        }

        XCTAssertTrue(summary.waitForExistence(timeout: 3))
        XCTAssertNotEqual(summary.label, before, "Painting down the timeline should update the live summary")
    }

    func testTargetHoursStepperIsInteractive() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["preferences_tour_next"].tap()
        app.buttons["preferences_tour_next"].tap()

        let value = app.staticTexts["preferences_tour_target_value"]
        XCTAssertTrue(value.waitForExistence(timeout: 5))
        let before = value.label

        app.buttons["preferences_tour_target_increment"].tap()
        XCTAssertNotEqual(value.label, before, "Tapping + should change the target-hours readout")
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["preferences_tour"].waitForExistence(timeout: 5))
        app.buttons["preferences_tour_next"].tap()
        XCTAssertTrue(app.otherElements["preferences_tour_paint_grid"].waitForExistence(timeout: 3))
        app.buttons["preferences_tour_next"].tap()

        let doneButton = app.buttons["preferences_tour_next"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 3))
        XCTAssertEqual(doneButton.label, "Done")
        doneButton.tap()

        XCTAssertFalse(app.otherElements["preferences_tour"].waitForExistence(timeout: 2))
    }
}
