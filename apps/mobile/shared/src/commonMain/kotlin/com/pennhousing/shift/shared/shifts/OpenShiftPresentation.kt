package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/*
 * Open Shifts (§5.6 Tab 2 / Tab 3 / §5.1 / §5.3 / §5.4) — PURE presentation logic
 * shared by both platforms, the open-shifts analogue of [MyShiftPresentation]. The
 * Compose/SwiftUI feed cards and the claim sheet render these row models verbatim,
 * so the (DST-correct, NY-anchored) formatting + the OPEN/UNPICKABLE/PERMANENT
 * mapping are tested once. No I/O, no system clock — claimability is decided by the
 * caller (the ViewModel's `claimable`, itself anchored to an injected `now`).
 */

/** The visual treatment an open-shift card renders — a subset of the full state legend. */
enum class OpenShiftCardState {
    /** A weekly one-time gap, still claimable (before its T-2h cutoff). */
    OPEN,

    /** A weekly gap past its T-2h cutoff (§5.4): visible, but no claim action. */
    UNPICKABLE,

    /** A recurring slot whose owner permanently dropped it (§5.1): pick up. */
    PERMANENT,
}

/**
 * §5.1 / §5.4: a permanent opening always renders PERMANENT (a pick-up, not subject
 * to the per-occurrence T-2h lock); a weekly gap renders UNPICKABLE once it is no
 * longer [claimable] (visible but locked), otherwise OPEN. Single source of truth
 * for both [openShiftCardState] and [toRow].
 */
fun resolveOpenState(
    feed: OpenFeed,
    claimable: Boolean,
): OpenShiftCardState =
    when {
        feed == OpenFeed.PERMANENT_OPENING -> OpenShiftCardState.PERMANENT
        !claimable -> OpenShiftCardState.UNPICKABLE
        else -> OpenShiftCardState.OPEN
    }

/** Card state for a shift at an injected [now] — the T-2h cutoff runs through [isClaimable]. */
fun openShiftCardState(
    shift: OpenShift,
    now: Instant,
): OpenShiftCardState = resolveOpenState(shift.feed, isClaimable(shift, now))

/** "Every Wed" — the recurring day-of-week label for a permanent opening (derived from its start). */
fun formatRecurringDayLabel(
    instant: Instant,
    zone: TimeZone = NEW_YORK,
): String = "Every " + DOW_SHORT[instant.toLocalDateTime(zone).dayOfWeek.ordinal]

/**
 * A fully-formatted open-shift card row — the feed renders this verbatim. [actionLabel]
 * is the trailing button ("Claim" / "Pick up"); null for an unpickable card. [meta] is
 * the bottom note ("6 weeks remaining" / the locked reason); [dayLabel] is the eyebrow.
 */
data class OpenShiftRow(
    val id: String,
    val state: OpenShiftCardState,
    val houseInitial: String,
    val houseName: String,
    val timeLabel: String,
    val dayLabel: String,
    val durationLabel: String,
    val meta: String?,
    val actionLabel: String?,
    // How many identical concurrent openings this card stands for (multi-staff houses).
    val count: Int = 1,
    // "2 open" badge text when [count] > 1, else null (a single opening shows no badge).
    val countLabel: String? = null,
    // A claim on this card is in flight (shifts/PendingWrites.kt). The card renders as
    // "claiming", its action is suppressed, and it holds its FULL span while the
    // per-block writes land. [busyLabel] / [busyNote] carry the copy.
    val busy: Boolean = false,
    val busyLabel: String? = null,
    val busyNote: String? = null,
)

/**
 * Map an [OpenShift] to its card row given whether it is currently [claimable] (the
 * caller passes the ViewModel's verdict, so this stays clock-free). Permanent openings
 * show the recurring "Every {DOW}" eyebrow + weeks-remaining; an unpickable gap shows
 * the locked reason and offers no action.
 */
