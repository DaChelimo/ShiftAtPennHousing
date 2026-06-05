package com.pennhousing.shift.shared.auth

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

class SessionValidityTest {
    private val expiry = Instant.parse("2026-03-04T18:00:00Z")
    private val session = AuthSession("u-1", "tok-1", expiry)

    @Test
    fun nullSessionIsInvalid() {
        assertFalse(SessionValidity.isValid(null, expiry - 2.hours))
    }

    @Test
    fun validWellBeforeExpiry() {
        assertTrue(SessionValidity.isValid(session, expiry - 2.hours))
    }

    @Test
    fun invalidAfterExpiry() {
        assertFalse(SessionValidity.isValid(session, expiry + 1.minutes))
    }

    @Test
    fun invalidWithinDefaultSkewOfExpiry() {
        // default skew is 60s; 30s before expiry is within skew => unusable
        assertFalse(SessionValidity.isValid(session, expiry - 30.seconds))
    }

    @Test
    fun boundaryAtExpiryMinusSkewIsInvalidStrict() {
        assertFalse(SessionValidity.isValid(session, expiry - 60.seconds))
    }

    @Test
    fun customSkewIsHonored() {
        assertFalse(SessionValidity.isValid(session, expiry - 5.minutes, 10.minutes))
        assertTrue(SessionValidity.isValid(session, expiry - 20.minutes, 10.minutes))
    }
}
