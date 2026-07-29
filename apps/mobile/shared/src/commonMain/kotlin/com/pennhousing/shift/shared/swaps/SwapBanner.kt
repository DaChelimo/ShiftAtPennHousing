package com.pennhousing.shift.shared.swaps

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.formatBlockTime
import com.pennhousing.shift.shared.shifts.formatDayLabel
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/*
 * The My-Shifts swap banner (BSpec §10.1) — PURE presentation over the same
 * `worker_pending_swaps` rows the card marks use.
 *
 * WHY (2026-07-28). A pending swap was only ever visible as a TINT on the affected
 * shift card. That fails in the two cases that matter most:
 *
 *   - INCOMING. A swap request needs an answer before it expires, and the only place
 *     it showed was a coloured card somewhere in the week, on whatever day the shift
 *     happens to fall. A worker opening the app has no reason to scroll to next
 *     Saturday, so requests sat unanswered until they lapsed.
 *   - OUTGOING. "I proposed a swap and I am waiting on Ben" had no representation on
 *     the home screen at all unless the worker happened to look at that exact card.
 *
 * Both states now surface at the TOP of My Shifts, always, for as long as they are
 * pending. Incoming is actionable and ranks first; outgoing is informational. This is
 * a status banner, not a notification: it is derived from live state, so it cannot go
 * stale, and it disappears by itself the moment the swap resolves.
 */

/** Which side of the exchange the viewing worker is on. Drives tone and the action. */
enum class SwapBannerTone {
    /** Someone is waiting on THIS worker. Actionable, ranked first. */
    AWAITING_YOU,

    /** THIS worker is waiting on someone else. Informational. */
    AWAITING_THEM,
}

/**
 * One line of the banner. [swapId] identifies the swap to open on tap: an
 * [SwapBannerTone.AWAITING_YOU] row opens the accept/decline decision, an
 * [SwapBannerTone.AWAITING_THEM] row opens the "cancel or keep waiting" notice, which
 * is exactly what the tinted cards already do.
 */
data class SwapBannerEntry(
    val swapId: String,
    val tone: SwapBannerTone,
    val title: String,
    val detail: String,
    val actionLabel: String,
)

/**
 * The whole banner. [entries] is ordered incoming-first, then by soonest deadline, so
 * the thing that expires next is the thing on top.
 */
data class SwapBanner(
    val entries: List<SwapBannerEntry>,
) {
    val isEmpty: Boolean get() = entries.isEmpty()

    /** How many swaps are waiting on this worker. Drives the Swaps-tab badge count. */
    val awaitingYouCount: Int get() = entries.count { it.tone == SwapBannerTone.AWAITING_YOU }
}

private fun kindWord(swapType: String): String = if (swapType.lowercase() == "handoff") "hand-off" else "swap"

private fun deadline(
    at: Instant,
    zone: TimeZone,
): String = "${formatDayLabel(at, zone)}, ${formatBlockTime(at, zone)}"

/**
 * Build the banner from the worker's pending swaps (both directions). Pure; [now] is
 * the screen's load instant and is used only for ordering, never to hide a swap. An
 * already-expired row is still shown until the server clears it, because the worker
 * seeing "this expired" is better than a request silently vanishing.
 */
fun buildSwapBanner(
    swaps: List<PendingSwap>,
    now: Instant,
    zone: TimeZone = NEW_YORK,
): SwapBanner {
    val entries =
        swaps
            .sortedWith(
                // Incoming before outgoing, then soonest deadline, then a stable id.
                compareBy<PendingSwap> { it.direction != SwapDirection.INCOMING }
                    .thenBy { it.expiresAt }
                    .thenBy { it.swapId },
            )
            .map { swap ->
                val word = kindWord(swap.swapType)
                // The expiry cron and the server are authoritative, and both run behind
                // the clock the worker is holding. A row whose deadline has passed but
                // which the server has not swept yet says so, instead of showing a
                // deadline in the past as though it were still answerable.
                val lapsed = swap.expiresAt <= now
                if (swap.direction == SwapDirection.INCOMING) {
                    SwapBannerEntry(
                        swapId = swap.swapId,
                        tone = SwapBannerTone.AWAITING_YOU,
                        title = "${swap.otherUserName} is waiting on your answer",
                        detail =
                            if (lapsed) {
                                "Their $word request has run out of time. Nothing will change."
                            } else {
                                "Respond to their $word by ${deadline(swap.expiresAt, zone)}."
                            },
                        actionLabel = "Review",
                    )
                } else {
                    SwapBannerEntry(
                        swapId = swap.swapId,
                        tone = SwapBannerTone.AWAITING_THEM,
                        title = "Waiting on ${swap.otherUserName}",
                        detail =
                            if (lapsed) {
                                "Your $word request has run out of time. Your shift stays yours."
                            } else {
                                "Your $word request expires ${deadline(swap.expiresAt, zone)} if they do not answer."
                            },
                        actionLabel = "View",
                    )
                }
            }
    return SwapBanner(entries)
}