fun OpenShift.toRow(
    claimable: Boolean,
    zone: TimeZone = NEW_YORK,
): OpenShiftRow {
    val state = resolveOpenState(feed, claimable)
    val dayLabel =
        if (state == OpenShiftCardState.PERMANENT) formatRecurringDayLabel(start, zone) else formatDayLabel(start, zone)
    val meta =
        when (state) {
            OpenShiftCardState.PERMANENT -> weeksRemaining?.let { "$it weeks remaining" }
            OpenShiftCardState.UNPICKABLE -> "Locked (within 2h of start)"
            OpenShiftCardState.OPEN -> null
        }
    val actionLabel =
        when (state) {
            OpenShiftCardState.PERMANENT -> "Pick up"
            OpenShiftCardState.UNPICKABLE -> null
            OpenShiftCardState.OPEN -> "Claim"
        }
    return OpenShiftRow(
        id = id,
        state = state,
        houseInitial = house.name.take(1),
        houseName = house.name,
        timeLabel = formatTimeRange(start, end, zone),
        dayLabel = dayLabel,
        durationLabel = formatDuration(start, end),
        meta = meta,
        // A card whose claim is in flight offers no action: tapping again would fire a
        // second set of per-block writes for seats the first set may already hold.
        actionLabel = if (busyKind != null) null else actionLabel,
        count = count,
        countLabel = if (count > 1) "$count open" else null,
        busy = busyKind != null,
        busyLabel = busyKind?.let { pendingWriteLabel(it) },
        busyNote = busyKind?.let { pendingWriteNote(it) },
    )
}

/** The success toast shown after a WEEKLY open-shift claim commits. */
const val CLAIM_SUCCESS_TOAST: String = "Claimed. It's now in My Shifts"

/**
 * The success toast shown after a drop COMMITS. Past tense on purpose: it is shown only
 * once the Edge Function has answered, never when the worker taps (2026-07-28).
 */
const val DROP_SUCCESS_TOAST: String = "Dropped. The shift is open for someone else"

/**
 * The success toast after a PERMANENT pickup when the scope is unknown (the dry-run GET
 * failed, a sub-range pickup, or the demo path) — no X-of-Y breakdown to show.
 */
const val PICKUP_SUCCESS_TOAST_GENERIC: String = "Picked up. It's now in My Shifts"

/**
 * The success toast shown after a PERMANENT pickup commits: "Picked up X of Y weeks"
 * (+ " · K skipped" when the worker's hours-cap / existing shifts dropped some weeks).
 * [totalWeeks] is the recurring slot's pickable (non-break, in-semester) week count;
 * [weeksPickedUp] the weeks actually taken; [weeksSkipped] the rest. A permanent pickup
 * never includes break weeks (those route through break-claim), so Y is "all the shifts
 * for that slot" the worker could take — the toast tells them how many landed. When the
 * scope is unknown, use [PICKUP_SUCCESS_TOAST_GENERIC] instead.
 */
fun permanentPickupToast(
    weeksPickedUp: Int,
    totalWeeks: Int,
    weeksSkipped: Int,
): String {
    val unit = if (totalWeeks == 1) "week" else "weeks"
    val base = "Picked up $weeksPickedUp of $totalWeeks $unit"
    return if (weeksSkipped > 0) "$base · $weeksSkipped skipped" else base
}

/**
 * The "This brings your week to {after}h of {cap}h" meter shown in the claim sheet
 * (§5.3). Reuses [evaluateClaimCap] for the verdict, so the meter and the soft/hard
 * gating never diverge; the fractions drive the progress bar and clamp to [0,1].
 */
data class ClaimMeter(
    val afterLabel: String,
    val capLabel: String,
    val currentFraction: Double,
    val afterFraction: Double,
    val verdict: ClaimCapVerdict,
)

fun claimMeter(
    currentWeeklyHours: Double,
    addedHours: Double,
    breakProfile: Boolean,
): ClaimMeter {
    val cap = if (breakProfile) BREAK_HOURS_CAP else SOFT_HOURS_CAP
    val after = currentWeeklyHours + addedHours
    return ClaimMeter(
        afterLabel = formatHours(after),
        capLabel = formatHours(cap),
        currentFraction = (currentWeeklyHours / cap).coerceIn(0.0, 1.0),
        afterFraction = (after / cap).coerceIn(0.0, 1.0),
        verdict = evaluateClaimCap(currentWeeklyHours, addedHours, breakProfile),
    )
}
