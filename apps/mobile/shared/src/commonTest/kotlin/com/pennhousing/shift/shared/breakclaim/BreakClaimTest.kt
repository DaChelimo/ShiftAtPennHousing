package com.pennhousing.shift.shared.breakclaim

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Break-claim presentation (shared) — the claimable list, the 40h HARD-cap meter, and
 * the claim/drop reducer, over an injected break-pool snapshot. Fixtures pin explicit
 * America/New_York offsets (EST −05:00, a winter break). Four Harnwell shifts of 4h.
 */
class BreakClaimTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")

    private fun shift(
        id: String,
        startIso: String,
        endIso: String,
    ) = BreakShift(id = id, house = harnwell, start = at(startIso), end = at(endIso))

    private val s1 = shift("bk-1", "2026-01-12T08:00:00-05:00", "2026-01-12T12:00:00-05:00")
    private val s2 = shift("bk-2", "2026-01-12T12:00:00-05:00", "2026-01-12T16:00:00-05:00")
    private val s3 = shift("bk-3", "2026-01-12T16:00:00-05:00", "2026-01-12T20:00:00-05:00")

    private fun snapshot(claimed: Set<String> = emptySet()) =
        BreakClaimSnapshot(
            profileContext = "WINTER BREAK PROFILE",
            infoTitle = "Winter break — only Harnwell open",
            infoBody = "First-come, first-served · 40h hard cap · drop back to the pool until T-1d.",
            // Deliberately out of order to assert start-sorting.
            shifts = listOf(s3, s1, s2),
            initiallyClaimedIds = claimed,
        )

    // ----- hours meter -----

    @Test fun hours_meter_labels_and_fraction() {
        val m = buildBreakHoursMeter(claimedHours = 16.0)
        assertEquals("16h", m.currentLabel)
        assertEquals("40h", m.capLabel)
        assertEquals(0.4, m.fraction, 1e-9)
        assertFalse(m.atCap)
    }

    @Test fun hours_meter_flags_at_cap() {
        val m = buildBreakHoursMeter(claimedHours = 40.0)
        assertTrue(m.atCap)
        assertEquals(1.0, m.fraction, 1e-9)
    }

    // ----- row mapping -----

    @Test fun claimable_row_offers_claim_no_meta() {
        val row = s1.toRow(claimedByMe = false)
        assertEquals("H", row.houseInitial)
        assertEquals("Harnwell", row.houseName)
        assertEquals("08:00 – 12:00", row.timeLabel)
        assertEquals("4h", row.durationLabel)
        assertEquals("Claim", row.actionLabel)
        assertFalse(row.claimedByMe)
        assertEquals(null, row.meta)
    }

    @Test fun claimed_row_offers_drop_with_t_minus_1d_meta() {
        val row = s1.toRow(claimedByMe = true)
        assertEquals("Drop", row.actionLabel)
        assertTrue(row.claimedByMe)
        assertEquals("Claimed by you · drop until T-1d", row.meta)
    }

    // ----- list assembly -----

    @Test fun list_sorts_by_start_and_sums_only_claimed_hours() {
        val list = buildBreakClaimList(snapshot(claimed = setOf("bk-1", "bk-2")), claimedIds = setOf("bk-1", "bk-2"))
        assertEquals(listOf("bk-1", "bk-2", "bk-3"), list.rows.map { it.id }) // sorted by start
        assertEquals(8.0, list.claimedHours, 1e-9) // 4h + 4h
        assertEquals("8h", list.meter.currentLabel)
        assertTrue(list.rows[0].claimedByMe)
        assertTrue(list.rows[1].claimedByMe)
        assertFalse(list.rows[2].claimedByMe)
        assertFalse(list.isEmpty)
    }

    @Test fun empty_pool_is_empty() {
        val list = buildBreakClaimList(snapshot().copy(shifts = emptyList()), claimedIds = emptySet())
        assertTrue(list.isEmpty)
        assertEquals(0.0, list.claimedHours, 1e-9)
    }

    // ----- ViewModel reducer -----

    @Test fun viewmodel_claim_then_drop_updates_meter_and_actions() {
        val vm = BreakClaimViewModel(snapshot())
        assertEquals(0.0, vm.uiState.value.list.claimedHours, 1e-9)

        vm.claim("bk-1")
        var rows = vm.uiState.value.list
        assertEquals(4.0, rows.claimedHours, 1e-9)
        assertEquals("Drop", rows.rows.first { it.id == "bk-1" }.actionLabel)

        vm.claim("bk-2")
        assertEquals(8.0, vm.uiState.value.list.claimedHours, 1e-9)

        vm.drop("bk-1")
        rows = vm.uiState.value.list
        assertEquals(4.0, rows.claimedHours, 1e-9)
        assertEquals("Claim", rows.rows.first { it.id == "bk-1" }.actionLabel)
    }

    @Test fun viewmodel_seeds_initial_claims() {
        val vm = BreakClaimViewModel(snapshot(claimed = setOf("bk-3")))
        assertEquals(4.0, vm.uiState.value.list.claimedHours, 1e-9)
        assertTrue(vm.uiState.value.list.rows.first { it.id == "bk-3" }.claimedByMe)
    }
}
