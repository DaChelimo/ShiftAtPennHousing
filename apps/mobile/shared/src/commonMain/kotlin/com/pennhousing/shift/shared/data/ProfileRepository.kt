package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.network.EdgeFunctionClient
import com.pennhousing.shift.shared.network.EdgeResult
import com.pennhousing.shift.shared.settings.NotificationPreferences
import com.pennhousing.shift.shared.settings.SettingsProfile
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.rpc
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Worker profile / settings data layer (parity T1-7) — the data behind the (pure,
 * tested) `SettingsViewModel`. The mobile analogue of the Edge/HTTP layer the phase-13a
 * test plan scopes out, so it is intentionally untested by kotlin.test; correctness is
 * verified manually against a running backend.
 *
 * READ — [fetchProfile] assembles the `SettingsProfile` snapshot + the live
 * `broadcast_subscribed` flag from three worker-readable sources (RLS scopes each to the
 * caller):
 *   * `users` (own row) — `name`, `email`, `home_house_id`, `broadcast_subscribed`
 *     ("users can select own row").
 *   * `user_roles` (own rows) — the worker's highest role label ("users can select own
 *     roles"); `sw` is the default when none is present.
 *   * `houses` — the home house `name` (authenticated read, migration 20260605000001).
 * There is no purpose-built profile view, so this joins those tables in code.
 *
 * WRITE — [setBroadcastSubscription] PATCHes the `users-broadcast-subscription` Edge
 * Function (`/users/{userId}/broadcast_subscribed`, body `{ broadcast_subscribed }`),
 * the ONLY user-toggleable notification channel (§10.1 — personal float / shift-reminder
 * / schedule-published notifications are mandatory and non-silenceable). There is no
 * authenticated UPDATE policy on `users`, so the write goes through the EF, which also
 * blocks HMs/BMs from subscribing. Best-effort, mirroring the Shifts screen's
 * claim/drop: the screen flips its optimistic local toggle regardless.
 */
