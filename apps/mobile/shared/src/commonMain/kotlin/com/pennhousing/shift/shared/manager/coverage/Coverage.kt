package com.pennhousing.shift.shared.manager.coverage

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import kotlinx.datetime.TimeZone
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Instant

/*
 * Allied coverage-request lifecycle — PURE presentation + state logic for the manager
 * Coverage tab (BSpec §5.4a). No I/O, no system clock: `now` is injected, per the
 * phase-13a rule that tested logic never reads a clock.
 *
 * CROSS-PLATFORM PARITY. This is a KOTLIN MIRROR of `packages/core/src/coverage/index.ts`,
 * which drives the web Coverage page. The two must agree on state derivation, the
 * action-required rule, the sort order, the rung labels, the outcome labels and the
 * note requirement, or the same request reads differently on a manager's phone than on
 * their laptop. `CoverageTest` pins this copy against the TS one's behaviour. If you
 * change either, change both. This is the same class of hazard as
 * `house/WorkerColors.kt` vs `apps/web/lib/workerColor.ts`.
 *
 * THE CENTRAL RULE, restated from the TS module because it is easy to undo:
 *
 *     AN OPEN REQUEST NEVER AUTO-CLEARS.
 *
 * Once the coverage window passes without a close-out the request is `OVERDUE` and stays
 * on screen until a human records an outcome. `CLOSED` is reachable only through
 * `close_allied_coverage_request`. There is no discard.
 *
 *   AWAITING_ACK -> ACKNOWLEDGED -> CLOSED     (the healthy path)
 *   AWAITING_ACK -> OVERDUE                    (window passed, nobody acknowledged)
 *   ACKNOWLEDGED -> OVERDUE                    (acknowledged, window passed, not closed)
 *
 * A NOTE ON THE MERGED UI. The TS module's header warns that collapsing "acknowledge"
 * and "close out" into one control is what lost the audit trail in the predecessor
 * design. The mobile Respond sheet (docs/manager-app/SPEC.md §6.1) does present them as
 * one job to the manager, and that is a deliberate product decision, NOT a reversal of
 * that warning: the two STATES remain distinct here and in the database. What is merged
 * is the sequence of taps, not the record. Acknowledgement still happens the moment the
 * sheet opens (so the ladder stops immediately) and the outcome is still recorded
 * separately, because it is not known until the Allied call connects. Do not "simplify"
 * this by dropping ACKNOWLEDGED.
 */

/** Why the escalation chain ran out of internal options. `reason` on the request row. */
private val REASON_LABEL =
    mapOf(
        "float_no_acknowledgment" to "No floater found or the floater did not acknowledge in time.",
        "no_floater_found" to "No floater found in the eligible source houses.",
        "floater_declined" to "The assigned floater declined.",
        "escalation_chain" to "The desk will be empty and no one picked up the shift.",
    )

/** Human copy for a raw `reason`. Unknown values degrade to the de-underscored raw value. */
fun coverageReasonLabel(reason: String): String = REASON_LABEL[reason] ?: reason.replace('_', ' ')

/** The four ways a request may be closed (`allied_coverage_outcome`). */
enum class CoverageOutcome(val wire: String) {
    ALLIED_SECURED("allied_secured"),
    COVERED_INTERNALLY("covered_internally"),
    DESK_UNSTAFFED("desk_unstaffed"),
    NO_LONGER_NEEDED("no_longer_needed"),
    ;

