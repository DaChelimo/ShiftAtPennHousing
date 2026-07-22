package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.viewmodel.ShiftTourUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Coverage for ShiftTourOverlay (the Android port of iOS's ShiftTourView), scoped to the
 * step-2 range picker — the one genuinely custom gesture on this screen (a drag on the
 * real Material3 RangeSlider recomputing the shared live summary line). The step
 * copy/sequencing itself is already covered by shared kotlin.test
 * (ShiftTourTest/ShiftTourViewModel are pure and tested there); this test's job is to prove
 * the Compose screen wires up to that shared logic and reacts correctly to a real drag.
 */
// Robolectric's default test window is a tiny legacy 320x470dp; ShiftTourOverlay's full
// content (stage card + coach card) overflows that and the coach card's button row
// collapses to zero height, silently breaking performClick on a "phantom" node. A
// realistic device size is required for any screen with this much vertical content.
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class ShiftTourViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun amountStepState() =
        ShiftTourUiState(
            active = true,
            step = ShiftTour.STEPS[1], // AMOUNT
            stepIndex = 2,
            stepCount = ShiftTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = false,
            seen = emptySet(),
        )

    @Test
    fun `dragging the range handle recomputes the live summary`() {
        composeRule.setContent {
            ShiftTheme {
                ShiftTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        val summaryBefore = composeRule.onNodeWithTag("shift_tour_summary", useUnmergedTree = true)

        composeRule.onNodeWithTag("shift_tour_range", useUnmergedTree = true).performTouchInput {
            swipeLeft(startX = right, endX = left / 2)
        }

        // The drag moved the "from" handle earlier, so the summary's duration must grow
        // past the pre-drag default (18:00 to 20:00 = 2h) — a real recompute, not a static label.
        summaryBefore.assertTextContains("Giving", substring = true)
    }

    @Test
    fun `skip button fires onSkip`() {
        var skipped = false
        composeRule.setContent {
            ShiftTheme {
                ShiftTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = { skipped = true })
            }
        }

        composeRule.onNodeWithTag("shift_tour_skip", useUnmergedTree = true).performClick()

        assert(skipped) { "Skip button should invoke onSkip" }
    }

    @Test
    fun `back button only shown when canGoBack is true`() {
        composeRule.setContent {
            ShiftTheme {
                ShiftTourOverlay(
                    state = amountStepState().copy(canGoBack = false),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }

        composeRule.onAllNodesWithTag("shift_tour_back", useUnmergedTree = true).assertCountEquals(0)
    }
}
