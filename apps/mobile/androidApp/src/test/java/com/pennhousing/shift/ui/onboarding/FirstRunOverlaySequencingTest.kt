package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.ui.DemoShiftsApp
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * First-run overlay sequencing, driven through the REAL app shell from a genuinely clean
 * install (no seeded prefs -- the opposite of `OnboardingTestState.markAllToursSeen`).
 *
 * The moment the welcome tour is finished or skipped on My Shifts, three separate pieces of
 * first-run chrome all become eligible off the same `welcomeDone` flip: the interactive
 * "Manage a shift" tour auto-opens, and the notification primer's blocking card wants the
 * screen too. They are rendered as siblings, so nothing stopped them stacking. This test
 * pins the sequencing: exactly one blocking overlay at a time.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class FirstRunOverlaySequencingTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `the notification primer waits for the auto-opened shift tour`() {
        composeRule.setContent { ShiftTheme { DemoShiftsApp() } }

        // The welcome tour owns the screen first; the primer must not be up behind it.
        composeRule.onNodeWithText("Welcome to Shift").assertExists()
        composeRule.onNodeWithTag("notification_primer").assertDoesNotExist()

        composeRule.onNodeWithText("Skip").performClick()

        // Skipping hands off to the interactive shift tour, NOT to the primer.
        composeRule.onNodeWithTag("shift_tour").assertExists()
        composeRule.onNodeWithTag("notification_primer").assertDoesNotExist()

        composeRule.onNodeWithTag("shift_tour_skip").performClick()

        // Only once the screen is clear does the primer take its turn.
        composeRule.onNodeWithTag("shift_tour").assertDoesNotExist()
        composeRule.onNodeWithTag("notification_primer").assertExists()
    }
}
