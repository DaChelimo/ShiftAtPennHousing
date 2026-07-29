package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.PendingWrite
import com.pennhousing.shift.shared.model.PendingWriteKind
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The set of seat writes this client has started and the server has not answered.
 *
 * Companion to the pure `shifts/PendingWrites.kt` projection: that file decides how an
 * in-flight write changes what is drawn, this one owns the lifetime. The host wraps
 * every claim / drop / swap in [begin] ... [end] so the UI can show honest progress
 * instead of an optimistic result (product decision 2026-07-28).
 *
 * Deliberately NOT part of a ViewModel. Both platforms rebuild their ViewModels from
 * each new snapshot, so anything stored in one would be destroyed by the very Realtime
 * event the write causes. This outlives the snapshot; the write does not lose its
 * progress state because the data underneath it changed.
 *
 * [end] is safe to call twice and safe to call for a token that was never begun, which
 * matters because it runs in the `finally` of a request that may have already failed.
 */
class PendingWriteStore {
    private val _writes = MutableStateFlow<List<PendingWrite>>(emptyList())

    /** In-flight writes, newest last. Feed straight into the ViewModels. */
    val writes: StateFlow<List<PendingWrite>> = _writes.asStateFlow()

    /**
     * Register a claim of [card]. The card is held whole while `claim-shift` writes its
     * blocks one at a time, so the worker sees one steady "claiming" card rather than a
     * span that assembles in front of them. Returns the token to pass to [end].
     */
    fun beginClaim(card: OpenShift): String =
        begin(
            PendingWrite(
                token = token(PendingWriteKind.CLAIM, card.blockIds),
                kind = PendingWriteKind.CLAIM,
                blockIds = card.blockIds.toSet(),
                card = card,
            ),
        )

    /** Register a drop of [blockIds]. The shift stays visible, busy, until the server answers. */
    fun beginDrop(blockIds: Collection<String>): String =
        begin(
            PendingWrite(
                token = token(PendingWriteKind.DROP, blockIds),
                kind = PendingWriteKind.DROP,
                blockIds = blockIds.toSet(),
            ),
        )

    /** Register a swap proposal over [blockIds] (the worker's own side of the exchange). */
    fun beginSwap(blockIds: Collection<String>): String =
        begin(
            PendingWrite(
                token = token(PendingWriteKind.SWAP, blockIds),
                kind = PendingWriteKind.SWAP,
                blockIds = blockIds.toSet(),
            ),
        )

    private fun begin(write: PendingWrite): String {
        // Same token means the same request shape is already in flight (a double tap on a
        // card whose action is meant to be disabled). Keep the first; a second entry would
        // make [end] ambiguous and could leave a card stuck busy forever.
        _writes.update { current -> if (current.any { it.token == write.token }) current else current + write }
        return write.token
    }

    /** Clear a settled write. Idempotent, and a no-op for an unknown token. */
    fun end(token: String) {
        _writes.update { current -> current.filterNot { it.token == token } }
    }

    /** True while any write covering [blockId] is in flight. Guards a second tap. */
    fun isBusy(blockId: String): Boolean = _writes.value.any { blockId in it.blockIds }

    private fun token(
        kind: PendingWriteKind,
        blockIds: Collection<String>,
    ): String = "${kind.name}:${blockIds.sorted().joinToString(",")}"
}
