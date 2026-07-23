package com.pennhousing.shift.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * The system back button, wired through the whole shell, after the app moved from
 * `var selectedIndex: Int` to Navigation 3.
 *
 * Before, there was no back stack: back exited the app from any tab, which is not what Android
 * users expect. Now every destination sits on top of My Shifts, so back returns there first and
 * only exits from My Shifts itself. The guard-on-back and pure routing are covered faster and
 * more reliably by the JVM-only ShiftNavigatorTest; this asserts the real back button reaches
 * that routing, driving the shell through [DemoShiftsApp] and the same `testTag` contract Maestro
 * uses. [createAndroidComposeRule] rather than `createComposeRule` because back needs a real
 * `OnBackPressedDispatcher`. Navigation is exercised through the reliably-hit bottom-bar tabs;
 * the More sheet's rows are a Popup surface Robolectric hit-tests unreliably, so they are left to
 * Maestro on a real device.
 */
// Robolectric's default 320x470dp window collapses this screen and breaks clicks on phantom
// zero-height nodes; a realistic device size is required (same reason as PreferencesScreenTest).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class ShiftNavigationTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    /** Returning-user state: no tour overlay to swallow the taps. See [OnboardingTestState]. */
    @Before
    fun dismissOnboarding() {
        OnboardingTestState.markAllToursSeen(ApplicationProvider.getApplicationContext())
    }

    private fun launch() = composeRule.setContent { DemoShiftsApp() }

    private fun tap(tag: String) {
        composeRule.onNodeWithTag(tag).performClick()
        composeRule.waitForIdle()
    }

    private fun pressBack() {
        composeRule.runOnUiThread { composeRule.activity.onBackPressedDispatcher.onBackPressed() }
        composeRule.waitForIdle()
    }

    /**
     * Whether anything in the app is still handling back. False means the press falls through
     * to the system and the app exits, which is the contract at the start destination.
     */
    private fun appHandlesBack(): Boolean = composeRule.activity.onBackPressedDispatcher.hasEnabledCallbacks()

    @Test
    fun `back from a bottom-bar destination returns to My Shifts`() {
        launch()

        listOf("tab_open_shifts", "tab_house", "tab_swaps").forEach { tab ->
            tap(tab)
            composeRule.onNodeWithTag(tab).assertIsSelected()

            pressBack()

            composeRule.onNodeWithTag("tab_my_shifts").assertIsSelected()
            composeRule.onNodeWithTag(tab).assertIsNotSelected()
        }
    }

    @Test
    fun `back is handled off the start destination and falls through on it`() {
        launch()

        // My Shifts is the start destination: nothing handles back, so the system exits.
        assertFalse("back on My Shifts should fall through to the system", appHandlesBack())

        tap("tab_house")
        assertTrue("back on a non-start destination should be handled in-app", appHandlesBack())

        pressBack()
        assertFalse("back should fall through again once home", appHandlesBack())
    }
}
