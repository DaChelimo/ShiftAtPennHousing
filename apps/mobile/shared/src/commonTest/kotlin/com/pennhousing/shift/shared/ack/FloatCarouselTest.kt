package com.pennhousing.shift.shared.ack

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.PendingFloat
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Float-request carousel (shared) — the closest-first ordering + NY-anchored window
 * formatting the blue My-Shifts cards render. Fixtures pin explicit America/New_York
 * offsets (EST -05:00) so the deadline math is unambiguous (AGENTS invariant #6).
 */
class FloatCarouselTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val dubois = House("dubois", "DuBois")
    private val harnwell = House("harnwell", "Harnwell")

    // DuBois 18:00–20:00, Harnwell 15:30–18:00 (both Thu 2026-01-15).
    private val later = PendingFloat("f-later", dubois, at("2026-01-15T18:00:00-05:00"), at("2026-01-15T20:00:00-05:00"), 4)
    private val sooner = PendingFloat("f-sooner", harnwell, at("2026-01-15T15:30:00-05:00"), at("2026-01-15T18:00:00-05:00"), 5)

    @Test
    fun cards_are_sorted_closest_start_first() {
        val now = at("2026-01-15T14:00:00-05:00")
        val cards = buildFloatRequestCards(listOf(later, sooner), now)
        assertEquals(listOf("f-sooner", "f-later"), cards.map { it.floatId })
    }

    @Test
    fun card_formats_the_full_window_and_starts_in() {
        val now = at("2026-01-15T14:00:00-05:00")
        val cards = buildFloatRequestCards(listOf(later, sooner), now)
        val first = cards.first() // sooner
        assertEquals("Harnwell", first.destinationName)
        assertEquals("Today", first.whenLabel)
        assertEquals("15:30 - 18:00", first.rangeLabel)
        assertEquals("2h 30m", first.durationLabel)
        assertEquals("Starts in 1h 30m", first.startsInLabel)
        // Time-to-respond countdown: deadline is T-10m before start (15:20); 1h 20m out.
        assertEquals("Accept by 15:20 · 1h 20m left", first.acceptByLabel)
        assertFalse(first.acceptUrgent)
        assertTrue(first.respondable)
        assertFalse(first.deadlinePassed)

        val second = cards[1] // later
        assertEquals("18:00 - 20:00", second.rangeLabel)
        assertEquals("2h", second.durationLabel)
        assertEquals("Starts in 4h", second.startsInLabel)
    }

    @Test
    fun float_on_another_day_labels_the_weekday() {
        val now = at("2026-01-14T14:00:00-05:00")
        val cards = buildFloatRequestCards(listOf(later), now)
        assertEquals("Thu · Jan 15", cards.single().whenLabel)
    }

    @Test
    fun past_deadline_float_is_excluded_from_the_carousel() {
        // start at now+5m → deadline (T-10m) already passed. A lapsed float no longer
        // belongs in the prominent zone; it moves to the recent section instead.
        val now = at("2026-01-15T17:55:00-05:00")
        assertTrue(buildFloatRequestCards(listOf(later), now).isEmpty())
    }

    @Test
    fun accept_by_turns_urgent_within_30m_of_the_deadline() {
        // sooner starts 15:30 → deadline 15:20. now 15:05 → 15m left, still respondable.
        val now = at("2026-01-15T15:05:00-05:00")
        val c = buildFloatRequestCards(listOf(sooner), now).single()
        assertEquals("Accept by 15:20 · 15m left", c.acceptByLabel)
        assertTrue(c.acceptUrgent)
        assertTrue(c.respondable)
    }

    @Test
    fun in_progress_float_is_excluded_from_the_carousel() {
        // now is inside the Harnwell window (15:30-18:00) → well past its T-10m deadline,
        // so it is not actionable and never renders as a carousel card.
        val now = at("2026-01-15T16:00:00-05:00")
        assertTrue(buildFloatRequestCards(listOf(sooner), now).isEmpty())
    }

    @Test
    fun empty_in_empty_out() {
        assertTrue(buildFloatRequestCards(emptyList(), at("2026-01-15T14:00:00-05:00")).isEmpty())
    }
}
