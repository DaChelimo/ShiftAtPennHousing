package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.categoryForType
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Instant

/**
 * Phase 13a — the worker-week data layer (commonMain).
 *
 * Sources the [WorkerSnapshot] the (pure, tested) `ShiftsScreenViewModel` renders
 * and keeps it live via Supabase Realtime — the mobile analogue of the Edge/HTTP
 * layer that the phase-13a test plan scopes out ("How … snapshots reach the
 * ViewModel … is NOT covered"). It is intentionally untested by the kotlin.test
 * suite; correctness is verified manually against a running backend.
 *
 * Reads go through two client read-model views that denormalize house + kind for
 * the app — `worker_my_shifts` and `worker_open_shifts` — keyed by the
 * authenticated worker. RLS scopes every row to that worker, so the Realtime
 * subscription needs no explicit server-side user filter: any change the worker
 * can see triggers a refetch (deliverable "no manual refresh").
 */
data class WorkerSnapshot(
    val myShifts: List<MyShift>,
    val openShifts: List<OpenShift>,
)

/** A new `notifications` row, mapped for the in-app toast (deliverable #7). */
data class ToastNotification(
    val title: String,
    val body: String,
)

class WorkerShiftsRepository(
    private val supabase: SupabaseClient,
) {
    suspend fun fetchWorkerWeek(userId: String): WorkerSnapshot {
        val myShifts =
            supabase
                .from(VIEW_MY_SHIFTS)
                .select { filter { eq("user_id", userId) } }
                .decodeList<MyShiftRow>()
                .map { it.toModel() }
        val openShifts =
            supabase
                .from(VIEW_OPEN_SHIFTS)
                .select { filter { eq("eligible_user_id", userId) } }
                .decodeList<OpenShiftRow>()
                .map { it.toModel() }
        return WorkerSnapshot(myShifts = myShifts, openShifts = openShifts)
    }

    /**
     * Emits an initial snapshot, then a fresh snapshot on every change to the
     * worker's `shift_block_assignments` (e.g. a float assigned at T-2h). The
     * subscription relies on RLS to scope rows to the authenticated worker.
     */
    fun observeWorkerWeek(userId: String): Flow<WorkerSnapshot> =
        flow {
            emit(fetchWorkerWeek(userId))
            val channel = supabase.channel("worker-shifts-$userId")
            val changes =
                channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = "shift_block_assignments"
                }
            channel.subscribe()
            changes.collect { emit(fetchWorkerWeek(userId)) }
        }

    /**
     * The worker's notification history for the Updates feed (§10.1). A plain SELECT
     * over the worker's own `notifications` rows (RLS-scoped); the pure
     * `buildUpdatesFeed` groups them. `urgent`/`floatId` are left unset — the live
     * pending-float linkage is a separate query (see the `AckDeclineViewModel` TODO),
     * so today the urgent entry comes from the demo/ack path, not this list.
     */
    suspend fun fetchNotifications(userId: String): List<NotificationItem> =
        supabase
            .from(TABLE_NOTIFICATIONS)
            .select { filter { eq("recipient_user_id", userId) } }
            .decodeList<NotificationWireRow>()
            .map { it.toModel() }

    /** Live new-notification stream for the top-of-screen toast (§10.1, deliverable #7). */
    fun observeNotifications(userId: String): Flow<ToastNotification> =
        flow {
            val channel = supabase.channel("worker-notifications-$userId")
            val inserts =
                channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
                    table = "notifications"
                }
            channel.subscribe()
            inserts.collect { action ->
                action.record.toToast()?.let { emit(it) }
            }
        }

    private companion object {
        const val VIEW_MY_SHIFTS = "worker_my_shifts"
        const val VIEW_OPEN_SHIFTS = "worker_open_shifts"
        const val TABLE_NOTIFICATIONS = "notifications"
    }
}

// ----- Wire rows (the client read-model views) → pure domain models. -----

@Serializable
internal data class MyShiftRow(
    val id: String,
    @SerialName("house_id") val houseId: String,
    @SerialName("house_name") val houseName: String,
    @SerialName("start_at") val startAt: String,
    @SerialName("end_at") val endAt: String,
    val kind: String,
    @SerialName("cross_house") val crossHouse: Boolean = false,
    val pending: Boolean = false,
    @SerialName("break_shift") val breakShift: Boolean = false,
    @SerialName("dropped_still_open") val droppedStillOpen: Boolean = false,
)

@Serializable
internal data class OpenShiftRow(
    val id: String,
    @SerialName("house_id") val houseId: String,
    @SerialName("house_name") val houseName: String,
    @SerialName("start_at") val startAt: String,
    @SerialName("end_at") val endAt: String,
    val feed: String,
    @SerialName("home_house") val homeHouse: Boolean,
    @SerialName("weeks_remaining") val weeksRemaining: Int? = null,
)

private fun MyShiftRow.toModel(): MyShift =
    MyShift(
        id = id,
        house = House(houseId, houseName),
        start = Instant.parse(startAt),
        end = Instant.parse(endAt),
        kind = parseAssignmentKind(kind),
        crossHouse = crossHouse,
        pending = pending,
        breakShift = breakShift,
        droppedStillOpen = droppedStillOpen,
    )

private fun OpenShiftRow.toModel(): OpenShift =
    OpenShift(
        id = id,
        house = House(houseId, houseName),
        start = Instant.parse(startAt),
        end = Instant.parse(endAt),
        feed = if (feed.equals("permanent_opening", ignoreCase = true)) OpenFeed.PERMANENT_OPENING else OpenFeed.WEEKLY,
        homeHouse = homeHouse,
        weeksRemaining = weeksRemaining,
    )

private fun parseAssignmentKind(raw: String): AssignmentKind =
    when (raw.lowercase()) {
        "permanent_pickup" -> AssignmentKind.PERMANENT_PICKUP
        "temp_pickup" -> AssignmentKind.TEMP_PICKUP
        "float_out" -> AssignmentKind.FLOAT_OUT
        else -> AssignmentKind.SCHEDULED
    }

@Serializable
internal data class NotificationWireRow(
    @SerialName("notification_id") val id: String,
    val type: String,
    val payload: JsonObject = JsonObject(emptyMap()),
    @SerialName("created_at") val createdAt: String,
    @SerialName("acknowledged_at") val acknowledgedAt: String? = null,
)

private fun NotificationWireRow.toModel(): NotificationItem =
    NotificationItem(
        id = id,
        category = categoryForType(type),
        title = payload["title"]?.jsonPrimitive?.content ?: "Notification",
        body = payload["body"]?.jsonPrimitive?.content ?: payload["message"]?.jsonPrimitive?.content ?: "",
        createdAt = Instant.parse(createdAt),
        unread = acknowledgedAt == null,
    )

private fun JsonObject.toToast(): ToastNotification? {
    val title = this["title"]?.jsonPrimitive?.content ?: return null
    val body = this["body"]?.jsonPrimitive?.content ?: this["message"]?.jsonPrimitive?.content ?: ""
    return ToastNotification(title = title, body = body)
}
