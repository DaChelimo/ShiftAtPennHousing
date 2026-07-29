import XCTest

/// Coverage for the 2026-07-24 swap-composer layout change (SwapCalendarPage, the live
/// "Propose a swap" calendar reached from a My-Shifts card): the take-hours selector moved
/// above the candidate roster, and the roster collapses to the picked person's row so the
/// selector (and give-vs-take comparison above it) doesn't get buried again by a long list.
/// `DemoData.houseWeekSeats` (shared Kotlin) always seeds several non-"me" workers on every
/// weekday, so this doesn't depend on which real day the suite happens to run on.
final class SwapCalendarComposerUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Drives the real navigation into the swap composer: tap a shift, choose Swap, continue.
    /// A fresh install may auto-show the swap-composer tour the first time this page is
    /// reached (see SwapTourUITests) — dismiss it via Skip if present so it doesn't swallow
    /// this suite's taps.
    private func openSwapComposer(_ app: XCUIApplication) {
        app.launch()

        let myShiftsTab = app.buttons["tab_my_shifts"]
        if myShiftsTab.waitForExistence(timeout: 5) { myShiftsTab.tap() }

        let shiftCard = app.buttons["calendar_shift_card"].firstMatch
        XCTAssertTrue(shiftCard.waitForExistence(timeout: 10), "Need at least one demo shift on My Shifts to open the manage sheet")
        shiftCard.tap()

        let manageSheet = app.otherElements["manage_shift_sheet"]
        XCTAssertTrue(manageSheet.waitForExistence(timeout: 5))

        let swapIntent = app.buttons["intent_swap"]
        XCTAssertTrue(swapIntent.waitForExistence(timeout: 3))
        swapIntent.tap()

        let continueButton = app.buttons["swap_continue_button"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 3))
        continueButton.tap()

        XCTAssertTrue(app.otherElements["swap_calendar_sheet"].waitForExistence(timeout: 5))

        let tourSkip = app.buttons["swap_tour_skip"]
        if tourSkip.waitForExistence(timeout: 2) { tourSkip.tap() }
    }

    func testPickingACandidateShowsHoursSelectorAndCollapsesRoster() {
        let app = XCUIApplication()
        openSwapComposer(app)

        // Before a pick: the full roster shows, no hours selector yet (nothing to show hours
        // for) and no collapsed row yet.
        XCTAssertTrue(app.otherElements["swap_take_list"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.otherElements["swap_take_range"].exists)
        XCTAssertFalse(app.buttons["swap_take_selected"].exists)

        let firstCandidate = app.buttons["swap_take_row"].firstMatch
        XCTAssertTrue(firstCandidate.waitForExistence(timeout: 3))
        firstCandidate.tap()

        // After a pick: the hours selector appears, and the roster collapses to one row.
        XCTAssertTrue(app.otherElements["swap_take_range"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["swap_take_selected"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.otherElements["swap_take_list"].exists)
    }

    func testTappingCollapsedRowReExpandsRoster() {
        let app = XCUIApplication()
        openSwapComposer(app)

        app.buttons["swap_take_row"].firstMatch.tap()
        let selected = app.buttons["swap_take_selected"]
        XCTAssertTrue(selected.waitForExistence(timeout: 3))

        selected.tap()

        XCTAssertTrue(app.otherElements["swap_take_list"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["swap_take_selected"].exists)
    }

    func testSwitchingDayReExpandsRosterEvenAfterAPick() {
        let app = XCUIApplication()
        openSwapComposer(app)

        app.buttons["swap_take_row"].firstMatch.tap()
        XCTAssertTrue(app.buttons["swap_take_selected"].waitForExistence(timeout: 3))

        // No PER-DAY accessibilityIdentifier exists — every day button in the strip shares
        // the container's "swap_day_strip" identifier, so matching on it returns all 7 day
        // buttons as a collection. Tap two distinct columns so at least one differs from
        // whichever day defaulted to selected (today's).
        let dayButtons = app.buttons.matching(identifier: "swap_day_strip")
        XCTAssertTrue(dayButtons.element(boundBy: 0).waitForExistence(timeout: 3))
        dayButtons.element(boundBy: 0).tap()
        dayButtons.element(boundBy: 3).tap()

        XCTAssertTrue(app.otherElements["swap_take_list"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["swap_take_selected"].exists)
    }
}
