import XCTest

/// Coverage for the interactive Break calendar (claim / drop) tour.
final class BreakTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Reaches Break shifts via the real More-sheet path, then taps its always-present
    /// header "?" to force a replay. Settings used to carry a dedicated "Replay break tour"
    /// row for this (removed 2026-08-06, see AGENTS.md); the header "?" was always the
    /// tour's real, permanent entry point and still is.
    private func openTour(_ app: XCUIApplication) {
        app.launch()
        let moreTab = app.buttons["tab_more"]
        XCTAssertTrue(moreTab.waitForExistence(timeout: 10))
        moreTab.tap()
        let breakRow = app.buttons["tab_break"]
        XCTAssertTrue(breakRow.waitForExistence(timeout: 5))
        breakRow.tap()

        // First-ever reach of this surface auto-starts the tour, in which case its
        // overlay is already covering the help button and tapping "break_tour_help" would hit
        // the overlay's own scrim instead (dismissing an already-showing tour on any
        // dismissible step). A later run in the same test target has already marked the
        // tour seen, so auto-start does not refire and the help button is reachable.
        // Force it only when the tour is not already showing, so both orders are safe.
        if !app.otherElements["break_tour"].waitForExistence(timeout: 2) {
            let helpButton = app.buttons["break_tour_help"]
            XCTAssertTrue(helpButton.waitForExistence(timeout: 5))
            helpButton.tap()
        }
    }

    func testReplayShowsFirstStep() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["break_tour"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["First come, first served"].waitForExistence(timeout: 2))
    }

    func testClaimDragUpdatesSummary() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["break_tour_next"].tap()
        let grid = app.otherElements["break_tour_grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))

        let summary = app.staticTexts["break_tour_claim_summary"]
        let before = summary.exists ? summary.label : ""

        let start = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.15))
        let end = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.85))
        start.press(forDuration: 0.2, thenDragTo: end)

        XCTAssertTrue(summary.waitForExistence(timeout: 3))
        XCTAssertNotEqual(summary.label, before, "Dragging down a desk lane should update the live claim summary")
    }

    func testDropStepStartsWithDisabledButtonUntilSelection() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["break_tour_next"].tap()
        app.buttons["break_tour_next"].tap()

        let grid = app.otherElements["break_tour_grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        let dropButton = app.buttons["break_tour_drop_button"]
        XCTAssertTrue(dropButton.waitForExistence(timeout: 3))
        XCTAssertFalse(dropButton.isEnabled, "Drop must start disabled until the worker actually drags over claimed hours")

        let start = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.15))
        let end = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.6))
        start.press(forDuration: 0.2, thenDragTo: end)

        let message = app.staticTexts["break_tour_drop_message"]
        XCTAssertTrue(message.waitForExistence(timeout: 3))
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["break_tour"].waitForExistence(timeout: 5))
        app.buttons["break_tour_next"].tap()
        XCTAssertTrue(app.otherElements["break_tour_grid"].waitForExistence(timeout: 3))
        app.buttons["break_tour_next"].tap()

        let doneButton = app.buttons["break_tour_next"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 3))
        XCTAssertEqual(doneButton.label, "Done")
        doneButton.tap()

        XCTAssertFalse(app.otherElements["break_tour"].waitForExistence(timeout: 2))
    }

    func testTappingOutsideDismissesOnLayoutStep() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["break_tour"].waitForExistence(timeout: 5))
        // Step 1 (LAYOUT) is view-only, so tapping the scrim should dismiss the tour.
        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()

        let tourStillVisible = app.otherElements["break_tour"].waitForExistence(timeout: 2)
        XCTAssertFalse(tourStillVisible, "Tapping the scrim on LAYOUT should dismiss the tour")
    }

    func testTappingOutsideDoesNotDismissOnClaimOrDropSteps() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["break_tour_next"].tap()
        XCTAssertTrue(app.otherElements["break_tour_grid"].waitForExistence(timeout: 5))

        let corner = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        corner.tap()
        XCTAssertTrue(
            app.otherElements["break_tour"].waitForExistence(timeout: 2),
            "Tapping the scrim on CLAIM (a press-and-drag step) must not dismiss"
        )

        app.buttons["break_tour_next"].tap()
        XCTAssertTrue(app.otherElements["break_tour_grid"].waitForExistence(timeout: 3))

        corner.tap()
        XCTAssertTrue(
            app.otherElements["break_tour"].waitForExistence(timeout: 2),
            "Tapping the scrim on DROP (a press-and-drag step) must not dismiss"
        )
    }
}
