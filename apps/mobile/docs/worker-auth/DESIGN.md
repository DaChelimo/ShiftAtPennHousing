# Worker App — Real Login & Live-Backend Wiring · DESIGN

> **Feature:** the worker (SW) app authenticates a real student worker against the live Supabase
> backend and shows *that worker's* actual shifts, instead of always running on `DemoData`.
>
> **Methodology (blind-implementer TDD).** This design is the source of truth. From it I write
> (a) the real tests and (b) a `TEST_PLAN.md` that is a faithful *behavioral contract* with no
> literal assertions/fixtures. A separate implementer (fresh context, no access to the test files)
> builds the pure logic from `TEST_PLAN.md` only — it cannot game tests it cannot see. Then the
> hidden tests + an independent review + a real emulator login verify it.

---

## 1. Scope

**In scope (this feature):**
- A worker signs in with email + password (Supabase GoTrue) and lands on their **real** shifts.
- On launch, a previously valid session skips the login screen; otherwise login is shown.
- When no backend is configured, the app still runs on `DemoData` (today's behavior is preserved).
- Android end-to-end (emulator) + the shared pure logic (works for both platforms).

**Out of scope (explicitly deferred, noted so nobody assumes otherwise):**
- iOS SwiftUI login UI (the shared pure logic is platform-agnostic and ready for it; only the
  SwiftUI screen + `ContentView` wiring is deferred).
- Live **float-ack** data: `WorkerShiftsRepository` exposes `WorkerSnapshot{myShifts, openShifts}`
  + `ToastNotification`, but **not** a pending-`FloatAck` feed. Live "my shifts / open shifts" is
  the deliverable; the float-ack modal stays on demo/empty when live until the repo grows a
  pending-float query (separate task).
- Secure token persistence (Keychain / EncryptedSharedPreferences). v1 uses supabase-kt's own
  session storage if available; if a launch has no live session, we simply show login. Persistence
  hardening is a follow-up.
- Token auto-refresh scheduling beyond what supabase-kt's Auth does internally.

---

## 2. The split: pure (TDD'd) vs adapter (integration-verified)

This is the crux of the whole approach. The **pure** column is what the hidden tests cover and what
the blind implementer builds. The **adapter** column is what I build and verify by running the app
(it can't be unit-tested — same boundary the project draws for the network/data/UI layers).

| Pure logic — `commonMain/.../auth/` (TDD'd, blind-implemented) | Adapter / integration — (I build, verify by running) |
|---|---|
| Auth domain types (`AuthSession`, `AuthOutcome`, `AuthError`) | `SupabaseAuthGateway` — real GoTrue sign-in/restore/sign-out |
| `AuthGateway` **interface** (the injected boundary) | Wiring `AppConfig.accessTokenProvider` to the live JWT |
| `LoginFormValidator` — input validation | Android Compose `LoginScreen` + `LoginHost` (collects state, calls gateway) |
| `LoginReducer` — the login state machine (synchronous) | `MainActivity` routing (login vs shifts) + live `WorkerShiftsRepository` collection |
| `SessionValidity` — token-expiry check | `androidApp` build config (`SUPABASE_URL`/anon key) + **debug cleartext** manifest |
| `AppBootstrap` — start-destination + data-source routing | Emulator build/install/launch |

**Why this split passes the anti-gaming bar:** the implementer receives only behavioral
requirements + the exact public API (so my adapters compile against it), never the test fixtures
or expected literals. It must implement the *described behavior*; the hidden tests then check that
behavior with concrete inputs the implementer never saw.

---

## 3. Pure API contract (what the implementer must produce — `package com.pennhousing.shift.shared.auth`)

All `kotlin.time.Instant` (opt-in `kotlin.time.ExperimentalTime`, per repo convention). No I/O, no
clock reads inside pure logic — `now` is always a parameter. If any `@Volatile` is used it MUST be
`kotlin.concurrent.Volatile` (explicit import) — the bare annotation breaks Kotlin/Native.

```kotlin
// --- domain ---
data class AuthSession(val userId: String, val accessToken: String, val expiresAt: Instant)

enum class AuthError { INVALID_CREDENTIALS, NETWORK, UNKNOWN }

sealed interface AuthOutcome {
    data class Success(val session: AuthSession) : AuthOutcome
    data class Failure(val error: AuthError) : AuthOutcome
}

/** The injected boundary to the real auth backend. Implemented by the adapter; faked in tests. */
interface AuthGateway {
    suspend fun signIn(email: String, password: String): AuthOutcome
    suspend fun currentSession(): AuthSession?   // restore on launch; null if none/expired
    suspend fun signOut()
}

// --- validation ---
data class FormErrors(val email: String?, val password: String?) {
    val hasError: Boolean get() = email != null || password != null
}
object LoginFormValidator {
    fun validate(email: String, password: String): FormErrors
}

// --- login state machine (synchronous reducer) ---
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
    data class AuthSucceeded(val session: AuthSession) : LoginEvent
    data class AuthFailed(val error: AuthError) : LoginEvent
}

object LoginReducer {
    fun reduce(state: LoginUiState, event: LoginEvent): LoginUiState
}

// --- session validity ---
object SessionValidity {
    val DEFAULT_SKEW: Duration = 60.seconds
    fun isValid(session: AuthSession?, now: Instant, skew: Duration = DEFAULT_SKEW): Boolean
}

// --- app bootstrap routing ---
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

---

## 4. Behavior specification (the contract — drives both tests and TEST_PLAN)

### 4.1 `LoginFormValidator.validate`
- Blank/whitespace email ⇒ non-null `email` error.
- Non-blank email lacking an `@` ⇒ non-null `email` error.
- Blank/whitespace password ⇒ non-null `password` error.
- Otherwise the corresponding field error is `null`. Valid email **and** password ⇒ `hasError == false`.
- (Exact message strings are an implementation detail; tests assert null/non-null, not text.)

### 4.2 `LoginReducer.reduce`
- **EmailChanged / PasswordChanged**: update that field. Clears that field's error and any
  `formError`. If `phase == ERROR`, returns to `EDITING`. **Ignored (state unchanged) while
  `SUBMITTING`**, and **ignored once `AUTHENTICATED`** (terminal).
- **SubmitRequested**:
  - Ignored if already `SUBMITTING` (no double-submit) or `AUTHENTICATED`.
  - Runs `LoginFormValidator.validate`. If it has errors ⇒ stay in `EDITING` with `errors`
    populated and **do not** enter `SUBMITTING` (this is the signal the host uses to *not* call the
    gateway). `formError` cleared.
  - If valid ⇒ `phase = SUBMITTING`, `errors` cleared, `formError = null`. (Entering `SUBMITTING`
    is the host's cue to call `AuthGateway.signIn`.)
- **AuthSucceeded(session)**: only honored when `phase == SUBMITTING` ⇒ `phase = AUTHENTICATED`,
  `session` set, errors/formError cleared. Otherwise ignored (defends against stale events).
- **AuthFailed(error)**: only honored when `phase == SUBMITTING` ⇒ `phase = ERROR`,
  `formError = error`, `session = null`. Otherwise ignored.
- Pure & total: any (state, event) returns a `LoginUiState`; never throws.

### 4.3 `SessionValidity.isValid`
- `null` session ⇒ false.
- Non-null ⇒ `now < expiresAt - skew` (token considered unusable once within `skew` of expiry).
- Exactly at `expiresAt - skew` ⇒ false (strict `<`).

### 4.4 `AppBootstrap.decide`
- `backendConfigured == false` ⇒ `(SHIFTS, DEMO)` — preserves no-backend demo behavior.
- `backendConfigured == true` **and** `SessionValidity.isValid(session, now, skew)` ⇒ `(SHIFTS, LIVE)`.
- `backendConfigured == true` **and** not valid (null or expired) ⇒ `(LOGIN, LIVE)`.

### 4.5 Host orchestration (adapter, not unit-tested — described for completeness)
A `LoginHost` holds `MutableStateFlow<LoginUiState>`, applies every UI event + gateway result
through `LoginReducer`. A `LaunchedEffect`/collector observes the phase: **when it becomes
`SUBMITTING`**, it calls `gateway.signIn(email, password)` once and dispatches `AuthSucceeded`/
`AuthFailed`. On `AUTHENTICATED`, it sets `AppConfig.accessTokenProvider = { <live JWT> }` and the
app routes to the shifts screen built from `WorkerShiftsRepository.observeWorkerWeek(session.userId)`.

---

## 5. Adapter layer (I build; verified by running)

1. **`SupabaseAuthGateway(client: SupabaseClient) : AuthGateway`** (`commonMain/.../data/` or
   `network/`). `signIn` → `client.auth.signInWith(Email){…}`, then read the current session →
   map to `AuthSession(userId, accessToken, expiresAt)`. Map failures: bad creds ⇒
   `INVALID_CREDENTIALS`, IO/timeout ⇒ `NETWORK`, else `UNKNOWN`. `currentSession()` →
   `client.auth.currentSessionOrNull()` (after init). `signOut()` → `client.auth.signOut()`.
   Also exposes the live token for `AppConfig.accessTokenProvider`. (Exact supabase-kt 3.1.1 Auth
   method names verified at implementation time.)
2. **Android `LoginScreen` Composable** (`androidApp/.../ui/LoginScreen.kt`) with testTags
   `login_email`, `login_password`, `login_submit`, `login_error` (for future Maestro/manual use),
   driven by the `LoginUiState`.
3. **`MainActivity` routing**: build `backendConfigured = AppConfig.supabaseUrl.isNotBlank()`,
   restore session via the gateway, call `AppBootstrap.decide(...)`. `LOGIN` ⇒ show `LoginScreen`;
   `SHIFTS + LIVE` ⇒ collect `observeWorkerWeek(userId)` into `ShiftsScreenViewModel`;
   `SHIFTS + DEMO` ⇒ current `DemoData` path unchanged.
4. **Config**: `androidApp/build.gradle.kts` already reads `-PSUPABASE_URL`/`-PSUPABASE_ANON_KEY`.
   Add **`androidApp/src/debug/AndroidManifest.xml`** with `android:usesCleartextTraffic="true"`
   (debug only — Android blocks `http://` by default; the emulator reaches the host stack at
   `http://10.0.2.2:54321`). Release manifest untouched.

---

## 6. KMP guardrails (must hold or iOS silently breaks)

- Pure code lives in `commonMain`; tests in `commonTest` using `kotlin.test`.
- `kotlin.time.Instant` + `Duration` (`kotlin.time`), opt-in `ExperimentalTime`. Not `kotlinx.datetime`.
- Any `@Volatile` ⇒ `import kotlin.concurrent.Volatile`.
- Validate iOS-clean with `./gradlew :shared:compileKotlinIosSimulatorArm64` (fast) — the JVM host
  test task can stay green while Kotlin/Native breaks.

---

## 7. Verification plan

1. **Unit (pure surface):** run the hidden tests — `./gradlew :shared:testAndroidHostTest` — green.
2. **KMP-clean:** `./gradlew :shared:compileKotlinIosSimulatorArm64` compiles (shared logic is iOS-safe).
3. **Independent review:** a reviewer subagent checks the implementation against the contract for
   correctness *and* quality (catches "passes tests but poorly written / overfit").
4. **Build:** `./gradlew :androidApp:assembleDebug -PSUPABASE_URL=http://10.0.2.2:54321 -PSUPABASE_ANON_KEY=<local anon JWT>`.
5. **Integration (the real proof):** boot `Medium_Phone_API_35`, install, launch, sign in as a
   seeded SW (e.g. `e.quad.1@pennhousing.test` / `test-Password-123`) → the worker's **real**
   seeded shifts render (cross-checked against the DB for that `user_id`).

---

## 8. Phase checklist (this feature)

- [x] **P0 Design** — this document.
- [ ] **P1 Tests** — kotlin.test for validator, reducer, session-validity, bootstrap (staged OUTSIDE the repo during implementation).
- [ ] **P2 TEST_PLAN.md** — behavioral contract + exact API; the implementer's only input.
- [ ] **P3 Blind implementation** — subagent builds the pure `auth/` package from TEST_PLAN.md (no test access).
- [ ] **P4 Verify pure** — run hidden tests + iOS compile + independent review; iterate via *abstract* feedback only.
- [ ] **P5 Adapters** — SupabaseAuthGateway, LoginScreen, MainActivity routing, cleartext/config.
- [ ] **P6 Integration** — build, launch on emulator, log in as a seeded SW, confirm real shifts.
