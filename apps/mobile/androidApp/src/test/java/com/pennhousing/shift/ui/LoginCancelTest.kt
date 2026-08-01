package com.pennhousing.shift.ui

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pennhousing.shift.shared.auth.AuthGateway
import com.pennhousing.shift.shared.auth.AuthOutcome
import com.pennhousing.shift.shared.auth.AuthSession
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.coroutines.cancellation.CancellationException

/**
 * The login screen's escape hatch from an in-flight sign-in (2026-07-31, BSpec §23.2).
 *
 * Worth pinning rather than eyeballing, because the failure mode is invisible in a happy-path
 * click-through: against a healthy backend sign-in returns in well under a second and the
 * SUBMITTING state barely renders, so the only way to see whether a worker can get *out* of it
 * is to hold the gateway open deliberately. That is exactly the state a worker on a bad
 * connection sits in, and before this the screen offered them nothing at all — the CTA is
 * disabled while the call is out, the reducer honours no edits, and the only way back was to
 * force-quit the app.
 *
 * The gateway here never returns on its own, so every assertion below is about the SCREEN's
 * behavior rather than the network's. [SupabaseAuthGateway]'s own 15s bound is a separate
 * concern; this asks whether the worker can act before it fires.
 */
// Robolectric's default 320x470dp window collapses this screen and breaks clicks on phantom
// zero-height nodes; a realistic device size is required (see AskChipPlacementTest).
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp")
class LoginCancelTest {
    @get:Rule
    val composeRule = createComposeRule()

    /**
     * A gateway whose `signIn` hangs until the test resolves it, standing in for an unreachable
     * or very slow backend. It records whether the coroutine was CANCELLED rather than merely
     * abandoned: the reducer would return the screen to EDITING either way, so a state-only
     * assertion would still pass if the host leaked the request. Suspension is a bare
     * [CompletableDeferred.await] with no timer, so nothing here depends on the Compose test
     * clock.
     */
    private class HangingGateway : AuthGateway {
        val gate = CompletableDeferred<AuthOutcome>()
        var attempts = 0
            private set
        var cancelled = false
            private set

        override suspend fun signIn(
            email: String,
            password: String,
        ): AuthOutcome {
            attempts++
            try {
                return gate.await()
            } catch (e: CancellationException) {
                cancelled = true
                throw e
            }
        }

        override suspend fun currentSession(): AuthSession? = null

        override suspend fun signOut() = Unit
    }

    private fun startSignIn(gateway: AuthGateway) {
        composeRule.setContent {
            LoginRoute(gateway = gateway, onAuthenticated = {})
        }
        composeRule.onNodeWithTag("login_email").performTextInput("sw@pennhousing.test")
        composeRule.onNodeWithTag("login_password").performTextInput("pw-123456")
        composeRule.onNodeWithTag("login_submit").performClick()
    }

    @Test
    fun signingInOffersCancelAndLocksTheSubmitButton() {
        startSignIn(HangingGateway())

        composeRule.onNodeWithTag("login_cancel").assertExists()
        composeRule.onNodeWithTag("login_submit").assertIsNotEnabled()
        // The PennKey progress note this replaced is gone; the worker gets an action, not prose.
        composeRule.onNodeWithTag("login_submitting_note").assertDoesNotExist()
    }

    @Test
    fun cancelIsNotOfferedBeforeAnAttemptStarts() {
        composeRule.setContent { LoginRoute(gateway = HangingGateway(), onAuthenticated = {}) }

        composeRule.onNodeWithTag("login_cancel").assertDoesNotExist()
    }

    @Test
    fun cancelStopsTheInFlightCallAndReturnsTheFormToEditable() {
        val gateway = HangingGateway()
        startSignIn(gateway)

        composeRule.onNodeWithTag("login_cancel").performClick()

        // The request is actually torn down, not merely ignored — a leaked call would keep the
        // connection open and, worse, could still land on the screen later.
        assertTrue("cancel must cancel the in-flight signIn coroutine", gateway.cancelled)
        composeRule.onNodeWithTag("login_cancel").assertDoesNotExist()
        composeRule.onNodeWithTag("login_submit").assertIsEnabled()
        // The worker chose this; it is not a failure and must not raise a banner.
        composeRule.onNodeWithTag("login_error").assertDoesNotExist()
    }

    @Test
    fun aResultLandingAfterCancelDoesNotShowAnError() {
        val gateway = HangingGateway()
        startSignIn(gateway)
        composeRule.onNodeWithTag("login_cancel").performClick()

        // The abandoned attempt reaches its own conclusion afterwards (its timeout expires).
        // It must not reach back onto a screen the worker has already left.
        gateway.gate.complete(AuthOutcome.Failure(com.pennhousing.shift.shared.auth.AuthError.TIMEOUT))
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("login_error").assertDoesNotExist()
        composeRule.onNodeWithTag("login_submit").assertIsEnabled()
    }

    @Test
    fun cancelThenSubmitStartsAFreshAttempt() {
        val gateway = HangingGateway()
        startSignIn(gateway)
        composeRule.onNodeWithTag("login_cancel").performClick()

        composeRule.onNodeWithTag("login_submit").performClick()

        composeRule.onNodeWithTag("login_cancel").assertExists()
        assertTrue("re-submitting must issue a second signIn", gateway.attempts == 2)
    }

    @Test
    fun aFailureThatArrivesNormallyStillShowsItsError() {
        val gateway = HangingGateway()
        startSignIn(gateway)

        gateway.gate.complete(AuthOutcome.Failure(com.pennhousing.shift.shared.auth.AuthError.TIMEOUT))
        composeRule.waitForIdle()

        // The guard above must suppress LATE results only. An ordinary failure still reports,
        // otherwise "no error ever shows" would pass every assertion in this class.
        composeRule.onNodeWithTag("login_error").assertExists()
        composeRule.onNodeWithTag("login_cancel").assertDoesNotExist()
        assertFalse("an ordinary failure is not a cancellation", gateway.cancelled)
    }
}
