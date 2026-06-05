package com.pennhousing.shift.shared.auth

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

/**
 * Pure session-expiry check (TEST_PLAN §3.3). No clock reads — `now` is injected.
 * A session is valid iff `now` is STRICTLY before `expiresAt - skew`; once `now`
 * reaches `expiresAt - skew` (or later) it is invalid. The default [skew]
 * ([DEFAULT_SKEW] = 60s) absorbs clock drift between client and server; a
 * caller-supplied skew overrides it.
 */
object SessionValidity {
    val DEFAULT_SKEW: Duration = 60.seconds

    fun isValid(
        session: AuthSession?,
        now: Instant,
        skew: Duration = DEFAULT_SKEW,
    ): Boolean {
        if (session == null) return false
        return now < session.expiresAt - skew
    }
}
