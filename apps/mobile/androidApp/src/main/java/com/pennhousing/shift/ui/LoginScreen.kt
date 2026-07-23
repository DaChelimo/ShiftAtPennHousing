package com.pennhousing.shift.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.BuildConfig
import com.pennhousing.shift.R
import com.pennhousing.shift.shared.auth.AuthError
import com.pennhousing.shift.shared.auth.AuthGateway
import com.pennhousing.shift.shared.auth.AuthOutcome
import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.auth.LoginEvent
import com.pennhousing.shift.shared.auth.LoginPhase
import com.pennhousing.shift.shared.auth.LoginReducer
import com.pennhousing.shift.shared.auth.LoginUiState
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.rememberPersistedDarkTheme
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
                is AuthOutcome.Failure -> dispatch(LoginEvent.AuthFailed(outcome.error, outcome.detail))
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
 * The reskinned login screen (worker-app.html `LoginScreen`) over [LoginUiState] — the
 * brand mark, the PennKey credential fields, "keep me signed in", and the primary
 * sign-in CTA. Binds to the existing reducer via [onEvent]; testTags (`login_screen`,
 * `login_email`, `login_password`, `login_submit`, `login_error`) are preserved.
 *
 * NOTE: a true PennKey SSO redirect is not wired (the gateway is email+password), so
 * the design's separate "Sign in with PennKey" SSO button + the credentials path are
 * folded into one real credential sign-in. "Keep me signed in" is informational — the
 * Supabase session persists via storage regardless.
 */
@Composable
fun LoginScreen(
    state: LoginUiState,
    onEvent: (LoginEvent) -> Unit,
) {
    ShiftTheme(darkTheme = rememberPersistedDarkTheme()) {
        val c = ShiftTheme.colors
        val submitting = state.phase == LoginPhase.SUBMITTING
        var showPassword by remember { mutableStateOf(false) }
        var keepSignedIn by remember { mutableStateOf(true) }

        Scaffold(
            modifier = Modifier.fillMaxSize().testTag("login_screen"),
            containerColor = c.bg,
        ) { padding ->
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(40.dp))
                BrandMark(72.dp)
                Text(
                    "Shift@PennHousing",
                    modifier = Modifier.padding(top = 20.dp),
                    color = c.ink,
                    fontSize = 27.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.02).em,
                )
                Text(
                    "Your schedule, floats and open shifts, for Residential Services staff.",
                    modifier = Modifier.padding(top = 6.dp),
                    color = c.sec,
                    fontSize = 14.5.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 21.sp,
                )

                Spacer(Modifier.height(36.dp))

                LoginField(
                    label = "PennKey email",
                    value = state.email,
                    onValueChange = { onEvent(LoginEvent.EmailChanged(it)) },
                    icon = ShiftIcons.Person,
                    keyboardType = KeyboardType.Email,
                    enabled = !submitting,
                    error = state.errors.email,
                    modifier = Modifier.testTag("login_email"),
                )
                Spacer(Modifier.height(16.dp))
                LoginField(
                    label = "Password",
                    value = state.password,
                    onValueChange = { onEvent(LoginEvent.PasswordChanged(it)) },
                    icon = ShiftIcons.Lock,
                    isPassword = true,
                    passwordVisible = showPassword,
                    keyboardType = KeyboardType.Password,
                    enabled = !submitting,
                    error = state.errors.password,
                    trailing = {
                        Text(
                            if (showPassword) "Hide" else "Show",
                            modifier = Modifier.clickable { showPassword = !showPassword },
                            color = MaterialTheme.colorScheme.primary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    },
                    modifier = Modifier.testTag("login_password"),
                )

                Row(
                    Modifier.fillMaxWidth().padding(top = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(
                        modifier = Modifier.clickable { keepSignedIn = !keepSignedIn },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(
                            Modifier
                                .size(20.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (keepSignedIn) MaterialTheme.colorScheme.primary else Color.Transparent)
                                .border(
                                    1.5.dp,
                                    if (keepSignedIn) MaterialTheme.colorScheme.primary else c.outline,
                                    RoundedCornerShape(6.dp),
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (keepSignedIn) {
                                Icon(ShiftIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp))
                            }
                        }
                        Text("Keep me signed in", color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    }
                    Text("Need help?", color = MaterialTheme.colorScheme.primary, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                }

                Spacer(Modifier.height(20.dp))
                ShiftButton(
                    text = if (submitting) "Signing in…" else "Sign in with PennKey",
                    onClick = { onEvent(LoginEvent.SubmitRequested) },
                    modifier = Modifier.fillMaxWidth().testTag("login_submit"),
                    size = ButtonSize.Lg,
                    icon = if (submitting) null else ShiftIcons.Lock,
                    enabled = !submitting,
                    fullWidth = true,
                )

                if (state.phase == LoginPhase.ERROR && state.formError != null) {
                    Spacer(Modifier.height(16.dp))
                    ShiftBanner(
                        title = state.formError!!.toMessage(),
                        tone = BannerTone.Error,
                        modifier = Modifier.testTag("login_error"),
                    )
                    // DEBUG-only: the raw underlying error (yellow), so a network/config
                    // failure is not mistaken for a wrong password. Never shown in release.
                    if (BuildConfig.DEBUG && state.formErrorDetail != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "debug: ${state.formErrorDetail}",
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0x22C79200))
                                    .padding(horizontal = 12.dp, vertical = 8.dp)
                                    .testTag("login_error_debug"),
                            color = Color(0xFFB8860B),
                            fontSize = 12.sp,
                            lineHeight = 15.sp,
                            maxLines = 3,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
                    }
                }

                Spacer(Modifier.height(28.dp))
                Text(
                    "University of Pennsylvania · Residential Services\nBy signing in you agree to the staff scheduling policy.",
                    color = c.ter,
                    fontSize = 11.5.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 17.sp,
                    modifier = Modifier.padding(bottom = 24.dp),
                )
            }
        }
    }
}

