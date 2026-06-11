package com.pennhousing.shift.shared.breakclaim

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.shifts.BREAK_HOURS_CAP
import com.pennhousing.shift.shared.shifts.MONTH_SHORT
import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatHours
import com.pennhousing.shift.shared.shifts.formatTimeRange
import com.pennhousing.shift.shared.shifts.hoursBetween
import kotlinx.datetime.LocalDate
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
 *  - LIVE context (T2-2a): `break_periods` is now worker-readable (migration
 *    20260611000002), so the break NAME + window + the "only Harnwell open" eyebrow are
 *    derived from the active break row by [breakContextCopy] and bound on the live
 *    screen (the demo path still supplies its own copy, unchanged). "Only Harnwell open"
 *    is derivable: it is true exactly for `break_type = winter_break` (BSpec §3.3/§4.4 —
 *    only Harnwell operates in winter); short breaks run at the worker's home house, so
 *    that line is omitted for them rather than fabricated.
 *  - REMAINING GAPs (flagged, not invented): (1) the claimable POOL itself is still
 *    demo-backed — surfacing live `worker_open_shifts` break rows is a larger wiring
 *    (deferred). (2) The "drop until T-1d" cutoff is NOT enforced in the backend, so it
 *    is descriptive meta only — the Drop action is never gated on it here (→ T2-2c).
 *  - 40h is a HARD cap (`break_type` winter/short break → hard) — reuses [BREAK_HOURS_CAP].
 *    The Claim action is BLOCKED in the UI when the worker is at the cap (the server is
 *    still authoritative — `break-claim` returns `hard_cap_exceeded`; the block is a
 *    pre-check that matches the regular-shift claim meter's hard-cap behavior).
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

/**
 * The three descriptive copy fields of a [BreakClaimSnapshot] — derived LIVE from the
 * worker-readable `break_periods` row (migration 20260611000002) by [breakContextCopy].
 */
data class BreakContextCopy(
    val profileContext: String,
    val infoTitle: String,
    val infoBody: String,
)

/**
 * Derive the live break-claim copy from the active break period.
 *
 * [breakName] / [breakType] / [startDate] / [endDate] come straight off the
 * worker-readable `break_periods` row. The "only Harnwell open" line is surfaced ONLY
 * for `winter_break` — per BSpec §3.3/§4.4 only Harnwell operates during winter break;
 * every other break runs at the worker's own home house, so the line is omitted rather
 * than fabricated. The window is rendered NY-anchored (invariant #6) as the inclusive
 * date range, e.g. "Dec 20 – Jan 4".
 */
fun breakContextCopy(
    breakName: String,
    breakType: String,
    startDate: LocalDate,
    endDate: LocalDate,
): BreakContextCopy {
    val isWinter = breakType.equals("winter_break", ignoreCase = true)
    val window = "${monthDay(startDate)} – ${monthDay(endDate)}"
    val title = if (isWinter) "$breakName — only Harnwell open" else breakName
    val body =
        buildString {
            append("First-come, first-served · 40h hard cap · ")
            append(window)
            append(" · drop back to the pool until T-1d.")
        }
    return BreakContextCopy(
        profileContext = "${breakName.uppercase()} · CLAIM-BASED",
        infoTitle = title,
        infoBody = body,
    )
}

/** "Dec 20" — NY-anchored month-day for the break window (the row is a plain calendar date). */
private fun monthDay(date: LocalDate): String = "${MONTH_SHORT[date.month.ordinal]} ${date.day}"

/**
 * Overlay live [context] onto a (demo) snapshot — replacing only the three descriptive
 * copy fields and keeping the (still demo-backed) pool + claimed set. The host calls
 * this when the live `break_periods` read resolves; both platforms share it so the
 * Android/iOS merge stays identical.
 */
fun BreakClaimSnapshot.withContext(context: BreakContextCopy): BreakClaimSnapshot =
    copy(
        profileContext = context.profileContext,
        infoTitle = context.infoTitle,
        infoBody = context.infoBody,
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

/** Copy for the at-40h-hard-cap claim block (shown disabled on unclaimed rows). */
const val BREAK_AT_CAP_LABEL = "Over the 40h limit — can't claim"

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
    // True only for an UNCLAIMED row while the worker is at the 40h HARD cap: the Claim
    // action must be disabled (server is still authoritative — `break-claim` returns
    // `hard_cap_exceeded`; this is the UI pre-check). A claimed row is never blocked
    // (dropping a claimed shift only reduces hours).
    val claimBlocked: Boolean = false,
)

/**
 * Map a [BreakShift] to its card row given whether it is currently mine and whether the
 * worker is [atCap] (40h hard cap reached). When [atCap] and the row is not yet mine,
 * the row is claim-blocked and shows the at-cap label instead of "Claim".
 */
fun BreakShift.toRow(
    claimedByMe: Boolean,
    atCap: Boolean = false,
    zone: TimeZone = NEW_YORK,
): BreakShiftRow {
    val blocked = atCap && !claimedByMe
    return BreakShiftRow(
        id = id,
        houseInitial = house.name.take(1),
        houseName = house.name,
        timeLabel = formatTimeRange(start, end, zone),
        durationLabel = formatDuration(start, end),
        claimedByMe = claimedByMe,
        actionLabel =
            when {
                claimedByMe -> "Drop"
                blocked -> BREAK_AT_CAP_LABEL
                else -> "Claim"
            },
        // T-1d cutoff is descriptive only — the backend does not enforce it (GAP).
        meta = if (claimedByMe) "Claimed by you · drop until T-1d" else null,
        claimBlocked = blocked,
    )
}

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
    val meter = buildBreakHoursMeter(claimedHours, cap)
    return BreakClaimList(
        rows = sorted.map { it.toRow(claimedByMe = it.id in claimedIds, atCap = meter.atCap, zone = zone) },
        claimedHours = claimedHours,
        meter = meter,
    )
}
