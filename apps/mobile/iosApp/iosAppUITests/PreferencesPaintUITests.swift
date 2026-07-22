import XCTest

/// Coverage for the REAL Preferences timeline (`PrefTimelineView`) — distinct from
/// `PreferencesTourUITests`, which drives the tour's separate sample canvas.
///
/// What matters here is the SPLIT gesture model, which is the whole reason the screen is shaped the
/// way it is: the block grid is a pure paint canvas that never scrolls the page, and the left time
/// gutter is the scroll handle.
///
/// KNOWN GAP, stated so nobody trusts these further than they go: they do NOT cover the
/// scroll-vs-paint ARBITRATION. The bug that prompted the split (the paint surface disabled only
/// the NEAREST enclosing scroll view, while Preferences also sat inside the shared page ScrollView,
/// so the outer one stayed free to pan and swallowed the drag) still passes both tests here — the
/// synthesized multi-point touch path is not a real continuous pan, so the outer scroll view never
/// grabs it. This was checked by reintroducing the nesting and re-running: both stayed green.
/// Arbitration is only observable with a real finger, so it is verified by hand on the simulator;
/// what these lock down is the routing contract (grid paints, gutter never paints, header pinned),
/// which a refactor genuinely can break. Android's `PreferencesScreenTest` carries the same caveat.
final class PreferencesPaintUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func openPreferences(_ app: XCUIApplication) {
        app.launch()
        let moreTab = app.buttons["tab_more"]
        XCTAssertTrue(moreTab.waitForExistence(timeout: 10))
        moreTab.tap()
        let prefsRow = app.buttons["tab_preferences"]
        XCTAssertTrue(prefsRow.waitForExistence(timeout: 5))
        prefsRow.tap()
        XCTAssertTrue(app.otherElements["preferences_screen"].waitForExistence(timeout: 5))
    }

    /// `pref_block_grid` / `preferences_screen` are deliberately 1x1 marker overlays (an identifier
    /// on a wrapping container leaks onto every descendant and shadows their own ids), so they can
    /// be found but not dragged. The block cells are the real, sized elements — anchor gestures to
    /// the first one and reach past it with normalized offsets greater than 1.
    private func firstBlockCell(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "pref_block_cell").element(boundBy: 0)
    }

    /// Drag vertically with a real multi-point touch path. A single
    /// `press(forDuration:thenDragTo:)` can be delivered as one coarse begin/end pair, which the
    /// raw UIKit `touchesBegan/Moved` handler under `PaintSurface` does not register as a drag at
    /// all; synthesizing intermediate points mirrors how a finger actually moves. (Same technique
    /// and reason as `PreferencesTourUITests.testPaintGestureUpdatesSummary`.)
    private func drag(_ element: XCUIElement, fromY: Double, toY: Double) {
        let steps = 6
        for i in 0...steps {
            let dy = fromY + ((toY - fromY) * Double(i) / Double(steps))
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: dy))
                .press(forDuration: i == 0 ? 0.05 : 0.02)
        }
    }

    func testDraggingTheGridPaintsWithoutScrollingThePage() {
        let app = XCUIApplication()
        openPreferences(app)

        let cell = firstBlockCell(app)
        XCTAssertTrue(cell.waitForExistence(timeout: 5))

        // The brush selector is pinned above the scrolling timeline, so it only moves if the PAGE
        // scrolled — which is exactly what the bug did instead of painting.
        let brush = app.buttons["pref_brush_preferred"]
        XCTAssertTrue(brush.waitForExistence(timeout: 5))
        let brushBefore = brush.frame.origin.y

        // Sweep down across several blocks (offsets >1 reach past the anchor cell).
        drag(cell, fromY: 0.5, toY: 4.5)

        XCTAssertEqual(
            brush.frame.origin.y, brushBefore, accuracy: 1.0,
            "a drag on the grid must paint, never scroll the page"
        )
        XCTAssertTrue(
            app.descendants(matching: .any).matching(identifier: "pref_run_pill").element(boundBy: 0)
                .waitForExistence(timeout: 3),
            "dragging the grid should have painted a run"
        )
        XCTAssertTrue(app.buttons["pref_discard_button"].exists, "painting makes the period dirty")
    }

    func testDraggingTheTimeGutterScrollsAndNeverPaints() {
        let app = XCUIApplication()
        openPreferences(app)

        let gutter = app.descendants(matching: .any).matching(identifier: "pref_time_gutter").element(boundBy: 0)
        XCTAssertTrue(gutter.waitForExistence(timeout: 5))

        // Drag UPWARD on the gutter, which scrolls further into the day.
        drag(gutter, fromY: 0.9, toY: 0.1)

        // The gutter carries no paint gesture, so nothing became dirty and no run appeared.
        XCTAssertFalse(
            app.buttons["pref_discard_button"].exists,
            "a drag on the time gutter must scroll, never paint"
        )
        XCTAssertFalse(
            app.descendants(matching: .any).matching(identifier: "pref_run_pill").element(boundBy: 0).exists,
            "a drag on the time gutter must not paint a run"
        )
    }
}
