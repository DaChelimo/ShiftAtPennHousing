package com.pennhousing.shift.ui.onboarding

import android.app.NotificationManager
import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.ui.DemoShiftsApp
import com.pennhousing.shift.ui.OnboardingTestState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * WHERE the notification ask appears, driven through the REAL app shell (BSpec §20.2).
 *
 * `NotificationNudgeRowTest` covers the row itself; this covers its placement, which is the
 * part a refactor of `ShiftsScreen` can silently break. Two claims worth pinning:
 *   - the standing row is on My Shifts and ONLY My Shifts (it is scoped to the surface where
 *     "a reminder before your shift" means something; one ask per app is the design), and
 *   - it never blocks the screen. Its predecessor was a scrim + centered card that had to be
 *     answered before the app was usable, and the regression to watch for is a return to that
 *     shape, which would show up here as the bottom nav becoming untappable behind it.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class NotificationNudgePlacementTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        OnboardingTestState.markAllToursSeen(context)
        // Robolectric reports notifications as ENABLED by default, which is the granted case
        // and would hide the row entirely. Turn them off so the ask is eligible at all.
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        shadowOf(manager).setNotificationsEnabled(false)
    }

    @Test
    fun `the standing ask rides My Shifts while alerts are off`() {
        composeRule.setContent { ShiftTheme { DemoShiftsApp() } }

        // My Shifts is the app's landing destination, so the row is up on arrival.
        composeRule.onNodeWithTag("notification_nudge").assertExists()
        composeRule.onNodeWithTag("notification_nudge_confirm").assertExists()
    }

    @Test
    fun `the standing ask does not follow the worker to other tabs`() {
        composeRule.setContent { ShiftTheme { DemoShiftsApp() } }

        composeRule.onNodeWithTag("notification_nudge").assertExists()

        composeRule.onNodeWithTag("tab_open_shifts").performClick()
        composeRule.onNodeWithTag("notification_nudge").assertDoesNotExist()

        composeRule.onNodeWithTag("tab_swaps").performClick()
        composeRule.onNodeWithTag("notification_nudge").assertDoesNotExist()

        // ...and comes back when the worker returns, because nothing dismissed it.
        composeRule.onNodeWithTag("tab_my_shifts").performClick()
        composeRule.onNodeWithTag("notification_nudge").assertExists()
    }

    @Test
    fun `the ask never blocks the screen behind it`() {
        // The predecessor was a full-screen scrim + card whose whole point was that the
        // worker had to answer it. Proving the bottom nav still works WHILE the row is up is
        // what distinguishes an inline row from a modal that merely looks smaller.
        composeRule.setContent { ShiftTheme { DemoShiftsApp() } }

        composeRule.onNodeWithTag("notification_nudge").assertExists()
        composeRule.onNodeWithTag("tab_house").performClick()

        // The House grid's frozen time rail only renders once that destination is actually
        // showing, so reaching it proves the nav tap was not swallowed by the ask.
        composeRule.onNodeWithTag("house_time_rail", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `a returning worker with alerts already on sees no ask at all`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        shadowOf(manager).setNotificationsEnabled(true)

        composeRule.setContent { ShiftTheme { DemoShiftsApp() } }

        composeRule.onNodeWithTag("notification_nudge").assertDoesNotExist()
        composeRule.onNodeWithTag("notification_nudge_claim").assertDoesNotExist()
        composeRule.onNodeWithTag("notification_nudge_swap").assertDoesNotExist()
    }
}
