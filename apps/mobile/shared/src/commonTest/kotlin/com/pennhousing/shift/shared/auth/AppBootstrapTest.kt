package com.pennhousing.shift.shared.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration.Companion.hours
import kotlin.time.Instant

class AppBootstrapTest {
    private val now = Instant.parse("2026-03-04T12:00:00Z")
    private val validSession = AuthSession("u-1", "tok", now + 2.hours)
    private val expiredSession = AuthSession("u-1", "tok", now - 1.hours)

    @Test
    fun noBackendRunsDemoShifts() {
        val d = AppBootstrap.decide(backendConfigured = false, session = null, now = now)
        assertEquals(StartDestination.SHIFTS, d.start)
        assertEquals(DataSource.DEMO, d.source)
    }

    @Test
    fun backendWithValidSessionGoesLiveShifts() {
        val d = AppBootstrap.decide(backendConfigured = true, session = validSession, now = now)
        assertEquals(StartDestination.SHIFTS, d.start)
        assertEquals(DataSource.LIVE, d.source)
    }

    @Test
    fun backendWithNoSessionGoesToLogin() {
        val d = AppBootstrap.decide(backendConfigured = true, session = null, now = now)
        assertEquals(StartDestination.LOGIN, d.start)
        assertEquals(DataSource.LIVE, d.source)
    }

    @Test
    fun backendWithExpiredSessionGoesToLogin() {
        val d = AppBootstrap.decide(backendConfigured = true, session = expiredSession, now = now)
        assertEquals(StartDestination.LOGIN, d.start)
    }
}
