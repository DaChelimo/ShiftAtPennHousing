package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatDayLabel
import com.pennhousing.shift.shared.shifts.formatDuration
import com.pennhousing.shift.shared.shifts.formatTimeRange
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * Swaps tab (DESIGN docs/swaps-enhancement/DESIGN.md §6) — PURE presentation for the
 * Incoming / Outgoing review surface. Each row leads with the DECISION-CRITICAL facts:
 * the hours you give, the hours you get (durations computed for the worker — no
 * "8pm→12am = 4h" mental math), and a live countdown to the deadline. The swap type +
 * "request" wording shrink to a chip. Built from the enriched `worker_pending_swaps`
 * read model ([PendingSwap]), so every row carries both spans. No I/O, no clock — `now`
 * is injected (the screen's load instant).
 */

/**
 * One side of a swap. [timeRange] is the HERO (the worker decides on WHEN, since swapped
 * hours are usually equal); [dayLabel] is context; [hours] is the small computed chip.
 * [timeRange]/[dayLabel] are null only for a just-proposed leg whose time isn't known yet.
 */
data class SwapSide(
    val timeRange: String?, // "08:00 - 12:00" — the prominent slot
    val dayLabel: String?, // "Sat · Jun 20" — context (rendered prominently, never squint-small)
    val hours: String, // "4h" / "2h 30m" — computed so the worker never does the math
    /**
     * The desk this side is PHYSICALLY worked at — the float destination when the shift was
     * floated, not the home house. Decision-critical on the "you get" side: accepting must
     * never silently relocate the worker. Null when the time isn't resolved yet.
     */
    val houseName: String? = null,
)

/** A fully-formatted Swaps-tab row — the UI renders it verbatim. */
data class SwapRow(
    val swapId: String,
    val typeLabel: String, // "Shift swap" — small chip
    val counterpartyName: String, // "Ben Carter"
    val incoming: Boolean,
    /** Who-acts-next label: "Needs your response" (incoming) / "Waiting on Ben" (outgoing). */
    val directionLabel: String,
    /** Accept is offered (incoming only — every type is acceptable from the phone now). */
    val acceptable: Boolean,
    /** The shift you'd give up — null when you give nothing back (a hand-off to you). */
    val give: SwapSide?,
    /** The shift you'd gain — null when you get nothing (you hand yours off / they take it). */
    val get: SwapSide?,
    /** "Expires in 5h" / "Expires in 2d" / "Expired" — the prominent countdown. */
    val deadline: String,
    /** True when the deadline is under 6h — the UI tints it for urgency. */
    val deadlineUrgent: Boolean,
    /** The request's deadline — the sort key ("closest about to begin first"). */
    val expiresAt: Instant,
    /** Co-created outgoing legs grouped under one client-side key (cosmetic). */
    val groupId: String? = null,
    /** Number of legs in this row's group (1 = standalone). */
    val groupSize: Int = 1,
)

/** The Swaps tab's three lists — All (both, merged), Incoming, Outgoing. */
data class SwapsFeed(
    val all: List<SwapRow>,
    val incoming: List<SwapRow>,
    val outgoing: List<SwapRow>,
) {
    val allCount: Int get() = all.size
    val incomingCount: Int get() = incoming.size
    val outgoingCount: Int get() = outgoing.size
    val isEmpty: Boolean get() = all.isEmpty()
}

private fun swapTypeLabel(swapType: String): String =
    when (swapType.lowercase()) {
        "shift_swap" -> "Shift swap"
        "float_swap" -> "Float swap"
        "permanent_swap" -> "Permanent swap"
        "handoff" -> "Hand-off"
        else -> "Swap"
    }

/** 30-min [blocks] → "4h" / "2h 30m" — when only the block count is known (optimistic add). */
private fun hoursFromBlocks(blocks: Int): String {
    val mins = blocks * 30
    val h = mins / 60
    val m = mins % 60
    return when {
        h > 0 && m > 0 -> "${h}h ${m}m"
        h > 0 -> "${h}h"
        else -> "${m}m"
    }
}

/** A swap span → a [SwapSide] (duration + day/time); null when the span is empty. */
private fun sideOf(
    start: Instant?,
    end: Instant?,
    blocks: Int,
    houseName: String?,
    zone: TimeZone,
): SwapSide? =
    when {
        blocks == 0 -> null
        start != null && end != null ->
            SwapSide(
                timeRange = formatTimeRange(start, end, zone),
                dayLabel = formatDayLabel(start, zone),
                hours = formatDuration(start, end),
                houseName = houseName,
            )
        // Hours known but the time isn't (a just-proposed leg) — fills in on the live refetch.
        else -> SwapSide(timeRange = null, dayLabel = null, hours = hoursFromBlocks(blocks), houseName = houseName)
    }

/** A humanized countdown to [at] from [now] — "Expires in 5h" / "Expires in 2d 3h" / "Expired". */
private fun deadlineLabel(
    now: Instant,
    at: Instant,
): String {
    val mins = (at - now).inWholeMinutes
    if (mins <= 0) return "Expired"
    val days = mins / (60 * 24)
    val hours = (mins % (60 * 24)) / 60
    val onlyMins = mins % 60
    val span =
        when {
            days > 0 && hours > 0 -> "${days}d ${hours}h"
            days > 0 -> "${days}d"
            hours > 0 && onlyMins > 0 -> "${hours}h ${onlyMins}m"
            hours > 0 -> "${hours}h"
            else -> "${onlyMins}m"
        }
    return "Expires in $span"
}

/**
 * The cosmetic grouping key for co-created outgoing legs: the create minute + type. A
 * multi-party compose fires its legs within the same second, so they bucket together;
 * the server stamps no correlation id by design (a false merge only changes a header).
 */
private fun bucketKey(swap: PendingSwap): String = "${swap.createdAt.epochSeconds / 60}-${swap.swapType.lowercase()}"

private fun rowOf(
    swap: PendingSwap,
    now: Instant,
    zone: TimeZone,
    groupId: String?,
    groupSize: Int,
): SwapRow {
    val outgoing = swap.direction == SwapDirection.OUTGOING
    // The worker's OWN shift is the initiator side when outgoing, the counterparty side when
    // incoming; the shift they'd RECEIVE is the opposite side. So "give"/"get" flip by direction.
    val mySide = sideOf(swap.initiatorStart, swap.initiatorEnd, swap.initiatorBlocks, swap.initiatorHouseName, zone)
    val theirSide = sideOf(swap.counterpartyStart, swap.counterpartyEnd, swap.counterpartyBlocks, swap.counterpartyHouseName, zone)
    return SwapRow(
        swapId = swap.swapId,
        typeLabel = swapTypeLabel(swap.swapType),
        counterpartyName = swap.otherUserName,
        incoming = !outgoing,
        // Frame by who has the next move — clearer than "incoming/outgoing" in the merged list.
        directionLabel = if (outgoing) "Waiting on ${swap.otherUserName}" else "Needs your response",
        acceptable = !outgoing,
        give = if (outgoing) mySide else theirSide,
        get = if (outgoing) theirSide else mySide,
        deadline = deadlineLabel(now, swap.expiresAt),
        deadlineUrgent = (swap.expiresAt - now).inWholeMinutes in 1..(6 * 60),
        expiresAt = swap.expiresAt,
        groupId = groupId,
        groupSize = groupSize,
    )
}

/**
 * Build the Swaps tab's All / Incoming / Outgoing lists from the worker's pending swaps
 * (both directions). Every list is sorted by the request deadline ASCENDING — soonest to
 * expire first. Co-created outgoing legs stay adjacent so a "Proposed together" header
 * renders once.
 */
fun buildSwapsFeed(
    pendingSwaps: List<PendingSwap>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): SwapsFeed {
    val incomingRows =
        pendingSwaps
            .filter { it.direction == SwapDirection.INCOMING }
            .sortedBy { it.expiresAt }
            .map { rowOf(it, now, zone, groupId = null, groupSize = 1) }

    val outgoing = pendingSwaps.filter { it.direction == SwapDirection.OUTGOING }
    val bucketSizes = outgoing.groupingBy { bucketKey(it) }.eachCount()
    val outgoingRows =
        outgoing
            .sortedWith(compareBy<PendingSwap> { it.expiresAt }.thenBy { bucketKey(it) }.thenBy { it.swapId })
            .map { swap ->
                val key = bucketKey(swap)
                val size = bucketSizes[key] ?: 1
                val grouped = size >= 2
                rowOf(swap, now, zone, groupId = if (grouped) key else null, groupSize = if (grouped) size else 1)
            }

    val allRows =
        (incomingRows + outgoingRows)
            .sortedWith(compareBy<SwapRow> { it.expiresAt }.thenBy { it.groupId ?: "" }.thenBy { it.swapId })

    return SwapsFeed(all = allRows, incoming = incomingRows, outgoing = outgoingRows)
}
