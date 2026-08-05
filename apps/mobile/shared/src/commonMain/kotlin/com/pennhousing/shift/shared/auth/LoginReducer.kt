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
    /** Non-blocking domain hint (TEST_PLAN §3.1 note) — see [LoginFormValidator.domainWarning]. */
    val emailWarning: String? = null,
    val formError: AuthError? = null,
    /** DEBUG-only raw diagnostic behind [formError] (never shown to end users). */
    val formErrorDetail: String? = null,
    val session: AuthSession? = null,
)

sealed interface LoginEvent {
    data class EmailChanged(val value: String) : LoginEvent

    data class PasswordChanged(val value: String) : LoginEvent

    data object SubmitRequested : LoginEvent

    /**
     * The worker backed out of an in-flight sign-in. The only event the machine
     * honours while SUBMITTING, and the reason SUBMITTING is no longer a one-way
     * door: without it a slow or hung gateway leaves the screen with no way out.
     */
    data object CancelRequested : LoginEvent

    data class AuthSucceeded(val session: AuthSession) : LoginEvent

    data class AuthFailed(val error: AuthError, val detail: String? = null) : LoginEvent
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
                    it.copy(
                        email = event.value,
                        errors = it.errors.copy(email = null),
                        emailWarning = LoginFormValidator.domainWarning(event.value),
                    )
                }
            is LoginEvent.PasswordChanged ->
                editField(state) {
                    it.copy(password = event.value, errors = it.errors.copy(password = null))
                }
            LoginEvent.SubmitRequested -> submit(state)
            LoginEvent.CancelRequested -> cancel(state)
            is LoginEvent.AuthSucceeded ->
                if (state.phase == LoginPhase.SUBMITTING) {
                    state.copy(
                        phase = LoginPhase.AUTHENTICATED,
                        session = event.session,
                        errors = FormErrors(null, null),
                        formError = null,
                        formErrorDetail = null,
                    )
                } else {
                    state
                }
            is LoginEvent.AuthFailed ->
                if (state.phase == LoginPhase.SUBMITTING) {
                    state.copy(
                        phase = LoginPhase.ERROR,
                        formError = event.error,
                        formErrorDetail = event.detail,
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
        val next = mutate(state).copy(formError = null, formErrorDetail = null)
        return if (next.phase == LoginPhase.ERROR) next.copy(phase = LoginPhase.EDITING) else next
    }

    /**
     * CancelRequested: only meaningful while SUBMITTING — drop back to EDITING with
     * the typed credentials intact and no error banner (the worker chose this; it is
     * not a failure). The host cancels the in-flight gateway call alongside.
     *
     * Returning to EDITING is also what makes a late result harmless: [AuthSucceeded]
     * and [AuthFailed] are both honoured ONLY from SUBMITTING, so a response that
     * lands after the cancel is dropped rather than signing the worker in or
     * flashing a stale error at them.
     */
    private fun cancel(state: LoginUiState): LoginUiState =
        if (state.phase == LoginPhase.SUBMITTING) {
            state.copy(
                phase = LoginPhase.EDITING,
                errors = FormErrors(null, null),
                formError = null,
                formErrorDetail = null,
                session = null,
            )
        } else {
            state
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
            state.copy(phase = LoginPhase.EDITING, errors = errors, formError = null, formErrorDetail = null)
        } else {
            state.copy(phase = LoginPhase.SUBMITTING, errors = FormErrors(null, null), formError = null, formErrorDetail = null)
        }
    }
}
