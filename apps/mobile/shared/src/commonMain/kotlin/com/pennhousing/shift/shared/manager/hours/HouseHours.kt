package com.pennhousing.shift.shared.manager.hours

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/*
 * The manager Hours report (docs/manager-app/SPEC.md §6.5) — PURE presentation logic. No I/O,
 * no clock.
 *
 * WHAT THIS ANSWERS. A manager at 22:00 deciding who to call needs two things: who has room
 * under their cap, and where this person's hours actually went. So each worker rolls up to a
 * total plus a home-desk figure, and every shift worked AWAY from their home desk is listed
 * individually with its duration, its real time range, and which house it was at.
 *
 * THE CLASSIFICATION MIRRORS `apps/web/lib/data/hours.ts`, which mirrors the canonical
 * `worker_my_shifts` view (migration 20260605000001). Keep all three in step:
 *
 *   scheduled                        -> home desk
 *   claimed, same house              -> home desk (a home pickup)
 *   floated_in / pending_float_in    -> away (covering another desk)
 *   claimed, different house         -> away (a cross-house pickup)
 *
 * Each 30-minute block is 0.5h (block atomicity, hard invariant #5), and contiguous blocks at
 * the same house on the same NY date coalesce into one displayed shift, the way every other
 * shift surface in this app already coalesces.
 *
 * CAPS ARE NEVER DERIVED HERE. The effective weekly cap is server-authoritative (it varies by
 * season and by per-worker modification), so it arrives on [WorkerHoursInput.capHours] from the
 * `effective_weekly_caps` RPC. Do not reintroduce a hardcoded 20.
 */

/** How a block counted toward a worker's week. */
enum class HoursKind {
    /** `scheduled`, or `claimed` at their own home house. */
    HOME,

    /** `floated_in` / `pending_float_in`: they were sent to cover another desk. */
    FLOATED_OUT,

    /** `claimed` at another house: they volunteered for it. */
    CROSS_HOUSE_PICKUP,
    ;

    /** Anything not at their home desk, which is what the breakdown itemizes. */
    val isAway: Boolean get() = this != HOME
}

/** One 30-minute occupied block, as the repository read it. */
data class HoursBlock(
    val start: Instant,
    val houseId: String,
    val houseName: String,
    val kind: HoursKind,
    /** Block length in minutes. Always 30 in practice; carried so the maths is not a constant. */
    val minutes: Int = 30,
)

/** One worker's raw week, before roll-up. */
data class WorkerHoursInput(
    val userId: String,
    val name: String,
    val homeHouseId: String,
    /** The server-authoritative effective weekly cap. Null when it could not be read. */
    val capHours: Double?,
    val blocks: List<HoursBlock>,
)

/** One away shift, coalesced from contiguous blocks. */
data class AwayShift(
    /** "Wed · Jan 14". */
    val dayLabel: String,
    /** "14:00 to 17:30" — the real range, not a reconstructed one. */
    val timeLabel: String,
    /** "3h 30m". */
    val durationLabel: String,
    val hours: Double,
    val houseName: String,
    /**
     * The house this shift was worked at. Carried so the UI can turn this shift into a
     * tappable chip that opens THAT house's calendar — the manager's way of independently
     * verifying the hours against the live schedule, rather than trusting the number alone.
     */
    val houseId: String,
    val kind: HoursKind,
) {
    /** "Floated out" / "Picked up" — why they were somewhere else. */
    val kindLabel: String
        get() =
            when (kind) {
                HoursKind.FLOATED_OUT -> "Floated out"
                HoursKind.CROSS_HOUSE_PICKUP -> "Picked up"
                HoursKind.HOME -> "At home desk"
            }
}

/** One roster row, and its expandable breakdown. */
data class WorkerHoursRow(
    val userId: String,
    val name: String,
    val totalHours: Double,
    val homeHours: Double,
    val awayHours: Double,
    val capHours: Double?,
    /** Every away shift, earliest first. Empty for a worker who never left their desk. */
    val awayShifts: List<AwayShift>,
) {
    /** "12h" / "12h 30m". */
    val totalLabel: String get() = hoursLabel(totalHours)
    val homeLabel: String get() = hoursLabel(homeHours)
    val awayLabel: String get() = hoursLabel(awayHours)

    /** "12h of 20h", or just the total when no cap could be read. */
    val capLabel: String get() = capHours?.let { "${hoursLabel(totalHours)} of ${hoursLabel(it)}" } ?: hoursLabel(totalHours)

    /** How much of the cap is used, clamped to 0..1 for a meter. Null without a cap. */
    val capFraction: Double?
        get() = capHours?.takeIf { it > 0 }?.let { (totalHours / it).coerceIn(0.0, 1.0) }

    /**
     * At or over the cap. The manager's real question is "can I give this person more hours",
     * so this is the flag the row highlights. The cap is advisory or hard depending on the
     * season, and that decision is the server's; this only reports the arithmetic.
     */
    val isAtCap: Boolean get() = capHours != null && totalHours >= capHours

    /** Hours still available under the cap. Null without a cap, never negative. */
    val remainingHours: Double? get() = capHours?.let { (it - totalHours).coerceAtLeast(0.0) }
}

