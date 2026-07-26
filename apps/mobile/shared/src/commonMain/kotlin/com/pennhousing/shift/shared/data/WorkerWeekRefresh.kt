package com.pennhousing.shift.shared.data

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * A manual "refetch the worker's week now" signal, merged into the Realtime change
 * stream by [WorkerShiftsRepository.observeWorkerWeek].
 *
 * WHY THIS EXISTS (concurrency audit 2026-07-26, finding F9).
 *
 * Every optimistic move in the app relies on Realtime to reconcile it back to server
 * truth. That works for the change the worker themselves caused, but there is one case
 * it structurally cannot cover: a row that leaves the worker's RLS scope.
 *
 * `postgres_changes` evaluates RLS against the NEW record, so when a concurrent writer
 * reassigns a seat away from this worker, the row stops being visible to them and the
 * subscription delivers NOTHING. The client keeps rendering a shift the server has
 * already given to somebody else, and no later event corrects it, because from the
 * subscription's point of view nothing happened. The audit found three server-side races
 * that produce exactly that state (a drop, a swap acceptance, and an admin assignment
 * each silently overwriting a just-committed claim); those are fixed in
 * 20260726000009, but the client must still be able to notice when it has lost a race
 * rather than trusting a write it got a 200 for.
 *
 * A refetch after every write closes it: it is a positive pull, so it sees the current
 * truth whether or not the worker can still see the rows that changed.
 *
 * Deliberately NOT a poll. The signal is edge-triggered by writes only; the shared
 * upstream already debounces and conflates, so a burst of writes still costs one refetch.
 */
class WorkerWeekRefresh {
    // extraBufferCapacity + DROP_OLDEST makes tryEmit non-suspending and non-blocking:
    // a refresh request is a hint, and dropping a redundant one when several land at once
    // is correct (the next refetch subsumes it).
    private val signals =
        MutableSharedFlow<Unit>(
            replay = 0,
            extraBufferCapacity = 8,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

    /** Emissions to merge into the Realtime change stream. */
    val stream: Flow<Unit> = signals

    /**
     * Ask every live collector of the worker's week to refetch. Safe to call from any
     * thread and from a non-suspending context; never throws and never blocks.
     */
    fun request() {
        signals.tryEmit(Unit)
    }
}
