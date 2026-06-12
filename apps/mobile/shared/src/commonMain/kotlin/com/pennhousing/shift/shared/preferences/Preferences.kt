package com.pennhousing.shift.shared.preferences

import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlin.time.Instant

/*
 * Preference submission (the tri-state "paint" grid + target weekly hours) —
 * PURE presentation logic shared by both platforms, the preferences analogue of
 * the other screens' presentation layers. The worker paints each 30-minute block
 * Available / Preferred / Cannot for the upcoming scheduling period, sets a target,
 * and submits before the deadline. No I/O, no system clock — the period snapshot
 * (incl. its blocks + any already-saved statuses) is injected, and every label is
 * NY-anchored (invariant #6).
 *
 * DATA AVAILABILITY (this is a NEW screen — checked before building):
 *  - `preferences` (own rows, R/W via RLS), `period_targets` (own row: target_hours
 *    + opted_out, R/W), and `shift_blocks` (authenticated read) all exist, and the
 *    `submit-preferences` Edge Function persists {period_id, preferences[], target,
 *    opted_out} through the `submit_preferences` RPC (deadline + cap enforced
 *    server-side). So the paint grid binds to REAL tables.
 *  - GAP (flagged, not invented): `scheduling_periods` has NO authenticated SELECT
 *    policy, so a worker can read NEITHER the active period_id NOR the
 *    `preference_deadline`. The period label + deadline copy here are therefore
 *    caller-supplied (the demo provides them; a live wiring needs a worker-readable
 *    period or an Edge Function — do not fabricate one). The reminder cadence is the
 *    server's 5/3/1-day, not the design's −24h/−2h.
 *  - `preference_status_enum` is {preferred, available, cannot, none}; the painter
 *    uses the three actionable values (`none` is the not-specified sentinel, unused
 *    here — every block defaults to AVAILABLE).
 */

/** The tri-state brush. [dbStatus] is the `preference_status_enum` value submitted. */
enum class PrefBrush(
    val dbStatus: String,
) {
    AVAILABLE("available"),
    PREFERRED("preferred"),
    CANNOT("cannot"),
}

/** Brush palette order (worker-app.html `PREF_ORDER`): Available · Preferred · Cannot. */
val PREF_BRUSH_ORDER: List<PrefBrush> = listOf(PrefBrush.AVAILABLE, PrefBrush.PREFERRED, PrefBrush.CANNOT)

/** Default soft cap on target weekly hours for a regular period (§5.3). */
const val PREF_DEFAULT_CAP_HOURS: Int = 20

/** Target-hours stepper increment (worker-app.html steps by 2). */
const val PREF_TARGET_STEP: Int = 2

/** One paintable 30-minute block — a worker-readable `shift_blocks` row. */
data class PrefBlock(
    val blockId: String,
    val start: Instant,
)

/**
 * The editable snapshot for one scheduling period: its 7 days of blocks (Mon..Sun,
 * each ascending), the already-saved statuses to pre-fill, the target + opt-out, and
 * the deadline/label copy (caller-supplied — see GAP above). [submitted] makes the
 * whole screen read-only (deadline passed / already final).
 */
data class PreferencePeriod(
    val periodId: String,
    val periodLabel: String,
    val deadlineLabel: String?,
    val submitted: Boolean,
    /** D9 (§4.2): the deadline has passed with NO submission — the grid locks read-only. */
    val deadlinePassed: Boolean = false,
    val weekStart: LocalDate,
    val days: List<List<PrefBlock>>,
    val initialStatuses: Map<String, PrefBrush> = emptyMap(),
    val targetHours: Int,
    val optedOut: Boolean,
    val capHours: Int = PREF_DEFAULT_CAP_HOURS,
)

/** The mutable paint state — block id → chosen brush; unset blocks read AVAILABLE. */
data class PreferenceGrid(
    val statuses: Map<String, PrefBrush>,
) {
    fun statusOf(blockId: String): PrefBrush = statuses[blockId] ?: PrefBrush.AVAILABLE

    /** Paint one block (pure copy) — leaves every other cell untouched. */
    fun paint(
        blockId: String,
        brush: PrefBrush,
    ): PreferenceGrid = PreferenceGrid(statuses + (blockId to brush))
}

/** The grid pre-filled from the period's already-saved statuses. */
fun PreferencePeriod.initialGrid(): PreferenceGrid = PreferenceGrid(initialStatuses)

// ── Week strip ───────────────────────────────────────────────────────────────

/** One Mon–Sun strip cell. [painted] = the day has any non-AVAILABLE block. */
data class PrefWeekCell(
    val dayIndex: Int,
    val dayLetter: String,
    val dateLabel: String,
    val selected: Boolean,
    val painted: Boolean,
)

data class PrefWeekStrip(
    val rangeLabel: String,
    val cells: List<PrefWeekCell>,
)

private const val DAYS_IN_WEEK = 7

/** The Mon–Sun strip; a day is [PrefWeekCell.painted] when it holds a Preferred/Cannot block. */
fun buildPrefWeekStrip(
    period: PreferencePeriod,
    grid: PreferenceGrid,
    selectedDayIndex: Int,
): PrefWeekStrip {
    val cells =
        (0 until DAYS_IN_WEEK).map { i ->
            val date = period.weekStart.plus(i, DateTimeUnit.DAY)
            val dayBlocks = period.days.getOrElse(i) { emptyList() }
            val painted = dayBlocks.any { grid.statusOf(it.blockId) != PrefBrush.AVAILABLE }
            PrefWeekCell(
                dayIndex = i,
                dayLetter = DOW_SHORT[i].take(1),
                dateLabel = date.day.toString(),
                selected = i == selectedDayIndex,
                painted = painted,
            )
        }
    val sunday = period.weekStart.plus(DAYS_IN_WEEK - 1, DateTimeUnit.DAY)
    val range =
        "${MONTH_SHORT[period.weekStart.month.ordinal]} ${period.weekStart.day} – " +
            "${MONTH_SHORT[sunday.month.ordinal]} ${sunday.day}"
    return PrefWeekStrip(rangeLabel = range, cells = cells)
}