/** The whole Hours screen state. */
data class HouseHoursReport(
    val houseId: String,
    val houseName: String,
    val weekLabel: String,
    val rows: List<WorkerHoursRow>,
) {
    val isEmpty: Boolean get() = rows.isEmpty()

    /** Everyone's hours added up, for the header. */
    val totalHours: Double get() = rows.sumOf { it.totalHours }
    val totalLabel: String get() = hoursLabel(totalHours)
}

/** "12h" / "12h 30m" / "30m" / "0h". Mirrors `formatDuration`'s vocabulary. */
fun hoursLabel(hours: Double): String {
    val mins = (hours * 60).toInt()
    val h = mins / 60
    val m = mins % 60
    return when {
        h == 0 && m == 0 -> "0h"
        h == 0 -> "${m}m"
        m == 0 -> "${h}h"
        else -> "${h}h ${m}m"
    }
}

/**
 * Coalesce a worker's blocks into their roll-up and their away-shift list.
 *
 * Blocks are grouped by (house, kind, NY date) and then split wherever there is a time gap, so
 * two separate away stints at the same house on the same day stay two shifts rather than
 * merging into one wrong range. Sorting first is what makes the contiguity test valid.
 */
fun rollUpWorkerHours(
    input: WorkerHoursInput,
    zone: TimeZone = NEW_YORK,
): WorkerHoursRow {
    val sorted = input.blocks.sortedBy { it.start }
    val homeMinutes = sorted.filter { it.kind == HoursKind.HOME }.sumOf { it.minutes }
    val awayMinutes = sorted.filter { it.kind.isAway }.sumOf { it.minutes }

    val awayShifts =
        sorted
            .filter { it.kind.isAway }
            .fold(mutableListOf<MutableList<HoursBlock>>()) { runs, block ->
                val open = runs.lastOrNull()
                val previous = open?.lastOrNull()
                val continues =
                    previous != null &&
                        previous.houseId == block.houseId &&
                        previous.kind == block.kind &&
                        // Contiguous in real time: the previous block ends exactly where this
                        // one starts. Duration arithmetic, never wall-clock, so a DST-crossing
                        // run does not split spuriously (hard invariant #6).
                        previous.start + previous.minutes.minutes == block.start &&
                        isSameNyDay(previous.start, block.start, zone)
                if (continues) open.add(block) else runs.add(mutableListOf(block))
                runs
            }
            .map { run ->
                val first = run.first()
                val last = run.last()
                val end = last.start + last.minutes.minutes
                AwayShift(
                    dayLabel = formatDayLabel(first.start, zone),
                    timeLabel = "${formatBlockTime(first.start, zone)} to ${formatBlockTime(end, zone)}",
                    durationLabel = formatDuration(first.start, end),
                    hours = run.sumOf { it.minutes } / 60.0,
                    houseName = first.houseName,
                    houseId = first.houseId,
                    kind = first.kind,
                )
            }

    return WorkerHoursRow(
        userId = input.userId,
        name = input.name,
        totalHours = (homeMinutes + awayMinutes) / 60.0,
        homeHours = homeMinutes / 60.0,
        awayHours = awayMinutes / 60.0,
        capHours = input.capHours,
        awayShifts = awayShifts,
    )
}

/**
 * Build the report, sorted by total hours DESCENDING.
 *
 * That order is the product decision: the question a manager opens this screen to answer is
 * "who has room", so the people who do not have room sort to the top where they are easiest to
 * rule out. Ties break on name so the list is stable between refreshes.
 */
fun buildHouseHoursReport(
    houseId: String,
    houseName: String,
    weekStart: Instant,
    workers: List<WorkerHoursInput>,
    zone: TimeZone = NEW_YORK,
): HouseHoursReport {
    val rows =
        workers
            .map { rollUpWorkerHours(it, zone) }
            .sortedWith(compareByDescending<WorkerHoursRow> { it.totalHours }.thenBy { it.name })
    return HouseHoursReport(
        houseId = houseId,
        houseName = houseName,
        weekLabel = weekRangeLabel(weekStart, zone),
        rows = rows,
    )
}

/** "Jan 12 to Jan 18" — the NY week the report covers. */
fun weekRangeLabel(
    weekStart: Instant,
    zone: TimeZone = NEW_YORK,
): String {
    // 6 days on, not 7: the label names the last DAY of the week, not the exclusive end.
    val weekEnd = weekStart + (6 * 24 * 60).minutes
    return "${monthDay(weekStart, zone)} to ${monthDay(weekEnd, zone)}"
}

private val MONTH_SHORT =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private fun monthDay(
    instant: Instant,
    zone: TimeZone,
): String {
    val ldt = instant.toLocalDateTime(zone)
    return "${MONTH_SHORT[ldt.month.ordinal]} ${ldt.day}"
}

private fun isSameNyDay(
    a: Instant,
    b: Instant,
    zone: TimeZone,
): Boolean {
    val da = a.toLocalDateTime(zone)
    val db = b.toLocalDateTime(zone)
    return da.year == db.year && da.month == db.month && da.day == db.day
}