    companion object {
        fun fromWire(wire: String?): CoverageOutcome? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * A note is mandatory when reporting that a desk went empty. Mirrors the RPC's
 * `note_required` guard so the sheet can disable the button before the round trip; the
 * RPC stays authoritative. An unexplained `desk_unstaffed` is the row nobody can act on
 * later.
 */
fun requiresCloseNote(outcome: CoverageOutcome): Boolean = outcome == CoverageOutcome.DESK_UNSTAFFED

/** Display copy for an outcome. No em/en dashes: this is surfaced text. */
fun outcomeLabel(outcome: CoverageOutcome): String =
    when (outcome) {
        CoverageOutcome.ALLIED_SECURED -> "Allied secured"
        CoverageOutcome.COVERED_INTERNALLY -> "Covered internally"
        CoverageOutcome.DESK_UNSTAFFED -> "Desk went unstaffed"
        CoverageOutcome.NO_LONGER_NEEDED -> "No longer needed"
    }

/** The three ladder rungs, plus the project-administrator terminal (BSpec §2.6). */
enum class CoverageRung(val wire: String) {
    RSM("rsm"),
    HM("hm"),
    HMOD("hmod"),
    ADMIN("admin"),
    ;

    /**
     * Nobody sits above the HMOD or the project administrator, so the request stays put
     * and keeps reminding. The UI says so explicitly rather than showing a countdown to
     * an escalation that will never happen.
     */
    val isTerminal: Boolean get() = this == HMOD || this == ADMIN

    companion object {
        /** Unknown rung values resolve to the terminal rung: never promise an escalation we cannot make. */
        fun fromWire(wire: String?): CoverageRung = entries.firstOrNull { it.wire == wire } ?: HMOD
    }
}

fun rungLabel(rung: CoverageRung): String =
    when (rung) {
        CoverageRung.RSM -> "Residential Services Manager"
        CoverageRung.HM -> "Housing Manager"
        CoverageRung.HMOD -> "Housing Manager on duty"
        CoverageRung.ADMIN -> "Project administrator"
    }

/** Where a request sits right now. */
enum class CoverageRequestState { AWAITING_ACK, ACKNOWLEDGED, OVERDUE, CLOSED }

/**
 * One `allied_coverage_requests` row, as the repository read it. Times are [Instant], so
 * ordering is real time-line ordering: the TS mirror has a comment warning that
 * offset-bearing ISO strings do not sort lexically, and parsing to [Instant] here is how
 * this copy avoids that trap entirely.
 */
data class CoverageRequest(
    val requestId: String,
    val houseId: String,
    val houseName: String,
    val windowStart: Instant,
    val windowEnd: Instant,
    val reason: String,
    val currentRung: CoverageRung,
    val rungFiredAt: Instant,
    val acknowledgedAt: Instant? = null,
    val closedAt: Instant? = null,
    val outcome: CoverageOutcome? = null,
    /** The desk phone for this house, when known. Shown on the Respond sheet's call action. */
    val deskPhone: String? = null,
)

/**
 * Where a request sits at [now].
 *
 * The ORDER OF THESE CHECKS IS LOAD-BEARING and matches the TS mirror: `CLOSED` wins over
 * everything (a closed request is finished even if its window is long past), and `OVERDUE`
 * wins over `ACKNOWLEDGED` (an acknowledged request whose window elapsed without a
 * close-out is exactly the case that must stay visible). Reordering these silently hides
 * missed coverage.
 */
fun coverageRequestState(
    request: CoverageRequest,
    now: Instant,
): CoverageRequestState =
    when {
        request.closedAt != null -> CoverageRequestState.CLOSED
        now >= request.windowEnd -> CoverageRequestState.OVERDUE
        request.acknowledgedAt != null -> CoverageRequestState.ACKNOWLEDGED
        else -> CoverageRequestState.AWAITING_ACK
    }

/**
 * Is this request still demanding someone's attention? Drives the app-wide banner and the
 * Coverage tab badge. An acknowledged request is deliberately NOT action-required:
 * somebody has said they are handling it, and the banner must stop nagging them.
 */
fun isActionRequired(
    request: CoverageRequest,
    now: Instant,
): Boolean =
    when (coverageRequestState(request, now)) {
        CoverageRequestState.AWAITING_ACK, CoverageRequestState.OVERDUE -> true
        else -> false
    }

/**
 * A missed-coverage INCIDENT: either a desk that went unstaffed, or a request nobody ever
 * closed. Both mean the process failed. The mobile app does not render the incident report
 * (SPEC §6.6 keeps it on web), but the predicate lives here so the card can mark itself.
 */
fun isMissedCoverageIncident(
    request: CoverageRequest,
    now: Instant,
): Boolean =
    if (request.closedAt != null) {
        request.outcome == CoverageOutcome.DESK_UNSTAFFED
    } else {
        coverageRequestState(request, now) == CoverageRequestState.OVERDUE
    }

/**
 * When the current rung escalates, given the configured timeout. Null once the request is
 * acknowledged or closed (the ladder has stopped) or on a terminal rung (nobody above).
 */
fun rungDeadline(
    request: CoverageRequest,
    timeoutMinutes: Int,
): Instant? {
    if (request.acknowledgedAt != null || request.closedAt != null) return null
    if (request.currentRung.isTerminal) return null
    return request.rungFiredAt + timeoutMinutes.minutes
}

/**
 * "Escalates in 12m" / "Escalating now" / "No further escalation" — the live countdown on
 * the card. Null when the ladder has stopped because someone acknowledged.
 */
fun rungCountdownLabel(
    request: CoverageRequest,
    timeoutMinutes: Int,
    now: Instant,
): String? {
    if (request.acknowledgedAt != null || request.closedAt != null) return null
    if (request.currentRung.isTerminal) return "No further escalation"
    val deadline = rungDeadline(request, timeoutMinutes) ?: return null
    if (now >= deadline) return "Escalating now"
    val left = deadline - now
    val h = left.inWholeMinutes / 60
    val m = left.inWholeMinutes % 60
    return if (h > 0) "Escalates in ${h}h ${m}m" else "Escalates in ${m}m"
}

/**
 * "Wed, 22:00 to 00:00" — the TRUE coverage window, from the request row's own
 * `window_start_at` / `window_end_at`.
 *
 * Never reconstruct this as start + 30 minutes. Migration 20260729000010's header records
 * that exact regression: a dropped `block_end_at` payload key made every Allied alert
 * render as a 30-minute window and archive up to 3.5 hours early on a 4-hour gap. The
 * window lives on the request row precisely so it cannot silently fall back again.
 */
fun coverageWindowLabel(
    request: CoverageRequest,
    zone: TimeZone = NEW_YORK,
): String =
    "${formatDayLabel(request.windowStart, zone)}, " +
        "${formatBlockTime(request.windowStart, zone)} to ${formatBlockTime(request.windowEnd, zone)}"

/** Whole hours of desk time at stake, for the card's "4h" chip. */
fun coverageWindowHours(request: CoverageRequest): Double =
    (request.windowEnd - request.windowStart).inWholeMinutes / 60.0

/**
 * Sort key for the Coverage list: overdue first (most overdue at the top), then the
 * soonest window. A manager scanning this list needs the thing that has already gone
 * wrong before the thing that is about to.
 *
 * The TS mirror subtracts `Number.MAX_SAFE_INTEGER` to force overdue rows ahead. This copy
 * returns a (bucket, key) pair instead, which is the same ordering without relying on a
 * sentinel that could collide at extreme timestamps.
 */
fun coverageSortKey(
    request: CoverageRequest,
    now: Instant,
): Pair<Int, Long> {
    val overdue = coverageRequestState(request, now) == CoverageRequestState.OVERDUE
    return if (overdue) {
        0 to request.windowEnd.toEpochMilliseconds()
    } else {
        1 to request.windowStart.toEpochMilliseconds()
    }
}

/** A fully-formatted Coverage card. The UI renders this directly and decides nothing. */
data class CoverageCard(
    val requestId: String,
    val houseId: String,
    val houseName: String,
    val windowLabel: String,
    val hoursLabel: String,
    val reasonLabel: String,
    val state: CoverageRequestState,
    /** "Housing Manager on duty" — who holds it now. */
    val rungLabel: String,
    /** "Escalates in 12m" / "No further escalation"; null once acknowledged. */
    val countdownLabel: String?,
    /** True on the terminal rung: the UI says nobody is coming after this. */
    val isTerminalRung: Boolean,
    val isActionRequired: Boolean,
    val isMissedCoverageIncident: Boolean,
    val deskPhone: String? = null,
    /** Set once closed, for the brief confirmation the card shows before it leaves the list. */
    val outcomeLabel: String? = null,
)

fun CoverageRequest.toCard(
    timeoutMinutes: Int,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): CoverageCard {
    return CoverageCard(
        requestId = requestId,
        houseId = houseId,
        houseName = houseName,
        windowLabel = coverageWindowLabel(this, zone),
        // "4h" / "2h 30m" — the same duration formatter every other shift surface uses.
        hoursLabel = formatDuration(windowStart, windowEnd),
        reasonLabel = coverageReasonLabel(reason),
        state = coverageRequestState(this, now),
        rungLabel = rungLabel(currentRung),
        countdownLabel = rungCountdownLabel(this, timeoutMinutes, now),
        isTerminalRung = currentRung.isTerminal,
        isActionRequired = isActionRequired(this, now),
        isMissedCoverageIncident = isMissedCoverageIncident(this, now),
        deskPhone = deskPhone,
        outcomeLabel = outcome?.let { outcomeLabel(it) },
    )
}

/**
 * The Coverage tab's whole render state.
 *
 * Closed requests are absent by design (SPEC §6.1): the retrospective incident report
 * lives on web. [actionRequiredCount] is what the tab badge and the persistent banner
 * read; [openCount] includes acknowledged-but-not-closed requests, which still need a
 * human to record an outcome.
 */
data class CoverageFeed(
    val cards: List<CoverageCard>,
    val actionRequiredCount: Int,
    val openCount: Int,
) {
    val isEmpty: Boolean get() = cards.isEmpty()

    /**
     * Whether to show the non-dismissable app-wide banner: only for a request nobody has
     * picked up yet. Once acknowledged it downgrades to the tab badge, so a manager who
     * has said "I've got this" is not nagged on every screen while they are on the phone
     * to Allied.
     */
    val showsBanner: Boolean get() = actionRequiredCount > 0
}

/**
 * Build the Coverage feed: drop closed requests, order overdue-first then soonest-window,
 * and count what needs attention.
 */
fun buildCoverageFeed(
    requests: List<CoverageRequest>,
    timeoutMinutes: Int,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): CoverageFeed {
    val open = requests.filter { coverageRequestState(it, now) != CoverageRequestState.CLOSED }
    val ordered =
        open.sortedWith(
            compareBy({ coverageSortKey(it, now).first }, { coverageSortKey(it, now).second }),
        )
    return CoverageFeed(
        cards = ordered.map { it.toCard(timeoutMinutes, now, zone) },
        actionRequiredCount = open.count { isActionRequired(it, now) },
        openCount = open.size,
    )
}

/** The system default for `allied_ladder_rung_timeout_minutes` (migration 20260729000010). */
const val DEFAULT_RUNG_TIMEOUT_MINUTES: Int = 60
