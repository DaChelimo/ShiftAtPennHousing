package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.MyShiftsSection
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.OpenShiftSort
import com.pennhousing.shift.shared.shifts.buildMyShiftsTab
import com.pennhousing.shift.shared.shifts.buildOtherHousesTab
import com.pennhousing.shift.shared.shifts.classifyMyShift
import com.pennhousing.shift.shared.shifts.dropOptionsFor
import com.pennhousing.shift.shared.shifts.evaluateClaimCap
import com.pennhousing.shift.shared.shifts.isClaimable
import com.pennhousing.shift.shared.shifts.roundDownToBlock
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/**
 * Phase 13a — Shifts screen ViewModel (shared, commonMain) — TDD-RED.
 *
 * Pins the three-tab Shifts screen (BEHAVIORAL_SPECIFICATION.md §5.6), the
 * claim cutoff/cap (§5.3, §5.4) and the drop flow (§5.2) as a PURE, deterministic
 * decision surface plus a thin StateFlow wrapper. Mirrors the project's
 * pure-logic-in-core / thin-wrapper discipline (phase-06/07/12).
 *
 * Every production symbol referenced here is defined by the phase-13a contract in
 * tests/PHASE_13a/TEST_PLAN.md and does NOT exist yet — this file fails to compile
 * until the worker-mobile shared logic lands, exactly as the phase-06..12 suites do.
 *
 * All times are timestamptz instants; the fixtures use explicit America/New_York
 * winter offsets (-05:00 EST) so the boundary assertions are unambiguous
 * (AGENTS hard invariant #6). Shift starts/ends sit on 30-minute block boundaries
 * (invariant #5); `now` is arbitrary.
 */
class ShiftsScreenViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val harnwell = House("harnwell", "Harnwell")
    private val quad = House("quad", "Quad")
    private val house5 = House("house-05", "House-5")

    // ----- The worker's own week (Tab 1). home = Harnwell. -----
    private val pickedUpHome =
        MyShift("pk-home", harnwell, at("2026-01-15T14:00:00-05:00"), at("2026-01-15T16:00:00-05:00"), AssignmentKind.TEMP_PICKUP)
    private val pickedUpCross =
        MyShift("pk-cross", quad, at("2026-01-15T09:00:00-05:00"), at("2026-01-15T11:00:00-05:00"), AssignmentKind.TEMP_PICKUP, crossHouse = true)
    private val droppedStillOpen =
        MyShift("dr", harnwell, at("2026-01-15T18:00:00-05:00"), at("2026-01-15T20:00:00-05:00"), AssignmentKind.SCHEDULED, droppedStillOpen = true)
    private val scheduled =
        MyShift("sc", harnwell, at("2026-01-15T12:00:00-05:00"), at("2026-01-15T14:00:00-05:00"), AssignmentKind.SCHEDULED)
    private val permanentPickup =
        MyShift("pp", harnwell, at("2026-01-15T20:00:00-05:00"), at("2026-01-15T22:00:00-05:00"), AssignmentKind.PERMANENT_PICKUP)
    private val floatOut =
        MyShift("fo", quad, at("2026-01-15T08:00:00-05:00"), at("2026-01-15T10:00:00-05:00"), AssignmentKind.FLOAT_OUT, crossHouse = true)

    private val myWeek = listOf(pickedUpHome, pickedUpCross, droppedStillOpen, scheduled, permanentPickup, floatOut)

    // ----- Open-shift feeds (Tab 2 home / Tab 3 cross-house). -----
    private val homeWeeklyLate =
        OpenShift("hw1", harnwell, at("2026-01-15T18:00:00-05:00"), at("2026-01-15T20:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = true)
    private val homeWeeklyEarly =
        OpenShift("hw2", harnwell, at("2026-01-15T10:00:00-05:00"), at("2026-01-15T12:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = true)
    private val homePermanent =
        OpenShift("hp1", harnwell, at("2026-01-15T09:00:00-05:00"), at("2026-01-15T11:00:00-05:00"), OpenFeed.PERMANENT_OPENING, homeHouse = true, weeksRemaining = 6)
    private val quadWeekly =
        OpenShift("qw1", quad, at("2026-01-15T13:00:00-05:00"), at("2026-01-15T15:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = false)
    private val quadPermanent =
        OpenShift("qp1", quad, at("2026-01-15T16:00:00-05:00"), at("2026-01-15T18:00:00-05:00"), OpenFeed.PERMANENT_OPENING, homeHouse = false, weeksRemaining = 4)
    private val house5Weekly =
        OpenShift("h5w1", house5, at("2026-01-15T08:00:00-05:00"), at("2026-01-15T10:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = false)

    private val feeds = listOf(homeWeeklyLate, homeWeeklyEarly, homePermanent, quadWeekly, quadPermanent, house5Weekly)

    private val noon = at("2026-01-15T12:00:00-05:00")

    private fun vm(now: Instant = noon) = ShiftsScreenViewModel(myShifts = myWeek, openShifts = feeds, now = now)

    // ===================================================================
    // Tab 1 — My Shifts: three subsections (§5.6 Tab 1).
    // ===================================================================

    @Test
    fun tab1PartitionsIntoPickedUpDroppedScheduled() {
        val t = vm().uiState.value.myShifts
        assertEquals(listOf("pk-cross", "pk-home"), t.pickedUp.map { it.id })
        assertEquals(listOf("dr"), t.dropped.map { it.id })
        assertEquals(listOf("fo", "sc", "pp"), t.scheduled.map { it.id })
    }

    @Test
    fun tab1SectionsAreChronologicalWithinEachSubsection() {
        val t = vm().uiState.value.myShifts
        // picked-up: 09:00 (cross) before 14:00 (home)
        assertEquals(listOf("pk-cross", "pk-home"), t.pickedUp.map { it.id })
        // scheduled: 08:00 (float) < 12:00 (scheduled) < 20:00 (permanent pickup)
        assertEquals(listOf("fo", "sc", "pp"), t.scheduled.map { it.id })
    }

    @Test
    fun tab1RendersTopToBottomPickedUpThenDroppedThenScheduled() {
        // §5.6: picked-up (top), dropped (middle), their shifts (bottom).
        val order = vm().uiState.value.myShifts.inDisplayOrder().map { it.id }
        assertEquals(listOf("pk-cross", "pk-home", "dr", "fo", "sc", "pp"), order)
    }

    @Test
    fun permanentPickupCountsAsTheirShiftNotPickedUp() {
        // §5.6 #3 explicitly groups permanently-picked-up recurring slots with the
        // SM-built schedule, NOT with this-week voluntary pickups.
        assertEquals(MyShiftsSection.SCHEDULED, classifyMyShift(permanentPickup))
    }

    @Test
    fun floatOutCountsAsTheirShift() {
        // A float-out relocates already-scheduled hours; it is neither a voluntary
        // pickup nor a personal drop, so it sits in "their shifts" (§5.6 #3, §11.2).
        assertEquals(MyShiftsSection.SCHEDULED, classifyMyShift(floatOut))
    }

    @Test
    fun temporaryPickupCountsAsPickedUp() {
        assertEquals(MyShiftsSection.PICKED_UP, classifyMyShift(pickedUpHome))
    }

    @Test
    fun droppedStillOpenTakesPrecedenceOverOriginalKind() {
        // A dropped pickup belongs in the Dropped subsection while still open, not in
        // Picked-up (§5.6 #2: "shifts the SW has personally dropped … still open").
        val droppedPickup = pickedUpCross.copy(id = "drp", droppedStillOpen = true)
        assertEquals(MyShiftsSection.DROPPED, classifyMyShift(droppedPickup))
    }

    @Test
    fun crossHousePickupRetainsDestinationHouseForItsCard() {
        // §5.6 #1 / §11.2: a cross-house pickup card identifies the destination house.
        val card = vm().uiState.value.myShifts.pickedUp.first { it.id == "pk-cross" }
        assertTrue(card.crossHouse)
        assertEquals("Quad", card.house.name)
    }

    // ===================================================================
    // Tab 2 — Open Shifts in My House (§5.6 Tab 2).
    // ===================================================================

    @Test
    fun tab2ShowsOnlyHomeHouseFeedsSplitWeeklyAndPermanent() {
        val t = vm().uiState.value.homeOpen
        assertEquals(listOf("hw2", "hw1"), t.weekly.map { it.id }) // chronological 10:00 then 18:00
        assertEquals(listOf("hp1"), t.permanentOpenings.map { it.id })
    }

    @Test
    fun tab2PermanentOpeningCarriesWeeksRemaining() {
        // §5.1: each permanent-openings entry shows how many weeks remain in the period.
        val perm = vm().uiState.value.homeOpen.permanentOpenings.first()
        assertEquals(6, perm.weeksRemaining)
    }

    @Test
    fun tab2ExcludesCrossHouseShifts() {
        val ids = vm().uiState.value.homeOpen.let { it.weekly + it.permanentOpenings }.map { it.id }
        assertFalse(ids.any { it in setOf("qw1", "qp1", "h5w1") })
    }

    // ===================================================================
    // Tab 3 — Open Shifts in Other Houses (§5.6 Tab 3).
    // ===================================================================

    @Test
    fun tab3GroupsCrossHouseFeedsByHouseOrderedByName() {
        val t = vm().uiState.value.otherHouses
        // grouped & ordered by house name: "House-5" < "Quad"; key = house id, title = name
        val byHouse = t.grouped(OpenShiftSort.BY_HOUSE)
        assertEquals(listOf("house-05", "quad"), byHouse.map { it.key })
        val quadGroup = byHouse.first { it.key == "quad" }
        assertEquals("Quad", quadGroup.title)
        // weekly cards before permanent within the house group
        assertEquals(listOf("qw1", "qp1"), quadGroup.shifts.map { it.id })
        val house5Group = byHouse.first { it.key == "house-05" }
        assertEquals(listOf("h5w1"), house5Group.shifts.map { it.id })
    }

    @Test
    fun tab3GroupsCrossHouseFeedsByDayOrderedMondayFirst() {
        // 2026-01-15 is a Thursday; 2026-01-19 is the following Monday. By-day grouping
        // orders Mon→Sun and titles each group with the weekday name.
        val thu = at("2026-01-15T10:00:00-05:00")
        val mon = at("2026-01-19T09:00:00-05:00")
        val feed =
            listOf(
                OpenShift("thuQ", quad, thu, thu + 30.minutes, OpenFeed.WEEKLY, homeHouse = false),
                OpenShift("monH5", house5, mon, mon + 30.minutes, OpenFeed.WEEKLY, homeHouse = false),
            )
        val byDay = buildOtherHousesTab(feed).grouped(OpenShiftSort.BY_DAY)
        assertEquals(listOf("Monday", "Thursday"), byDay.map { it.title })
        assertEquals(listOf("monH5"), byDay.first { it.title == "Monday" }.shifts.map { it.id })
        assertEquals(listOf("thuQ"), byDay.first { it.title == "Thursday" }.shifts.map { it.id })
    }

    @Test
    fun tab3CollapsesConcurrentMultiStaffOpeningsIntoOneCardWithCount() {
        // Quad (multi-staff) has two desks both vacant 13:00–14:00; the read model returns
        // one row per desk-block. Tab 3 must show ONE "2 open" card, not fragments.
        val s = at("2026-01-15T13:00:00-05:00")
        fun desk(prefix: String) =
            (0 until 2).map { i ->
                OpenShift("$prefix-$i", quad, s + (i * 30).minutes, s + ((i + 1) * 30).minutes, OpenFeed.WEEKLY, homeHouse = false)
            }
        val model = ShiftsScreenViewModel(myShifts = emptyList(), openShifts = desk("d1") + desk("d2"), now = noon)
        val quadGroup = model.uiState.value.otherHouses.grouped(OpenShiftSort.BY_HOUSE).single { it.key == "quad" }
        assertEquals(1, quadGroup.shifts.size)
        assertEquals(2, quadGroup.shifts.single().count)
    }

    @Test
    fun tab3ExcludesHomeHouseShifts() {
        val crossIds =
            vm().uiState.value.otherHouses.grouped(OpenShiftSort.BY_HOUSE).flatMap { it.shifts }.map { it.id }
        assertFalse(crossIds.any { it in setOf("hw1", "hw2", "hp1") })
    }

    @Test
    fun tab3IsEmptyWhenNoEligibleCrossHouseFeed() {
        // §5.6: Tab 3 is empty when no eligible cross-house feed exists — e.g. winter
        // break, when only Harnwell operates so a Harnwell SW's Quad + 11-house feeds
        // are all closed. The matrix-filtered feed simply arrives empty.
        val homeOnly = feeds.filter { it.homeHouse }
        val t = buildOtherHousesTab(homeOnly)
        assertTrue(t.isEmpty)
        assertTrue(t.grouped(OpenShiftSort.BY_HOUSE).isEmpty())
        assertTrue(t.grouped(OpenShiftSort.BY_DAY).isEmpty())
    }

    // ===================================================================
    // Claim flow (§5.3, §5.4).
    // ===================================================================

    @Test
    fun shiftIsClaimableStrictlyBeforeTMinus2h() {
        // §5.4: unpickable at exactly T-2h; only claims strictly before succeed.
        val shift = quadWeekly.copy(start = at("2026-01-15T18:00:00-05:00"))
        assertTrue(isClaimable(shift, at("2026-01-15T15:59:00-05:00"))) // before T-2h (16:00)
        assertFalse(isClaimable(shift, at("2026-01-15T16:00:00-05:00"))) // exactly T-2h
        assertFalse(isClaimable(shift, at("2026-01-15T16:01:00-05:00"))) // after T-2h
    }

    @Test
    fun deskCoveredShiftStaysClaimableWithinTMinus2h() {
        // §5.4/§5.5: a still-staffed desk (a co-worker on) keeps the dropped seat
        // claimable right up to block start — never locked by the clock alone.
        val shift = quadWeekly.copy(start = at("2026-01-15T18:00:00-05:00"), deskCovered = true)
        assertTrue(isClaimable(shift, at("2026-01-15T17:00:00-05:00"))) // 1h out, covered
        assertTrue(isClaimable(shift, at("2026-01-15T17:59:00-05:00"))) // 1m out, still covered
        assertFalse(isClaimable(shift, at("2026-01-15T18:00:00-05:00"))) // at start → no longer
    }

    @Test
    fun coverageLockedShiftIsNeverClaimable() {
        // The one-way lock wins even outside T-2h and even when still covered.
        val shift = quadWeekly.copy(start = at("2026-01-15T18:00:00-05:00"), deskCovered = true, coverageLocked = true)
        assertFalse(isClaimable(shift, at("2026-01-15T10:00:00-05:00"))) // 8h out but locked
        assertFalse(isClaimable(shift, at("2026-01-15T17:00:00-05:00"))) // 1h out, covered but locked
    }

    @Test
    fun viewModelClaimableWiresTheLoadTimeNow() {
        val shift = quadWeekly.copy(start = at("2026-01-15T18:00:00-05:00"))
        assertTrue(vm(now = at("2026-01-15T15:00:00-05:00")).claimable(shift))
        assertFalse(vm(now = at("2026-01-15T17:00:00-05:00")).claimable(shift))
    }

    @Test
    fun crossHouseOpenShiftCardShowsDestinationHouseName() {
        // §5.3 / §5.6 Tab 3: a cross-house card names the destination house.
        val card = vm().uiState.value.otherHouses.grouped(OpenShiftSort.BY_HOUSE).first { it.key == "quad" }.shifts.first()
        assertEquals("Quad", card.house.name)
        assertFalse(card.homeHouse)
    }

    @Test
    fun claimOverSoftCapWarnsButIsAllowed() {
        // §5.3: claiming over the 20h regular/spring-fling cap is permitted with a warning.
        assertEquals(ClaimCapVerdict.SOFT_CAP_WARNING, evaluateClaimCap(currentWeeklyHours = 18.0, addedHours = 3.0, breakProfile = false))
        assertEquals(ClaimCapVerdict.OK, evaluateClaimCap(currentWeeklyHours = 17.0, addedHours = 3.0, breakProfile = false)) // exactly 20 → not over
    }

    @Test
    fun claimOverBreakHardCapIsBlocked() {
        // §5.3: claiming over the 40h break cap is prohibited.
        assertEquals(ClaimCapVerdict.HARD_CAP_BLOCKED, evaluateClaimCap(currentWeeklyHours = 38.0, addedHours = 3.0, breakProfile = true))
        assertEquals(ClaimCapVerdict.OK, evaluateClaimCap(currentWeeklyHours = 37.0, addedHours = 3.0, breakProfile = true)) // exactly 40 → ok
    }

    @Test
    fun viewModelClaimCapDerivesAddedHoursFromTheShiftSpan() {
        // A 3h open shift (18:00–21:00) on top of 18h this week → 21h → soft-cap warning.
        val threeHour = quadWeekly.copy(start = at("2026-01-15T18:00:00-05:00"), end = at("2026-01-15T21:00:00-05:00"))
        assertEquals(ClaimCapVerdict.SOFT_CAP_WARNING, vm().claimCap(threeHour, currentWeeklyHours = 18.0, breakProfile = false))
    }

    // ===================================================================
    // Drop flow (§5.2).
    // ===================================================================

    @Test
    fun dropOptionsOfferOccurrenceAndPermanentForRecurringRegularShifts() {
        // §5.2: the drop popup offers "this occurrence" or "permanently".
        val o = dropOptionsFor(scheduled, breakProfile = false)
        assertTrue(o.canDropOccurrence)
        assertTrue(o.canDropPermanently)
        assertTrue(dropOptionsFor(permanentPickup, breakProfile = false).canDropPermanently)
    }

    @Test
    fun temporaryPickupCannotBePermanentlyDropped() {
        // A this-week pickup is not a recurring slot; only the occurrence can be dropped.
        val o = dropOptionsFor(pickedUpHome, breakProfile = false)
        assertTrue(o.canDropOccurrence)
        assertFalse(o.canDropPermanently)
    }

    @Test
    fun permanentDropIsUnavailableDuringBreakProfiles() {
        // §5.2: "Permanent drops do not apply during break profiles."
        val o = dropOptionsFor(scheduled, breakProfile = true)
        assertTrue(o.canDropOccurrence)
        assertFalse(o.canDropPermanently)
    }

    @Test
    fun workerHoldingAFloatCanDropTheOccurrence() {
        // §5.5 float-drop exception: a worker who is holding/floating a shift may
        // drop it. The FLOAT_OUT card surfaces a drop affordance (occurrence drop
        // is offered; a single float occurrence is not a recurring slot so the
        // permanent option stays off). The card lives in the droppable SCHEDULED
        // subsection, so it is tappable into the drop sheet.
        val o = dropOptionsFor(floatOut, breakProfile = false)
        assertTrue(o.canDropOccurrence)
        assertFalse(o.canDropPermanently)
        assertEquals(MyShiftsSection.SCHEDULED, classifyMyShift(floatOut))
    }

    @Test
    fun dropFromNowMidShiftRoundsTheGapStartDownToTheBlockBoundary() {
        // §5.2: a drop-from-now at 17:51 of a 15:00–24:00 shift produces a 17:30–24:00 gap.
        val shift = MyShift("mid", harnwell, at("2026-01-15T15:00:00-05:00"), at("2026-01-16T00:00:00-05:00"), AssignmentKind.SCHEDULED)
        val plan = vm(now = at("2026-01-15T17:51:00-05:00")).planDrop(shift, dropFromNow = true)
        assertEquals(at("2026-01-15T17:30:00-05:00"), plan.gapStart)
        assertEquals(at("2026-01-16T00:00:00-05:00"), plan.gapEnd)
        assertTrue(plan.midShift)
    }

    @Test
    fun roundDownToBlockFloorsToTheMostRecent30MinuteBoundary() {
        assertEquals(at("2026-01-15T17:30:00-05:00"), roundDownToBlock(at("2026-01-15T17:51:00-05:00")))
        assertEquals(at("2026-01-15T18:00:00-05:00"), roundDownToBlock(at("2026-01-15T18:00:00-05:00")))
        assertEquals(at("2026-01-15T18:00:00-05:00"), roundDownToBlock(at("2026-01-15T18:29:00-05:00")))
        assertEquals(at("2026-01-15T18:30:00-05:00"), roundDownToBlock(at("2026-01-15T18:30:00-05:00")))
    }

    @Test
    fun wholeOccurrenceDropAnchorsTheGapAtTheShiftStart() {
        val plan = vm(now = at("2026-01-15T06:00:00-05:00")).planDrop(scheduled, dropFromNow = false)
        assertEquals(scheduled.start, plan.gapStart)
        assertEquals(scheduled.end, plan.gapEnd)
        assertFalse(plan.midShift)
        assertFalse(plan.shortNotice) // starts 6h out
    }

    @Test
    fun dropOfAShiftStartingWithin20MinutesIsFlaggedShortNotice() {
        // §5.2: dropping a shift starting within 20 minutes is allowed but warns.
        val soon = scheduled.copy(start = at("2026-01-15T12:00:00-05:00"))
        val plan = vm(now = at("2026-01-15T11:50:00-05:00")).planDrop(soon, dropFromNow = false)
        assertTrue(plan.shortNotice)
    }

    @Test
    fun droppingAShiftMovesItFromTheirShiftsIntoDropped() {
        // §5.2 / §5.6: after confirm, the shift leaves its section and shows in Dropped
        // (it remains in the My Shifts tab, in the Dropped subsection).
        val m = vm()
        assertTrue(m.uiState.value.myShifts.scheduled.any { it.id == "sc" })
        m.drop("sc")
        val after = m.uiState.value.myShifts
        assertFalse(after.scheduled.any { it.id == "sc" })
        assertTrue(after.dropped.any { it.id == "sc" })
    }

    @Test
    fun reclaimingADroppedShiftReturnsItToItsOriginalSection() {
        // §5.2: a worker who dropped a shift may reclaim it (no one else took it).
        val m = vm()
        m.drop("sc")
        m.reclaim("sc")
        val after = m.uiState.value.myShifts
        assertTrue(after.scheduled.any { it.id == "sc" })
        assertFalse(after.dropped.any { it.id == "sc" })
    }

    // ===================================================================
    // Block coalescing (parity CO) — the live read models are per-30-min-block;
    // the displayed tabs merge contiguous same-shift runs into one card.
    // ===================================================================

    /** [n] consecutive 30-min SCHEDULED Harnwell blocks from [startIso], ids `prefix-i`. */
    private fun blockRun(
        startIso: String,
        n: Int,
        prefix: String,
    ): List<MyShift> {
        val start = at(startIso)
        return (0 until n).map { i ->
            MyShift(
                id = "$prefix-$i",
                house = harnwell,
                start = start + (i * 30).minutes,
                end = start + ((i + 1) * 30).minutes,
                kind = AssignmentKind.SCHEDULED,
            )
        }
    }

    @Test
    fun perBlockSnapshotRendersAsOneCoalescedCard() {
        // A live 4h shift arrives as 8 rows but must display as ONE card (CO).
        val m = ShiftsScreenViewModel(blockRun("2026-01-15T12:00:00-05:00", 8, "blk"), emptyList(), noon)
        val scheduled = m.uiState.value.myShifts.scheduled
        assertEquals(1, scheduled.size)
        assertEquals("blk-0", scheduled.single().id)
        assertEquals((0 until 8).map { "blk-$it" }, scheduled.single().blockIds)
    }

    @Test
    fun droppingACoalescedCardFlagsAllItsBlocksAndReclaimRestoresThem() {
        val m = ShiftsScreenViewModel(blockRun("2026-01-15T12:00:00-05:00", 4, "blk"), emptyList(), noon)
        m.drop("blk-0") // the displayed card's id (its first block)
        val afterDrop = m.uiState.value.myShifts
        assertTrue(afterDrop.scheduled.isEmpty())
        assertEquals(1, afterDrop.dropped.size) // dropped blocks re-coalesce into one card
        assertEquals((0 until 4).map { "blk-$it" }, afterDrop.dropped.single().blockIds)
        m.reclaim("blk-0")
        val afterReclaim = m.uiState.value.myShifts
        assertTrue(afterReclaim.dropped.isEmpty())
        assertEquals(1, afterReclaim.scheduled.size)
    }

    @Test
    fun partialDropFlagsOnlyTheSelectedBlocksAndTheRestReCoalesce() {
        // §5.2 partial drop (T2-11): dropping the middle 2 blocks of an 8-block card
        // leaves TWO scheduled cards around ONE dropped-still-open card.
        val m = ShiftsScreenViewModel(blockRun("2026-01-15T15:00:00-05:00", 8, "blk"), emptyList(), noon)
        val card = m.uiState.value.myShifts.scheduled.single()
        val plan = m.planDropRange(card, 3, 5) // 16:30–17:30
        m.dropBlocks(plan.blockIds)
        val after = m.uiState.value.myShifts
        assertEquals(listOf("blk-3", "blk-4"), after.dropped.single().blockIds)
        assertEquals(2, after.scheduled.size)
        assertEquals(listOf("blk-0", "blk-1", "blk-2"), after.scheduled[0].blockIds)
        assertEquals(listOf("blk-5", "blk-6", "blk-7"), after.scheduled[1].blockIds)
    }

    @Test
    fun claimingACoalescedOpenCardRemovesAllItsFeedBlocks() {
        val openRun =
            (0 until 4).map { i ->
                OpenShift(
                    id = "op-$i",
                    house = harnwell,
                    start = at("2026-01-15T14:00:00-05:00") + (i * 30).minutes,
                    end = at("2026-01-15T14:00:00-05:00") + ((i + 1) * 30).minutes,
                    feed = OpenFeed.WEEKLY,
                    homeHouse = true,
                )
            }
        val m = ShiftsScreenViewModel(emptyList(), openRun, noon)
        val card = m.uiState.value.homeOpen.weekly.single() // displayed coalesced card
        m.claim(card)
        assertTrue(m.uiState.value.homeOpen.weekly.isEmpty()) // every block left the feed
        val picked = m.uiState.value.myShifts.pickedUp.single()
        assertEquals(card.blockIds, picked.blockIds) // pickup carries the per-block ids
        assertEquals(card.start, picked.start)
        assertEquals(card.end, picked.end)
    }

    @Test
    fun partialClaimTakesOnlyTheSelectedBlocksAndTheRestStaysOpen() {
        // §5.3 partial claim (T2-10): claiming the first 2 blocks of a 4-block
        // opening leaves the trailing 2 blocks as their own open card.
        val openRun =
            (0 until 4).map { i ->
                OpenShift(
                    id = "op-$i",
                    house = harnwell,
                    start = at("2026-01-15T14:00:00-05:00") + (i * 30).minutes,
                    end = at("2026-01-15T14:00:00-05:00") + ((i + 1) * 30).minutes,
                    feed = OpenFeed.WEEKLY,
                    homeHouse = true,
                )
            }
        val m = ShiftsScreenViewModel(emptyList(), openRun, noon)
        val card = m.uiState.value.homeOpen.weekly.single()
        val plan = m.planClaimRange(card, 0, 2)
        m.claim(com.pennhousing.shift.shared.shifts.subOpenShiftFor(card, plan))
        val remaining = m.uiState.value.homeOpen.weekly.single()
        assertEquals(listOf("op-2", "op-3"), remaining.blockIds)
        assertEquals(at("2026-01-15T15:00:00-05:00"), remaining.start)
        val picked = m.uiState.value.myShifts.pickedUp.single()
        assertEquals(listOf("op-0", "op-1"), picked.blockIds)
        assertEquals(at("2026-01-15T14:00:00-05:00"), picked.start)
        assertEquals(at("2026-01-15T15:00:00-05:00"), picked.end)
    }

    @Test
    fun weeklyHoursSumsThisWeeksHeldShiftsOnly() {
        // D8 — the "This week" chip: held shifts in now's week count; a
        // dropped-still-open block and an other-week shift do not.
        val nextWeek =
            MyShift("nw", harnwell, at("2026-01-22T12:00:00-05:00"), at("2026-01-22T14:00:00-05:00"), AssignmentKind.SCHEDULED)
        val held = listOf(pickedUpHome, scheduled, droppedStillOpen, nextWeek)
        // pickedUpHome 2h + scheduled 2h; dropped 2h excluded; next week excluded.
        assertEquals(4.0, com.pennhousing.shift.shared.shifts.weeklyHours(held, noon))
    }

    // ===================================================================
    // My-Shifts week navigation — the tab is scoped to the shown week so a
    // future-week pickup / drop shows under the week it belongs to (§5.6).
    // ===================================================================

    // A scheduled shift one week after `myWeek` (Thu 2026-01-22, next week).
    private val nextWeekScheduled =
        MyShift("nw-sc", harnwell, at("2026-01-22T12:00:00-05:00"), at("2026-01-22T14:00:00-05:00"), AssignmentKind.SCHEDULED)
    private val nextWeekPickup =
        MyShift("nw-pk", quad, at("2026-01-22T09:00:00-05:00"), at("2026-01-22T11:00:00-05:00"), AssignmentKind.TEMP_PICKUP, crossHouse = true)

    private fun vmWithNextWeek() =
        ShiftsScreenViewModel(myShifts = myWeek + nextWeekScheduled + nextWeekPickup, openShifts = feeds, now = noon)

    @Test
    fun myShiftsTabDefaultsToTheCurrentWeekAndExcludesOtherWeeks() {
        // §5.6: at offset 0 only now's-week shifts show; the next-week ones are hidden.
        val t = vmWithNextWeek().uiState.value
        assertEquals(0, t.weekOffset)
        assertFalse(t.myShifts.scheduled.any { it.id == "nw-sc" })
        assertFalse(t.myShifts.pickedUp.any { it.id == "nw-pk" })
        // the current-week fixtures are still present
        assertTrue(t.myShifts.scheduled.any { it.id == "sc" })
    }

    @Test
    fun navigatingToNextWeekShowsThatWeeksShiftsOnly() {
        val m = vmWithNextWeek()
        m.nextWeek()
        val t = m.uiState.value
        assertEquals(1, t.weekOffset)
        // next week's pickup + scheduled now show…
        assertTrue(t.myShifts.pickedUp.any { it.id == "nw-pk" })
        assertTrue(t.myShifts.scheduled.any { it.id == "nw-sc" })
        // …and the current week's shifts are gone from the view.
        assertFalse(t.myShifts.scheduled.any { it.id == "sc" })
        assertFalse(t.myShifts.pickedUp.any { it.id == "pk-home" })
    }

    @Test
    fun previousAndAbsoluteWeekSelectionMoveTheShownWeek() {
        val m = vmWithNextWeek()
        m.previousWeek()
        assertEquals(-1, m.uiState.value.weekOffset)
        // last week is empty (no fixtures there)
        assertTrue(m.uiState.value.myShifts.inDisplayOrder().isEmpty())
        m.selectWeekOffset(1)
        assertEquals(1, m.uiState.value.weekOffset)
        assertTrue(m.uiState.value.myShifts.scheduled.any { it.id == "nw-sc" })
    }

    @Test
    fun weekHoursReflectsTheShownWeekNotTheWholeSnapshot() {
        val m = vmWithNextWeek()
        // Current week held hours: pk-home 2h + pk-cross 2h + scheduled 2h + permanent 2h
        // + float 2h = 10h; the dropped-still-open shift (2h) is excluded.
        assertEquals(10.0, m.uiState.value.weekHours)
        m.nextWeek()
        // Next week: nw-sc 2h + nw-pk 2h = 4h.
        assertEquals(4.0, m.uiState.value.weekHours)
    }

    @Test
    fun weekRangeLabelAndOptionsAreExposedForTheHeader() {
        val m = vmWithNextWeek()
        // Jan 15 2026 is a Thursday → its week is Mon Jan 12 - Sun Jan 18.
        assertEquals("Jan 12 - Jan 18", m.uiState.value.weekRangeLabel)
        m.nextWeek()
        assertEquals("Jan 19 - Jan 25", m.uiState.value.weekRangeLabel)
        // the picker offers the quick weeks (last / this / next / +2 / +3).
        assertEquals(listOf(-1, 0, 1, 2, 3), m.weekOptions().map { it.offset })
    }

    @Test
    fun navigatedWeekSurvivesAnOptimisticDrop() {
        // A drop while viewing next week keeps the view on that week (offset is sticky),
        // and the dropped next-week shift moves into that week's Dropped subsection.
        val m = vmWithNextWeek()
        m.nextWeek()
        m.drop("nw-sc")
        val t = m.uiState.value
        assertEquals(1, t.weekOffset)
        assertFalse(t.myShifts.scheduled.any { it.id == "nw-sc" })
        assertTrue(t.myShifts.dropped.any { it.id == "nw-sc" })
    }

    // ===================================================================
    // Open-Shifts week navigation + past split (UI filter — this session).
    // The open feeds are scoped to their OWN week (last week through +4); a started
    // weekly opening splits into the collapsed "past" card; permanent openings recur.
    // ===================================================================

    // A weekly home opening one week out (Thu 2026-01-22) — only visible at openWeekOffset 1.
    private val nextWeekHomeWeekly =
        OpenShift("nw-hw", harnwell, at("2026-01-22T18:00:00-05:00"), at("2026-01-22T20:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = true)
    private val nextWeekQuadWeekly =
        OpenShift("nw-qw", quad, at("2026-01-22T13:00:00-05:00"), at("2026-01-22T15:00:00-05:00"), OpenFeed.WEEKLY, homeHouse = false)

    private fun vmWithNextWeekOpen() =
        ShiftsScreenViewModel(myShifts = emptyList(), openShifts = feeds + nextWeekHomeWeekly + nextWeekQuadWeekly, now = noon)

    @Test
    fun openFeedsDefaultToTheCurrentWeekAndExcludeOtherWeeks() {
        // At openWeekOffset 0 only now's-week weekly openings show; next week's are hidden.
        val s = vmWithNextWeekOpen().uiState.value
        assertEquals(0, s.openWeekOffset)
        val homeIds = (s.homeOpen.weekly + s.homeOpen.permanentOpenings).map { it.id }
        assertFalse(homeIds.contains("nw-hw"))
        assertTrue(homeIds.contains("hw1")) // current-week home opening still present
        val otherIds = s.otherHouses.openShifts.map { it.id }
        assertFalse(otherIds.contains("nw-qw"))
        assertTrue(otherIds.contains("qw1"))
    }

    @Test
    fun navigatingOpenFeedsToNextWeekShowsThatWeeksOpeningsOnly() {
        val m = vmWithNextWeekOpen()
        m.nextOpenWeek()
        val s = m.uiState.value
        assertEquals(1, s.openWeekOffset)
        assertTrue(s.homeOpen.weekly.any { it.id == "nw-hw" })
        assertFalse(s.homeOpen.weekly.any { it.id == "hw1" }) // current-week opening gone
        assertTrue(s.otherHouses.openShifts.any { it.id == "nw-qw" })
        assertFalse(s.otherHouses.openShifts.any { it.id == "qw1" })
        // The My-Shifts week is independent — it did not move.
        assertEquals(0, s.weekOffset)
    }

    @Test
    fun permanentOpeningsRecurAcrossEveryNavigatedWeek() {
        // Permanent openings carry their own "weeks remaining"; they show on any week.
        val m = vmWithNextWeekOpen()
        assertTrue(m.uiState.value.homeOpen.permanentOpenings.any { it.id == "hp1" })
        m.nextOpenWeek()
        assertTrue(m.uiState.value.homeOpen.permanentOpenings.any { it.id == "hp1" })
        m.selectOpenWeekOffset(-1)
        assertTrue(m.uiState.value.homeOpen.permanentOpenings.any { it.id == "hp1" })
    }

    @Test
    fun openWeekRangeLabelTracksTheShownOpenWeek() {
        val m = vmWithNextWeekOpen()
        assertEquals("Jan 12 - Jan 18", m.uiState.value.openWeekRangeLabel)
        m.nextOpenWeek()
        assertEquals("Jan 19 - Jan 25", m.uiState.value.openWeekRangeLabel)
    }

    @Test
    fun openWeekOptionsSpanLastWeekThroughFourWeeksAhead() {
        // The UI guardrail: last week … in 4 weeks (prevents claiming too far out).
        assertEquals(listOf(-1, 0, 1, 2, 3, 4), vm().openWeekOptions().map { it.offset })
    }

    @Test
    fun pastUpcomingSplitsStartedWeeklyOpeningsAndKeepsPermanentUpcoming() {
        // At noon: hw2 (10:00–12:00) has started → past; hw1 (18:00) → upcoming; the
        // permanent opening hp1 (recurring) is never past even though it starts at 09:00.
        val m = vm()
        val home = m.uiState.value.homeOpen
        val weeklySplit = m.pastUpcoming(home.weekly)
        assertEquals(listOf("hw1"), weeklySplit.upcoming.map { it.id })
        assertEquals(listOf("hw2"), weeklySplit.past.map { it.id })
        // Permanent stays upcoming when run through the split.
        val permSplit = m.pastUpcoming(home.permanentOpenings)
        assertEquals(listOf("hp1"), permSplit.upcoming.map { it.id })
        assertTrue(permSplit.past.isEmpty())
    }

    // ===================================================================
    // Tab selection.
    // ===================================================================

    @Test
    fun defaultsToMyShiftsTabAndSwitchesWithoutMutatingData() {
        val m = vm()
        assertEquals(ShiftsTab.MY_SHIFTS, m.uiState.value.selectedTab)
        val dataBefore = m.uiState.value.otherHouses
        m.selectTab(ShiftsTab.OPEN_OTHER)
        assertEquals(ShiftsTab.OPEN_OTHER, m.uiState.value.selectedTab)
        assertEquals(dataBefore, m.uiState.value.otherHouses) // tab data is unchanged by selection
    }
}
