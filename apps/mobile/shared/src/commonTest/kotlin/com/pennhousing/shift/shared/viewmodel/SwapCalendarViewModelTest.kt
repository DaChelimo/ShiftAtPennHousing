package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.swaps.HandoffWorker
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Calendar swap ViewModel (CALENDAR_REDESIGN.md §3) — week-paged give/take selection.
 * Pins persist across week navigation (cross-week swaps); the host feeds per-week
 * housemate seats. These pin the CLIENT state-machine contract; the server stays
 * authoritative for §8 eligibility.
 */
class SwapCalendarViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val quad = House("quad", "Quad")
    private val now = at("2026-01-15T12:00:00-05:00") // Thursday (day index 3)

    private fun myShift(
        id: String,
        kind: AssignmentKind,
        startIso: String,
        endIso: String,
        blocks: Int,
    ) = MyShift(
        id = id,
        house = quad,
        start = at(startIso),
        end = at(endIso),
        kind = kind,
        blockIds = (0 until blocks).map { "$id-$it" },
    )

    private fun seats(
        prefix: String,
        startIso: String,
        n: Int,
        userId: String,
    ): List<HouseSeat> {
        val start = at(startIso)
        return (0 until n).map { i ->
            HouseSeat(
                id = "$prefix-$i",
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                vacant = false,
                pending = false,
                floatIn = false,
                userId = userId,
                workerName = "W $userId",
                workerPhone = null,
            )
        }
    }

    private val schedThu = myShift("sch", AssignmentKind.SCHEDULED, "2026-01-15T14:00:00-05:00", "2026-01-15T16:00:00-05:00", 4)
    private val floatThu = myShift("flo", AssignmentKind.FLOAT_OUT, "2026-01-15T18:00:00-05:00", "2026-01-15T19:00:00-05:00", 2)

    private val thuSeats = seats("ben", "2026-01-15T12:00:00-05:00", 4, "ben") // this-week Thursday housemate
    private val nextThuSeats = seats("cara", "2026-01-22T14:00:00-05:00", 4, "cara") // NEXT-week Thursday housemate

    // The hand-off recipient directory (§8.5). `me` is home Quad (so "My House" = Quad,
    // matching the give shift's house); the rest exercise eligibility + grouping.
    private val handoffDir =
        listOf(
            HandoffWorker("me", "Me", "quad", "Quad"),
            HandoffWorker("ben", "Ben", "quad", "Quad"),
            HandoffWorker("cara", "Cara", "harnwell", "Harnwell"),
            HandoffWorker("dee", "Dee", "house-03", "Gregory"),
        )

    @Test
    fun prepinned_give_opens_on_its_week_and_day() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        val s = vm.uiState.value
        assertEquals(0, s.weekOffset)
        assertEquals(3, s.selectedDayIndex) // Thursday
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), s.give?.seatIds)
        assertTrue(s.loadingWeek) // host hasn't fed seats yet
        assertFalse(s.canPropose)
    }

    @Test
    fun feeding_seats_then_picking_take_enables_a_shift_swap_proposal() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        val s = vm.uiState.value
        assertFalse(s.loadingWeek)
        assertEquals(1, s.day.others.size)
        vm.pickTake(s.day.others[0])
        val after = vm.uiState.value
        assertTrue(after.canPropose)
        val proposals = vm.proposals()
        assertEquals(1, proposals.size)
        assertEquals("shift_swap", proposals[0].swapType)
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), proposals[0].initiatorAssignmentIds)
        assertEquals(4, proposals[0].counterpartyAssignmentIds?.size)
    }

    @Test
    fun an_already_pending_shift_is_excluded_from_the_give_pool() {
        // A second own Thursday shift, already tied up in a pending swap — it must not appear
        // as a giveable option (a second proposal on it would be rejected server-side).
        val sched2 = myShift("s2", AssignmentKind.SCHEDULED, "2026-01-15T09:00:00-05:00", "2026-01-15T11:00:00-05:00", 4)
        val vm =
            SwapCalendarViewModel(
                listOf(schedThu, sched2),
                meUserId = "me",
                now = now,
                pendingGiveAssignmentIds = setOf("s2-0", "s2-1", "s2-2", "s2-3"),
            )
        vm.selectDay(3) // Thursday — where both shifts sit
        val mineIds = vm.uiState.value.day.mine.map { it.seatIds }
        assertTrue(mineIds.contains(listOf("sch-0", "sch-1", "sch-2", "sch-3"))) // the free shift stays
        assertFalse(mineIds.any { it.contains("s2-0") }) // the pending shift is gone
    }

    @Test
    fun give_this_week_take_next_week_is_a_cross_week_swap() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.nextWeek() // → week offset 1; give stays pinned from week 0
        assertEquals(1, vm.uiState.value.weekOffset)
        assertTrue(vm.uiState.value.loadingWeek)
        vm.setWeekSeats(1, nextThuSeats)
        val s = vm.uiState.value
        assertEquals(1, s.day.others.size) // next-week housemate
        vm.pickTake(s.day.others[0])
        val proposals = vm.proposals()
        assertEquals(1, proposals.size)
        // give from week 0 (sch), take from week 1 (cara) — different ISO weeks.
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), proposals[0].initiatorAssignmentIds)
        assertEquals(listOf("cara-0", "cara-1", "cara-2", "cara-3"), proposals[0].counterpartyAssignmentIds)
    }

    @Test
    fun permanent_toggle_visible_upfront_and_drives_permanent_swap() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        assertTrue(vm.uiState.value.permanentToggleVisible) // visible up front (give is a SCHEDULED slot)
        vm.togglePermanent() // can choose permanent before picking the person
        assertTrue(vm.uiState.value.permanent)
        assertFalse(vm.uiState.value.canPropose) // still need a counterparty to propose
        vm.pickTake(vm.uiState.value.day.others[0])
        assertTrue(vm.uiState.value.canPropose)
        assertEquals("permanent_swap", vm.proposals()[0].swapType)
    }

    @Test
    fun take_slider_is_enabled_on_a_full_untouched_give() {
        // Giving your WHOLE shift must not hide the counterparty hours slider: picking a
        // multi-block counterparty enables `takeSplittable` immediately, with NO prior
        // setGiveRange call. (You give all of your 2h and still pick any sub-window of
        // their longer shift.)
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        assertFalse(vm.uiState.value.takeSplittable) // no counterparty picked yet
        vm.pickTake(vm.uiState.value.day.others[0])
        // give is still the full, untouched shift (no setGiveRange call above)
        assertEquals(0, vm.uiState.value.giveFrom)
        assertEquals(4, vm.uiState.value.giveTo)
        assertTrue(vm.uiState.value.takeSplittable) // counterparty hours slider is live
    }

    @Test
    fun partial_permanent_swap_trims_the_recurring_slot() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.togglePermanent()
        assertTrue(vm.uiState.value.giveSplittable) // a permanent swap can ALSO be trimmed (§8.3 partial)
        vm.setGiveRange(2, 4) // hand off only my last 2 blocks (15:00–16:00) every week
        vm.pickTake(vm.uiState.value.day.others[0])
        val p = vm.proposals()
        assertEquals(1, p.size)
        assertEquals("permanent_swap", p[0].swapType)
        assertEquals(listOf("sch-2", "sch-3"), p[0].initiatorAssignmentIds) // only the trimmed blocks
        assertNull(p[0].counterpartyAssignmentIds) // person-level — no counterparty span
        assertEquals(schedThu.start + 60.minutes, p[0].recurringSlotStart) // 15:00
        assertEquals(schedThu.end, p[0].recurringSlotEnd) // 16:00 — drives the partial recurring_pattern
    }

    @Test
    fun initial_permanent_opens_a_scheduled_give_straight_into_a_permanent_swap() {
        // The manage-shift sheet pivots to swap with the shared scope on "Permanent": the
        // calendar opens already in the permanent deal, no extra toggle tap.
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch", initialPermanent = true)
        vm.setWeekSeats(0, thuSeats)
        assertTrue(vm.uiState.value.permanent)
        vm.pickTake(vm.uiState.value.day.others[0])
        assertEquals("permanent_swap", vm.proposals()[0].swapType)
    }

    @Test
    fun initial_permanent_stays_editable_and_can_be_toggled_back_to_this_week() {
        // "Pre-fill, still editable": the worker can still flip it back to a this-week swap.
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch", initialPermanent = true)
        vm.setWeekSeats(0, thuSeats)
        assertTrue(vm.uiState.value.permanent)
        vm.togglePermanent()
        assertFalse(vm.uiState.value.permanent)
        vm.pickTake(vm.uiState.value.day.others[0])
        assertEquals("shift_swap", vm.proposals()[0].swapType)
    }

    @Test
    fun initial_permanent_is_ignored_for_a_non_permanent_eligible_give() {
        // A float give can't go permanent — the scope carry is dropped, not honoured blindly.
        val vm = SwapCalendarViewModel(listOf(floatThu), meUserId = "me", now = now, initialGiveShiftId = "flo", initialPermanent = true)
        vm.setWeekSeats(0, thuSeats)
        assertFalse(vm.uiState.value.permanent)
        assertFalse(vm.uiState.value.permanentToggleVisible)
    }

    @Test
    fun a_give_pinned_to_a_sub_range_carries_only_those_blocks_into_the_swap() {
        // The manage-shift range selector carries into swap by pinning the sub-shift (its
        // blockIds are the selected run) as the give — so the proposal spans only that range.
        val subRange = myShift("sub", AssignmentKind.SCHEDULED, "2026-01-15T15:00:00-05:00", "2026-01-15T16:00:00-05:00", 2)
        val vm = SwapCalendarViewModel(listOf(subRange), meUserId = "me", now = now, initialGiveShiftId = "sub")
        vm.setWeekSeats(0, thuSeats)
        assertEquals(2, vm.uiState.value.giveBlockCount) // only the carried sub-range, not a full shift
        vm.pickTake(vm.uiState.value.day.others[0])
        assertEquals(listOf("sub-0", "sub-1"), vm.proposals()[0].initiatorAssignmentIds)
    }

    @Test
    fun float_give_produces_a_float_swap() {
        val vm = SwapCalendarViewModel(listOf(floatThu), meUserId = "me", now = now, initialGiveShiftId = "flo")
        vm.setWeekSeats(0, thuSeats)
        vm.pickTake(vm.uiState.value.day.others[0])
        assertEquals("float_swap", vm.proposals()[0].swapType)
        assertFalse(vm.uiState.value.permanentToggleVisible) // a float can't be a permanent swap
    }

    @Test
    fun handoff_mode_produces_a_give_only_handoff_proposal() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setHandoff(true)
        vm.setWorkerDirectory(handoffDir) // the recipient pool (no calendar needed)
        assertTrue(vm.uiState.value.handoff)
        assertFalse(vm.uiState.value.permanentToggleVisible) // permanent hidden in hand-off
        val ben = vm.uiState.value.handoffDirectory.myHouse.first { it.userId == "ben" }
        vm.pickRecipient(ben)
        val p = vm.proposals()
        assertEquals(1, p.size)
        assertEquals("handoff", p[0].swapType)
        assertEquals("ben", p[0].counterpartyUserId) // the recipient
        assertEquals(listOf("sch-0", "sch-1", "sch-2", "sch-3"), p[0].initiatorAssignmentIds) // I give my whole shift
        assertNull(p[0].counterpartyAssignmentIds) // they give nothing back
    }

    @Test
    fun handoff_and_permanent_are_mutually_exclusive() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.togglePermanent()
        assertTrue(vm.uiState.value.permanent)
        vm.setHandoff(true)
        assertTrue(vm.uiState.value.handoff)
        assertFalse(vm.uiState.value.permanent) // permanent cleared
    }

    @Test
    fun stale_seat_feed_for_another_week_is_ignored() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(5, thuSeats) // arrives for a week the worker isn't on
        assertTrue(vm.uiState.value.loadingWeek)
        assertTrue(vm.uiState.value.day.others.isEmpty())
    }

    @Test
    fun tapping_the_pinned_take_again_unpins_it() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        val card = vm.uiState.value.day.others[0]
        vm.pickTake(card)
        assertTrue(vm.uiState.value.canPropose)
        vm.pickTake(card)
        assertNull(vm.uiState.value.take)
        assertFalse(vm.uiState.value.canPropose)
    }

    @Test
    fun deal_shows_the_pinned_give_with_a_placeholder_until_a_take_is_picked() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        val give = vm.uiState.value.give!!
        val deal = vm.uiState.value.deal!!
        assertEquals(give.dayLabel, deal.giveTitle)
        assertEquals("${give.timeLabel} · ${give.durationLabel}", deal.giveDetail)
        assertEquals("You take", deal.takeEyebrow)
        assertNull(deal.takeTitle) // nothing picked yet
        assertNull(deal.takeDetail)
        assertEquals("Pick a shift below", deal.takePlaceholder)
    }

    @Test
    fun deal_fills_the_take_side_once_a_counterparty_is_picked() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        val card = vm.uiState.value.day.others[0]
        vm.pickTake(card)
        val deal = vm.uiState.value.deal!!
        assertEquals("You take", deal.takeEyebrow)
        assertEquals(card.workerName.take(1), deal.takeInitial)
        assertEquals("${card.workerName} · ${card.dayLabel}", deal.takeTitle)
        assertEquals("${card.timeLabel} · ${card.durationLabel}", deal.takeDetail)
    }

    @Test
    fun deal_take_side_becomes_a_recipient_in_handoff_mode() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setHandoff(true)
        vm.setWorkerDirectory(handoffDir)
        val ben = vm.uiState.value.handoffDirectory.myHouse.first { it.userId == "ben" }
        vm.pickRecipient(ben)
        val deal = vm.uiState.value.deal!!
        assertEquals("Hand off to", deal.takeEyebrow)
        assertEquals("Ben", deal.takeTitle) // just the recipient, no shift back
        assertEquals("Quad · gives nothing back", deal.takeDetail)
    }

    @Test
    fun deal_handoff_placeholder_prompts_for_a_recipient() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.setHandoff(true)
        val deal = vm.uiState.value.deal!!
        assertEquals("Hand off to", deal.takeEyebrow)
        assertNull(deal.takeTitle)
        assertEquals("Pick someone below", deal.takePlaceholder)
    }

    @Test
    fun handoff_directory_splits_my_house_and_others_excluding_me() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setHandoff(true)
        vm.setWorkerDirectory(handoffDir)
        val dir = vm.uiState.value.handoffDirectory
        assertEquals(listOf("ben"), dir.myHouse.map { it.userId }) // give shift is at Quad → My House = Quad, me excluded
        assertEquals(listOf("Gregory", "Harnwell"), dir.others.map { it.houseName }) // grouped, house-name A→Z
    }

    @Test
    fun handoff_query_filters_only_the_others_tab() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setHandoff(true)
        vm.setWorkerDirectory(handoffDir)
        vm.setHandoffQuery("dee")
        val dir = vm.uiState.value.handoffDirectory
        assertEquals(listOf("ben"), dir.myHouse.map { it.userId }) // My House is not search-filtered
        assertEquals(listOf("dee"), dir.others.flatMap { g -> g.workers.map { it.userId } })
    }

    @Test
    fun partial_give_range_trims_the_initiator_span() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        assertTrue(vm.uiState.value.giveSplittable) // a 4-block shift can be split
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.setGiveRange(1, 3) // the middle 2 of my 4 blocks
        val p = vm.proposals()
        assertEquals(1, p.size)
        assertEquals(listOf("sch-1", "sch-2"), p[0].initiatorAssignmentIds)
    }

    @Test
    fun partial_take_range_trims_the_counterparty_span() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.setTakeRange(0, 2)
        assertEquals(listOf("ben-0", "ben-1"), vm.proposals()[0].counterpartyAssignmentIds)
    }

    @Test
    fun multi_leg_splits_my_shift_across_two_people_as_independent_proposals() {
        val benSteve =
            seats("ben", "2026-01-15T12:00:00-05:00", 4, "ben") +
                seats("steve", "2026-01-15T16:00:00-05:00", 4, "steve")
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, benSteve)
        val others = vm.uiState.value.day.others
        val ben = others.first { it.userId == "ben" }
        val steve = others.first { it.userId == "steve" }
        // Give my first 2 hours to Ben, bank it, then the rest to Steve — independent legs.
        vm.setGiveRange(0, 2)
        vm.pickTake(ben)
        assertTrue(vm.uiState.value.canAddLeg) // 2 give-blocks still free
        vm.addLeg()
        assertEquals(1, vm.uiState.value.legs.size)
        assertEquals(2, vm.uiState.value.giveFrom) // next leg auto-advances to the free run
        vm.pickTake(steve)
        val p = vm.proposals()
        assertEquals(2, p.size)
        assertEquals(listOf("sch-0", "sch-1"), p[0].initiatorAssignmentIds)
        assertEquals("ben", p[0].counterpartyUserId)
        assertEquals(listOf("sch-2", "sch-3"), p[1].initiatorAssignmentIds)
        assertEquals("steve", p[1].counterpartyUserId)
    }

    @Test
    fun changing_the_give_shift_clears_banked_legs() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, thuSeats)
        vm.setGiveRange(0, 2)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.addLeg()
        assertEquals(1, vm.uiState.value.legs.size)
        vm.pickGive(vm.uiState.value.give!!) // unpin the give
        assertTrue(vm.uiState.value.legs.isEmpty())
    }

    // ── two-budget reservation + segmented timeline + same-person chip ──

    // Dan: a single 4-block (2h) Thursday run — the counterparty re-taken across legs.
    private val danSeats = seats("dan", "2026-01-15T12:00:00-05:00", 4, "dan")
    private val sched6 = myShift("sx", AssignmentKind.SCHEDULED, "2026-01-15T14:00:00-05:00", "2026-01-15T17:00:00-05:00", 6)

    @Test
    fun take_dedup_greys_out_blocks_already_taken_of_the_same_counterparty_shift() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, danSeats)
        vm.setGiveRange(0, 2)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.setTakeRange(0, 2) // take Dan's first 2 blocks
        vm.addLeg()
        // Re-pick the SAME Dan shift — the part already taken is locked, take defaults past it.
        vm.pickTake(vm.uiState.value.day.others[0])
        val s = vm.uiState.value
        assertEquals(2, s.takeFrom)
        assertEquals(4, s.takeTo)
        val locked = s.takeSegments.single { it.locked }
        assertEquals(0, locked.from)
        assertEquals(2, locked.to)
        assertEquals("Taken", locked.note)
    }

    @Test
    fun give_timeline_locks_a_banked_run_with_the_receiver_name_and_clamps_to_the_active_run() {
        val vm = SwapCalendarViewModel(listOf(sched6), meUserId = "me", now = now, initialGiveShiftId = "sx")
        vm.setWeekSeats(0, thuSeats)
        vm.setGiveRange(2, 4) // give the MIDDLE 2 of my 6 blocks to Ben (interior split)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.addLeg()
        val s = vm.uiState.value
        // Free run [0,2) active, locked [2,4) → "W ben", free run [4,6).
        assertEquals(3, s.giveSegments.size)
        val locked = s.giveSegments.single { it.locked }
        assertEquals(2, locked.from)
        assertEquals(4, locked.to)
        assertEquals("W ben", locked.note)
        // The default next leg lands on the first free run; the slider clamps to it.
        assertEquals(0, s.giveFrom)
        assertEquals(2, s.giveTo)
        assertEquals(0, s.giveRunFrom)
        assertEquals(2, s.giveRunTo)
    }

    @Test
    fun focus_give_run_jumps_the_active_selection_across_a_locked_gap() {
        val vm = SwapCalendarViewModel(listOf(sched6), meUserId = "me", now = now, initialGiveShiftId = "sx")
        vm.setWeekSeats(0, thuSeats)
        vm.setGiveRange(2, 4)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.addLeg()
        assertEquals(0, vm.uiState.value.giveFrom) // starts on the leading free run
        vm.focusGiveRun(5) // tap the trailing free run [4,6)
        val s = vm.uiState.value
        assertEquals(4, s.giveFrom)
        assertEquals(6, s.giveTo)
        assertEquals(4, s.giveRunFrom)
        assertEquals(6, s.giveRunTo)
        vm.focusGiveRun(3) // tapping a LOCKED block is a no-op
        assertEquals(4, vm.uiState.value.giveFrom)
    }

    @Test
    fun suggestion_offers_the_next_free_run_to_the_last_counterparty() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, danSeats)
        vm.setGiveRange(0, 2)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.setTakeRange(0, 2)
        vm.addLeg()
        val sug = vm.uiState.value.suggestion!!
        assertEquals("W dan", sug.workerName)
        assertTrue(sug.label.contains("W dan"))
    }

    @Test
    fun accept_suggestion_pins_the_same_person_for_the_next_free_run_as_an_independent_leg() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, danSeats)
        vm.setGiveRange(0, 2)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.setTakeRange(0, 2)
        vm.addLeg()
        vm.acceptSuggestion()
        val s = vm.uiState.value
        assertNull(s.suggestion) // gone once a take is re-pinned
        assertEquals("W dan", s.take?.workerName)
        assertEquals(2, s.giveFrom) // next free give run
        assertEquals(2, s.takeFrom) // Dan's first 2 already taken → de-duped to 2..4
        val p = vm.proposals()
        assertEquals(2, p.size)
        assertEquals(listOf("sch-0", "sch-1"), p[0].initiatorAssignmentIds)
        assertEquals(listOf("dan-0", "dan-1"), p[0].counterpartyAssignmentIds)
        assertEquals("dan", p[0].counterpartyUserId)
        assertEquals(listOf("sch-2", "sch-3"), p[1].initiatorAssignmentIds)
        assertEquals(listOf("dan-2", "dan-3"), p[1].counterpartyAssignmentIds)
        assertEquals("dan", p[1].counterpartyUserId)
    }

    @Test
    fun suggestion_absent_when_the_counterparty_shift_is_fully_taken() {
        val vm = SwapCalendarViewModel(listOf(schedThu), meUserId = "me", now = now, initialGiveShiftId = "sch")
        vm.setWeekSeats(0, danSeats)
        vm.setGiveRange(0, 2)
        vm.pickTake(vm.uiState.value.day.others[0])
        vm.setTakeRange(0, 4) // take ALL of Dan, even though I only give 2 blocks
        vm.addLeg()
        assertNull(vm.uiState.value.suggestion) // nothing left of Dan to take, despite free give hours
    }
}
