import XCTest

/// Coverage for the "Manage a shift" interactive tour (ShiftTourView.swift), the reference
/// implementation every other tour in this target mirrors. Confirms it's still reachable and
/// functional after the five new tours were wired alongside it in ContentView.swift.
final class ShiftTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func openSettings(_ app: XCUIApplication) {
        app.launch()
        let moreTab = app.buttons["tab_more"]
        XCTAssertTrue(moreTab.waitForExistence(timeout: 10))
        moreTab.tap()
        let settingsRow = app.buttons["tab_settings"]
        XCTAssertTrue(settingsRow.waitForExistence(timeout: 5))
        settingsRow.tap()
    }

    func testReplayFromSettingsShowsFirstStep() {
        let app = XCUIApplication()
        openSettings(app)

        let replayRow = app.buttons["settings_replay_shift_tour"]
        XCTAssertTrue(replayRow.waitForExistence(timeout: 5))
        replayRow.tap()

        let tour = app.otherElements["shift_tour"]
        XCTAssertTrue(tour.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Manage a shift"].waitForExistence(timeout: 2))
    }

    func testRangeStepAdvancesSummaryOnDrag() {
        let app = XCUIApplication()
        openSettings(app)
        app.buttons["settings_replay_shift_tour"].tap()

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        app.buttons["shift_tour_next"].tap()

        let rangeControl = app.otherElements["shift_tour_range"]
        XCTAssertTrue(rangeControl.waitForExistence(timeout: 5))
        let summary = app.staticTexts["shift_tour_summary"]
        let before = summary.label

        let start = rangeControl.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = rangeControl.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: end)

        XCTAssertNotEqual(summary.label, before, "Dragging the range handle should recompute the live summary line")
    }

    func testSkipClosesTheTour() {
        let app = XCUIApplication()
        openSettings(app)
        app.buttons["settings_replay_shift_tour"].tap()

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        app.buttons["shift_tour_skip"].tap()

        let tourStillVisible = app.otherElements["shift_tour"].waitForExistence(timeout: 2)
        XCTAssertFalse(tourStillVisible, "Skip should dismiss the tour overlay")
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openSettings(app)
        app.buttons["settings_replay_shift_tour"].tap()

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        // Step 1 -> 2
        app.buttons["shift_tour_next"].tap()
        XCTAssertTrue(app.otherElements["shift_tour_range"].waitForExistence(timeout: 3))
        // Step 2 -> 3
        app.buttons["shift_tour_next"].tap()
        // Step 3 is last: the primary button reads "Done".
        let doneButton = app.buttons["shift_tour_next"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 3))
        XCTAssertEqual(doneButton.label, "Done")
        doneButton.tap()

        XCTAssertFalse(app.otherElements["shift_tour"].waitForExistence(timeout: 2))
    }

    func testTappingOutsideDismissesOnADismissibleStep() {
        let app = XCUIApplication()
        openSettings(app)
        app.buttons["settings_replay_shift_tour"].tap()

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        // Step 1 (MANAGE) has no drag gesture, so tapping the scrim should dismiss the tour.
        // Tap the far left edge at mid-height: well outside the centered, horizontally
        // padded card, so the touch can only land on the scrim itself (and away from the
        // top/bottom edges, clear of the status bar and home indicator).
        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()

        let tourStillVisible = app.otherElements["shift_tour"].waitForExistence(timeout: 2)
        XCTAssertFalse(tourStillVisible, "Tapping the scrim on MANAGE should dismiss the tour")
    }

    func testTappingOutsideDoesNotDismissOnTheRangeStep() {
        let app = XCUIApplication()
        openSettings(app)
        app.buttons["settings_replay_shift_tour"].tap()

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        app.buttons["shift_tour_next"].tap()
        XCTAssertTrue(app.otherElements["shift_tour_range"].waitForExistence(timeout: 3))

        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()

        let tourStillVisible = app.otherElements["shift_tour"].waitForExistence(timeout: 2)
        XCTAssertTrue(tourStillVisible, "Tapping the scrim on AMOUNT (the range slider step) must not dismiss")
    }
}
