package com.pennhousing.shift.shared.preferences

import com.pennhousing.shift.shared.shifts.DOW_LONG
import com.pennhousing.shift.shared.shifts.DOW_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Duration.Companion.minutes
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

/**
 * One Mon–Sun strip cell. Preferences are a WEEKLY TEMPLATE (what the worker wants every
 * Monday, every Tuesday, etc. for the whole season), so a cell carries only its weekday
 * [dayLabel] — never a calendar date. [painted] = the day has any non-AVAILABLE block.
 */
data class PrefWeekCell(
    val dayIndex: Int,
    val dayLabel: String,
    val selected: Boolean,
    val painted: Boolean,
)

data class PrefWeekStrip(
    val rangeLabel: String,
    val cells: List<PrefWeekCell>,
)

private const val DAYS_IN_WEEK = 7

/**
 * The Mon–Sun strip. Because preferences are a weekly TEMPLATE, cells carry the weekday name
 * only (no dates) and the strip's label reads as a repeat, not a specific week. A day is
 * [PrefWeekCell.painted] when it holds a Preferred/Cannot block.
 */
fun buildPrefWeekStrip(
    period: PreferencePeriod,
    grid: PreferenceGrid,
    selectedDayIndex: Int,
): PrefWeekStrip {
    val cells =
        (0 until DAYS_IN_WEEK).map { i ->
            val dayBlocks = period.days.getOrElse(i) { emptyList() }
            val painted = dayBlocks.any { grid.statusOf(it.blockId) != PrefBrush.AVAILABLE }
            PrefWeekCell(
                dayIndex = i,
                dayLabel = DOW_SHORT[i],
                selected = i == selectedDayIndex,
                painted = painted,
            )
        }
    return PrefWeekStrip(rangeLabel = "Repeats every week this season", cells = cells)
}

// ── Selected-day timeline ────────────────────────────────────────────────────────
//
// The picker is a vertical day timeline, NOT a labelled per-cell grid: hours live in a
// left gutter (on the dividing lines, so a fill *between* the "8 AM" and "9" lines is
// unambiguously 08:00–09:00), each 30-min block is a bare colored segment (no per-cell
// text — that crowds short shifts), and a painted run carries ONE span label. The UI
// paints by drag (long-press → sweep, current brush) with a single tap = one block.

private const val BLOCK_MINUTES = 30

/** One paintable 30-minute segment. No visible text — [a11yLabel] is the screen-reader copy. */
data class PrefBlockCell(
    val blockId: String,
    val brush: PrefBrush,
    /** This block starts on the hour → a heavier divider above it. */
    val isHourStart: Boolean,
    /** "8:00 AM – 8:30 AM · preferred" (accessibility only — never rendered as a label). */
    val a11yLabel: String,
)

/** One left-gutter hour label. [boundaryIndex] is how many blocks down its line sits (0 = top). */
data class PrefHourMark(
    val boundaryIndex: Int,
    val label: String,
)

/** A contiguous painted span (never AVAILABLE) — backs the single per-run label pill. */
data class PrefBlockRun(
    val brush: PrefBrush,
    val startBlockIndex: Int,
    val blockCount: Int,
    /** "8:00 AM – 12:00 PM" — the whole span, shown once on the run. */
    val label: String,
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
    val hourMarks: List<PrefHourMark>,
    val runs: List<PrefBlockRun>,
    val summary: PrefDaySummary,
) {
    val isEmpty: Boolean get() = cells.isEmpty()
}

private fun pad2(n: Int): String = if (n < 10) "0$n" else n.toString()

/** "8 AM" / "9" / "12 PM" — a gutter hour mark. Meridiem shown only when [withMeridiem]. */
fun formatHourMark(
    instant: Instant,
    withMeridiem: Boolean,
    zone: TimeZone = NEW_YORK,
): String {
    val ldt = instant.toLocalDateTime(zone)
    val h12 = ((ldt.hour + 11) % 12) + 1
    return if (withMeridiem) "$h12 ${if (ldt.hour < 12) "AM" else "PM"}" else "$h12"
}

/** "8:00 AM" — 12-hour clock with minutes + meridiem (NY-anchored, invariant #6). */
fun formatClock12(
    instant: Instant,
    zone: TimeZone = NEW_YORK,
): String {
    val ldt = instant.toLocalDateTime(zone)
    val h12 = ((ldt.hour + 11) % 12) + 1
    return "$h12:${pad2(ldt.minute)} ${if (ldt.hour < 12) "AM" else "PM"}"
}

/**
 * "8:00 AM – 12:00 PM" for the inclusive block span [lo..hi] (the end is the last block's
 * start + 30 min). The leading meridiem is dropped when both ends share it ("8:00 – 11:00 AM").
 */
fun prefRangeLabel(
    blocks: List<PrefBlock>,
    fromIndex: Int,
    toIndex: Int,
    zone: TimeZone = NEW_YORK,
): String {
    if (blocks.isEmpty()) return ""
    val lo = minOf(fromIndex, toIndex).coerceIn(blocks.indices)
    val hi = maxOf(fromIndex, toIndex).coerceIn(blocks.indices)
    val start = blocks[lo].start
    val end = blocks[hi].start + BLOCK_MINUTES.minutes
    val startMer = if (start.toLocalDateTime(zone).hour < 12) "AM" else "PM"
    val endMer = if (end.toLocalDateTime(zone).hour < 12) "AM" else "PM"
    val startLabel =
        if (startMer == endMer) formatClock12(start, zone).removeSuffix(" $startMer") else formatClock12(start, zone)
    return "$startLabel - ${formatClock12(end, zone)}"
}

