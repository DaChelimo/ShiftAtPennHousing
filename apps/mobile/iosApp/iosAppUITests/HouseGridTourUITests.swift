import XCTest

/// Coverage for the interactive House grid tour.
final class HouseGridTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Reaches House via its bottom-bar tab, then taps its always-present header "?" to
    /// force a replay. Settings used to carry a dedicated "Replay house grid tour" row for
    /// this (removed 2026-08-06, see AGENTS.md); the header "?" was always the tour's real,
    /// permanent entry point and still is.
    private func openTour(_ app: XCUIApplication) {
        app.launch()
        let houseTab = app.buttons["tab_house"]
        XCTAssertTrue(houseTab.waitForExistence(timeout: 10))
        houseTab.tap()

        // First-ever reach of this surface auto-starts the tour, in which case its
        // overlay is already covering the help button and tapping "housegrid_tour_help" would hit
        // the overlay's own scrim instead (dismissing an already-showing tour on any
        // dismissible step). A later run in the same test target has already marked the
        // tour seen, so auto-start does not refire and the help button is reachable.
        // Force it only when the tour is not already showing, so both orders are safe.
        if !app.otherElements["housegrid_tour"].waitForExistence(timeout: 2) {
            let helpButton = app.buttons["housegrid_tour_help"]
            XCTAssertTrue(helpButton.waitForExistence(timeout: 5))
            helpButton.tap()
        }
    }

    func testReplayShowsFirstStep() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["housegrid_tour"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Find who's on"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.otherElements["housegrid_tour_stage_rail"].exists)
        XCTAssertTrue(app.otherElements["housegrid_tour_stage_name_cell"].exists)
    }

    func testSwitchHouseAndWeekStepIsInteractive() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["housegrid_tour_next"].tap()

        let houseSwitcher = app.otherElements["housegrid_tour_stage_house_switcher"]
        XCTAssertTrue(houseSwitcher.waitForExistence(timeout: 3))
        houseSwitcher.tap()

        let nextWeek = app.buttons["housegrid_tour_stage_next_week"]
        XCTAssertTrue(nextWeek.waitForExistence(timeout: 3))
        nextWeek.tap()
    }

    func testEmptySeatStepShowsVacantCell() {
        let app = XCUIApplication()
        openTour(app)

        app.buttons["housegrid_tour_next"].tap()
        app.buttons["housegrid_tour_next"].tap()

        XCTAssertTrue(app.staticTexts["An empty seat"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.otherElements["housegrid_tour_stage_blank_cell"].exists)
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openTour(app)

        XCTAssertTrue(app.otherElements["housegrid_tour"].waitForExistence(timeout: 5))
        app.buttons["housegrid_tour_next"].tap()
        app.buttons["housegrid_tour_next"].tap()

        let doneButton = app.buttons["housegrid_tour_next"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 3))
        XCTAssertEqual(doneButton.label, "Done")
        doneButton.tap()

        XCTAssertFalse(app.otherElements["housegrid_tour"].waitForExistence(timeout: 2))
    }
}
