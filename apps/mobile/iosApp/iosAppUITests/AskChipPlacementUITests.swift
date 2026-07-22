import XCTest

/// The "Ask" assistant chip is scoped to the My-Shifts home screen ONLY (2026-07-22). It used to
/// ride every tab except Assistant, which made it noise rather than discoverability: a floating
/// button that follows you everywhere covers content on the feeds and grids where the Assistant
/// isn't what you came to do. It stays reachable from "More" on every screen.
///
/// Worth pinning per-tab rather than eyeballing: the chip is a single `.overlay` on the whole tab
/// container, so one edit to its condition changes every screen at once with no local signal.
/// Mirrors Android's `AskChipPlacementTest`.
final class AskChipPlacementUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func askChip(_ app: XCUIApplication) -> XCUIElement {
        app.buttons["ask_assistant"]
    }

    func testChipShowsOnMyShifts() {
        let app = XCUIApplication()
        app.launch()

        // My Shifts is the launch tab.
        XCTAssertTrue(askChip(app).waitForExistence(timeout: 10), "the Ask chip belongs on My Shifts")
    }

    func testChipIsHiddenOnTheOtherBottomBarTabs() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(askChip(app).waitForExistence(timeout: 10))

        for tab in ["tab_open_shifts", "tab_house", "tab_swaps"] {
            let item = app.buttons[tab]
            XCTAssertTrue(item.waitForExistence(timeout: 5), "missing bottom-bar item \(tab)")
            item.tap()
            XCTAssertFalse(askChip(app).exists, "the Ask chip should not follow the worker onto \(tab)")
        }
    }

    func testChipComesBackOnReturningToMyShifts() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(askChip(app).waitForExistence(timeout: 10))

        app.buttons["tab_house"].tap()
        XCTAssertFalse(askChip(app).exists)

        app.buttons["tab_my_shifts"].tap()
        XCTAssertTrue(askChip(app).waitForExistence(timeout: 5), "returning to My Shifts restores the chip")
    }
}
