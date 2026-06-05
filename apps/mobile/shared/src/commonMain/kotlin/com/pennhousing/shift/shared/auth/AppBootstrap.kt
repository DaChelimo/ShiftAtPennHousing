package com.pennhousing.shift.shared.auth

import kotlin.time.Duration
import kotlin.time.Instant

/** Where the app opens on launch (TEST_PLAN §3.4). */
enum class StartDestination { LOGIN, SHIFTS }

/** Whether the app runs against demo fixtures or the live backend (§3.4). */
enum class DataSource { DEMO, LIVE }

data class BootstrapDecision(
    val start: StartDestination,
    val source: DataSource,
)

/**
 * Pure launch routing (TEST_PLAN §3.4). No clock reads — `now` is injected and
 * forwarded to [SessionValidity.isValid].
 * - backend not configured ⇒ demo mode, straight to SHIFTS;
 * - backend configured + valid session ⇒ live SHIFTS;
 * - backend configured + invalid/missing session ⇒ live LOGIN.
 */
object AppBootstrap {
    fun decide(
        backendConfigured: Boolean,
        session: AuthSession?,
        now: Instant,
        skew: Duration = SessionValidity.DEFAULT_SKEW,
    ): BootstrapDecision {
        if (!backendConfigured) {
            return BootstrapDecision(StartDestination.SHIFTS, DataSource.DEMO)
        }
        val start =
            if (SessionValidity.isValid(session, now, skew)) {
                StartDestination.SHIFTS
            } else {
                StartDestination.LOGIN
            }
        return BootstrapDecision(start, DataSource.LIVE)
    }
}
