package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.SwapDirection
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.rpc
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.shareIn
import kotlin.random.Random
import kotlin.time.Instant

/**
 * Live swap + notification data (commonMain), extracted from [WorkerShiftsRepository]
 * (which AGENTS.md quarantines as a God class) when swaps gained a Realtime channel.
 *
 * WHY THIS EXISTS (pilot bug, 2026-07-28). Swaps had NO live path at all:
 *
 *  - `swap_requests` was not in the `supabase_realtime` publication, so nothing on the
 *    client could hear a swap being created, accepted, declined, cancelled or expired.
 *    The only channel the app held was `shift_block_assignments`.
 *  - The hosts read swaps through a `produceState` keyed on the VIEWING worker's own
 *    actions, so a request someone else sent, or a decline someone else made, was only
 *    picked up when an unrelated seat change happened to force a re-read. That is the
 *    "it showed up much later" in the report, and the reason a decline never reached the
 *    person who proposed the swap.
 *
 * Now one shared channel carries BOTH tables the swap experience depends on:
 * `swap_requests` (the state) and `notifications` (the §10.1 alert, which the same
 * migration made mandatory for every swap event). One channel, one debounce, one
 * refetch, fanned out to every collector, mirroring the worker-week sharing so an iOS
 * client with two collectors does not open two connections.
 *
 * Reads stay RLS-scoped: `worker_pending_swaps` self-scopes to `auth.uid()`, and the
 * `swap_requests` / `notifications` policies are own-row, so the subscription needs no
 * server-side user filter (which also avoids the version-variable filter DSL).
 */
data class SwapActivity(
    /** Both directions, enriched with each side's span. Powers the banner, marks and cards. */
    val pendingSwaps: List<PendingSwap>,
    /** The counterparty-side rows the Updates feed synthesizes entries from. */
    val incomingSwaps: List<IncomingSwap>,
    /** The worker's own notification rows, or null while the first read is in flight. */
    val notifications: List<NotificationItem>?,
)

/**
 * Realtime refetch debounce, matching the worker-week flow's 500 ms. A swap acceptance
 * writes seats AND flips the swap AND inserts notifications, so a single user action
 * produces a burst across both subscribed tables; debounce collapses it into one refetch.
 */
private const val SWAP_REFETCH_DEBOUNCE_MS = 500L

