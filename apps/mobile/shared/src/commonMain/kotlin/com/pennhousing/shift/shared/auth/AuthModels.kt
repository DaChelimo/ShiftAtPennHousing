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

enum class AuthError { INVALID_CREDENTIALS, NETWORK, UNKNOWN }

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
    suspend fun signIn(
        email: String,
        password: String,
    ): AuthOutcome

    suspend fun currentSession(): AuthSession?

    suspend fun signOut()
}