class ProfileRepository(
    private val supabase: SupabaseClient,
    private val edge: EdgeFunctionClient = EdgeFunctionClient(),
) {
    /**
     * The worker's identity + live broadcast subscription, or null when the own `users`
     * row cannot be read (the caller falls back to the demo profile).
     */
    suspend fun fetchProfile(userId: String): ProfileSnapshot? {
        val user =
            supabase
                .from("users")
                .select(Columns.list("name", "email", "home_house_id", "broadcast_subscribed")) {
                    filter { eq("user_id", userId) }
                }
                .decodeSingleOrNull<UserProfileRow>() ?: return null

        // The home-house display name (authenticated read). Fall back to the id when the
        // join row is missing rather than dropping the whole profile.
        val houseName =
            supabase
                .from("houses")
                .select(Columns.list("name")) { filter { eq("id", user.homeHouseId) } }
                .decodeSingleOrNull<HouseNameRow>()
                ?.name ?: user.homeHouseId

        // The worker's roles (own rows). Pick the most privileged for the display label;
        // `sw` is the implicit default when no row is present.
        val roles =
            supabase
                .from("user_roles")
                .select(Columns.list("role")) { filter { eq("user_id", userId) } }
                .decodeList<UserRoleRow>()
                .map { it.role }
        val role = highestRole(roles)

        return ProfileSnapshot(
            profile =
                SettingsProfile(
                    name = user.name,
                    email = user.email,
                    role = role,
                    homeHouseName = houseName,
                ),
            broadcastSubscribed = user.broadcastSubscribed,
        )
    }

    /**
     * Set the worker's broadcast ("General updates") subscription → the PATCH-only
     * `users-broadcast-subscription` Edge Function. Best-effort; `EdgeResult.ok` reports
     * the 2xx (the EF 403s if an HM/BM tries to subscribe — the screen's optimistic flip
     * still happened, and the next profile read reconciles).
     */
    suspend fun setBroadcastSubscription(
        userId: String,
        subscribed: Boolean,
    ): EdgeResult {
        val body = Json.encodeToString(BroadcastRequest(broadcastSubscribed = subscribed))
        return edge.patch("users-broadcast-subscription/users/$userId/broadcast_subscribed", body)
    }

    /**
     * The worker's two configurable notification channels (BSpec §10.1). A worker with
     * no row has never opened Settings, which must behave IDENTICALLY to one who kept
     * the defaults, so a missing row resolves to [NotificationPreferences]'s defaults
     * rather than to false/false. Those defaults mirror the column defaults and
     * `wants_open_shift_notification`; if you change one, change all three.
     */
    suspend fun fetchNotificationPreferences(userId: String): NotificationPreferences =
        runCatching {
            supabase
                .from(TABLE_NOTIFICATION_PREFERENCES)
                .select(
                    Columns.list(
                        "open_shifts_home_house",
                        "open_shifts_other_houses",
                        "shift_reminder_offsets",
                    ),
                ) {
                    filter { eq("user_id", userId) }
                }
                .decodeSingleOrNull<NotificationPreferencesRow>()
                ?.let {
                    NotificationPreferences(
                        openShiftsHomeHouse = it.openShiftsHomeHouse,
                        openShiftsOtherHouses = it.openShiftsOtherHouses,
                        shiftReminderOffsets = it.shiftReminderOffsets.toSet(),
                    )
                }
                ?: NotificationPreferences()
        }.getOrDefault(NotificationPreferences())

    /**
     * Persist both configurable channels through the `set_notification_preferences` RPC.
     * The RPC writes `auth.uid()`'s own row and takes no user_id, so a client cannot aim
     * this at somebody else. Returns false on any failure; the caller reverts + toasts.
     */
    suspend fun setNotificationPreferences(prefs: NotificationPreferences): Boolean =
        runCatching {
            supabase.postgrest.rpc(
                "set_notification_preferences",
                buildJsonObject {
                    put("p_open_shifts_home_house", JsonPrimitive(prefs.openShiftsHomeHouse))
                    put("p_open_shifts_other_houses", JsonPrimitive(prefs.openShiftsOtherHouses))
                    // Always sent, never omitted: the RPC treats NULL as "leave unchanged",
                    // so omitting it would make turning every reminder OFF impossible.
                    put(
                        "p_shift_reminder_offsets",
                        buildJsonArray { prefs.shiftReminderOffsets.sorted().forEach { add(JsonPrimitive(it)) } },
                    )
                },
            )
            true
        }.getOrDefault(false)

    /** Role precedence for the profile label (bm > hm > rsm > sm > sw). */
    private fun highestRole(roles: List<String>): String =
        ROLE_PRECEDENCE.firstOrNull { it in roles } ?: "sw"

    private companion object {
        val ROLE_PRECEDENCE = listOf("bm", "hm", "rsm", "sm", "sw")
        const val TABLE_NOTIFICATION_PREFERENCES = "notification_preferences"
    }
}

@Serializable
private data class NotificationPreferencesRow(
    @SerialName("open_shifts_home_house") val openShiftsHomeHouse: Boolean = true,
    @SerialName("open_shifts_other_houses") val openShiftsOtherHouses: Boolean = false,
    @SerialName("shift_reminder_offsets") val shiftReminderOffsets: List<Int> = listOf(60),
)

/** The worker's identity + live broadcast flag, for the `SettingsViewModel` constructor. */
data class ProfileSnapshot(
    val profile: SettingsProfile,
    val broadcastSubscribed: Boolean,
)

// ----- Wire rows → pure inputs. -----

@Serializable
private data class UserProfileRow(
    val name: String,
    val email: String,
    @SerialName("home_house_id") val homeHouseId: String,
    @SerialName("broadcast_subscribed") val broadcastSubscribed: Boolean = false,
)

@Serializable
private data class HouseNameRow(
    val name: String,
)

@Serializable
private data class UserRoleRow(
    val role: String,
)

// ----- The `users-broadcast-subscription` Edge-Function request body. -----

@Serializable
private data class BroadcastRequest(
    @SerialName("broadcast_subscribed") val broadcastSubscribed: Boolean,
)
