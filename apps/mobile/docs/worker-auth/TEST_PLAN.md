# Worker Auth — Pure Logic · TEST PLAN (implementer's contract)

> **You are implementing a feature blind.** This file is your **complete and only** specification.
> A hidden test suite verifies the behavior described here against concrete inputs you will not see.
> **Do not** search for, open, or read any test files (`*Test.kt`) — implement the *behavior*
> described, not assertions. There are no feature tests in the tree to find. Implement exactly the
> public API in §2 (signatures are a contract other code compiles against — do not rename or
> re-shape them) and the behavior in §3. Build only the pure logic; the adapters are built
> separately.

## 1. What to build & where

Create the Kotlin package **`com.pennhousing.shift.shared.auth`** in
`apps/mobile/shared/src/commonMain/kotlin/com/pennhousing/shift/shared/auth/`. Pure logic only:
no network, no platform APIs, no I/O, **no clock reads** (`now` is always a parameter). All time
types are `kotlin.time.Instant` / `kotlin.time.Duration` with `@OptIn(kotlin.time.ExperimentalTime::class)`
where needed (this repo uses `kotlin.time`, **not** `kotlinx.datetime`). If you use `@Volatile`, it
**must** be `import kotlin.concurrent.Volatile` (the bare/JVM one breaks Kotlin/Native). Suggested
file split: `AuthModels.kt`, `LoginFormValidator.kt`, `LoginReducer.kt`, `SessionValidity.kt`,
`AppBootstrap.kt` (your choice, same package).

## 2. Public API (produce these signatures exactly)

```kotlin
package com.pennhousing.shift.shared.auth

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

data class AuthSession(val userId: String, val accessToken: String, val expiresAt: Instant)

enum class AuthError { INVALID_CREDENTIALS, NETWORK, TIMEOUT, UNKNOWN }

sealed interface AuthOutcome {
    data class Success(val session: AuthSession) : AuthOutcome
    data class Failure(val error: AuthError) : AuthOutcome
}

interface AuthGateway {
    suspend fun signIn(email: String, password: String): AuthOutcome
    suspend fun currentSession(): AuthSession?
    suspend fun signOut()
}

data class FormErrors(val email: String?, val password: String?) {
    val hasError: Boolean get() = email != null || password != null
}

object LoginFormValidator {
    fun validate(email: String, password: String): FormErrors
}

enum class LoginPhase { EDITING, SUBMITTING, AUTHENTICATED, ERROR }

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
    data object CancelRequested : LoginEvent
    data class AuthSucceeded(val session: AuthSession) : LoginEvent
    data class AuthFailed(val error: AuthError) : LoginEvent
}

object LoginReducer {
    fun reduce(state: LoginUiState, event: LoginEvent): LoginUiState
}

object SessionValidity {
    val DEFAULT_SKEW: Duration = 60.seconds
    fun isValid(session: AuthSession?, now: Instant, skew: Duration = DEFAULT_SKEW): Boolean
}

enum class StartDestination { LOGIN, SHIFTS }
enum class DataSource { DEMO, LIVE }
data class BootstrapDecision(val start: StartDestination, val source: DataSource)

object AppBootstrap {
    fun decide(
        backendConfigured: Boolean,
        session: AuthSession?,
        now: Instant,
        skew: Duration = SessionValidity.DEFAULT_SKEW,
    ): BootstrapDecision
}
```

> Note: `AuthGateway` is only an **interface** here — do **not** implement it (the real
> Supabase-backed implementation is built separately). Your job is the pure logic that *uses* its
> result types (`AuthOutcome`, `AuthSession`, `AuthError`).

## 3. Required behavior

### 3.1 `LoginFormValidator.validate(email, password) -> FormErrors`
- Email that is blank or whitespace-only ⇒ non-null `email` error.
- Email that is non-blank but contains **no** `@` ⇒ non-null `email` error.
- Password that is blank or whitespace-only ⇒ non-null `password` error.
- A field with no problem ⇒ that field's error is `null`. A valid email **and** valid password ⇒
  `hasError == false`. (The exact message text is yours; only presence/absence is specified.)

### 3.2 `LoginReducer.reduce(state, event) -> LoginUiState` (pure, total, never throws)
- **`EmailChanged(v)` / `PasswordChanged(v)`**: set the field to `v`; clear **that** field's error
  and clear `formError`; if `phase == ERROR`, move to `EDITING`. **No effect (return the state
  unchanged) when `phase == SUBMITTING` or `phase == AUTHENTICATED`.**
- **`SubmitRequested`**:
  - If `phase == SUBMITTING` or `AUTHENTICATED` ⇒ unchanged.
  - Otherwise validate the current email+password. **If invalid** ⇒ stay in `EDITING`, set `errors`
    to the validation result, clear `formError`, and **do not** enter `SUBMITTING`. **If valid** ⇒
    `phase = SUBMITTING`, clear `errors`, clear `formError`. (Entering `SUBMITTING` is the external
    host's signal to call `AuthGateway.signIn`; staying in `EDITING` means it won't.)
- **`AuthSucceeded(session)`**: honored **only** when `phase == SUBMITTING` ⇒ `phase =
  AUTHENTICATED`, set `session`, clear `errors` and `formError`. From any other phase ⇒ unchanged.
- **`AuthFailed(error)`**: honored **only** when `phase == SUBMITTING` ⇒ `phase = ERROR`,
  `formError = error`, `session = null`. From any other phase ⇒ unchanged.
- `AUTHENTICATED` is terminal: every event leaves the state unchanged.

### 3.3 `SessionValidity.isValid(session, now, skew) -> Boolean`
- `null` session ⇒ `false`.
- Otherwise ⇒ `true` iff `now` is strictly before `expiresAt - skew` (i.e. once `now` reaches
  `expiresAt - skew` or later, it's `false`). Default `skew` is `DEFAULT_SKEW` (60s); a caller-
  supplied `skew` must be honored.

### 3.4 `AppBootstrap.decide(backendConfigured, session, now, skew) -> BootstrapDecision`
- `backendConfigured == false` ⇒ `BootstrapDecision(SHIFTS, DEMO)`.
- `backendConfigured == true` **and** the session is valid (per `SessionValidity.isValid`) ⇒
  `BootstrapDecision(SHIFTS, LIVE)`.
- `backendConfigured == true` **and** the session is not valid (null or expired) ⇒
  `BootstrapDecision(LOGIN, LIVE)`.

## 4. Self-check (tests are withheld by design)
- `./gradlew :shared:testAndroidHostTest` — must **compile** (it runs the existing, unrelated tests;
  yours are not present). Don't add tests.
- `./gradlew :shared:compileKotlinIosSimulatorArm64` — must compile (proves the code is Kotlin/Native-safe).
- Keep everything in `commonMain`. Do not touch other packages, the build files, or the app modules.
