package com.pennhousing.shift.ui

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.preferences.PrefBlock
import com.pennhousing.shift.shared.preferences.PrefBrush
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.datetime.toLocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.time.Instant

/**
 * Coverage for the REAL Preferences timeline (`PrefTimeline` inside [PreferencesTabContent]) —
 * distinct from `PreferencesTourViewTest`, which exercises the tour's separate sample canvas.
 *
 * The one thing worth testing here is the SPLIT gesture model, because it is the whole reason the
 * screen is built the way it is: the block grid is a pure paint canvas that consumes its drags (so
 * the enclosing scroll can never steal them), and the left time gutter is the scroll handle. The
 * paint arithmetic itself is already covered by shared kotlin.test (`PreferencesTest`), so these
 * tests assert only what Compose actually routed where — through the VM's observable state, which
 * is the same contract the screen renders from.
 *
 * KNOWN GAP, stated so nobody trusts these further than they go: these do NOT cover the
 * scroll-vs-paint ARBITRATION. The bug that prompted the split (the grid consumed only AFTER touch
 * slop, so `verticalScroll` could win the first post-slop event and swallow the drag) still passes
 * every test here — Compose's synthesized `performTouchInput` does not reproduce the real-device
 * race. This was checked by reverting the fix and re-running: all four stayed green. Arbitration is
 * only observable on a real device/simulator, so it is verified by hand there; what these lock down
 * is the routing contract (grid paints ranges, gutter never paints, read-only ignores input), which
 * a refactor genuinely can break.
 */
// Robolectric's default window is a tiny legacy 320x470dp, which collapses this screen's content and
// silently breaks gestures on "phantom" zero-height nodes. A realistic device size is required
// (same reason as the identical @Config in PreferencesTourViewTest / ShiftTourViewTest).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class PreferencesScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun at(iso: String): Instant = Instant.parse(iso)

    private val weekStart = at("2026-06-08T12:00:00-04:00").toLocalDateTime(NEW_YORK).date // Mon Jun 8

    /**
     * Monday carries a full 16-block (08:00-16:00) day so the timeline is TALLER than the viewport.
     * That matters: a grid short enough to fit would make "the grid never scrolls the page"
     * vacuously true, and the test would pass even with the consumption bug present.
     */
    private val monday =
        (0 until 16).map { i ->
            val half = if (i % 2 == 0) "00" else "30"
            val hour = 8 + i / 2
            PrefBlock(blockId = "d0-b$i", start = at("2026-06-08T%02d:%s:00-04:00".format(hour, half)))
        }

    private val days = listOf(monday) + List(6) { emptyList<PrefBlock>() }

    private fun period(deadlinePassed: Boolean = false) =
        PreferencePeriod(
            periodId = "period-test",
            periodLabel = "Week of Jun 8",
            deadlineLabel = "Due Fri 17:00",
            submitted = false,
            deadlinePassed = deadlinePassed,
            weekStart = weekStart,
            days = days,
            initialStatuses = emptyMap(),
            targetHours = 16,
            optedOut = false,
        )

    private fun setScreen(vm: PreferencesViewModel) {
        composeRule.setContent { ShiftTheme { PreferencesTabContent(vm = vm) } }
    }

    /** How many of Monday's blocks currently hold [brush]. */
    private fun painted(
        vm: PreferencesViewModel,
        brush: PrefBrush = PrefBrush.PREFERRED,
    ) = vm.uiState.value.day.cells.count { it.brush == brush }

    @Test
    fun `dragging the block grid paints a contiguous range`() {
        val vm = PreferencesViewModel(period())
        setScreen(vm)
        assertEquals("fixture starts unpainted", 0, painted(vm))

        composeRule.onNodeWithTag("pref_block_grid", useUnmergedTree = true).performTouchInput {
            swipeDown(startY = top + 4f, endY = bottom - 4f)
        }

        // A range, not a single block: proves the drag was received as a paint sweep rather than
        // degrading to a tap (which is what a scroll stealing the gesture would leave behind).
        assertTrue("expected a multi-block range, painted=${painted(vm)}", painted(vm) > 1)
        assertTrue("a painted range should produce a run pill", vm.uiState.value.day.runs.isNotEmpty())
    }

    @Test
    fun `dragging the time gutter scrolls and never paints`() {
        val vm = PreferencesViewModel(period())
        setScreen(vm)

        composeRule.onNodeWithTag("pref_time_gutter", useUnmergedTree = true).performTouchInput {
            swipeDown(startY = top + 4f, endY = bottom - 4f)
        }

        // The gutter is the scroll handle: it carries NO paint gesture, so a drag there must leave
        // the grid untouched. (That it scrolls is the parent verticalScroll's own behaviour, which
        // is exactly what the grid's unconditional consume keeps it from doing on the grid side.)
        assertEquals("a gutter drag must not paint", 0, painted(vm))
        assertEquals(0, painted(vm, PrefBrush.CANNOT))
    }

    @Test
    fun `dragging back over the same brush erases the range`() {
        val vm = PreferencesViewModel(period())
        setScreen(vm)
        val grid = composeRule.onNodeWithTag("pref_block_grid", useUnmergedTree = true)

        grid.performTouchInput { swipeDown(startY = top + 4f, endY = bottom - 4f) }
        val afterFirst = painted(vm)
        assertTrue(afterFirst > 1)

        // Same span, same brush → the whole sweep erases (decided by the start block; see
        // PreferencesViewModel.beginPaintDrag).
        grid.performTouchInput { swipeDown(startY = top + 4f, endY = bottom - 4f) }

        assertTrue("a second same-brush sweep should erase", painted(vm) < afterFirst)
    }

    @Test
    fun `a read-only period ignores grid drags`() {
        val vm = PreferencesViewModel(period(deadlinePassed = true))
        setScreen(vm)

        composeRule.onNodeWithTag("pref_block_grid", useUnmergedTree = true).performTouchInput {
            swipeDown(startY = top + 4f, endY = bottom - 4f)
        }

        assertEquals("the deadline has passed; the canvas is disabled", 0, painted(vm))
    }
}
