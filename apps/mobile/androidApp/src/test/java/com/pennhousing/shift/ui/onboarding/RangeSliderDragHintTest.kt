package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.shared.viewmodel.OpenClaimTourUiState
import com.pennhousing.shift.shared.viewmodel.ShiftTourUiState
import com.pennhousing.shift.shared.viewmodel.SwapTourUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * The "drag me" badge the three range-slider tour steps ride on the lower handle
 * (`RangeSliderDragHint`). A two-handle range slider is not an affordance workers arrive
 * with, so the badge primes it — and it must retire the instant they drag, or it becomes
 * noise sitting on top of the control it was pointing at.
 *
 * Both halves are asserted for every tour that has the step, because the show/hide wiring
 * is duplicated per tour (each owns its own `dragged` flag next to its own slider) and a
 * copy that silently lost the `dragged = true` line would still look right on first render.
 *
 * iOS carries the same badge, wired the same way (`showDragHint` / `registerSliderInteraction`
 * in ShiftTourView.swift and friends).
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class RangeSliderDragHintTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `the shift tour primes the range slider and retires the hint on drag`() {
        composeRule.setContent {
            ShiftTheme {
                ShiftTourOverlay(
                    state =
                        ShiftTourUiState(
                            active = true,
                            step = ShiftTour.STEPS[1], // AMOUNT
                            stepIndex = 2,
                            stepCount = ShiftTour.STEP_COUNT,
                            canGoBack = true,
                            isLastStep = false,
                            seen = emptySet(),
                        ),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }
        assertHintRetiresOnDrag(sliderTag = "shift_tour_range", hintTag = "shift_tour_drag_hint")
    }

    @Test
    fun `the open-claim tour primes the range slider and retires the hint on drag`() {
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(
                    state =
                        OpenClaimTourUiState(
                            active = true,
                            step = OpenClaimTour.STEPS[1], // AMOUNT
                            stepIndex = 2,
                            stepCount = OpenClaimTour.STEP_COUNT,
                            canGoBack = true,
                            isLastStep = false,
                            seen = emptySet(),
                        ),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }
        assertHintRetiresOnDrag(sliderTag = "openclaim_tour_range", hintTag = "openclaim_tour_drag_hint")
    }

    @Test
    fun `the swap tour primes the range slider and retires the hint on drag`() {
        composeRule.setContent {
            ShiftTheme {
                SwapTourOverlay(
                    state =
                        SwapTourUiState(
                            active = true,
                            step = SwapTour.STEPS[1], // AMOUNT
                            stepIndex = 2,
                            stepCount = SwapTour.STEP_COUNT,
                            canGoBack = true,
                            isLastStep = false,
                            seen = emptySet(),
                        ),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }
        assertHintRetiresOnDrag(sliderTag = "swap_tour_range", hintTag = "swap_tour_drag_hint")
    }

    /**
     * The badge is up before the gesture, and gone after a real drag on the real slider —
     * not after a tap or a state poke, since the drag IS the thing the badge is teaching.
     */
    private fun assertHintRetiresOnDrag(
        sliderTag: String,
        hintTag: String,
    ) {
        composeRule.onNodeWithTag(hintTag, useUnmergedTree = true).assertIsDisplayed()

        composeRule.onNodeWithTag(sliderTag, useUnmergedTree = true).performTouchInput {
            swipeLeft(startX = right, endX = left / 2)
        }

        composeRule.onNodeWithTag(hintTag, useUnmergedTree = true).assertDoesNotExist()
    }
}
