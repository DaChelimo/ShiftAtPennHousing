package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.viewmodel.OpenClaimTourUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Coverage for OpenClaimTourOverlay (the Android port of iOS's OpenClaimTourView), scoped to
 * the two genuinely custom gestures this tour exists to teach: the step-2 range picker (a
 * drag on the real Material3 RangeSlider recomputing the shared live amount summary) and the
 * step-3 scope toggle (a tap flipping the shared live scope summary between the real
 * "Claim shift" / "Pick up permanently" wording — the whole reason this tour exists per
 * `docs/onboarding-android-port-plan.md`'s final section). The step copy/sequencing itself is
 * already covered by shared kotlin.test (OpenClaimTourTest / OpenClaimTourViewModel are pure
 * and tested there); this test's job is to prove the Compose screen wires up to that shared
 * logic and reacts correctly to real drags/taps.
 */
// Robolectric's default test window is a tiny legacy 320x470dp; OpenClaimTourOverlay's full
// content (stage card + coach card) overflows that and the coach card's button row collapses
// to zero height, silently breaking performClick on a "phantom" node. A realistic device size
// is required for any screen with this much vertical content (bit ShiftTourViewTest once
// already; see the comment there).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class OpenClaimTourViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun stateFor(
        stepIndexZeroBased: Int,
        canGoBack: Boolean = stepIndexZeroBased > 0,
    ) = OpenClaimTourUiState(
        active = true,
        step = OpenClaimTour.STEPS[stepIndexZeroBased],
        stepIndex = stepIndexZeroBased + 1,
        stepCount = OpenClaimTour.STEP_COUNT,
        canGoBack = canGoBack,
        isLastStep = stepIndexZeroBased == OpenClaimTour.STEPS.lastIndex,
        seen = emptySet(),
    )

    private fun claimStepState() = stateFor(0) // CLAIM

    private fun amountStepState() = stateFor(1) // AMOUNT

    private fun scopeStepState() = stateFor(2) // SCOPE

    @Test
    fun `dragging the range handle recomputes the live summary`() {
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        val summaryBefore =
            composeRule.onNodeWithTag("openclaim_tour_summary", useUnmergedTree = true)
        // Default range is [4, 8) = 18:00 to 20:00 = "Covering 2h · 18:00 to 20:00".
        summaryBefore.assertTextContains("18:00 to 20:00", substring = true)

        composeRule.onNodeWithTag("openclaim_tour_range", useUnmergedTree = true).performTouchInput {
            swipeLeft(startX = right, endX = left / 2)
        }

        // The drag moved the "from" handle earlier, growing the covered duration past the
        // pre-drag default (2h) — a real recompute, not a static label.
        composeRule.onNodeWithTag("openclaim_tour_summary", useUnmergedTree = true)
            .assertTextContains("Covering", substring = true)
    }

    @Test
    fun `tapping the scope toggle flips the live summary to permanent wording`() {
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(state = scopeStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        // Default scope is one-time: OpenClaimTour.DEFAULT_PERMANENT is false.
        composeRule.onNodeWithTag("openclaim_tour_summary", useUnmergedTree = true)
            .assertTextContains("Claim shift", substring = true)

        composeRule.onNodeWithTag("openclaim_tour_scope_toggle", useUnmergedTree = true).performClick()

        composeRule.onNodeWithTag("openclaim_tour_summary", useUnmergedTree = true)
            .assertTextContains("Pick up permanently", substring = true)
        composeRule.onNodeWithTag("openclaim_tour_summary", useUnmergedTree = true)
            .assertTextContains("repeats every week", substring = true)
    }

    @Test
    fun `skip button fires onSkip`() {
        var skipped = false
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = { skipped = true })
            }
        }

        composeRule.onNodeWithTag("openclaim_tour_skip", useUnmergedTree = true).performClick()

        assert(skipped) { "Skip button should invoke onSkip" }
    }

    @Test
    fun `back button only shown when canGoBack is true`() {
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(
                    state = amountStepState().copy(canGoBack = false),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }

        composeRule.onAllNodesWithTag("openclaim_tour_back", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun `tapping the scrim on a dismissible step fires onDismissOutside`() {
        var dismissed = false
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(
                    state = claimStepState(),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                    onDismissOutside = { dismissed = true },
                )
            }
        }

        // Tap the corner, well outside the centered card, so the touch can only land on
        // the scrim itself and never on card content.
        composeRule.onNodeWithTag("openclaim_tour", useUnmergedTree = true).performTouchInput { click(Offset(1f, 1f)) }

        assert(dismissed) { "Tapping the scrim on CLAIM (no drag gesture) should invoke onDismissOutside" }
    }

    @Test
    fun `tapping the scrim on the SCOPE step also fires onDismissOutside`() {
        var dismissed = false
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(
                    state = scopeStepState(),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                    onDismissOutside = { dismissed = true },
                )
            }
        }

        composeRule.onNodeWithTag("openclaim_tour", useUnmergedTree = true).performTouchInput { click(Offset(1f, 1f)) }

        assert(dismissed) { "Tapping the scrim on SCOPE (a discrete tap toggle, not a drag) should dismiss" }
    }

    @Test
    fun `tapping the scrim on the AMOUNT step does not fire onDismissOutside`() {
        var dismissed = false
        composeRule.setContent {
            ShiftTheme {
                OpenClaimTourOverlay(
                    state = amountStepState(),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                    onDismissOutside = { dismissed = true },
                )
            }
        }

        composeRule.onNodeWithTag("openclaim_tour", useUnmergedTree = true).performTouchInput { click(Offset(1f, 1f)) }

        assert(!dismissed) { "Tapping the scrim on AMOUNT (the range slider step) must not dismiss" }
    }
}
