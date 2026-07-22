package com.pennhousing.shift.ui.onboarding

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.shared.viewmodel.SwapTourUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Coverage for SwapTourOverlay (the Android port of iOS's SwapTourView), scoped to the
 * genuinely custom gestures on this screen: dragging the step-2 give-range (a real Material3
 * RangeSlider recomputing the shared live summary line), tapping a step-3 split segment, and
 * the mode-dependent summary branching (Swap vs Hand off) that `SwapTour.summaryLine` owns.
 * The step copy/sequencing itself is already covered by shared kotlin.test
 * (SwapTourTest/SwapTourViewModel are pure and tested there); this test's job is to prove the
 * Compose screen wires up to that shared logic and reacts correctly to real gestures.
 */
// Robolectric's default test window is a tiny legacy 320x470dp; SwapTourOverlay's full
// content (stage card + coach card) overflows that and the coach card's button row
// collapses to zero height, silently breaking performClick on a "phantom" node. A
// realistic device size is required for any screen with this much vertical content (this
// bit the Android ShiftTour port once already; see ShiftTourViewTest.kt).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class SwapTourViewTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun amountStepState() =
        SwapTourUiState(
            active = true,
            step = SwapTour.STEPS[1], // AMOUNT
            stepIndex = 2,
            stepCount = SwapTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = false,
            seen = emptySet(),
        )

    private fun splitStepState() =
        SwapTourUiState(
            active = true,
            step = SwapTour.STEPS[2], // SPLIT
            stepIndex = 3,
            stepCount = SwapTour.STEP_COUNT,
            canGoBack = true,
            isLastStep = true,
            seen = emptySet(),
        )

    /**
     * A tiny stateful host that advances a local step index on Next/Back, mirroring how
     * SwapTourViewModel sequences SwapTour.STEPS. Used only by the mode-branch test, which
     * needs to pick a mode on step 1 and then land on step 2 to read the summary it produced
     * — SwapTourOverlay's own `mode`/`from`/`to` state is `remember`ed across that transition
     * since the composable instance stays mounted.
     */
    @androidx.compose.runtime.Composable
    private fun StatefulSwapTourHost(initialStepIndex: Int) {
        var index by remember { mutableIntStateOf(initialStepIndex) }
        val state =
            SwapTourUiState(
                active = true,
                step = SwapTour.STEPS[index],
                stepIndex = index + 1,
                stepCount = SwapTour.STEP_COUNT,
                canGoBack = index > 0,
                isLastStep = index == SwapTour.STEPS.lastIndex,
                seen = emptySet(),
            )
        SwapTourOverlay(
            state = state,
            onNext = { if (index < SwapTour.STEPS.lastIndex) index += 1 },
            onBack = { if (index > 0) index -= 1 },
            onSkip = {},
        )
    }

    @Test
    fun `dragging the give range recomputes the live summary`() {
        composeRule.setContent {
            ShiftTheme {
                SwapTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        val summaryNode = composeRule.onNodeWithTag("swap_tour_summary", useUnmergedTree = true)
        val before = summaryNode.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }

        composeRule.onNodeWithTag("swap_tour_range", useUnmergedTree = true).performTouchInput {
            swipeLeft(startX = right, endX = left / 2)
        }

        val after = summaryNode.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }
        assert(before != after) {
            "Dragging the give-range slider should recompute the live summary line (before=$before after=$after)"
        }
    }

    @Test
    fun `swap mode default summary reads You give for the default give range`() {
        composeRule.setContent {
            ShiftTheme {
                SwapTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        composeRule.onNodeWithTag("swap_tour_summary", useUnmergedTree = true)
            .assertTextContains("You give", substring = true)
    }

    @Test
    fun `hand off mode summary reads Giving and nothing comes back for the same default give range`() {
        composeRule.setContent {
            ShiftTheme {
                StatefulSwapTourHost(initialStepIndex = 0) // MODE
            }
        }

        // Pick Hand off on step 1, then advance to step 2 (AMOUNT) without ever touching the
        // range slider, so the give range is still SwapTour.DEFAULT_FROM_BLOCK/TO_BLOCK — the
        // SAME range the Swap-mode test above reads, isolating the assertion to the mode
        // branch alone.
        composeRule.onNodeWithTag("swap_tour_mode_handoff", useUnmergedTree = true).performClick()
        composeRule.onNodeWithTag("swap_tour_next", useUnmergedTree = true).performClick()

        composeRule.onNodeWithTag("swap_tour_summary", useUnmergedTree = true)
            .assertTextContains("Giving", substring = true)
            .assertTextContains("nothing comes back", substring = true)
    }

    @Test
    fun `tapping a free split segment focuses it`() {
        composeRule.setContent {
            ShiftTheme {
                SwapTourOverlay(state = splitStepState(), onNext = {}, onBack = {}, onSkip = {})
            }
        }

        // The segment cells set `Modifier.semantics(mergeDescendants = true)` (see
        // segmentCell in SwapTourView.kt) so their two child Text labels read as one node's
        // text — but `useUnmergedTree = true` deliberately bypasses that merging (it exists
        // to dodge container-tag shadowing elsewhere, per AGENTS.md), so these three
        // single-match, non-ambiguous tags are queried on the normal (merged) tree instead,
        // the only way to read their combined label text.
        // Starting state: segment 1 (17:00 to 18:00) is the focused/active reservation;
        // segment 2 (18:00 to 20:00) is free.
        composeRule.onNodeWithTag("swap_seg_active").assertTextContains("17:00 to 18:00", substring = true)
        composeRule.onNodeWithTag("swap_seg_free").assertTextContains("18:00 to 20:00", substring = true)

        composeRule.onNodeWithTag("swap_seg_free").performClick()

        // The tap should move the focus onto the tapped segment (now "swap_seg_active") and
        // return the previously-focused segment to "swap_seg_free"; the locked segment never
        // changes.
        composeRule.onNodeWithTag("swap_seg_active").assertTextContains("18:00 to 20:00", substring = true)
        composeRule.onNodeWithTag("swap_seg_free").assertTextContains("17:00 to 18:00", substring = true)
        composeRule.onNodeWithTag("swap_seg_locked").assertTextContains("16:00 to 17:00", substring = true)
    }

    @Test
    fun `skip button fires onSkip`() {
        var skipped = false
        composeRule.setContent {
            ShiftTheme {
                SwapTourOverlay(state = amountStepState(), onNext = {}, onBack = {}, onSkip = { skipped = true })
            }
        }

        composeRule.onNodeWithTag("swap_tour_skip", useUnmergedTree = true).performClick()

        assert(skipped) { "Skip button should invoke onSkip" }
    }

    @Test
    fun `back button only shown when canGoBack is true`() {
        composeRule.setContent {
            ShiftTheme {
                SwapTourOverlay(
                    state = amountStepState().copy(canGoBack = false),
                    onNext = {},
                    onBack = {},
                    onSkip = {},
                )
            }
        }

        composeRule.onAllNodesWithTag("swap_tour_back", useUnmergedTree = true).assertCountEquals(0)
    }
}
