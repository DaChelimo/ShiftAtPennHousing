package com.pennhousing.shift.shared.breakclaim

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.shifts.BREAK_HOURS_CAP
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatHours
import com.pennhousing.shift.shared.shifts.formatTimeRange
import com.pennhousing.shift.shared.shifts.hoursBetween
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * Break claim picker (Phase 11) — PURE presentation logic shared by both platforms.
 * During a break period only some desks are open (e.g. Winter Break → Harnwell only);
 * a worker sees the claimable break shifts, claims one first-come-first-served, watches
 * a 40-hour HARD-cap meter, and can drop a claimed shift back to the pool. No I/O, no
 * system clock — the snapshot is injected and the claimed set is the only mutable state.
 *
 * DATA AVAILABILITY (this is a NEW screen — checked before building):
 *  - Claimable break shifts surface through `worker_open_shifts` while the break is in
 *    its `open_feed` phase (the view excludes break dates outside that window); a
 *    worker's already-claimed break shifts come from `worker_my_shifts` (its
 *    `break_shift` flag) — both worker-readable. So the list + the live week-hours
 *    meter bind to REAL data.
 *  - Claiming calls the `break-claim` Edge Function (its response also carries
 *    current/projected hours); dropping reuses the generic `drop-shift` EF (there is
 *    no break-specific drop RPC — confirmed). Those writes are the data-layer concern,
 *    kept optimistic-local here exactly as the Shifts screen's claim/drop are.
 *  - GAPs (flagged, not invented): (1) `break_periods` has no authenticated SELECT, so
 *    the break NAME / "only Harnwell open" copy is caller-supplied (the demo provides
 *    it). (2) The "drop until T-1d" cutoff is NOT enforced anywhere in the backend, so
 *    it is shown as descriptive meta only — the Drop action is never gated on it here.
 *  - 40h is a HARD cap (`break_type` winter/short break → hard) — reuses [BREAK_HOURS_CAP].
 */

/** A single claimable break shift (a vacant `worker_open_shifts` row in a break window). */
data class BreakShift(
    val id: String,
    val house: House,
    val start: Instant,
    val end: Instant,
)

/**
 * The break-claim snapshot. [shifts] is the whole break pool (claimable + already
 * mine); [initiallyClaimedIds] are the ones already mine (from `worker_my_shifts`).
 * [infoTitle]/[infoBody]/[profileContext] are the descriptive break copy (see GAP).
 */
data class BreakClaimSnapshot(
    val profileContext: String,
    val infoTitle: String,
    val infoBody: String,
    val shifts: List<BreakShift>,
    val initiallyClaimedIds: Set<String> = emptySet(),
)

/** The "This week — Xh / 40h" hard-cap meter atop the picker. */
data class BreakHoursMeter(
    val currentLabel: String,
    val capLabel: String,
    val fraction: Double,
    val atCap: Boolean,
)

fun buildBreakHoursMeter(
    claimedHours: Double,
    cap: Double = BREAK_HOURS_CAP,
): BreakHoursMeter =
    BreakHoursMeter(
        currentLabel = formatHours(claimedHours),
        capLabel = formatHours(cap),
        fraction = (claimedHours / cap).coerceIn(0.0, 1.0),
        atCap = claimedHours >= cap,
    )

/** A fully-formatted break-shift card row — the feed renders this verbatim. */
data class BreakShiftRow(
    val id: String,
    val houseInitial: String,
    val houseName: String,
    val timeLabel: String,
    val durationLabel: String,
    val claimedByMe: Boolean,
    val actionLabel: String,
    val meta: String?,
)

/** Map a [BreakShift] to its card row given whether it is currently mine. */
fun BreakShift.toRow(
    claimedByMe: Boolean,
    zone: TimeZone = NEW_YORK,
): BreakShiftRow =
    BreakShiftRow(
        id = id,
        houseInitial = house.name.take(1),
        houseName = house.name,
        timeLabel = formatTimeRange(start, end, zone),
        durationLabel = formatDuration(start, end),
        claimedByMe = claimedByMe,
        actionLabel = if (claimedByMe) "Drop" else "Claim",
        // T-1d cutoff is descriptive only — the backend does not enforce it (GAP).
        meta = if (claimedByMe) "Claimed by you · drop until T-1d" else null,
    )

/** The rendered picker — the rows (sorted by start), the live hours + its meter. */
data class BreakClaimList(
    val rows: List<BreakShiftRow>,
    val claimedHours: Double,
    val meter: BreakHoursMeter,
) {
    val isEmpty: Boolean get() = rows.isEmpty()
}

/**
 * Build the picker for the current [claimedIds]: every pool shift as a row (Claim /
 * Drop), the summed hours of the claimed ones, and the 40h hard-cap meter over them.
 */
fun buildBreakClaimList(
    snapshot: BreakClaimSnapshot,
    claimedIds: Set<String>,
    cap: Double = BREAK_HOURS_CAP,
    zone: TimeZone = NEW_YORK,
): BreakClaimList {
    val sorted = snapshot.shifts.sortedBy { it.start }
    val claimedHours =
        sorted.filter { it.id in claimedIds }.sumOf { hoursBetween(it.start, it.end) }
    return BreakClaimList(
        rows = sorted.map { it.toRow(claimedByMe = it.id in claimedIds, zone = zone) },
        claimedHours = claimedHours,
        meter = buildBreakHoursMeter(claimedHours, cap),
    )
}
