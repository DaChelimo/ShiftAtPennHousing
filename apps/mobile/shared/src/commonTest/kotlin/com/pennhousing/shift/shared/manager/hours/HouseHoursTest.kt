package com.pennhousing.shift.shared.manager.hours

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * The manager Hours report (docs/manager-app/SPEC.md §6.5).
 *
 * The cases that matter are the coalescing rules, because getting them wrong produces a
 * plausible-looking but wrong shift list: two stints at the same house on the same day must not
 * merge into one long range, and a run that is genuinely contiguous must not fragment.
 *
 * Anchor: the NY week of Mon 2026-01-12.
 */
class HouseHoursTest {
    private fun at(iso: String): Instant = Instant.parse(iso)

    private val weekStart = at("2026-01-12T00:00:00-05:00")

    private fun home(
        start: String,
        count: Int = 1,
    ) = blocks(start, count, "harnwell", "Harnwell", HoursKind.HOME)

    private fun away(
        start: String,
        count: Int = 1,
        houseId: String = "rodin",
        houseName: String = "Rodin",
        kind: HoursKind = HoursKind.FLOATED_OUT,
    ) = blocks(start, count, houseId, houseName, kind)

    private fun blocks(
        start: String,
        count: Int,
        houseId: String,
        houseName: String,
        kind: HoursKind,
    ): List<HoursBlock> {
        val first = at(start)
        return (0 until count).map { i ->
            HoursBlock(
                start = first.plus(kotlin.time.Duration.parse("${i * 30}m")),
                houseId = houseId,
                houseName = houseName,
                kind = kind,
            )
        }
    }

    private fun worker(
        name: String = "Andrew",
        capHours: Double? = 20.0,
        blocks: List<HoursBlock> = emptyList(),
    ) = WorkerHoursInput(
        userId = "u-$name",
        name = name,
        homeHouseId = "harnwell",
        capHours = capHours,
        blocks = blocks,
    )

    // ----- Roll-up arithmetic. Each block is half an hour. -----

    @Test
    fun eachBlockIsHalfAnHour() {
        val row = rollUpWorkerHours(worker(blocks = home("2026-01-14T09:00:00-05:00", count = 8)))
        assertEquals(4.0, row.totalHours, 0.001)
        assertEquals(4.0, row.homeHours, 0.001)
        assertEquals(0.0, row.awayHours, 0.001)
        assertEquals("4h", row.totalLabel)
    }

    @Test
    fun homeAndAwaySplitAndSumToTheTotal() {
        val row =
            rollUpWorkerHours(
                worker(
                    blocks =
                        home("2026-01-14T09:00:00-05:00", count = 8) +
                            away("2026-01-15T14:00:00-05:00", count = 4),
                ),
            )
        assertEquals(6.0, row.totalHours, 0.001)
        assertEquals(4.0, row.homeHours, 0.001)
        assertEquals(2.0, row.awayHours, 0.001)
    }

    /** A pickup at their OWN house is home time, not away time. */
    @Test
    fun aHomeHousePickupCountsAsHomeTime() {
        val row =
            rollUpWorkerHours(
                worker(
                    blocks =
                        blocks("2026-01-14T09:00:00-05:00", 4, "harnwell", "Harnwell", HoursKind.HOME),
                ),
            )
        assertEquals(2.0, row.homeHours, 0.001)
        assertTrue(row.awayShifts.isEmpty())
    }

    // ----- Away-shift coalescing. The load-bearing part. -----

    @Test
    fun contiguousAwayBlocksBecomeOneShiftWithTheRealRange() {
        val row = rollUpWorkerHours(worker(blocks = away("2026-01-15T14:00:00-05:00", count = 7)))
        val shift = row.awayShifts.single()
        assertEquals("Thu · Jan 15", shift.dayLabel)
        assertEquals("14:00 to 17:30", shift.timeLabel)
        assertEquals("3h 30m", shift.durationLabel)
        assertEquals(3.5, shift.hours, 0.001)
        assertEquals("Rodin", shift.houseName)
        // The house ID travels with the shift — it is what a verification chip navigates on.
        assertEquals("rodin", shift.houseId)
    }

