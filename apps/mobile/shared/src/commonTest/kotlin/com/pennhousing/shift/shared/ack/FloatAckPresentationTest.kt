package com.pennhousing.shift.shared.ack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Float-ack hero presentation (shared) — the per-phase copy + NY-anchored
 * when/starts-in/countdown formatting both front ends render. Fixtures pin explicit
 * America/New_York offsets (EST -05:00) so the deadline math is unambiguous (AGENTS
 * invariant #6). Float starts Thu 2026-01-15 18:00 ET → deadline 17:50 (T-10m).
 */
class FloatAckPresentationTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val floatStart = at("2026-01-15T18:00:00-05:00")
    private val deadline = at("2026-01-15T17:50:00-05:00")

    private fun hero(
        phase: AckPhase,
        now: Instant,
        dest: String = "Quad",
    ) = floatAckHero(phase, dest, floatStart, deadline, now)

    // ----- pending -----

    @Test
    fun pending_hero_copy_and_countdown() {
        val h = hero(AckPhase.PENDING, now = at("2026-01-15T16:00:00-05:00"))
        assertEquals("Float assignment", h.eyebrow)
        assertEquals("You're needed at Quad", h.headline)
        assertEquals("Today · 18:00", h.whenLabel)
        assertEquals("2h", h.startsInLabel)
        assertEquals("Respond by 17:50 · 1h 50m left", h.countdownLabel)
        assertFalse(h.countdownUrgent)
        assertNull(h.statusLine)
    }

    @Test
    fun pending_countdown_is_urgent_within_30m_of_deadline() {
        val h = hero(AckPhase.PENDING, now = at("2026-01-15T17:30:00-05:00"))
        assertEquals("Respond by 17:50 · 20m left", h.countdownLabel)
        assertTrue(h.countdownUrgent)
    }

    // ----- terminal phases -----

    @Test
    fun acknowledged_hero_copy() {
        val h = hero(AckPhase.ACKNOWLEDGED, now = at("2026-01-15T16:01:00-05:00"))
        assertEquals("Acknowledged", h.eyebrow)
        assertEquals("You're covering Quad", h.headline)
        assertNull(h.countdownLabel)
        assertFalse(h.countdownUrgent)
        assertEquals("Confirmed · read-only", h.statusLine)
    }

    @Test
    fun declined_hero_copy() {
        val h = hero(AckPhase.DECLINED, now = at("2026-01-15T16:05:00-05:00"))
        assertEquals("Declined", h.eyebrow)
        assertEquals("No problem", h.headline)
        assertNull(h.countdownLabel)
        assertEquals("We'll find another floater. You can still be reassigned.", h.statusLine)
    }

    @Test
    fun deadline_passed_hero_copy() {
        val h = hero(AckPhase.DEADLINE_PASSED, now = at("2026-01-15T17:55:00-05:00"))
        assertEquals("Deadline passed", h.eyebrow)
        assertEquals("Reassigned", h.headline)
        assertNull(h.countdownLabel)
        assertEquals("This float was reassigned to another worker.", h.statusLine)
        // float hasn't started yet (17:55 < 18:00) → still a positive "starts in".
        assertEquals("5m", h.startsInLabel)
    }

    @Test
    fun starts_in_is_now_once_the_float_has_begun() {
        val h = hero(AckPhase.DEADLINE_PASSED, now = at("2026-01-15T18:30:00-05:00"))
        assertEquals("now", h.startsInLabel)
    }

    // ----- relative day -----

    @Test
    fun when_label_uses_day_label_on_a_different_day() {
        // now is the day before → not "Today".
        val h = hero(AckPhase.PENDING, now = at("2026-01-14T20:00:00-05:00"))
        assertEquals("Thu · Jan 15 · 18:00", h.whenLabel)
    }
}
