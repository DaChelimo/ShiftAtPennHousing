package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * Pending-swap surfacing (worker-app) — PURE presentation over the `worker_pending_swaps`
 * read model. Drives two things the worker sees on My-Shifts:
 *  - an INDICATOR on a shift card that has a pending swap (a swap you proposed = outgoing,
 *    or one someone asked of you = incoming), via [PendingSwap.myAssignmentIds]; and
 *  - the accept/decline POPUP when an incoming-swap card is tapped, via [buildSwapDecision]
 *    (shows the hours on each side — what you give and what you get).
 * No I/O, no clock — labels are formatted from the spans the read model already resolved.
 */

/** A pending swap's direction relative to the viewing worker. */
enum class SwapDirection { INCOMING, OUTGOING }

/**
 * One pending swap involving the viewing worker, enriched with BOTH sides' span (start /
 * end / block count) and the other party's name — everything the My-Shifts indicator and
 * the decision popup need. The worker's OWN side (what sits on their calendar) is the
 * initiator side when [direction] is OUTGOING, the counterparty side when INCOMING.
 */
data class PendingSwap(
    val swapId: String,
    val swapType: String, // shift_swap | float_swap | permanent_swap | handoff
    val direction: SwapDirection,
    val otherUserName: String,
    val createdAt: Instant,
    val expiresAt: Instant,
    val initiatorAssignmentIds: List<String>,
    val counterpartyAssignmentIds: List<String>,
    val initiatorStart: Instant?,
    val initiatorEnd: Instant?,
    val initiatorBlocks: Int,
    /** The house the initiator side is PHYSICALLY worked at (the float destination, if floated). */
    val initiatorHouseName: String? = null,
    val counterpartyStart: Instant?,
    val counterpartyEnd: Instant?,
    val counterpartyBlocks: Int,
    /** The house the counterparty side is PHYSICALLY worked at (the float destination, if floated). */
    val counterpartyHouseName: String? = null,
) {
    /** The viewing worker's own assignment ids in this swap — the ones on their calendar. */
    val myAssignmentIds: List<String>
        get() = if (direction == SwapDirection.OUTGOING) initiatorAssignmentIds else counterpartyAssignmentIds
}

/**
 * The accept/decline popup for an INCOMING swap, fully resolved so the UI only lays out
 * strings. [giveLabel] is the shift you'd give up (your span), [getLabel] the shift you'd
 * gain (their span) — either is null when that side is empty (a one-sided hand-off), so a
 * hand-off shows only the relevant half. [permanent] rides a "rest of the term" note.
 */
data class SwapDecision(
    val swapId: String,
    val swapType: String,
    val typeLabel: String, // "Shift swap" / "Float swap" / "Permanent swap" / "Hand-off"
    val title: String, // "Swap request" / "Hand-off request"
    val intro: String, // "Ben wants to swap shifts with you."
    val respondBy: String, // "Respond by Mon, 18:30"
    val giveLabel: String?, // "Sat · Jun 20 · 14:00 - 18:00 · 4h" — null if you give nothing
    val giveHouse: String?, // "Harnwell" — the desk you'd give up (null if you give nothing)
    val getLabel: String?, // the shift you'd gain — null if you get nothing
    /**
     * The desk you'd actually WORK if you accept — the float destination when their shift was
     * floated, not their home house. Load-bearing: accepting must never silently relocate you.
     */
    val getHouse: String?, // "Harnwell" — null if you get nothing
    val permanent: Boolean,
    val note: String?, // hand-off / permanent context line
)

/**
 * The "this shift is waiting on a swap" notice for an OUTGOING swap (one the worker
 * proposed), opened by tapping the flagged My-Shifts card. While the swap is pending the
 * shift is tied up — it can't be dropped or swapped again — so instead of the drop sheet
 * (which the server would reject with a generic error) the worker sees this: the shift
 * itself (day, date, start-end, duration), a plain explanation, and two choices — CANCEL
 * the swap (void it, freeing the shift) or KEEP WAITING (just dismiss / minimise the card).
 * A one-sided hand-off reads "hand-off" instead of "swap".
 */
data class PendingSwapNotice(
    val swapId: String,
    val swapType: String,
    val typeLabel: String, // "Shift swap" / "Float swap" / "Permanent swap" / "Hand-off"
    val title: String, // "Swap pending" / "Hand-off pending"
    val houseName: String?, // "Harnwell" — the desk this shift is worked at (float destination, if floated)
    val dayLabel: String, // "Sat · Jun 20" — the shift's day-of-week + date
    val timeLabel: String, // "14:00 - 18:00" — start-end
    val durationLabel: String, // "4h"
    val body: String, // why it can't be dropped/swapped + the two options, in plain words
    val waitingOn: String, // "Waiting on Ben · expires Mon · Jun 22, 18:30"
    val cancelLabel: String, // "Cancel swap" / "Cancel hand-off"
    val keepWaitingLabel: String, // "Keep waiting"
)