    /**
     * Two separate stints on the same day at the same house. Merging these would report one
     * 8-hour shift the worker never worked, which is exactly the kind of wrong-but-plausible
     * number a manager would act on.
     */
    @Test
    fun aGapSplitsTwoStintsAtTheSameHouseOnTheSameDay() {
        val row =
            rollUpWorkerHours(
                worker(
                    blocks =
                        away("2026-01-15T09:00:00-05:00", count = 2) +
                            away("2026-01-15T15:00:00-05:00", count = 2),
                ),
            )
        assertEquals(2, row.awayShifts.size)
        assertEquals("09:00 to 10:00", row.awayShifts[0].timeLabel)
        assertEquals("15:00 to 16:00", row.awayShifts[1].timeLabel)
    }

    /** Different houses never merge, even back to back (which cannot happen, but must not fuse). */
    @Test
    fun differentHousesNeverMerge() {
        val row =
            rollUpWorkerHours(
                worker(
                    blocks =
                        away("2026-01-15T09:00:00-05:00", count = 2, houseId = "rodin", houseName = "Rodin") +
                            away("2026-01-15T10:00:00-05:00", count = 2, houseId = "lauder", houseName = "Lauder"),
                ),
            )
        assertEquals(2, row.awayShifts.size)
        assertEquals(listOf("Rodin", "Lauder"), row.awayShifts.map { it.houseName })
        assertEquals(listOf("rodin", "lauder"), row.awayShifts.map { it.houseId })
    }

    /** A float and a pickup are different facts about the same worker; do not fuse them. */
    @Test
    fun floatedOutAndPickedUpNeverMerge() {
        val row =
            rollUpWorkerHours(
                worker(
                    blocks =
                        away("2026-01-15T09:00:00-05:00", count = 2, kind = HoursKind.FLOATED_OUT) +
                            away("2026-01-15T10:00:00-05:00", count = 2, kind = HoursKind.CROSS_HOUSE_PICKUP),
                ),
            )
        assertEquals(2, row.awayShifts.size)
        assertEquals(listOf("Floated out", "Picked up"), row.awayShifts.map { it.kindLabel })
    }

    /** A run crossing NY midnight splits by calendar day, because that is how a manager reads it. */
    @Test
    fun aRunCrossingMidnightSplitsByNyDay() {
        val row = rollUpWorkerHours(worker(blocks = away("2026-01-15T23:00:00-05:00", count = 4)))
        assertEquals(2, row.awayShifts.size)
        assertEquals("23:00 to 00:00", row.awayShifts[0].timeLabel)
        assertEquals("00:00 to 01:00", row.awayShifts[1].timeLabel)
    }

    /** Out-of-order input must not fragment a contiguous run. */
    @Test
    fun unsortedBlocksStillCoalesce() {
        val ordered = away("2026-01-15T14:00:00-05:00", count = 4)
        val row = rollUpWorkerHours(worker(blocks = ordered.reversed()))
        assertEquals(1, row.awayShifts.size)
        assertEquals("14:00 to 16:00", row.awayShifts.single().timeLabel)
    }

    // ----- The cap. Server-authoritative, never derived here. -----

    @Test
    fun capLabelAndRemainingReadFromTheServerCap() {
        val row = rollUpWorkerHours(worker(capHours = 20.0, blocks = home("2026-01-14T09:00:00-05:00", count = 24)))
        assertEquals(12.0, row.totalHours, 0.001)
        assertEquals("12h of 20h", row.capLabel)
        assertEquals(8.0, row.remainingHours!!, 0.001)
        assertFalse(row.isAtCap)
        assertEquals(0.6, row.capFraction!!, 0.001)
    }

    @Test
    fun atOrOverTheCapIsFlagged() {
        val atCap = rollUpWorkerHours(worker(capHours = 4.0, blocks = home("2026-01-14T09:00:00-05:00", count = 8)))
        assertTrue(atCap.isAtCap)
        assertEquals(0.0, atCap.remainingHours!!, 0.001)

        val overCap = rollUpWorkerHours(worker(capHours = 4.0, blocks = home("2026-01-14T09:00:00-05:00", count = 12)))
        assertTrue(overCap.isAtCap)
        // Never negative, and the meter never overflows.
        assertEquals(0.0, overCap.remainingHours!!, 0.001)
        assertEquals(1.0, overCap.capFraction!!, 0.001)
    }

