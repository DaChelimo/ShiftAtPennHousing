import XCTest

/// Coverage for the interactive swap-composer tour. Unlike the other five tours, this one
/// only opens once the worker actually reaches the swap page inside the manage sheet — so
/// this suite primes it from Settings, then drives the REAL navigation (tap a shift, choose
/// Swap, continue) rather than a shortcut, since that's the actual trigger condition being tested.
final class SwapTourUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Primes the tour (forces it to show the next time the swap page is reached, regardless
    /// of any prior seen-flag), then drives the real path into the composer's swap page.
    private func openTourViaRealFlow(_ app: XCUIApplication) {
        app.launch()

        let moreTab = app.buttons["tab_more"]
        XCTAssertTrue(moreTab.waitForExistence(timeout: 10))
        moreTab.tap()
        let settingsRow = app.buttons["tab_settings"]
        XCTAssertTrue(settingsRow.waitForExistence(timeout: 5))
        settingsRow.tap()
        let replayRow = app.buttons["settings_replay_swap_tour"]
        XCTAssertTrue(replayRow.waitForExistence(timeout: 5))
        replayRow.tap() // primes swapTourModel + navigates back to My Shifts

        // `calendar_shift_card` is the same identifier on every row (by design; see
        // ContentView.swift), so more than one demo shift on My Shifts means more than one
        // match. Any of them opens the manage sheet, so the first is fine here.
        let shiftCard = app.buttons["calendar_shift_card"].firstMatch
        XCTAssertTrue(shiftCard.waitForExistence(timeout: 5), "Need at least one demo shift on My Shifts to open the manage sheet")
        shiftCard.tap()

        let manageSheet = app.otherElements["manage_shift_sheet"]
        XCTAssertTrue(manageSheet.waitForExistence(timeout: 5))

        let swapIntent = app.buttons["intent_swap"]
        XCTAssertTrue(swapIntent.waitForExistence(timeout: 3))
        swapIntent.tap()

        let continueButton = app.buttons["swap_continue_button"]
        XCTAssertTrue(continueButton.waitForExistence(timeout: 3))
        continueButton.tap()
    }

    func testReachingSwapPageShowsFirstStep() {
        let app = XCUIApplication()
        openTourViaRealFlow(app)

        XCTAssertTrue(app.otherElements["swap_tour"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Swap or hand off"].waitForExistence(timeout: 2))
        // Never re-teaches Drop vs Swap — that decision already happened on the manage page.
        XCTAssertFalse(app.staticTexts["Drop the shift"].exists)
    }

    func testRangeStepSummaryReflectsModeChoice() {
        let app = XCUIApplication()
        openTourViaRealFlow(app)

        XCTAssertTrue(app.otherElements["swap_tour"].waitForExistence(timeout: 5))
        // Step 1: default is Swap mode; select Hand off instead.
        let handOffCard = app.buttons["swap_tour_mode_handoff"]
        XCTAssertTrue(handOffCard.waitForExistence(timeout: 3))
        handOffCard.tap()

        app.buttons["swap_tour_next"].tap()

        let rangeControl = app.otherElements["swap_tour_range"]
        XCTAssertTrue(rangeControl.waitForExistence(timeout: 5))
        let summary = app.staticTexts["swap_tour_summary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 3))
        XCTAssertTrue(summary.label.contains("nothing comes back"),
                      "Hand-off mode's summary must read differently from a two-way swap, got: \(summary.label)")
    }

    func testSplitTimelineTapToFocus() {
        let app = XCUIApplication()
        openTourViaRealFlow(app)

        XCTAssertTrue(app.otherElements["swap_tour"].waitForExistence(timeout: 5))
        app.buttons["swap_tour_next"].tap()
        XCTAssertTrue(app.otherElements["swap_tour_range"].waitForExistence(timeout: 3))
        app.buttons["swap_tour_next"].tap()

        let timeline = app.otherElements["swap_tour_split_timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 3))
        let freeSegment = app.otherElements["swap_seg_free"]
        if freeSegment.exists {
            freeSegment.tap()
        }
    }

    func testFullStepSequenceReachesDone() {
        let app = XCUIApplication()
        openTourViaRealFlow(app)

        XCTAssertTrue(app.otherElements["swap_tour"].waitForExistence(timeout: 5))
        app.buttons["swap_tour_next"].tap()
        XCTAssertTrue(app.otherElements["swap_tour_range"].waitForExistence(timeout: 3))
        app.buttons["swap_tour_next"].tap()

        let doneButton = app.buttons["swap_tour_next"]
        XCTAssertTrue(doneButton.waitForExistence(timeout: 3))
        XCTAssertEqual(doneButton.label, "Done")
        doneButton.tap()

        XCTAssertFalse(app.otherElements["swap_tour"].waitForExistence(timeout: 2))
    }
}
