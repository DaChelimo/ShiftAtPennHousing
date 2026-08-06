import XCTest

/// Coverage for the "Manage a shift" interactive tour (ShiftTourView.swift), the reference
/// implementation every other tour in this target mirrors. Confirms it's still reachable and
/// functional after the five new tours were wired alongside it in ContentView.swift.
final class ShiftTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Reaches the surface (My Shifts is the app's landing tab, so just launching is enough)
    /// and taps its always-present header "?" to force a replay. Settings used to carry a
    /// dedicated "Replay shift tour" row for this (removed 2026-08-06, see AGENTS.md); the
    /// header "?" was always the tour's real, permanent entry point and still is.
    private func openTour(_ app: XCUIApplication) {
        app.launch()
        // First-ever reach of this surface auto-starts the tour, in which case its
        // overlay is already covering the help button and tapping "shift_tour_help" would hit
        // the overlay's own scrim instead (dismissing an already-showing tour on any
        // dismissible step). A later run in the same test target has already marked the
        // tour seen, so auto-start does not refire and the help button is reachable.
        // Force it only when the tour is not already showing, so both orders are safe.
        if !app.otherElements["shift_tour"].waitForExistence(timeout: 2) {
            let helpButton = app.buttons["shift_tour_help"]
            XCTAssertTrue(helpButton.waitForExistence(timeout: 5))
            helpButton.tap()
        }
    }

    func testReplayFromHelpButtonShowsFirstStep() {
        let app = XCUIApplication()
        openTour(app)

        let tour = app.otherElements["shift_tour"]
        XCTAssertTrue(tour.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Manage a shift"].waitForExistence(timeout: 2))
    }

    func testRangeStepAdvancesSummaryOnDrag() {
        let app = XCUIApplication()
        openTour(app)

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
        openTour(app)

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        app.buttons["shift_tour_skip"].tap()

        let tourStillVisible = app.otherElements["shift_tour"].waitForExistence(timeout: 2)
        XCTAssertFalse(tourStillVisible, "Skip should dismiss the tour overlay")
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openTour(app)

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
        openTour(app)

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
        openTour(app)

        XCTAssertTrue(app.otherElements["shift_tour"].waitForExistence(timeout: 5))
        app.buttons["shift_tour_next"].tap()
        XCTAssertTrue(app.otherElements["shift_tour_range"].waitForExistence(timeout: 3))

        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()

        let tourStillVisible = app.otherElements["shift_tour"].waitForExistence(timeout: 2)
        XCTAssertTrue(tourStillVisible, "Tapping the scrim on AMOUNT (the range slider step) must not dismiss")
    }
}
