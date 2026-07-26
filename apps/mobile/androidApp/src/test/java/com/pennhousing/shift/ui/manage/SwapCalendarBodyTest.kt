package com.pennhousing.shift.ui.manage

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.time.Clock
import kotlin.time.Duration.Companion.minutes

/**
 * Coverage for the 2026-07-24 swap-composer layout change (SwapCalendarBody, the live
 * "Propose a swap" calendar reached from a My-Shifts card): the take-hours selector moved
 * above the candidate list, and the candidate list collapses to the picked person's row so
 * the selector (and give-vs-take comparison above it) doesn't get buried again by a long
 * roster. `DemoData.houseWeekSeats` always seeds several non-"me" workers on every weekday,
 * so this doesn't depend on which real day the suite happens to run on.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class SwapCalendarBodyTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun setContent() {
        val now = Clock.System.now()
        val give =
            MyShift(
                id = "give-1",
                house = House("harnwell", "Harnwell"),
                start = now,
                end = now + 30.minutes,
                kind = AssignmentKind.SCHEDULED,
            )
        val seats = DemoData.houseWeekSeats(now, meUserId = "demo")
        composeRule.setContent {
            ShiftTheme {
                // Mirrors ShiftBottomSheet's own vertical scroll (Sheets.kt) — SwapCalendarBody
                // is always hosted inside that scrollable body in production, and content this
                // long overflows a bare Robolectric window without it.
                androidx.compose.foundation.layout.Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    SwapCalendarBody(giveShift = give, meUserId = null, demoSeats = seats, onSubmit = {})
                }
            }
        }
    }

    @Test
    fun `picking a candidate shows the hours selector and collapses the roster`() {
        setContent()

        // Before a pick: the full roster shows, no hours selector yet (nothing to show hours
        // for) and no collapsed row yet.
        composeRule.onAllNodesWithTag("swap_take_list").assertCountEquals(1)
        composeRule.onAllNodesWithTag("swap_take_range").assertCountEquals(0)
        composeRule.onAllNodesWithTag("swap_take_selected").assertCountEquals(0)

        composeRule
            .onAllNodesWithTag("swap_take_row")
            .onFirst()
            .performScrollTo()
            .performClick()

        // After a pick: the hours selector appears, and the roster collapses to one row.
        composeRule.onAllNodesWithTag("swap_take_range").assertCountEquals(1)
        composeRule.onAllNodesWithTag("swap_take_selected").assertCountEquals(1)
        composeRule.onAllNodesWithTag("swap_take_list").assertCountEquals(0)
    }

    @Test
    fun `tapping the collapsed row re-expands the roster`() {
        setContent()

        composeRule
            .onAllNodesWithTag("swap_take_row")
            .onFirst()
            .performScrollTo()
            .performClick()
        composeRule.onAllNodesWithTag("swap_take_selected").assertCountEquals(1)

        composeRule.onNodeWithTag("swap_take_selected").performScrollTo().performClick()

        composeRule.onAllNodesWithTag("swap_take_list").assertCountEquals(1)
        composeRule.onAllNodesWithTag("swap_take_selected").assertCountEquals(0)
    }

    @Test
    fun `switching day re-expands the roster even after a pick`() {
        setContent()

        composeRule
            .onAllNodesWithTag("swap_take_row")
            .onFirst()
            .performScrollTo()
            .performClick()
        composeRule.onAllNodesWithTag("swap_take_selected").assertCountEquals(1)

        // No per-day testTag exists on the day strip; click two distinct day columns so at
        // least one differs from whichever day defaulted to selected (today's).
        val days = composeRule.onNodeWithTag("swap_day_strip").onChildren()
        days[0].performScrollTo().performClick()
        days[3].performScrollTo().performClick()

        composeRule.onAllNodesWithTag("swap_take_list").assertCountEquals(1)
        composeRule.onAllNodesWithTag("swap_take_selected").assertCountEquals(0)
    }
}
