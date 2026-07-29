package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingWriteKind

/*
 * In-flight seat writes (claim / drop / swap) — PURE, shared by both platforms.
 *
 * WHY THIS EXISTS (product decision 2026-07-28). Claim, drop and swap used to be
 * OPTIMISTIC: the ViewModel moved the card the instant the worker tapped, the host
 * fired the Edge Function best-effort, and a failure was walked back afterwards by
 * rebuilding from the last snapshot. Two things made that indefensible on a real
 * device:
 *
 *   1. It lied. "Picked up" appeared before anything had been written, so a worker on
 *      a flaky connection was told they held a shift they did not hold. The whole
 *      point of the app is that a worker knows, without checking with anyone, whether
 *      a desk is theirs.
 *   2. It visibly assembled. `claim-shift` is ONE POST PER 30-MINUTE BLOCK (invariant
 *      #5), and every landed block emits a Realtime event that refetches the week. So
 *      claiming 16:00-20:00 rendered as a card that grew 16:00-16:30, 16:00-17:00,
 *      16:00-17:30 ... underneath an already-shown success toast, which reads as a
 *      claim that is falling apart and invites a second tap.
 *
 * The replacement: the worker's tap registers a [PendingWrite], and the UI shows that
 * span in a "working on it" state at its FULL size until the server has answered for
 * every block. While a write is in flight this layer:
 *
 *   - HOLDS the claimed card whole (from [PendingWrite.card]) instead of letting the
 *     open feed shrink block by block, and
 *   - HIDES the half-written rows the read models are emitting meanwhile, so the
 *     worker never watches their own shift being built.
 *
 * Nothing here decides anything about eligibility, and nothing here is optimistic:
 * a pending write shows PROGRESS, never an outcome. The outcome comes from the next
 * server snapshot, after the host clears the write.
 *
 * No I/O and no clock — the host owns the lifecycle (begin before the request, end
 * after it settles); this file only projects a snapshot through the in-flight set.
 */

/**
 * One in-flight write. [blockIds] are the 30-minute assignment ids the request covers,
 * which is how a half-written read model is recognised and suppressed. [card] is set
 * for a [PendingWriteKind.CLAIM] and is the open-shift card the worker actually tapped,
 * kept so the feed can hold it at full span while its blocks are consumed one by one.
 *
 * [token] is the host's handle for ending the write; it is opaque here.
 */
data class PendingWrite(
    val token: String,
    val kind: PendingWriteKind,
    val blockIds: Set<String>,
    val card: OpenShift? = null,
)

/** Headline on an in-progress card. Present tense: it is happening, it has not happened. */
fun pendingWriteLabel(kind: PendingWriteKind): String =
    when (kind) {
        PendingWriteKind.CLAIM -> "Claiming this shift"
        PendingWriteKind.DROP -> "Dropping this shift"
        PendingWriteKind.SWAP -> "Sending your swap request"
    }

/**
 * Sub-line on an in-progress card. Says what is actually happening and what the worker
 * should do, which is nothing. No em/en dashes (surfaced copy).
 */
fun pendingWriteNote(kind: PendingWriteKind): String =
    when (kind) {
        PendingWriteKind.CLAIM -> "Confirming with the server. Do not tap again, we will show you when it is yours."
        PendingWriteKind.DROP -> "Confirming with the server. We will show you once the shift has been released."
        PendingWriteKind.SWAP -> "Confirming with the server. We will let you know once your housemate has it."
    }

/** Every block id currently tied up in a write of [kind]. */
private fun blocksFor(
    writes: List<PendingWrite>,
    kind: PendingWriteKind,
): Set<String> = writes.filter { it.kind == kind }.flatMapTo(mutableSetOf()) { it.blockIds }

/** Every block id currently tied up in ANY in-flight write. */
fun pendingBlockIds(writes: List<PendingWrite>): Set<String> =
    writes.flatMapTo(mutableSetOf()) { it.blockIds }

/**
 * Project the worker's held shifts through the in-flight set.
 *
 *  - A block being CLAIMED is hidden. The read model starts emitting it the moment its
 *    own POST commits, which is precisely the block-by-block assembly this replaces;
 *    the worker sees the single in-progress card instead until every block is in.
 *  - A block being DROPPED or SWAPPED stays exactly where it is, flagged [MyShift.busy]
 *    so the card renders as busy and refuses a second action. It is still the worker's
 *    shift until the server says otherwise, and pretending it is gone is the same lie
 *    in the opposite direction.
 */
fun pendingAwareMyShifts(
    shifts: List<MyShift>,
    writes: List<PendingWrite>,
): List<MyShift> {
    if (writes.isEmpty()) return shifts
    val claiming = blocksFor(writes, PendingWriteKind.CLAIM)
    val dropping = blocksFor(writes, PendingWriteKind.DROP)
    val swapping = blocksFor(writes, PendingWriteKind.SWAP)
    return shifts
        .filterNot { shift -> shift.blockIds.any { it in claiming } }
        .map { shift ->
            // A drop outranks a swap on the same seat: it is the more destructive of the
            // two and the one the worker most needs told about while it is happening.
            val kind =
                when {
                    shift.blockIds.any { it in dropping } -> PendingWriteKind.DROP
                    shift.blockIds.any { it in swapping } -> PendingWriteKind.SWAP
                    else -> null
                }
            if (kind == null) shift else shift.copy(busyKind = kind)
        }
}

/**
 * Project the open feed through the in-flight set.
 *
 *  - Real rows for blocks under ANY in-flight write are dropped. A claim consumes them
 *    one at a time (the shrinking card) and a drop produces them one at a time (a card
 *    that grows while the worker watches); both are half-written states.
 *  - Each CLAIM then re-inserts its own [PendingWrite.card] at full span, flagged
 *    [OpenShift.busy]. That card is what the worker tapped, so it stays put, whole, in
 *    the place they are looking, until the write settles.
 *
 * A DROP contributes no card here: the shift it frees is still shown, busy, under My
 * Shifts. It arrives in the open feed when the server confirms it, not before.
 */
fun pendingAwareOpenShifts(
    openShifts: List<OpenShift>,
    writes: List<PendingWrite>,
): List<OpenShift> {
    if (writes.isEmpty()) return openShifts
    val touched = pendingBlockIds(writes)
    val held =
        writes
            .filter { it.kind == PendingWriteKind.CLAIM }
            .mapNotNull { it.card?.copy(busyKind = PendingWriteKind.CLAIM) }
    return openShifts.filterNot { row -> row.blockIds.any { it in touched } } + held
}
