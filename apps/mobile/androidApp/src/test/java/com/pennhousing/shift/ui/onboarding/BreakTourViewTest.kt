package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.TouchInjectionScope
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.viewmodel.BreakTourUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** A drag on lane 0 (Desk 1, x = width/4) spanning the whole grid's height. */
private fun TouchInjectionScope.dragDeskOne() {
    down(Offset(x = width / 4f, y = top + 2f))
    moveTo(Offset(x = width / 4f, y = bottom - 2f))
    up()
}

/**
 * Coverage for BreakTourOverlay (the Android port of iOS's BreakTourView), scoped to the two
 * genuinely custom gestures on this screen: a press-and-drag claim across a desk lane (step 2)
 * and a press-and-drag drop over the worker's own claimed hours (step 3), both driven by a raw
 * `awaitEachGesture` pointer loop rather than a higher-level gesture detector. The step
 * copy/sequencing itself is already covered by shared kotlin.test (BreakTourTest/
 * BreakTourViewModel are pure and tested there); this test's job is to prove the Compose screen
 * wires up to that shared logic and reacts correctly to real touch input.
 */
// Robolectric's default test window is a tiny legacy 320x470dp; BreakTourOverlay's full content
// (stage card + coach card) overflows that and the coach card's button row collapses to zero
// height, silently breaking performClick on a "phantom" node. A realistic device size is
// required for any screen with this much vertical content (this bit the Android ShiftTour port
// once already, see the comment in ShiftTourViewTest.kt).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class BreakTourViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun layoutStepState() =
        BreakTourUiState(
            active = true,
            step = BreakTour.STEPS[0], // LAYOUT
            stepIndex = 1,
            stepCount = BreakTour.STEP_COUNT,
            canGoBack = false,
            isLastStep = false,
            seen = emptySet(),
        )

    private fun claimStepState() =
        BreakTourUiState(
            active = true,
            step = BreakTour.STEPS[1], // CLAIM
            stepIndex = 2,
            stepCount = BreakTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = false,
            seen = emptySet(),
        )

    private fun dropStepState() =
        BreakTourUiState(
            active = true,
            step = BreakTour.STEPS[2], // DROP
            stepIndex = 3,
            stepCount = BreakTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = true,
            seen = emptySet(),
        )

    @Test
    fun `dragging down a desk lane produces a live claim summary`() {
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(state = claimStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        composeRule.onNodeWithTag("break_tour_claim_summary", useUnmergedTree = true)
            .assertTextEquals("Press and drag down a desk")

        composeRule.onNodeWithTag("break_tour_grid", useUnmergedTree = true).performTouchInput { dragDeskOne() }

        // The drag produced a real claim range on Desk 1, not a static label.
        composeRule.onNodeWithTag("break_tour_claim_summary", useUnmergedTree = true)
            .assertTextContains("Claiming", substring = true)
        composeRule.onNodeWithTag("break_tour_claim_summary", useUnmergedTree = true)
            .assertTextContains("Desk 1", substring = true)
    }

    @Test
    fun `dropping over claimed hours enables the drop button`() {
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(state = dropStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        // Neutral, disabled before any drag.
        composeRule.onNodeWithTag("break_tour_drop_button", useUnmergedTree = true).assertIsNotEnabled()
        composeRule.onNodeWithTag("break_tour_drop_message", useUnmergedTree = true)
            .assertTextEquals("Drag over your hours to drop them")

        // Drag the full height of Desk 1 (lane 0), the lane MINE_BLOCKS lives on, so the drag
        // overlaps blocks 2-4 (the worker's own claimed hours).
        composeRule.onNodeWithTag("break_tour_grid", useUnmergedTree = true).performTouchInput { dragDeskOne() }

        composeRule.onNodeWithTag("break_tour_drop_button", useUnmergedTree = true).assertIsEnabled()
        composeRule.onNodeWithTag("break_tour_drop_message", useUnmergedTree = true)
            .assertTextContains("Dropping", substring = true)
    }

    @Test
    fun `skip button fires onSkip`() {
        var skipped = false
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(state = claimStepState(), onNext = {}, onBack = {}, onSkip = { skipped = true })
            }
        }

        composeRule.onNodeWithTag("break_tour_skip", useUnmergedTree = true).performClick()

        assert(skipped) { "Skip button should invoke onSkip" }
    }

    @Test
    fun `back button only shown when canGoBack is true`() {
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(
                    state = claimStepState().copy(canGoBack = false),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }

        composeRule.onAllNodesWithTag("break_tour_back", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun `tapping the scrim on LAYOUT fires onDismissOutside`() {
        var dismissed = false
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(
                    state = layoutStepState(),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                    onDismissOutside = { dismissed = true },
                )
            }
        }

        // Tap the corner, well outside the centered card, so the touch can only land on
        // the scrim itself and never on card content.
        composeRule.onNodeWithTag("break_tour", useUnmergedTree = true).performTouchInput { click(Offset(1f, 1f)) }

        assert(dismissed) { "Tapping the scrim on LAYOUT (view-only, no drag) should invoke onDismissOutside" }
    }

    @Test
    fun `tapping the scrim on CLAIM does not fire onDismissOutside`() {
        var dismissed = false
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(
                    state = claimStepState(),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                    onDismissOutside = { dismissed = true },
                )
            }
        }

        composeRule.onNodeWithTag("break_tour", useUnmergedTree = true).performTouchInput { click(Offset(1f, 1f)) }

        assert(!dismissed) { "Tapping the scrim on CLAIM (a press-and-drag step) must not dismiss" }
    }

    @Test
    fun `tapping the scrim on DROP does not fire onDismissOutside`() {
        var dismissed = false
        composeRule.setContent {
            ShiftTheme {
                BreakTourOverlay(
                    state = dropStepState(),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                    onDismissOutside = { dismissed = true },
                )
            }
        }

        composeRule.onNodeWithTag("break_tour", useUnmergedTree = true).performTouchInput { click(Offset(1f, 1f)) }

        assert(!dismissed) { "Tapping the scrim on DROP (a press-and-drag step) must not dismiss" }
    }
}