/**
 * Resolve an OUTGOING [swap] to its "pending" notice. The shift shown is the worker's own
 * (initiator) side — the shift they offered, which is exactly the card they tapped. Pure
 * presentation; the cancel action is wired by the host (`void-swap`).
 */
fun buildPendingSwapNotice(
    swap: PendingSwap,
    zone: TimeZone = NEW_YORK,
): PendingSwapNotice {
    val handoff = swap.swapType.lowercase() == "handoff"
    val permanent = swap.swapType.lowercase() == "permanent_swap"
    val kindWord = if (handoff) "hand-off" else "swap"
    // The worker's own side of an OUTGOING swap is the initiator side (see PendingSwap.myAssignmentIds).
    val start = swap.initiatorStart
    val end = swap.initiatorEnd
    val offered = if (handoff) "You offered to hand this shift off." else "You proposed a swap for this shift."
    val permanentNote = if (permanent) " It applies every week for the rest of the term." else ""
    val body =
        "$offered It's waiting for ${swap.otherUserName} to respond, so it can't be dropped or " +
            "swapped again until the $kindWord is settled.$permanentNote Cancel the $kindWord to free " +
            "the shift, or keep waiting for a reply."
    return PendingSwapNotice(
        swapId = swap.swapId,
        swapType = swap.swapType,
        typeLabel = swapTypeLabelFor(swap.swapType),
        title = if (handoff) "Hand-off pending" else "Swap pending",
        houseName = swap.initiatorHouseName,
        dayLabel = start?.let { formatDayLabel(it, zone) } ?: "",
        timeLabel = if (start != null && end != null) formatTimeRange(start, end, zone) else "",
        durationLabel = if (start != null && end != null) formatDuration(start, end) else "",
        body = body,
        waitingOn = "Waiting on ${swap.otherUserName} · expires ${formatDayLabel(swap.expiresAt, zone)}, ${formatBlockTime(swap.expiresAt, zone)}",
        cancelLabel = if (handoff) "Cancel hand-off" else "Cancel swap",
        keepWaitingLabel = "Keep waiting",
    )
}

private fun swapTypeLabelFor(swapType: String): String =
    when (swapType.lowercase()) {
        "shift_swap" -> "Shift swap"
        "float_swap" -> "Float swap"
        "permanent_swap" -> "Permanent swap"
        "handoff" -> "Hand-off"
        else -> "Swap"
    }

private fun spanLabel(
    start: Instant?,
    end: Instant?,
    zone: TimeZone,
): String? =
    if (start == null || end == null) {
        null
    } else {
        "${formatDayLabel(start, zone)} · ${formatTimeRange(start, end, zone)} · ${formatDuration(start, end)}"
    }

/**
 * Resolve an INCOMING [swap] to its accept/decline popup model. "Give" is the worker's own
 * span (counterparty side), "get" is the proposer's span (initiator side); a one-sided
 * hand-off leaves one of them null so only the real half shows.
 */
fun buildSwapDecision(
    swap: PendingSwap,
    zone: TimeZone = NEW_YORK,
): SwapDecision {
    val handoff = swap.swapType.lowercase() == "handoff"
    val permanent = swap.swapType.lowercase() == "permanent_swap"
    val giveLabel = spanLabel(swap.counterpartyStart, swap.counterpartyEnd, zone).takeIf { swap.counterpartyBlocks > 0 }
    val getLabel = spanLabel(swap.initiatorStart, swap.initiatorEnd, zone).takeIf { swap.initiatorBlocks > 0 }
    val intro =
        when {
            handoff && giveLabel == null -> "${swap.otherUserName} wants to hand a shift to you."
            handoff -> "${swap.otherUserName} wants to take your shift."
            permanent -> "${swap.otherUserName} wants to swap permanently."
            else -> "${swap.otherUserName} wants to swap shifts with you."
        }
    val note =
        when {
            handoff && giveLabel == null -> "They give nothing in return."
            handoff -> "You'd hand this over with nothing back."
            permanent -> "Applies to this shift every week for the rest of the term."
            else -> null
        }
    return SwapDecision(
        swapId = swap.swapId,
        swapType = swap.swapType,
        typeLabel = swapTypeLabelFor(swap.swapType),
        title = if (handoff) "Hand-off request" else "Swap request",
        intro = intro,
        respondBy = "Respond by ${formatDayLabel(swap.expiresAt, zone)}, ${formatBlockTime(swap.expiresAt, zone)}",
        giveLabel = giveLabel,
        giveHouse = swap.counterpartyHouseName.takeIf { swap.counterpartyBlocks > 0 },
        getLabel = getLabel,
        getHouse = swap.initiatorHouseName.takeIf { swap.initiatorBlocks > 0 },
        permanent = permanent,
        note = note,
    )
}
