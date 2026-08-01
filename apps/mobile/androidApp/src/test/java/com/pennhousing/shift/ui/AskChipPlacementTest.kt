package com.pennhousing.shift.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * The "Ask" assistant chip is scoped to the My-Shifts home screen ONLY (2026-07-22). It previously
 * rode every tab except Assistant, which made it noise rather than discoverability: a floating
 * button that follows you everywhere covers content on the feeds and grids where the Assistant
 * isn't what you came to do. The Assistant stays reachable from "More" on every screen.
 *
 * Worth pinning per-tab rather than eyeballing: the chip is threaded down as one optional callback
 * (`CalendarTabContent`'s `onAskAssistant`), so any edit to that single wiring changes it app-wide
 * with no local signal at the call sites it affects. It renders INSIDE the agenda area rather than
 * in the Scaffold's `floatingActionButton` slot, which floats above the bottom nav bar and so put
 * the pill on top of the week navigator.
 */
// Robolectric's default 320x470dp window collapses this screen and breaks clicks on phantom
// zero-height nodes; a realistic device size is required (see PreferencesTourViewTest).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class AskChipPlacementTest {
    @get:Rule
    val composeRule = createComposeRule()

    /** Returning-user state: no tour overlay to swallow the tab taps. See [OnboardingTestState]. */
    @Before
    fun dismissOnboarding() {
        OnboardingTestState.markAllToursSeen(ApplicationProvider.getApplicationContext())
    }

    private fun askChip() = composeRule.onAllNodesWithTag("ask_assistant", useUnmergedTree = true)

    /** NavigationBarItem merges its semantics, so the click action lives on the MERGED node. */
    private fun tapTab(tag: String) = composeRule.onNodeWithTag(tag).performClick()

    @Test
    fun `the ask chip shows on My Shifts`() {
        composeRule.setContent { DemoShiftsApp() }

        // My Shifts is the launch tab.
        askChip().assertCountEquals(1)
    }

    @Test
    fun `the ask chip is hidden on every other bottom-bar tab`() {
        composeRule.setContent { DemoShiftsApp() }

        listOf("tab_open_shifts", "tab_house", "tab_swaps").forEach { tab ->
            tapTab(tab)
            askChip().assertCountEquals(0)
        }
    }

    @Test
    fun `the ask chip comes back when returning to My Shifts`() {
        composeRule.setContent { DemoShiftsApp() }

        tapTab("tab_house")
        askChip().assertCountEquals(0)

        tapTab("tab_my_shifts")
        askChip().assertCountEquals(1)
    }
}