// ── Selected-day grid ──────────────────────────────────────────────────────────

/** One paintable cell in the day grid — its mono time + the current brush. */
data class PrefBlockCell(
    val blockId: String,
    val timeLabel: String,
    val brush: PrefBrush,
)

/** Per-day tally for the summary line. */
data class PrefDaySummary(
    val preferred: Int,
    val available: Int,
    val cannot: Int,
)

data class PrefDayView(
    val dayIndex: Int,
    val title: String,
    val cells: List<PrefBlockCell>,
    val summary: PrefDaySummary,
) {
    val isEmpty: Boolean get() = cells.isEmpty()
}

/** The selected day's grid + header ("Wed · Jun 10") + summary counts. */
fun buildPrefDay(
    period: PreferencePeriod,
    grid: PreferenceGrid,
    selectedDayIndex: Int,
    zone: TimeZone = NEW_YORK,
): PrefDayView {
    val blocks = period.days.getOrElse(selectedDayIndex) { emptyList() }
    val cells =
        blocks.map { b ->
            PrefBlockCell(blockId = b.blockId, timeLabel = formatBlockTime(b.start, zone), brush = grid.statusOf(b.blockId))
        }
    val summary =
        PrefDaySummary(
            preferred = cells.count { it.brush == PrefBrush.PREFERRED },
            available = cells.count { it.brush == PrefBrush.AVAILABLE },
            cannot = cells.count { it.brush == PrefBrush.CANNOT },
        )
    val date = period.weekStart.plus(selectedDayIndex, DateTimeUnit.DAY)
    val title = "${DOW_SHORT[selectedDayIndex]} · ${MONTH_SHORT[date.month.ordinal]} ${date.day}"
    return PrefDayView(dayIndex = selectedDayIndex, title = title, cells = cells, summary = summary)
}

// ── Target hours ───────────────────────────────────────────────────────────────

/** Clamp a target into [0, capHours]. The UI steps by [PREF_TARGET_STEP] before clamping. */
fun clampTarget(
    value: Int,
    capHours: Int,
): Int = value.coerceIn(0, capHours)

/** The target-hours stepper meter — "16h" (or "0h" when opted out) + the progress fraction. */
data class TargetMeter(
    val label: String,
    val capLabel: String,
    val fraction: Double,
)

fun buildTargetMeter(
    targetHours: Int,
    optedOut: Boolean,
    capHours: Int = PREF_DEFAULT_CAP_HOURS,
): TargetMeter {
    val effective = if (optedOut) 0 else targetHours
    val cap = if (capHours <= 0) 1 else capHours
    return TargetMeter(
        label = "${effective}h",
        capLabel = "${capHours}h",
        fraction = (effective.toDouble() / cap).coerceIn(0.0, 1.0),
    )
}

// ── Banner + submit payload ─────────────────────────────────────────────────────

enum class PrefBannerTone { INFO, SUCCESS }

/** The top banner: editable → the submit-by reminder; submitted → the read-only notice. */
data class PreferenceBanner(
    val tone: PrefBannerTone,
    val title: String,
    val body: String,
)

fun buildPreferenceBanner(period: PreferencePeriod): PreferenceBanner =
    when {
        period.submitted ->
            PreferenceBanner(
                tone = PrefBannerTone.SUCCESS,
                title = "Submitted · read-only",
                body = "Deadline passed. Your manager builds next week from these.",
            )
        // D9 (§4.2): never submitted AND the window closed — the RPC would reject a
        // late write (preference_deadline_is_open), so the UI locks instead of
        // silently failing.
        period.deadlinePassed ->
            PreferenceBanner(
                tone = PrefBannerTone.INFO,
                title = "Deadline passed — preferences are locked",
                body = "The submission window closed. Your manager builds the week without them.",
            )
        else ->
            PreferenceBanner(
                tone = PrefBannerTone.INFO,
                title = period.deadlineLabel?.let { "Submit by $it" } ?: "Submit before the deadline",
                body = "Reminders go out as the deadline nears. You can edit until then.",
            )
    }

/** One {block_id, status} entry in the `submit-preferences` Edge-Function payload. */
data class PrefEntry(
    val blockId: String,
    val status: String,
)

/**
 * The `submit-preferences` request body the data layer POSTs (period_id + every
 * block's status + target + opted_out). Built from the full grid so the upsert
 * mirrors exactly what the worker painted. The Edge Function re-checks the deadline
 * and the hours cap server-side.
 */
data class SubmitPreferencesPayload(
    val periodId: String,
    val entries: List<PrefEntry>,
    val targetHours: Int,
    val optedOut: Boolean,
)

fun buildSubmitPayload(
    period: PreferencePeriod,
    grid: PreferenceGrid,
    targetHours: Int,
    optedOut: Boolean,
): SubmitPreferencesPayload {
    val entries =
        period.days.flatten().map { b ->
            PrefEntry(blockId = b.blockId, status = grid.statusOf(b.blockId).dbStatus)
        }
    return SubmitPreferencesPayload(
        periodId = period.periodId,
        entries = entries,
        targetHours = if (optedOut) 0 else clampTarget(targetHours, period.capHours),
        optedOut = optedOut,
    )
}
