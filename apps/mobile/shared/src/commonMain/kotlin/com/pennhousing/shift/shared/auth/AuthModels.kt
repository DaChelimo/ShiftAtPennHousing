package com.pennhousing.shift.shared.auth

import kotlin.time.Instant

/**
 * Worker auth — pure logic (TEST_PLAN §2). No network, no platform APIs, no I/O,
 * no clock reads: `now` is always a parameter. The instant type is
 * `kotlin.time.Instant` (this repo uses `kotlin.time`, not `kotlinx.datetime`);
 * the module-wide `kotlin.time.ExperimentalTime` opt-in lives in
 * `shared/build.gradle.kts`.
 *
 * These are the result types the (separately built) Supabase-backed
 * [AuthGateway] produces and the pure login state machine consumes.
 */
data class AuthSession(
    val userId: String,
    val accessToken: String,
    val expiresAt: Instant,
)

/**
 * The user-facing failure buckets a sign-in can land in.
 *
 * [TIMEOUT] is deliberately distinct from [NETWORK]: "the request never came back"
 * needs different advice ("try again") from "there is no connection at all", and
 * keeping them apart is what stops an unreachable backend reading as a wrong
 * password. See `SupabaseAuthGateway.SIGN_IN_TIMEOUT` for the bound.
 */
enum class AuthError { INVALID_CREDENTIALS, NETWORK, TIMEOUT, UNKNOWN }

sealed interface AuthOutcome {
    data class Success(val session: AuthSession) : AuthOutcome

    /**
     * A sign-in failure. [error] is the classified, user-facing bucket; [detail] is
     * an optional raw diagnostic (HTTP status, exception class + message) that the
     * gateway captures for DEBUG surfaces only. Never show [detail] to end users.
     */
    data class Failure(val error: AuthError, val detail: String? = null) : AuthOutcome
}

/**
 * Declared here for callers/adapters to compile against — the real
 * Supabase-backed implementation is built separately (TEST_PLAN §2 note). Do
 * NOT implement it in this pure-logic package.
 */
interface AuthGateway {
    /**
     * Attempts a sign-in. Implementations must be BOUNDED — a call that never
     * returns strands the login screen in SUBMITTING, where the reducer honours no
     * events except [LoginEvent.CancelRequested]. Every terminal condition,
     * including "took too long", must come back as an [AuthOutcome].
     *
     * The one exception is cancellation: if the caller cancels the coroutine (the
     * worker tapped Cancel), implementations must let [kotlin.coroutines.cancellation.CancellationException]
     * propagate rather than converting it into a [AuthOutcome.Failure]. Swallowing
     * it would report a bogus error for a deliberate user action.
     */
    suspend fun signIn(
        email: String,
        password: String,
    ): AuthOutcome

    suspend fun currentSession(): AuthSession?

    suspend fun signOut()
}