class SwapActivityRepository(
    private val supabase: SupabaseClient,
) {
    /** See [WorkerShiftsRepository.refresh] for why this scope is never cancelled. */
    private val repositoryScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** One shared flow per worker. Main-thread-confined lookup, exactly like the week flow. */
    private val shared = mutableMapOf<String, Flow<SwapActivity>>()

    /**
     * Edge-triggered refetch, merged into the Realtime stream. Realtime covers everything
     * the worker can still SEE; this covers what they can no longer see. Accepting a swap
     * moves seats between two people, so one side's rows leave their RLS scope and
     * `postgres_changes` delivers nothing at all to them.
     */
    val refresh: WorkerWeekRefresh = WorkerWeekRefresh()

    /**
     * The worker's live swap state. Emits immediately, then on every change to their
     * `swap_requests` or `notifications` rows.
     */
    fun observeSwapActivity(userId: String): Flow<SwapActivity> {
        shared[userId]?.let { return it }
        val flow =
            rawSwapActivity(userId)
                .shareIn(
                    scope = repositoryScope,
                    started = SharingStarted.WhileSubscribed(replayExpirationMillis = 0),
                    replay = 1,
                )
        shared[userId] = flow
        return flow
    }

    // debounce() is still FlowPreview; opted in for the same reason the worker-week flow does.
    @OptIn(kotlinx.coroutines.FlowPreview::class)
    private fun rawSwapActivity(userId: String): Flow<SwapActivity> =
        flow {
            emit(fetchSwapActivity(userId))
            // The Random suffix is load-bearing, same as the worker-week channel:
            // supabase.channel() caches by NAME, and calling postgresChangeFlow on an
            // already-joined channel throws. Share the FLOW, never the topic.
            val channel = supabase.channel("swap-activity-$userId-${Random.nextLong()}")
            // BOTH registrations must happen before subscribe(); afterwards they throw.
            val swapChanges =
                channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = TABLE_SWAP_REQUESTS
                }
            val notificationChanges =
                channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = TABLE_NOTIFICATIONS
                }
            channel.subscribe()
            try {
                merge(
                    swapChanges.map { },
                    notificationChanges.map { },
                    refresh.stream,
                )
                    .debounce(SWAP_REFETCH_DEBOUNCE_MS)
                    .conflate()
                    .collect { emit(fetchSwapActivity(userId)) }
            } finally {
                runCatching { supabase.realtime.removeChannel(channel) }
            }
        }

    /** One round trip per source, best-effort: a failed read keeps the last good value shape. */
    private suspend fun fetchSwapActivity(userId: String): SwapActivity =
        SwapActivity(
            pendingSwaps = fetchPendingSwaps(),
            incomingSwaps = runCatching { fetchIncomingSwaps(userId) }.getOrDefault(emptyList()),
            notifications = runCatching { fetchNotifications(userId) }.getOrNull(),
        )

    /**
     * The worker's pending swaps (BOTH directions), enriched with each side's span, from
     * the `worker_pending_swaps` read model (SECURITY DEFINER, scoped to `auth.uid()`).
     * Powers the My-Shifts swap banner, the card marks and the accept/decline popup.
     */
    suspend fun fetchPendingSwaps(): List<PendingSwap> =
        runCatching {
            supabase.postgrest
                .rpc("worker_pending_swaps")
                .decodeList<WorkerPendingSwapRow>()
                .map { row ->
                    PendingSwap(
                        swapId = row.swapId,
                        swapType = row.swapType,
                        direction = if (row.direction == "outgoing") SwapDirection.OUTGOING else SwapDirection.INCOMING,
                        otherUserName = row.otherUserName ?: "A housemate",
                        createdAt = Instant.parse(row.createdAt),
                        expiresAt = Instant.parse(row.expiresAt),
                        initiatorAssignmentIds = row.initiatorAssignmentIds,
                        counterpartyAssignmentIds = row.counterpartyAssignmentIds ?: emptyList(),
                        initiatorStart = row.initiatorStart?.let { Instant.parse(it) },
                        initiatorEnd = row.initiatorEnd?.let { Instant.parse(it) },
                        initiatorBlocks = row.initiatorBlocks,
                        initiatorHouseName = row.initiatorHouseName,
                        counterpartyStart = row.counterpartyStart?.let { Instant.parse(it) },
                        counterpartyEnd = row.counterpartyEnd?.let { Instant.parse(it) },
                        counterpartyBlocks = row.counterpartyBlocks,
                        counterpartyHouseName = row.counterpartyHouseName,
                    )
                }
        }.getOrDefault(emptyList())

    /**
     * The worker's INCOMING pending swaps (§8.2, T3a). Own `swap_requests` rows where the
     * worker is the counterparty and the swap is still pending (own-row RLS). The Updates
     * feed synthesizes deep-link entries from these via the pure `withIncomingSwapEntries`.
     */
    suspend fun fetchIncomingSwaps(userId: String): List<IncomingSwap> =
        supabase
            .from(TABLE_SWAP_REQUESTS)
            .select(SWAP_REQUEST_COLUMNS) {
                filter {
                    eq("counterparty_user_id", userId)
                    eq("status", "pending")
                }
            }
            .decodeList<SwapRequestRow>()
            .map { it.toIncomingSwap() }

    /**
     * The worker's OWN outgoing pending swaps (D4, initiator side; own-row RLS). The
     * Updates feed synthesizes voidable entries via `withOutgoingSwapEntries`.
     */
    suspend fun fetchOutgoingSwaps(userId: String): List<IncomingSwap> =
        supabase
            .from(TABLE_SWAP_REQUESTS)
            .select(SWAP_REQUEST_COLUMNS) {
                filter {
                    eq("initiator_user_id", userId)
                    eq("status", "pending")
                }
            }
            .decodeList<SwapRequestRow>()
            .map { it.toIncomingSwap() }

    /**
     * The worker's notification history for the Updates feed (§10.1). A plain SELECT over
     * their own RLS-scoped `notifications` rows; the pure `buildUpdatesFeed` groups them.
     */
    suspend fun fetchNotifications(userId: String): List<NotificationItem> =
        supabase
            .from(TABLE_NOTIFICATIONS)
            .select(NOTIFICATION_COLUMNS) {
                filter { eq("recipient_user_id", userId) }
            }
            .decodeList<NotificationWireRow>()
            .map { it.toNotificationItem() }

    companion object {
        internal const val TABLE_SWAP_REQUESTS = "swap_requests"
        internal const val TABLE_NOTIFICATIONS = "notifications"

        /** Narrow projection (cost audit F-12): every column here is consumed by [SwapRequestRow]. */
        internal val SWAP_REQUEST_COLUMNS =
            Columns.list("swap_id", "swap_type", "created_at", "expires_at")

        /** Consumed by [NotificationWireRow]; keep the two in step (cost audit F-12). */
        internal val NOTIFICATION_COLUMNS =
            Columns.list("notification_id", "type", "payload", "created_at", "acknowledged_at")
    }
}

private fun SwapRequestRow.toIncomingSwap(): IncomingSwap =
    IncomingSwap(
        swapId = swapId,
        swapType = swapType,
        createdAt = Instant.parse(createdAt),
        expiresAt = Instant.parse(expiresAt),
    )