/**
 * The brand mark: the chevronel on its paper ground.
 *
 * `ic_brand_mark` is generated by scripts/brand/build-icons.mjs from the same
 * geometry as the launcher icon, the iOS AppIcon and the web favicon, so this
 * cannot drift from them. The drawable carries its own ground, which is why it
 * reads identically in light and dark. Corner radius matches the iOS squircle
 * so the two platforms' login screens agree. See docs/design/logo.md.
 */
@Composable
private fun BrandMark(size: androidx.compose.ui.unit.Dp) {
    Image(
        painter = painterResource(R.drawable.ic_brand_mark),
        contentDescription = null,
        modifier = Modifier.size(size).clip(RoundedCornerShape(size * 0.2237f)),
    )
}

/** A login text field (worker-app.html `Field`): label + a 52dp rounded box with icon + input. */
@Composable
private fun LoginField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    isPassword: Boolean = false,
    passwordVisible: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    enabled: Boolean = true,
    error: String? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = ShiftTheme.colors
    var focused by remember { mutableStateOf(false) }
    val borderColor =
        when {
            error != null -> c.danger.accent
            focused -> MaterialTheme.colorScheme.primary
            else -> c.divider
        }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(label, color = c.sec, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(13.dp))
                .background(c.surface)
                .border(1.5.dp, borderColor, RoundedCornerShape(13.dp))
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(icon, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = modifier.weight(1f).onFocusChanged { focused = it.isFocused },
                enabled = enabled,
                singleLine = true,
                textStyle = TextStyle(color = c.ink, fontSize = 16.sp, fontWeight = FontWeight.Medium),
                visualTransformation = if (isPassword && !passwordVisible) PasswordVisualTransformation() else VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
            trailing?.invoke()
        }
        if (error != null) Text(error, color = c.danger.accent, fontSize = 12.5.sp)
    }
}

private fun AuthError.toMessage(): String =
    when (this) {
        AuthError.INVALID_CREDENTIALS -> "Incorrect email or password."
        AuthError.NETWORK -> "Network error. Check your connection and try again."
        AuthError.UNKNOWN -> "Something went wrong. Please try again."
    }
