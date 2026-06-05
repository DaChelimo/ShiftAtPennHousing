package com.pennhousing.shift.shared.auth

/** The four phases of the login screen's state machine (TEST_PLAN §2/§3.2). */
enum class LoginPhase { EDITING, SUBMITTING, AUTHENTICATED, ERROR }

/**
 * The full login-screen snapshot the host renders and feeds back into
 * [LoginReducer]. `phase == SUBMITTING` is the host's signal to call
 * `AuthGateway.signIn`; `AUTHENTICATED` carries the resulting [session].
 */
data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val phase: LoginPhase = LoginPhase.EDITING,
    val errors: FormErrors = FormErrors(null, null),
    val formError: AuthError? = null,
    val session: AuthSession? = null,
)

sealed interface LoginEvent {
    data class EmailChanged(val value: String) : LoginEvent

    data class PasswordChanged(val value: String) : LoginEvent

    data object SubmitRequested : LoginEvent

    data class AuthSucceeded(val session: AuthSession) : LoginEvent

    data class AuthFailed(val error: AuthError) : LoginEvent
}

/**
 * The pure, total login state machine (TEST_PLAN §3.2). `reduce` is a pure
 * function of (state, event) — it never reads a clock, performs I/O, or throws.
 * Every (state, event) pair returns a [LoginUiState] (the input state unchanged
 * when the event is not honored in the current phase).
 */
object LoginReducer {
    fun reduce(
        state: LoginUiState,
        event: LoginEvent,
    ): LoginUiState =
        when (event) {
            is LoginEvent.EmailChanged ->
                editField(state) {
                    it.copy(email = event.value, errors = it.errors.copy(email = null))
                }
            is LoginEvent.PasswordChanged ->
                editField(state) {
                    it.copy(password = event.value, errors = it.errors.copy(password = null))
                }
            LoginEvent.SubmitRequested -> submit(state)
            is LoginEvent.AuthSucceeded ->
                if (state.phase == LoginPhase.SUBMITTING) {
                    state.copy(
                        phase = LoginPhase.AUTHENTICATED,
                        session = event.session,
                        errors = FormErrors(null, null),
                        formError = null,
                    )
                } else {
                    state
                }
            is LoginEvent.AuthFailed ->
                if (state.phase == LoginPhase.SUBMITTING) {
                    state.copy(
                        phase = LoginPhase.ERROR,
                        formError = event.error,
                        session = null,
                    )
                } else {
                    state
                }
        }

    /**
     * Field edits (§3.2): apply [mutate] (sets the field and clears that field's
     * error), always clear `formError`, and if currently in ERROR move back to
     * EDITING. No effect while SUBMITTING or AUTHENTICATED.
     */
    private inline fun editField(
        state: LoginUiState,
        mutate: (LoginUiState) -> LoginUiState,
    ): LoginUiState {
        if (state.phase == LoginPhase.SUBMITTING || state.phase == LoginPhase.AUTHENTICATED) return state
        val next = mutate(state).copy(formError = null)
        return if (next.phase == LoginPhase.ERROR) next.copy(phase = LoginPhase.EDITING) else next
    }

    /**
     * SubmitRequested (§3.2): no effect while SUBMITTING/AUTHENTICATED; otherwise
     * validate the current email+password. Invalid ⇒ stay EDITING with the
     * validation errors (and `formError` cleared) and do NOT enter SUBMITTING;
     * valid ⇒ enter SUBMITTING with errors and `formError` cleared.
     */
    private fun submit(state: LoginUiState): LoginUiState {
        if (state.phase == LoginPhase.SUBMITTING || state.phase == LoginPhase.AUTHENTICATED) return state
        val errors = LoginFormValidator.validate(state.email, state.password)
        return if (errors.hasError) {
            state.copy(phase = LoginPhase.EDITING, errors = errors, formError = null)
        } else {
            state.copy(phase = LoginPhase.SUBMITTING, errors = FormErrors(null, null), formError = null)
        }
    }
}
