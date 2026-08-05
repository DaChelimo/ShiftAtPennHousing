package com.pennhousing.shift.ui.onboarding

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.onboarding.NotificationPriming
import com.pennhousing.shift.ui.theme.ShiftTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Coverage for [NotificationNudgeRow] — the inline notification ask that replaced the
 * blocking first-run permission card on 2026-08-03 (BSpec §20.2).
 *
 * The shared gating (`shouldShowStandingNudge` / `shouldShowContextualNudge` /
 * `confirmLabel`) is pure and already covered by `NotificationPrimingTest` on the JVM host.
 * This test's job is the Compose surface: that the row renders one line of copy plus exactly
 * one action, that the action fires, that the button follows `osCanPrompt`, and — the load-
 * bearing one — that the row ships NO dismiss control. A dismiss added here would silently
 * revert the design decision the whole redesign turns on.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class NotificationNudgeRowTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun stateFor(
        osCanPrompt: Boolean = true,
        onConfirm: () -> Unit = {},
    ) = NotificationNudgeState(granted = false, osCanPrompt = osCanPrompt, onConfirm = onConfirm)

    @Test
    fun `the standing row renders its one-line copy and a single action`() {
        composeRule.setContent {
            ShiftTheme {
                NotificationNudgeRow(body = NotificationPriming.BODY_MY_SHIFTS, state = stateFor())
            }
        }

        composeRule.onNodeWithTag("notification_nudge").assertIsDisplayed()
        composeRule.onNodeWithText(NotificationPriming.BODY_MY_SHIFTS).assertIsDisplayed()
        composeRule.onNodeWithTag("notification_nudge_confirm").assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun `tapping the action fires the confirm callback`() {
        var confirms = 0
        composeRule.setContent {
            ShiftTheme {
                NotificationNudgeRow(
                    body = NotificationPriming.BODY_MY_SHIFTS,
                    state = stateFor(onConfirm = { confirms += 1 }),
                )
            }
        }

        composeRule.onNodeWithTag("notification_nudge_confirm").performClick()

        assertEquals(1, confirms)
    }

    @Test
    fun `the row has NO dismiss control, so only granting alerts retires it`() {
        composeRule.setContent {
            ShiftTheme {
                NotificationNudgeRow(body = NotificationPriming.BODY_MY_SHIFTS, state = stateFor())
            }
        }

        // The predecessor card shipped a "Not now" that marked the ask spent for the whole
        // install; removing it is the point of the redesign. Assert on every shape a dismiss
        // has previously taken here, so reintroducing one fails loudly.
        composeRule.onNodeWithTag("notification_nudge_dismiss").assertDoesNotExist()
        composeRule.onNodeWithText("Not now").assertDoesNotExist()
        composeRule.onNodeWithText("Dismiss").assertDoesNotExist()
        composeRule.onNodeWithText("Got it").assertDoesNotExist()
    }

    @Test
    fun `the action offers the OS dialog while it can still fire`() {
        composeRule.setContent {
            ShiftTheme {
                NotificationNudgeRow(
                    body = NotificationPriming.BODY_MY_SHIFTS,
                    state = stateFor(osCanPrompt = true),
                )
            }
        }

        composeRule.onNodeWithText(NotificationPriming.CONFIRM).assertIsDisplayed()
    }

    @Test
    fun `the action routes to settings once the OS dialog is spent`() {
        // A row that persists until alerts are ON is guaranteed to outlive the point where
        // Android stops surfacing POST_NOTIFICATIONS, so the button must stop claiming it
        // will turn anything on and offer settings instead.
        composeRule.setContent {
            ShiftTheme {
                NotificationNudgeRow(
                    body = NotificationPriming.BODY_MY_SHIFTS,
                    state = stateFor(osCanPrompt = false),
                )
            }
        }

        composeRule.onNodeWithText(NotificationPriming.CONFIRM_SETTINGS).assertIsDisplayed()
        composeRule.onNodeWithText(NotificationPriming.CONFIRM).assertDoesNotExist()
    }

    @Test
    fun `each placement carries its own tag and contextual copy`() {
        // The three placements share one composable but must stay individually selectable:
        // the standing row on My Shifts, and the two once-per-install contextual rows.
        composeRule.setContent {
            ShiftTheme {
                NotificationNudgeRow(
                    body = NotificationPriming.BODY_AFTER_CLAIM,
                    state = stateFor(),
                    tag = "notification_nudge_claim",
                )
            }
        }

        composeRule.onNodeWithTag("notification_nudge_claim").assertIsDisplayed()
        composeRule.onNodeWithTag("notification_nudge_claim_confirm").assertIsDisplayed()
        composeRule.onNodeWithText(NotificationPriming.BODY_AFTER_CLAIM).assertIsDisplayed()
        // The standing row's tag must NOT match a contextual row, or a shell test asserting
        // "the standing ask is up" would pass on a transient post-claim row instead.
        composeRule.onNodeWithTag("notification_nudge").assertDoesNotExist()
    }
}
