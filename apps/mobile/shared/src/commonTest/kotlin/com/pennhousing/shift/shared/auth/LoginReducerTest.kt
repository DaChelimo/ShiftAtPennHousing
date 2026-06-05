package com.pennhousing.shift.shared.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

class LoginReducerTest {
    private val session =
        AuthSession("u-42", "tok-abc", Instant.parse("2026-03-04T18:00:00Z"))

    private fun submitting(
        email: String = "sw@pennhousing.test",
        password: String = "pw-123456",
    ) = LoginUiState(email = email, password = password, phase = LoginPhase.SUBMITTING)

    @Test
    fun emailChangedUpdatesFieldAndStaysEditing() {
        val s = LoginReducer.reduce(LoginUiState(), LoginEvent.EmailChanged("a@b.co"))
        assertEquals("a@b.co", s.email)
        assertEquals(LoginPhase.EDITING, s.phase)
        assertNull(s.errors.email)
    }

    @Test
    fun passwordChangedUpdatesField() {
        val s = LoginReducer.reduce(
            LoginUiState(email = "a@b.co"),
            LoginEvent.PasswordChanged("secret-pw"),
        )
        assertEquals("secret-pw", s.password)
    }

    @Test
    fun submitWithInvalidFormStaysEditingWithErrorsAndDoesNotSubmit() {
        val s = LoginReducer.reduce(
            LoginUiState(email = "", password = ""),
            LoginEvent.SubmitRequested,
        )
        assertEquals(LoginPhase.EDITING, s.phase)
        assertTrue(s.errors.hasError)
    }

    @Test
    fun submitWithValidFormEntersSubmittingAndClearsStaleErrors() {
        val start = LoginUiState(
            email = "sw@pennhousing.test",
            password = "pw-123456",
            errors = FormErrors("stale", null),
            formError = AuthError.NETWORK,
        )
        val s = LoginReducer.reduce(start, LoginEvent.SubmitRequested)
        assertEquals(LoginPhase.SUBMITTING, s.phase)
        assertFalse(s.errors.hasError)
        assertNull(s.formError)
    }

    @Test
    fun doubleSubmitWhileSubmittingIsIgnored() {
        val s0 = submitting()
        assertEquals(s0, LoginReducer.reduce(s0, LoginEvent.SubmitRequested))
    }

    @Test
    fun authSucceededFromSubmittingAuthenticates() {
        val s = LoginReducer.reduce(submitting(), LoginEvent.AuthSucceeded(session))
        assertEquals(LoginPhase.AUTHENTICATED, s.phase)
        assertEquals(session, s.session)
    }

    @Test
    fun authSucceededWhenNotSubmittingIsIgnored() {
        val editing = LoginUiState(email = "a@b.co")
        assertEquals(editing, LoginReducer.reduce(editing, LoginEvent.AuthSucceeded(session)))
    }

    @Test
    fun authFailedFromSubmittingGoesToErrorWithReason() {
        val s = LoginReducer.reduce(
            submitting(),
            LoginEvent.AuthFailed(AuthError.INVALID_CREDENTIALS),
        )
        assertEquals(LoginPhase.ERROR, s.phase)
        assertEquals(AuthError.INVALID_CREDENTIALS, s.formError)
        assertNull(s.session)
    }

    @Test
    fun editingAfterErrorReturnsToEditingAndClearsFormError() {
        val errored = LoginUiState(
            email = "a@b.co",
            password = "pw-123456",
            phase = LoginPhase.ERROR,
            formError = AuthError.INVALID_CREDENTIALS,
        )
        val s = LoginReducer.reduce(errored, LoginEvent.PasswordChanged("pw-9999999"))
        assertEquals(LoginPhase.EDITING, s.phase)
        assertNull(s.formError)
    }

    @Test
    fun editsAreIgnoredWhileSubmitting() {
        val s0 = submitting()
        assertEquals(s0, LoginReducer.reduce(s0, LoginEvent.EmailChanged("x@y.co")))
        assertEquals(s0, LoginReducer.reduce(s0, LoginEvent.PasswordChanged("zzzzzzzz")))
    }

    @Test
    fun authenticatedIsTerminal() {
        val auth = LoginUiState(phase = LoginPhase.AUTHENTICATED, session = session)
        assertEquals(auth, LoginReducer.reduce(auth, LoginEvent.EmailChanged("x@y.co")))
        assertEquals(auth, LoginReducer.reduce(auth, LoginEvent.SubmitRequested))
        assertEquals(auth, LoginReducer.reduce(auth, LoginEvent.AuthFailed(AuthError.NETWORK)))
    }
}