    /** A cap that could not be read must degrade, not invent a number. */
    @Test
    fun anUnreadableCapDegradesToTheTotalAlone() {
        val row = rollUpWorkerHours(worker(capHours = null, blocks = home("2026-01-14T09:00:00-05:00", count = 8)))
        assertEquals("4h", row.capLabel)
        assertNull(row.remainingHours)
        assertNull(row.capFraction)
        assertFalse(row.isAtCap)
    }

    /** A zero cap must not divide by zero. */
    @Test
    fun aZeroCapYieldsNoFraction() {
        val row = rollUpWorkerHours(worker(capHours = 0.0, blocks = home("2026-01-14T09:00:00-05:00", count = 2)))
        assertNull(row.capFraction)
        assertTrue(row.isAtCap)
    }

    // ----- The report: ordering and totals. -----

    @Test
    fun rowsSortByTotalHoursDescendingThenName() {
        val report =
            buildHouseHoursReport(
                houseId = "harnwell",
                houseName = "Harnwell",
                weekStart = weekStart,
                workers =
                    listOf(
                        worker(name = "Beth", blocks = home("2026-01-14T09:00:00-05:00", count = 4)),
                        worker(name = "Andrew", blocks = home("2026-01-14T09:00:00-05:00", count = 12)),
                        // Same total as Beth, so name breaks the tie.
                        worker(name = "Aaron", blocks = home("2026-01-13T09:00:00-05:00", count = 4)),
                    ),
            )
        assertEquals(listOf("Andrew", "Aaron", "Beth"), report.rows.map { it.name })
    }

    @Test
    fun reportTotalsEveryonesHours() {
        val report =
            buildHouseHoursReport(
                houseId = "harnwell",
                houseName = "Harnwell",
                weekStart = weekStart,
                workers =
                    listOf(
                        worker(name = "Andrew", blocks = home("2026-01-14T09:00:00-05:00", count = 8)),
                        worker(name = "Beth", blocks = home("2026-01-14T09:00:00-05:00", count = 4)),
                    ),
            )
        assertEquals(6.0, report.totalHours, 0.001)
        assertEquals("6h", report.totalLabel)
        assertFalse(report.isEmpty)
    }

    @Test
    fun anEmptyRosterReportsEmpty() {
        val report = buildHouseHoursReport("harnwell", "Harnwell", weekStart, emptyList())
        assertTrue(report.isEmpty)
        assertEquals("0h", report.totalLabel)
    }

    @Test
    fun weekLabelNamesTheFirstAndLastDay() {
        assertEquals("Jan 12 to Jan 18", weekRangeLabel(weekStart))
    }

    /** A worker with no blocks is still on the roster: they are the one with room. */
    @Test
    fun aWorkerWithNoShiftsStillAppears() {
        val report = buildHouseHoursReport("harnwell", "Harnwell", weekStart, listOf(worker(name = "Idle")))
        val row = report.rows.single()
        assertEquals(0.0, row.totalHours, 0.001)
        assertEquals("0h", row.totalLabel)
        assertTrue(row.awayShifts.isEmpty())
        assertEquals(20.0, row.remainingHours!!, 0.001)
    }

    // ----- Labels. Surfaced copy, so no em/en dashes. -----

    @Test
    fun hoursLabelsReadNaturally() {
        assertEquals("0h", hoursLabel(0.0))
        assertEquals("30m", hoursLabel(0.5))
        assertEquals("1h", hoursLabel(1.0))
        assertEquals("12h 30m", hoursLabel(12.5))
    }

    @Test
    fun surfacedCopyAvoidsDashes() {
        val row =
            rollUpWorkerHours(
                worker(blocks = away("2026-01-15T14:00:00-05:00", count = 4)),
            )
        val copy =
            listOf(row.totalLabel, row.capLabel, row.homeLabel, row.awayLabel) +
                row.awayShifts.flatMap { listOf(it.dayLabel, it.timeLabel, it.durationLabel, it.kindLabel) } +
                listOf(weekRangeLabel(weekStart))
        copy.forEach {
            assertFalse(it.contains('—'), "em dash in surfaced copy: $it")
            assertFalse(it.contains('–'), "en dash in surfaced copy: $it")
        }
    }
}
