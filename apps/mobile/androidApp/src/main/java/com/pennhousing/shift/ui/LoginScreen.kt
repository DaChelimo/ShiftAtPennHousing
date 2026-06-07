package com.pennhousing.shift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.auth.AuthError
import com.pennhousing.shift.shared.auth.AuthGateway
import com.pennhousing.shift.shared.auth.AuthOutcome
import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.auth.LoginEvent
import com.pennhousing.shift.shared.auth.LoginPhase
import com.pennhousing.shift.shared.auth.LoginReducer
import com.pennhousing.shift.shared.auth.LoginUiState
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Worker auth — the Android login host + screen (DESIGN §4.5 / §5.2).
 *
 * The host holds a [MutableStateFlow] of the pure [LoginUiState], routes every UI
 * event and every gateway result through [LoginReducer.reduce] (the only place state
 * changes), and reacts to phase transitions:
 *  - when the phase becomes [LoginPhase.SUBMITTING], it calls `gateway.signIn` ONCE
 *    and dispatches [LoginEvent.AuthSucceeded] / [LoginEvent.AuthFailed];
 *  - when it becomes [LoginPhase.AUTHENTICATED], it invokes [onAuthenticated].
 *
 * All decision logic lives in the shared pure `auth/` package (the Fruitties split);
 * this is native Compose over it.
 */
class LoginHost(
    private val gateway: AuthGateway,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun dispatch(event: LoginEvent) {
        _state.value = LoginReducer.reduce(_state.value, event)
    }

    /**
     * Called from a [LaunchedEffect] keyed on the phase: exactly when the reducer has
     * moved us into SUBMITTING, fire the single sign-in call and feed the result back
     * through the reducer. Reading email/password off the current state (not the
     * event) keeps the gateway call a pure function of the submitted form.
     */
    fun runSubmit() {
        val snapshot = _state.value
        if (snapshot.phase != LoginPhase.SUBMITTING) return
        scope.launch {
            val outcome = gateway.signIn(snapshot.email, snapshot.password)
            when (outcome) {
                is AuthOutcome.Success -> dispatch(LoginEvent.AuthSucceeded(outcome.session))
                is AuthOutcome.Failure -> dispatch(LoginEvent.AuthFailed(outcome.error))
            }
        }
    }
}

/**
 * Wires a [LoginHost] into the composition and renders [LoginScreen]. The SUBMITTING
 * effect runs the gateway; the AUTHENTICATED effect surfaces the session to the caller.
 */
@Composable
fun LoginRoute(
    gateway: AuthGateway,
    onAuthenticated: (AuthSession) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val host = remember(gateway) { LoginHost(gateway, scope) }
    val state by host.state.collectAsStateWithLifecycle()

    // Fire the network call once per entry into SUBMITTING.
    LaunchedEffect(state.phase) {
        if (state.phase == LoginPhase.SUBMITTING) host.runSubmit()
    }
    // Surface the authenticated session exactly once.
    LaunchedEffect(state.phase) {
        if (state.phase == LoginPhase.AUTHENTICATED) {
            state.session?.let(onAuthenticated)
        }
    }

    LoginScreen(state = state, onEvent = host::dispatch)
}

/**
 * Pure-ish Compose view over [LoginUiState]. testTags (`login_email`,
 * `login_password`, `login_submit`, `login_error`) match the Maestro selector
 * contract for future flows.
 */
@Composable
fun LoginScreen(
    state: LoginUiState,
    onEvent: (LoginEvent) -> Unit,
) {
    ShiftTheme {
        Scaffold(modifier = Modifier.fillMaxSize().testTag("login_screen")) { padding ->
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Shift@PennHousing",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )

                val submitting = state.phase == LoginPhase.SUBMITTING

                OutlinedTextField(
                    value = state.email,
                    onValueChange = { onEvent(LoginEvent.EmailChanged(it)) },
                    label = { Text("Email") },
                    singleLine = true,
                    enabled = !submitting,
                    isError = state.errors.email != null,
                    supportingText = { state.errors.email?.let { Text(it) } },
                    modifier = Modifier.fillMaxWidth().testTag("login_email"),
                )

                OutlinedTextField(
                    value = state.password,
                    onValueChange = { onEvent(LoginEvent.PasswordChanged(it)) },
                    label = { Text("Password") },
                    singleLine = true,
                    enabled = !submitting,
                    isError = state.errors.password != null,
                    supportingText = { state.errors.password?.let { Text(it) } },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth().testTag("login_password"),
                )

                Button(
                    onClick = { onEvent(LoginEvent.SubmitRequested) },
                    enabled = !submitting,
                    modifier = Modifier.fillMaxWidth().testTag("login_submit"),
                ) {
                    if (submitting) {
                        CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
                        Text("Signing in…")
                    } else {
                        Text("Sign in")
                    }
                }

                if (state.phase == LoginPhase.ERROR && state.formError != null) {
                    Text(
                        text = state.formError!!.toMessage(),
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.fillMaxWidth().testTag("login_error"),
                    )
                }
            }
        }
    }
}

private fun AuthError.toMessage(): String =
    when (this) {
        AuthError.INVALID_CREDENTIALS -> "Incorrect email or password."
        AuthError.NETWORK -> "Network error. Check your connection and try again."
        AuthError.UNKNOWN -> "Something went wrong. Please try again."
    }
