package com.pennhousing.shift.shared.platform

import kotlin.concurrent.Volatile
import kotlin.time.Clock
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Instant

/**
 * Simulated clock for the worker app — the mobile mirror of the web's `app_now()`
 * time-travel (migration 20260611000007).
 *
 * The offset lets the whole system be fast-forwarded for manual testing of the
 * time-driven flows (T-3h broadcast, T-2h float lookup, HMOD-for-Allied, T-15m
 * no-ack void, ack reminders). The server's "now" comes from `app_now()`. The
 * worker app's pure decision surface takes an injected `now`; if that `now` is the
 * device wall clock while the server is time-travelled, the two disagree (the ack
 * hero countdown is wrong; the local deadline check and the server's `app_now()`
 * void can disagree).
 *
 * This holds a single OFFSET (server_now − device_now), refreshed by
 * [com.pennhousing.shift.shared.data.WorkerBackend.syncSimClock] at live launch AND
 * whenever the app returns to the foreground, so a clock change made on the web is
 * reflected without a relaunch. [now] adds it to the device clock so the app's `now`
 * tracks the simulated instant. Moving the offset away from zero is admin-only, in
 * every environment including production (migration 20260805000001 — the DB rejects
 * the write for anyone else) — but nothing here needs to know that: with offset 0,
 * the only state anyone other than the project administrator will ever cause, [now]
 * is exactly `Clock.System.now()`, so behaviour is unchanged.
 */
object SimClock {
    // Offset in milliseconds (server_now − device_now). A primitive so @Volatile is
    // well-defined on every KMP target (a Duration-typed volatile is not).
    @Volatile
    var offsetMillis: Long = 0L

    /** Simulated now: the device clock shifted by the captured offset. */
    fun now(): Instant = Clock.System.now() + offsetMillis.milliseconds

    /** Back to the real wall clock (offset 0) — used by tests/demo resets. */
    fun reset() {
        offsetMillis = 0L
    }
}
