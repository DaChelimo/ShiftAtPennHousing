package com.pennhousing.shift.shared.ack

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.model.RecentFloatStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * "Recent float requests" section (shared) — the de-emphasized 24h history under the
 * carousel. Fixtures pin explicit America/New_York offsets (EST -05:00) so the deadline
 * and relative-time math is unambiguous (AGENTS invariant #6).
 */
class RecentFloatPresentationTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val dubois = House("dubois", "DuBois")
    private val harnwell = House("harnwell", "Harnwell")
    private val now = at("2026-01-15T20:00:00-05:00")

    private val accepted =
        RecentFloat("acc", dubois, at("2026-01-15T14:00:00-05:00"), at("2026-01-15T16:00:00-05:00"), RecentFloatStatus.ACCEPTED, at("2026-01-15T15:00:00-05:00"))
    private val declined =
        RecentFloat("dec", harnwell, at("2026-01-15T16:00:00-05:00"), at("2026-01-15T18:00:00-05:00"), RecentFloatStatus.DECLINED, at("2026-01-15T17:00:00-05:00"))
    private val expired =
        RecentFloat("exp", dubois, at("2026-01-15T19:30:00-05:00"), at("2026-01-15T20:30:00-05:00"), RecentFloatStatus.EXPIRED, at("2026-01-15T19:52:00-05:00"))

    @Test
    fun rows_are_sorted_most_recent_first() {
        val rows = buildRecentFloatRows(listOf(accepted, declined, expired), emptyList(), now)
        assertEquals(listOf("exp", "dec", "acc"), rows.map { it.floatId })
    }

    @Test
    fun each_status_maps_to_its_chip_reason_and_window() {
        val rows = buildRecentFloatRows(listOf(accepted, declined, expired), emptyList(), now)
        val exp = rows.first { it.floatId == "exp" }
        assertEquals("DuBois · 19:30 - 20:30", exp.title)
        assertEquals("Window passed · 8m ago", exp.detail)
        assertEquals("Expired", exp.statusChip)
        assertEquals(RecentFloatStatus.EXPIRED, exp.status)

        val dec = rows.first { it.floatId == "dec" }
        assertEquals("Harnwell · 16:00 - 18:00", dec.title)
        assertEquals("You declined · 3h ago", dec.detail)
        assertEquals("Declined", dec.statusChip)

        val acc = rows.first { it.floatId == "acc" }
        assertEquals("You're covering · 5h ago", acc.detail)
        assertEquals("Accepted", acc.statusChip)
    }

    @Test
    fun a_pending_float_past_its_deadline_is_synthesized_as_expired() {
        // Starts 20:05 → deadline (T-10m) is 19:55, already past at 20:00 but not yet voided.
        val lapsed = PendingFloat("p1", dubois, at("2026-01-15T20:05:00-05:00"), at("2026-01-15T21:05:00-05:00"), 2)
        val rows = buildRecentFloatRows(emptyList(), listOf(lapsed), now)
        val row = rows.single()
        assertEquals("p1", row.floatId)
        assertEquals(RecentFloatStatus.EXPIRED, row.status)
        assertEquals("Window passed · 5m ago", row.detail)
    }

    @Test
    fun a_still_actionable_pending_float_is_not_in_the_recent_section() {
        // Starts 21:00 → deadline 20:50, still in the future; this float is an ACTIVE card.
        val active = PendingFloat("p2", dubois, at("2026-01-15T21:00:00-05:00"), at("2026-01-15T22:00:00-05:00"), 2)
        assertTrue(buildRecentFloatRows(emptyList(), listOf(active), now).isEmpty())
    }

    @Test
    fun the_resolved_feed_wins_over_a_synthesized_duplicate() {
        // Same floatId appears as a declined resolved row AND as a past-deadline pending
        // float — the authoritative declined row must win (no duplicate expired row).
        val sameId = PendingFloat("dec", harnwell, at("2026-01-15T16:00:00-05:00"), at("2026-01-15T18:00:00-05:00"), 4)
        val rows = buildRecentFloatRows(listOf(declined), listOf(sameId), now)
        assertEquals(1, rows.size)
        assertEquals("Declined", rows.single().statusChip)
    }

    @Test
    fun rows_older_than_24h_are_dropped() {
        val stale = accepted.copy(resolvedAt = now - kotlin.time.Duration.parse("25h"))
        assertTrue(buildRecentFloatRows(listOf(stale), emptyList(), now).isEmpty())
    }

    @Test
    fun just_resolved_reads_just_now() {
        val fresh = expired.copy(resolvedAt = now - kotlin.time.Duration.parse("20s"))
        val row = buildRecentFloatRows(listOf(fresh), emptyList(), now).single()
        assertEquals("Window passed · just now", row.detail)
    }
}
