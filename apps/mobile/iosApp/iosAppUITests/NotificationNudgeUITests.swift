import XCTest

/// Coverage for the inline notification ask that replaced the blocking first-run permission
/// card on 2026-08-03 (BSpec §20.2).
///
/// A freshly installed simulator app sits at `UNAuthorizationStatus.notDetermined`, which is
/// exactly the "alerts are off, and the OS will still prompt" state the standing row exists
/// for, so no permission stubbing is needed to reach it.
///
/// Two claims are load-bearing and are what these tests exist to protect:
///   - the row has NO dismiss control (only granting alerts retires it), and
///   - it never blocks the screen, which is the whole difference between this and the modal
///     it replaced. That one is asserted by driving the tab bar while the row is up.
final class NotificationNudgeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Launch, then clear the "Manage a shift" tour that auto-opens on the first My-Shifts
    /// landing of a fresh install. Its scrim swallows taps, so without this every tab tap in
    /// this file lands on the tour instead of the bar. (The Android twin of this is
    /// `OnboardingTestState.markAllToursSeen`.)
    private func launchPastFirstRunTour() -> XCUIApplication {
        let app = XCUIApplication()
        app.launch()
        dismissActiveTour(app, timeout: 5)
        return app
    }

    /// Skip whichever interactive tour is currently up, if any. Each tab hosts its own tour
    /// that auto-starts on first arrival, so this has to run after every tab change, not only
    /// at launch: an active tour's scrim swallows the next tap (turning it into a dismiss),
    /// which silently makes a tab-navigation assertion pass or fail depending on how many
    /// tours happen to have been seen on that simulator already.
    private func dismissActiveTour(_ app: XCUIApplication, timeout: TimeInterval = 2) {
        for name in ["shift_tour", "openclaim_tour", "housegrid_tour", "preferences_tour", "break_tour", "swap_tour"] {
            let tour = app.otherElements[name]
            if tour.waitForExistence(timeout: timeout) {
                app.buttons["\(name)_skip"].tap()
                XCTAssertTrue(tour.waitForNonExistence(timeout: 5), "\(name) did not close on Skip")
                return
            }
        }
    }

    func testStandingAskRidesMyShifts() {
        let app = launchPastFirstRunTour()

        // My Shifts is the landing tab, so the ask is up on arrival.
        XCTAssertTrue(app.otherElements["notification_nudge"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["notification_nudge_confirm"].exists)
    }

    func testAskShipsNoDismissControl() {
        let app = launchPastFirstRunTour()

        XCTAssertTrue(app.otherElements["notification_nudge"].waitForExistence(timeout: 10))

        // The predecessor card shipped a "Not now" that marked the ask spent for the whole
        // install. Assert on every shape a dismiss has taken here, so reintroducing one fails.
        XCTAssertFalse(app.buttons["notification_nudge_dismiss"].exists)
        XCTAssertFalse(app.buttons["Not now"].exists)
        XCTAssertFalse(app.buttons["Got it"].exists)
    }

    func testAskDoesNotFollowTheWorkerToOtherTabs() {
        let app = launchPastFirstRunTour()

        XCTAssertTrue(app.otherElements["notification_nudge"].waitForExistence(timeout: 10))

        // `waitForNonExistence`, not a bare `exists`: XCUITest evaluates `exists` against the
        // snapshot it already holds, which on a SwiftUI tab change is taken before the new
        // tree has rendered, so a bare check reads the OLD tab and passes or fails at random.
        app.buttons["tab_open_shifts"].tap()
        XCTAssertTrue(app.otherElements["notification_nudge"].waitForNonExistence(timeout: 5))
        dismissActiveTour(app)

        app.buttons["tab_swaps"].tap()
        XCTAssertTrue(app.otherElements["notification_nudge"].waitForNonExistence(timeout: 5))
        dismissActiveTour(app)

        // ...and returns when the worker comes back, because nothing dismissed it.
        app.buttons["tab_my_shifts"].tap()
        XCTAssertTrue(app.otherElements["notification_nudge"].waitForExistence(timeout: 3))
    }

    func testAskNeverBlocksTheScreenBehindIt() {
        // The predecessor was a full-screen scrim + card the worker had to answer before the
        // app was usable. Driving the tab bar WHILE the row is up is what distinguishes an
        // inline row from a modal that merely looks smaller.
        let app = launchPastFirstRunTour()

        XCTAssertTrue(app.otherElements["notification_nudge"].waitForExistence(timeout: 10))

        // The More sheet is chosen deliberately: it is pure UI with no backend dependency, so
        // reaching it proves the nav tap landed without the assertion also depending on the
        // House tab having loaded data (which it will not on a live build with no session).
        app.buttons["tab_more"].tap()
        XCTAssertTrue(app.buttons["tab_settings"].waitForExistence(timeout: 5))
    }

    func testNoFirstRunWalkthroughCoversTheApp() {
        // The 7-step welcome tour and the one-card contextual tips were removed. Deliberately
        // a RAW launch, not `launchPastFirstRunTour` — this test is about what covers a fresh
        // launch, so skipping anything first would defeat it. The interactive ShiftTour may
        // legitimately be up; what must never come back is the welcome overlay or the primer.
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.buttons["tab_my_shifts"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.otherElements["onboarding_overlay"].exists)
        XCTAssertFalse(app.otherElements["notification_primer"].exists)
        XCTAssertFalse(app.staticTexts["Welcome to Shift"].exists)
    }
}
