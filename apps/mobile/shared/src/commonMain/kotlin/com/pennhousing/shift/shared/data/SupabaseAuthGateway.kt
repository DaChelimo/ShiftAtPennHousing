package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.auth.AuthError
import com.pennhousing.shift.shared.auth.AuthGateway
import com.pennhousing.shift.shared.auth.AuthOutcome
import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.platform.AppConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.user.UserSession
import io.github.jan.supabase.exceptions.RestException
import io.ktor.client.plugins.HttpRequestTimeoutException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.datetime.toStdlibInstant
import kotlinx.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration.Companion.seconds

/**
 * Worker auth — the real GoTrue-backed [AuthGateway] (adapter layer, DESIGN §5.1).
 *
 * The pure login state machine (`auth/`) is injected with an [AuthGateway]; this is
 * the production implementation over supabase-kt 3.1.1 Auth. It is the mobile
 * analogue of the Edge/HTTP layer the test plans scope out — not exercised by the
 * kotlin.test suite, verified by signing in against a running backend.
 *
 * supabase-kt 3.1.1 Auth API used here:
 * - `client.auth.signInWith(Email) { email = …; password = … }` — suspends, updates
 *   `sessionStatus`, throws a [RestException] subclass on an error response and a
 *   ktor [HttpRequestTimeoutException] / [IOException] on connectivity failure.
 * - `client.auth.currentSessionOrNull(): UserSession?` — the live session snapshot.
 * - `client.auth.loadFromStorage()` / `awaitInitialization()` — restore on launch.
 * - `client.auth.signOut()` — clears the local session.
 *
 * `UserSession.expiresAt` is a `kotlinx.datetime.Instant` (the resolved
 * `0.7.1-0.6.x-compat` artifact keeps it a distinct class, not yet the
 * `kotlin.time.Instant` typealias), so we bridge it with `.toStdlibInstant()` to the
 * `kotlin.time.Instant` the pure [AuthSession] uses.
 *
 * EVERY path out of [signIn] terminates. supabase-kt installs its own Ktor
 * `HttpTimeout` (10s per request by default) which covers the GoTrue POST, but that
 * bound does not cover the rest of the call — session persistence, the
 * `sessionStatus` update, engine-level DNS on some platforms — so [SIGN_IN_TIMEOUT]
 * wraps the whole thing. Without an outer bound a stalled sign-in leaves the login
 * screen in SUBMITTING indefinitely, which is precisely the "signing in forever with
 * no error" the worker cannot escape.
 */
/**
 * Hard upper bound on one sign-in attempt, from tap to outcome.
 *
 * Sized to sit just outside supabase-kt's own 10s per-request timeout so that a
 * genuine HTTP timeout still reports with its real cause, and this only fires when
 * something outside the request itself stalls. 15s is also about as long as a worker
 * will wait at a desk before deciding the app is broken — the point of the bound is
 * that they get an error and a retry, not a spinner.
 */
internal val SIGN_IN_TIMEOUT = 15.seconds

class SupabaseAuthGateway(
    private val client: SupabaseClient,
) : AuthGateway {
    override suspend fun signIn(
        email: String,
        password: String,
    ): AuthOutcome =
        try {
            withTimeout(SIGN_IN_TIMEOUT) {
                client.auth.signInWith(Email) {
                    this.email = email
                    this.password = password
                }
                // signInWith updates sessionStatus; read the resulting session back.
                val session = client.auth.currentSessionOrNull()
                if (session != null) {
                    AuthOutcome.Success(session.toAuthSession())
                } else {
                    // Authenticated with no readable session is an unexpected backend state.
                    AuthOutcome.Failure(AuthError.UNKNOWN, "signInWith returned no session (unexpected backend state)")
                }
            }
        } catch (e: TimeoutCancellationException) {
            // The outer bound fired: something inside signInWith did not come back.
            AuthOutcome.Failure(
                AuthError.TIMEOUT,
                "signIn exceeded $SIGN_IN_TIMEOUT against ${AppConfig.supabaseUrl}",
            )
        } catch (e: CancellationException) {
            // The WORKER cancelled (tapped Cancel), or the host scope went away. This is
            // not a failure and must not be reported as one — and swallowing it here
            // would leave the caller running inside an already-cancelled coroutine.
            // Must be caught before the `Throwable` arm below, which would otherwise eat it.
            throw e
        } catch (e: HttpRequestTimeoutException) {
            // supabase-kt's own per-request bound (10s by default) beat ours to it.
            AuthOutcome.Failure(AuthError.TIMEOUT, "HTTP request to ${AppConfig.supabaseUrl} timed out: ${e.message}")
        } catch (e: IOException) {
            // Includes supabase-kt's HttpRequestException, which extends kotlinx.io.IOException.
            AuthOutcome.Failure(AuthError.NETWORK, "Cannot reach ${AppConfig.supabaseUrl} (${e::class.simpleName}): ${e.message}")
        } catch (e: RestException) {
            AuthOutcome.Failure(e.toAuthError(), "HTTP ${e.statusCode} from GoTrue: ${e.message}")
        } catch (e: Throwable) {
            AuthOutcome.Failure(AuthError.UNKNOWN, "${e::class.simpleName}: ${e.message}")
        }

    override suspend fun currentSession(): AuthSession? =
        try {
            // Restore any persisted session, then await Auth init so currentSessionOrNull
            // reflects the loaded state rather than a transient Initializing status.
            //
            // Bounded: awaitInitialization can trigger a token refresh against the auth
            // server, which hangs indefinitely when the backend is unreachable and would
            // otherwise strand the launch spinner. On timeout withTimeoutOrNull returns
            // null → "no usable session" → caller shows login (safe fallback; the worker
            // re-authenticates rather than staring at an infinite progress bar).
            withTimeoutOrNull(BOOT_NETWORK_TIMEOUT) {
                client.auth.loadFromStorage()
                client.auth.awaitInitialization()
                client.auth.currentSessionOrNull()?.toAuthSession()
            }
        } catch (e: Throwable) {
            // A restore failure simply means "no usable session" → caller shows login.
            null
        }

    override suspend fun signOut() {
        client.auth.signOut()
    }
}

/**
 * Maps a GoTrue [UserSession] to the pure [AuthSession]. `expiresAt` is bridged from
 * the session's `kotlinx.datetime.Instant` to `kotlin.time.Instant` via
 * `toStdlibInstant()`; in the normal (non-compat) datetime artifact the two are the
 * same type and this is identity, with the `0.6.x-compat` artifact it converts.
 */
@Suppress("DEPRECATION")
private fun UserSession.toAuthSession(): AuthSession =
    AuthSession(
        userId = user?.id ?: "",
        accessToken = accessToken,
        expiresAt = expiresAt.toStdlibInstant(),
    )

/**
 * Maps a GoTrue error response to an [AuthError]. Supabase returns HTTP 400 for an
 * invalid email/password and 401 for an unauthorized/expired credential; both mean
 * "the credentials didn't work" to the worker. Anything else is UNKNOWN.
 */
private fun RestException.toAuthError(): AuthError =
    when (statusCode) {
        400, 401, 403, 422 -> AuthError.INVALID_CREDENTIALS
        else -> AuthError.UNKNOWN
    }
