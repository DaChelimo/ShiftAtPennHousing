import XCTest

/// Coverage for the interactive House grid tour.
final class HouseGridTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func openTour(_ app: XCUIApplication) {
        app.launch()
        let moreTab = app.buttons["tab_more"]
        XCTAssertTrue(moreTab.waitForExistence(timeout: 10))
        moreTab.tap()
        let settingsRow = app.buttons["tab_settings"]
        XCTAssertTrue(settingsRow.waitForExistence(timeout: 5))
        settingsRow.tap()

        let replayRow = app.buttons["settings_replay_housegrid_tour"]
        XCTAssertTrue(replayRow.waitForExistence(timeout: 5))
        replayRow.tap()
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
