package com.pennhousing.shift.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.assistant.AssistantPrompts
import com.pennhousing.shift.shared.data.AssistantRepository
import com.pennhousing.shift.shared.viewmodel.AssistantViewModel
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Regression coverage for the AssistantScreen auto-scroll crash: the LaunchedEffect at
 * the bottom of AssistantScreen keys off (messages.size, loading, lastMessage.content)
 * and calls `listState.animateScrollToItem(messages.size - 1)`. An off-by-one there
 * (e.g. using `messages.size` instead of `messages.size - 1`) throws inside Compose's
 * LazyList scroll machinery the moment a message is appended. These tests drive that
 * path both through the real send button and, for deeper coverage, directly through
 * the shared AssistantViewModel across many appends.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class AssistantScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `empty state renders exactly the current starter prompt set, not a stale count`() {
        // AssistantPrompts.starters was trimmed from 7 to 4; assert against the shared
        // source of truth rather than a literal so this can't itself drift stale.
        composeRule.setContent {
            ShiftTheme {
                AssistantScreen(vm = AssistantViewModel(), repository = AssistantRepository())
            }
        }

        composeRule.onAllNodesWithTag("assistant_starter_prompt")
            .assertCountEquals(AssistantPrompts.starters.size)
    }

    @Test
    fun `tapping a starter prompt sends it and appends bubbles without crashing`() {
        val vm = AssistantViewModel()
        composeRule.setContent {
            ShiftTheme {
                AssistantScreen(vm = vm, repository = AssistantRepository())
            }
        }

        composeRule.onAllNodesWithTag("assistant_starter_prompt").onFirst().performClick()
        composeRule.waitForIdle()

        // The user's question is appended immediately, and onStreamStart (invoked
        // synchronously by submit()) appends the empty assistant placeholder right after
        // it — this two-item transition is exactly what the off-by-one crashed on, and
        // rendering here without throwing is the regression check.
        assert(vm.uiState.value.messages.size == 2) {
            "expected 2 messages after sending, got ${vm.uiState.value.messages.size}"
        }
        composeRule.onNodeWithTag("assistant_message_list").assertIsDisplayed()
    }

    @Test
    fun `list survives many appended messages and scrolls to the newest one`() {
        val vm = AssistantViewModel()
        composeRule.setContent {
            ShiftTheme {
                AssistantScreen(vm = vm, repository = AssistantRepository())
            }
        }

        // Drive the real shared ViewModel through several full request/response cycles —
        // the same state transitions AssistantScreen.submit() drives via the repository
        // stream — to grow the LazyColumn well past the first off-by-one crash point.
        repeat(5) { i ->
            vm.onUserSubmitted("Question $i")
            vm.onStreamStart()
            vm.onStreamDelta("Answer $i")
            vm.onStreamDone()
            composeRule.waitForIdle()
        }

        val messages = vm.uiState.value.messages
        // 5 rounds x (question + answer) = 10 messages.
        assert(messages.size == 10) { "expected 10 messages, got ${messages.size}" }

        val newestTag = "assistant_bubble_${messages.last().id}"
        composeRule.onNodeWithTag("assistant_message_list")
            .performScrollToNode(hasTestTag(newestTag))
        composeRule.onNodeWithTag(newestTag, useUnmergedTree = true).assertIsDisplayed()
    }
}
