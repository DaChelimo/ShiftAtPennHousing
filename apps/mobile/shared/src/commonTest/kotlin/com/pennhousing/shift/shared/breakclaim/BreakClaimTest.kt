package com.pennhousing.shift.shared.breakclaim

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
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

    // ----- at-40h-hard-cap claim block -----

    @Test fun unclaimed_row_blocks_claim_at_cap() {
        val row = s1.toRow(claimedByMe = false, atCap = true)
        assertTrue(row.claimBlocked)
        assertEquals(BREAK_AT_CAP_LABEL, row.actionLabel)
    }

    @Test fun claimed_row_is_never_blocked_even_at_cap() {
        // A claimed row at cap still shows Drop — dropping only reduces hours.
        val row = s1.toRow(claimedByMe = true, atCap = true)
        assertFalse(row.claimBlocked)
        assertEquals("Drop", row.actionLabel)
    }

    @Test fun list_blocks_unclaimed_rows_when_meter_at_cap() {
        // cap=8h; claiming the two 4h shifts (bk-1, bk-2) reaches the cap. The remaining
        // unclaimed bk-3 is claim-blocked; the claimed rows are not.
        val list = buildBreakClaimList(snapshot(claimed = setOf("bk-1", "bk-2")), claimedIds = setOf("bk-1", "bk-2"), cap = 8.0)
        assertTrue(list.meter.atCap)
        assertFalse(list.rows.first { it.id == "bk-1" }.claimBlocked)
        assertFalse(list.rows.first { it.id == "bk-2" }.claimBlocked)
        assertTrue(list.rows.first { it.id == "bk-3" }.claimBlocked)
        assertEquals(BREAK_AT_CAP_LABEL, list.rows.first { it.id == "bk-3" }.actionLabel)
    }

    @Test fun viewmodel_claim_is_noop_at_cap() {
        // 11×4h shifts; claiming 10 reaches the 40h hard cap. A further claim is ignored
        // (the UI also disables the button; this guards the programmatic path).
        val many =
            (1..11).map {
                shift("c-$it", "2026-01-12T00:00:00-05:00", "2026-01-12T04:00:00-05:00")
            }
        val snap = snapshot().copy(shifts = many, initiallyClaimedIds = emptySet())
        val vm = BreakClaimViewModel(snap)
        (1..10).forEach { vm.claim("c-$it") } // 40h → at cap
        assertTrue(vm.uiState.value.list.meter.atCap)
        assertEquals(40.0, vm.uiState.value.list.claimedHours, 1e-9)

        vm.claim("c-11") // blocked
        assertEquals(40.0, vm.uiState.value.list.claimedHours, 1e-9)
        assertFalse(vm.uiState.value.list.rows.first { it.id == "c-11" }.claimedByMe)
    }

    // ----- live context derivation (T2-2a) -----

    @Test fun winter_break_context_surfaces_only_harnwell_open() {
        val copy =
            breakContextCopy(
                breakName = "Winter Break 2026",
                breakType = "winter_break",
                startDate = LocalDate(2026, 12, 20),
                endDate = LocalDate(2027, 1, 4),
            )
        assertEquals("Winter Break 2026 — only Harnwell open", copy.infoTitle)
        assertEquals("WINTER BREAK 2026 · CLAIM-BASED", copy.profileContext)
        assertTrue(copy.infoBody.contains("Dec 20 – Jan 4"))
        assertTrue(copy.infoBody.contains("40h hard cap"))
    }

    @Test fun short_break_context_omits_harnwell_line() {
        val copy =
            breakContextCopy(
                breakName = "Thanksgiving 2026",
                breakType = "thanksgiving",
                startDate = LocalDate(2026, 11, 25),
                endDate = LocalDate(2026, 11, 29),
            )
        // No "only Harnwell open" for a short break — the break runs at the home house.
        assertEquals("Thanksgiving 2026", copy.infoTitle)
        assertFalse(copy.infoTitle.contains("Harnwell"))
        assertTrue(copy.infoBody.contains("Nov 25 – Nov 29"))
    }

    @Test fun with_context_overlays_only_copy_keeps_pool() {
        val live = breakContextCopy("Spring Break", "spring_break", LocalDate(2027, 3, 8), LocalDate(2027, 3, 14))
        val merged = snapshot().withContext(live)
        // Copy replaced; pool + claims preserved.
        assertEquals(live.infoTitle, merged.infoTitle)
        assertEquals(live.profileContext, merged.profileContext)
        assertEquals(snapshot().shifts.size, merged.shifts.size)
    }

    // ----- §4.4 "no break hours" opt-out (T2-2b) -----

    @Test fun opted_out_list_is_empty_and_flagged() {
        // Opting out suppresses the whole pool: the opted-out empty state shows instead.
        val list = buildBreakClaimList(snapshot(), claimedIds = emptySet(), optedOut = true)
        assertTrue(list.optedOut)
        assertTrue(list.isEmpty)
        assertEquals(0.0, list.claimedHours, 1e-9)
        assertEquals("0h", list.meter.currentLabel)
    }

    @Test fun not_opted_out_list_still_shows_pool() {
        val list = buildBreakClaimList(snapshot(), claimedIds = emptySet(), optedOut = false)
        assertFalse(list.optedOut)
        assertFalse(list.isEmpty)
        assertEquals(3, list.rows.size)
    }

    @Test fun with_opt_out_overlays_break_id_and_state_keeps_pool() {
        val merged = snapshot().withOptOut(breakId = "winter-2026", optedOut = true)
        assertEquals("winter-2026", merged.breakId)
        assertTrue(merged.initiallyOptedOut)
        // Pool + copy preserved.
        assertEquals(snapshot().shifts.size, merged.shifts.size)
        assertEquals(snapshot().infoTitle, merged.infoTitle)
    }

    @Test fun viewmodel_seeds_opted_out_and_exposes_break_id() {
        val vm = BreakClaimViewModel(snapshot().withOptOut("bk-period", optedOut = true))
        assertTrue(vm.uiState.value.optedOut)
        assertTrue(vm.uiState.value.list.isEmpty)
        assertEquals("bk-period", vm.breakId)
    }

    @Test fun viewmodel_toggle_opt_out_flips_list_and_returns_new_state() {
        val vm = BreakClaimViewModel(snapshot())
        assertFalse(vm.uiState.value.optedOut)
        assertFalse(vm.uiState.value.list.isEmpty)

        val nowOptedOut = vm.toggleOptedOut()
        assertTrue(nowOptedOut)
        assertTrue(vm.uiState.value.optedOut)
        assertTrue(vm.uiState.value.list.isEmpty) // pool suppressed

        val nowOptedIn = vm.toggleOptedOut()
        assertFalse(nowOptedIn)
        assertFalse(vm.uiState.value.optedOut)
        assertFalse(vm.uiState.value.list.isEmpty) // pool restored
    }

    @Test fun viewmodel_claim_is_noop_while_opted_out() {
        val vm = BreakClaimViewModel(snapshot().withOptOut("bk-period", optedOut = true))
        vm.claim("bk-1")
        assertEquals(0.0, vm.uiState.value.list.claimedHours, 1e-9)
        // Opting back in keeps the (still un-claimed) pool — the opted-out claim was ignored.
        vm.toggleOptedOut()
        assertFalse(vm.uiState.value.list.rows.first { it.id == "bk-1" }.claimedByMe)
    }

    // ----- live pool overlay + projection reconcile (D6) -----

    @Test fun live_pool_overlays_window_filtered_coalesced_runs_and_claimed_set() {
        val h = com.pennhousing.shift.shared.model.House("harnwell", "Harnwell")
        val inWindow = kotlin.time.Instant.parse("2026-12-21T08:00:00-05:00")
        val outside = kotlin.time.Instant.parse("2026-12-01T08:00:00-05:00")
        val open =
            (0 until 4).map { i ->
                com.pennhousing.shift.shared.model.OpenShift(
                    id = "ob-$i", house = h,
                    start = inWindow + (i * 30).minutes,
                    end = inWindow + ((i + 1) * 30).minutes,
                    feed = com.pennhousing.shift.shared.model.OpenFeed.WEEKLY, homeHouse = true,
                )
            } + com.pennhousing.shift.shared.model.OpenShift(
                id = "out-1", house = h, start = outside,
                end = outside + 30.minutes,
                feed = com.pennhousing.shift.shared.model.OpenFeed.WEEKLY, homeHouse = true,
            )
        val mine =
            (0 until 2).map { i ->
                com.pennhousing.shift.shared.model.MyShift(
                    id = "mb-$i", house = h,
                    start = inWindow + (240 + i * 30).minutes,
                    end = inWindow + (270 + i * 30).minutes,
                    kind = com.pennhousing.shift.shared.model.AssignmentKind.SCHEDULED,
                    breakShift = true,
                )
            }
        val live =
            snapshot().withLivePool(
                openShifts = open,
                myShifts = mine,
                startDate = kotlinx.datetime.LocalDate(2026, 12, 20),
                endDate = kotlinx.datetime.LocalDate(2027, 1, 4),
            )
        assertEquals(2, live.shifts.size) // one coalesced open run + one claimed run; out-of-window dropped
        val pool = live.shifts.first { it.id == "ob-0" }
        assertEquals(listOf("ob-0", "ob-1", "ob-2", "ob-3"), pool.blockIds)
        assertEquals(setOf("mb-0"), live.initiallyClaimedIds) // claimed run keyed by first block
    }

    @Test fun view_model_reconciles_the_server_hours_projection_and_resolves_block_ids() {
        val vm = com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel(snapshot())
        val before = vm.uiState.value.list.claimedHours
        vm.reconcileHours(12.5)
        assertEquals(12.5, vm.uiState.value.list.claimedHours)
        assertEquals("12.5h", vm.uiState.value.list.meter.currentLabel)
        vm.reconcileHours(null) // null projection → no change
        assertEquals(12.5, vm.uiState.value.list.claimedHours)
        assertEquals(before, before) // (sanity)
        assertEquals(listOf("bk-1"), vm.blockIdsFor("bk-1")) // single-block default
        assertEquals(listOf("nope"), vm.blockIdsFor("nope")) // unknown id falls back to itself
    }
}