/** The selected day's timeline: header ("Wed · Jun 10"), bare segments, gutter hours, run labels, tally. */
fun buildPrefDay(
    period: PreferencePeriod,
    grid: PreferenceGrid,
    selectedDayIndex: Int,
    zone: TimeZone = NEW_YORK,
): PrefDayView {
    val blocks = period.days.getOrElse(selectedDayIndex) { emptyList() }
    // Weekly template: the title is the weekday alone ("Monday"), not a specific date, so the
    // worker reads it as "every Monday this season looks like this."
    val title = "Every ${DOW_LONG[selectedDayIndex]}"
    if (blocks.isEmpty()) {
        return PrefDayView(selectedDayIndex, title, emptyList(), emptyList(), emptyList(), PrefDaySummary(0, 0, 0))
    }
    val cells =
        blocks.map { b ->
            val onHour = b.start.toLocalDateTime(zone).minute == 0
            val brush = grid.statusOf(b.blockId)
            PrefBlockCell(
                blockId = b.blockId,
                brush = brush,
                isHourStart = onHour,
                a11yLabel = "${formatClock12(b.start, zone)} - ${formatClock12(b.start + BLOCK_MINUTES.minutes, zone)} · ${brush.dbStatus}",
            )
        }
    // Gutter marks at every on-the-hour boundary, from the first block's start through the
    // end of the last block; meridiem only on the first mark and at noon/midnight. The first
    // and last boundaries are ALWAYS labelled so the rail is anchored to the shift's real
    // start and end: an off-the-hour edge (e.g. a 5:30 AM start) gets the exact clock time
    // "5:30 AM" rather than being left blank until the next whole hour.
    val hourMarks = mutableListOf<PrefHourMark>()
    val lastBoundary = blocks.size
    for (b in 0..lastBoundary) {
        val time = if (b < blocks.size) blocks[b].start else blocks.last().start + BLOCK_MINUTES.minutes
        val ldt = time.toLocalDateTime(zone)
        when {
            ldt.minute == 0 ->
                hourMarks += PrefHourMark(b, formatHourMark(time, withMeridiem = b == 0 || ldt.hour == 0 || ldt.hour == 12, zone))
            b == 0 || b == lastBoundary ->
                hourMarks += PrefHourMark(b, formatClock12(time, zone))
        }
    }
    // Group consecutive same-brush non-AVAILABLE cells into labelled runs.
    val runs = mutableListOf<PrefBlockRun>()
    var i = 0
    while (i < cells.size) {
        val brush = cells[i].brush
        if (brush == PrefBrush.AVAILABLE) {
            i++
            continue
        }
        var j = i
        while (j + 1 < cells.size && cells[j + 1].brush == brush) j++
        runs += PrefBlockRun(brush, i, j - i + 1, prefRangeLabel(blocks, i, j, zone))
        i = j + 1
    }
    val summary =
        PrefDaySummary(
            preferred = cells.count { it.brush == PrefBrush.PREFERRED },
            available = cells.count { it.brush == PrefBrush.AVAILABLE },
            cannot = cells.count { it.brush == PrefBrush.CANNOT },
        )
    return PrefDayView(
        dayIndex = selectedDayIndex,
        title = title,
        cells = cells,
        hourMarks = hourMarks,
        runs = runs,
        summary = summary,
    )
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

fun buildPreferenceBanner(
    period: PreferencePeriod,
    isDirty: Boolean = false,
): PreferenceBanner =
    // Copy is kept SHORT and the deadline is intentionally omitted from every body — the UI
    // renders the deadline as a separate chip (PreferencesUiState.deadlineChip), so repeating
    // it here would just be the verbose duplication the compact card is meant to remove.
    when {
        // Deadline passed → the window is closed for everyone (the only read-only state).
        period.deadlinePassed && period.submitted ->
            PreferenceBanner(
                tone = PrefBannerTone.SUCCESS,
                title = "Submitted",
                body = "The window has closed. Your manager builds from these.",
            )
        // D9 (§4.2): never submitted AND the window closed — the RPC would reject a
        // late write (preference_deadline_is_open), so the UI locks instead of
        // silently failing.
        period.deadlinePassed ->
            PreferenceBanner(
                tone = PrefBannerTone.INFO,
                title = "Preferences locked",
                body = "The submission window has closed.",
            )
        // Submitted but still editable: dirty → nudge to re-submit (or lose the edits);
        // clean → reassure they can keep editing until the deadline.
        period.submitted && isDirty ->
            PreferenceBanner(
                tone = PrefBannerTone.INFO,
                title = "Unsaved changes",
                body = "Save again before the deadline.",
            )
        period.submitted ->
            PreferenceBanner(
                tone = PrefBannerTone.SUCCESS,
                title = "Submitted",
                body = "You can still edit until the deadline.",
            )
        // Open + dirty (never submitted) → same lose-your-edits nudge.
        isDirty ->
            PreferenceBanner(
                tone = PrefBannerTone.INFO,
                title = "Unsaved changes",
                body = "Submit before the deadline.",
            )
        else ->
            PreferenceBanner(
                tone = PrefBannerTone.INFO,
                title = "Not submitted yet",
                body = "Submit before the deadline.",
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
