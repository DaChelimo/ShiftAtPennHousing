import XCTest

/// Coverage for the interactive Open-shifts claim tour. Its whole reason for existing is
/// teaching workers that some open shifts can be claimed PERMANENTLY (a standing weekly
/// pickup), not only once — so step 3's scope toggle is this suite's most important check.
final class OpenClaimTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Reaches Open Shifts via its bottom-bar tab, then taps its always-present header "?"
    /// to force a replay. Settings used to carry a dedicated "Replay open shifts tour" row
    /// for this (removed 2026-08-06, see AGENTS.md); the header "?" was always the tour's
    /// real, permanent entry point and still is.
    private func openTour(_ app: XCUIApplication) {
        app.launch()
        let openShiftsTab = app.buttons["tab_open_shifts"]
        XCTAssertTrue(openShiftsTab.waitForExistence(timeout: 10))
        openShiftsTab.tap()

        // First-ever reach of this surface auto-starts the tour, in which case its
        // overlay is already covering the help button and tapping "openclaim_tour_help" would hit
        // the overlay's own scrim instead (dismissing an already-showing tour on any
        // dismissible step). A later run in the same test target has already marked the
        // tour seen, so auto-start does not refire and the help button is reachable.
        // Force it only when the tour is not already showing, so both orders are safe.
        if !app.otherElements["openclaim_tour"].waitForExistence(timeout: 2) {
            let helpButton = app.buttons["openclaim_tour_help"]
            XCTAssertTrue(helpButton.waitForExistence(timeout: 5))
            helpButton.tap()
        }
    }

    func testReplayShowsFirstStep() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["openclaim_tour"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Claim what's open"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.otherElements["openclaim_tour_subtabs"].exists)
    }

    func testRangeStepAdvancesSummaryOnDrag() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["openclaim_tour_next"].tap()
        let rangeControl = app.otherElements["openclaim_tour_range"]
        XCTAssertTrue(rangeControl.waitForExistence(timeout: 5))

        let summary = app.staticTexts["openclaim_tour_summary"]
        let before = summary.exists ? summary.label : ""

        let start = rangeControl.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = rangeControl.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: end)

        XCTAssertTrue(summary.waitForExistence(timeout: 3))
        XCTAssertNotEqual(summary.label, before, "Dragging the claim range should recompute the live summary")
    }

    /// The primary reason this tour exists: flipping the scope toggle must visibly change
    /// the live summary between "this week only" and a recurring/permanent wording.
    func testScopeToggleTeachesPermanentPickup() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["openclaim_tour_next"].tap()
        app.buttons["openclaim_tour_next"].tap()

        let toggle = app.otherElements["openclaim_tour_scope_toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let summary = app.staticTexts["openclaim_tour_summary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 3))
        let weeklySummary = summary.label

        let permanentPill = app.buttons["Permanent opening"]
        XCTAssertTrue(permanentPill.waitForExistence(timeout: 3))
        permanentPill.tap()

        XCTAssertNotEqual(summary.label, weeklySummary,
                           "Switching to Permanent opening must change the live summary to reflect recurring pickup")
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["openclaim_tour"].waitForExistence(timeout: 5))
        app.buttons["openclaim_tour_next"].tap()
        XCTAssertTrue(app.otherElements["openclaim_tour_range"].waitForExistence(timeout: 3))
        app.buttons["openclaim_tour_next"].tap()

        let doneButton = app.buttons["openclaim_tour_next"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 3))
        XCTAssertEqual(doneButton.label, "Done")
        doneButton.tap()

        XCTAssertFalse(app.otherElements["openclaim_tour"].waitForExistence(timeout: 2))
    }

    func testTappingOutsideDismissesOnADismissibleStep() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["openclaim_tour"].waitForExistence(timeout: 5))
        // Step 1 (CLAIM) has no drag gesture, so tapping the scrim should dismiss the tour.
        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()

        let tourStillVisible = app.otherElements["openclaim_tour"].waitForExistence(timeout: 2)
        XCTAssertFalse(tourStillVisible, "Tapping the scrim on CLAIM should dismiss the tour")
    }

    func testTappingOutsideDoesNotDismissOnTheRangeStep() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["openclaim_tour_next"].tap()
        XCTAssertTrue(app.otherElements["openclaim_tour_range"].waitForExistence(timeout: 5))

        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()

        let tourStillVisible = app.otherElements["openclaim_tour"].waitForExistence(timeout: 2)
        XCTAssertTrue(tourStillVisible, "Tapping the scrim on AMOUNT (the range slider step) must not dismiss")
    }
}
