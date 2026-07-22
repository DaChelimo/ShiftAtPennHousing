package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.viewmodel.PreferencesTourUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Coverage for PreferencesTourOverlay (the Android port of iOS's PreferencesTourView), scoped to
 * the step-2 paint canvas — the one genuinely custom gesture on this screen (a raw
 * `awaitEachGesture` drag that paints/erases a sample day timeline and recomputes the shared live
 * summary line). The step copy/sequencing itself is already covered by shared kotlin.test
 * (PreferencesTourTest/PreferencesTourViewModel are pure and tested there); this test's job is to
 * prove the Compose screen wires up to that shared logic and reacts correctly to real gestures.
 */
// Robolectric's default test window is a tiny legacy 320x470dp; PreferencesTourOverlay's full
// content (stage card + coach card) overflows that and the coach card's button row collapses to
// zero height, silently breaking performClick on a "phantom" node. A realistic device size is
// required for any screen with this much vertical content (this bit the Android ShiftTour port
// once already; see the identical comment in ShiftTourViewTest.kt).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class PreferencesTourViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun modeStepState() =
        PreferencesTourUiState(
            active = true,
            step = PreferencesTour.STEPS[0], // MODE
            stepIndex = 1,
            stepCount = PreferencesTour.STEP_COUNT,
            canGoBack = false,
            isLastStep = false,
            seen = emptySet(),
        )

    private fun paintStepState() =
        PreferencesTourUiState(
            active = true,
            step = PreferencesTour.STEPS[1], // PAINT
            stepIndex = 2,
            stepCount = PreferencesTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = false,
            seen = emptySet(),
        )

    private fun targetStepState() =
        PreferencesTourUiState(
            active = true,
            step = PreferencesTour.STEPS[2], // TARGET
            stepIndex = 3,
            stepCount = PreferencesTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = true,
            seen = emptySet(),
        )

    @Test
    fun `dragging the paint grid recomputes the live summary`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = paintStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        val summary = composeRule.onNodeWithTag("preferences_tour_paint_summary", useUnmergedTree = true)
        summary.assertTextEquals("No hours painted yet")

        composeRule.onNodeWithTag("preferences_tour_paint_grid", useUnmergedTree = true).performTouchInput {
            swipeDown(startY = top + 4f, endY = bottom - 4f)
        }

        summary.assertTextContains("Painted", substring = true)
    }

    @Test
    fun `dragging the same brush over a painted range erases it`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = paintStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        val grid = composeRule.onNodeWithTag("preferences_tour_paint_grid", useUnmergedTree = true)
        val summary = composeRule.onNodeWithTag("preferences_tour_paint_summary", useUnmergedTree = true)

        // First drag paints (default brush is Preferred).
        grid.performTouchInput { swipeDown(startY = top + 4f, endY = bottom - 4f) }
        summary.assertTextContains("Painted", substring = true)

        // A second drag over the SAME range with the SAME brush erases it back to empty.
        grid.performTouchInput { swipeDown(startY = top + 4f, endY = bottom - 4f) }
        summary.assertTextEquals("No hours painted yet")
    }

    @Test
    fun `tapping a brush chip selects it`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = modeStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        // Should not throw: the chip is present and clickable.
        composeRule.onNodeWithTag("preferences_tour_brush_cannot", useUnmergedTree = true).performClick()
        composeRule.onNodeWithTag("preferences_tour_brush_available", useUnmergedTree = true).performClick()
    }

    @Test
    fun `target stepper increments and decrements within the cap`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = targetStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        val value = composeRule.onNodeWithTag("preferences_tour_target_value", useUnmergedTree = true)
        value.assertTextEquals("${PreferencesTour.SAMPLE_TARGET_HOURS}h")

        composeRule.onNodeWithTag("preferences_tour_target_increment", useUnmergedTree = true).performClick()
        value.assertTextEquals("${PreferencesTour.SAMPLE_TARGET_HOURS + PreferencesTour.TARGET_STEP}h")

        composeRule.onNodeWithTag("preferences_tour_target_decrement", useUnmergedTree = true).performClick()
        composeRule.onNodeWithTag("preferences_tour_target_decrement", useUnmergedTree = true).performClick()
        value.assertTextEquals("${PreferencesTour.SAMPLE_TARGET_HOURS - PreferencesTour.TARGET_STEP}h")
    }

    @Test
    fun `no-hours toggle zeroes the target label`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = targetStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        composeRule.onNodeWithTag("preferences_tour_no_hours_toggle", useUnmergedTree = true).performClick()

        composeRule.onNodeWithTag("preferences_tour_target_value", useUnmergedTree = true).assertTextEquals("0h")
    }

    @Test
    fun `skip button fires onSkip`() {
        var skipped = false
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = modeStepState(), onNext = {}, onBack = {}, onSkip = { skipped = true })
            }
        }

        composeRule.onNodeWithTag("preferences_tour_skip", useUnmergedTree = true).performClick()

        assert(skipped) { "Skip button should invoke onSkip" }
    }

    @Test
    fun `back button only shown when canGoBack is true`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(
                    state = modeStepState().copy(canGoBack = false),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }

        composeRule.onAllNodesWithTag("preferences_tour_back", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun `next button reads Done on the last step`() {
        composeRule.setContent {
            ShiftTheme {
                PreferencesTourOverlay(state = targetStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        composeRule.onNodeWithText("Done", useUnmergedTree = true).assertExists()
    }
}
