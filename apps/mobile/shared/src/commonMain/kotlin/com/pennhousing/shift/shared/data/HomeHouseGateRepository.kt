package com.pennhousing.shift.shared.data

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.rpc
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.time.Duration.Companion.seconds

/**
 * Result of the staggered-launch home-house gate: whether the worker's home house is live
 * yet, plus its display name for the "coming soon" placeholder.
 */
data class HomeHouseGate(
    val isLive: Boolean,
    val houseName: String,
)

/**
 * Upper bound on resolving [HomeHouseGateRepository.fetchHomeHouseGate]. This sits behind the
 * launch splash (`MainActivity.LiveOrLoginRoot`), and without a bound its two sequential calls
 * can each individually ride out supabase-kt's 10s HTTP timeout on a slow or unreachable
 * backend, stranding the splash for up to ~20s with no way out — the same "sits there forever"
 * failure the sign-in screen had (BSpec §23.2). A timeout here resolves fail-open, exactly like
 * every other step inside it.
 */
internal val HOME_HOUSE_GATE_TIMEOUT = 8.seconds

/** `users` — its own constant so this repository has no compile-time coupling to
 *  `WorkerShiftsRepository`, whose identical `TABLE_USERS` lives in its companion object. */
private const val TABLE_USERS = "users"

/**
 * Staggered-launch gate (rollout, BSpec §22): has the signed-in worker's home house gone live
 * yet? Split out of `WorkerShiftsRepository` (AGENTS.md §5.2 quarantines that file as a God
 * class) — a single-purpose repository, mirroring the existing `WeeklyCapRepository` split.
 */
class HomeHouseGateRepository(
    private val supabase: SupabaseClient,
) {
    /**
     * Resolves the worker's `home_house_id` and its display name in ONE embedded query
     * (`houses!inner(name)` over the `home_house_id` FK — own-row `users` RLS covers both
     * sides), then delegates to the `house_is_live` RPC (SECURITY DEFINER, folds in the
     * master switch). Two round trips, not three: this used to be a separate `houses` read
     * for the name.
     *
     * FAIL-OPEN: any unreadable step (including a timeout — see [HOME_HOUSE_GATE_TIMEOUT])
     * defaults to live, so a transient error never locks a worker out of an already-launched
     * house (the gate is a soft UX guard, not security).
     */
    suspend fun fetchHomeHouseGate(userId: String): HomeHouseGate =
        withTimeoutOrNull(HOME_HOUSE_GATE_TIMEOUT) { fetchHomeHouseGateUnbounded(userId) }
            ?: HomeHouseGate(isLive = true, houseName = "your house")

    private suspend fun fetchHomeHouseGateUnbounded(userId: String): HomeHouseGate {
        val homeHouse =
            runCatching {
                supabase
                    .from(TABLE_USERS)
                    .select(Columns.raw("home_house_id,houses!inner(name)")) { filter { eq("user_id", userId) } }
                    .decodeSingleOrNull<HomeHouseWithNameRow>()
            }.getOrNull() ?: return HomeHouseGate(isLive = true, houseName = "your house")
        val isLive =
            runCatching {
                supabase.postgrest
                    .rpc("house_is_live", buildJsonObject { put("p_house_id", homeHouse.homeHouseId) })
                    .decodeAs<Boolean>()
            }.getOrDefault(true)
        return HomeHouseGate(isLive = isLive, houseName = homeHouse.houses.name)
    }
}

/** `users.home_house_id` embedded with its `houses.name` via the FK, in one PostgREST call. */
@Serializable
internal data class HomeHouseWithNameRow(
    @SerialName("home_house_id") val homeHouseId: String,
    val houses: HouseNameEmbed,
)

@Serializable
internal data class HouseNameEmbed(
    val name: String,
)
