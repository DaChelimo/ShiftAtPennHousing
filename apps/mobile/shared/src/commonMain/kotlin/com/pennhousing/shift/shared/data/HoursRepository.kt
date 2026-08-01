package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.manager.hours.HouseHoursReport
import com.pennhousing.shift.shared.manager.hours.HoursBlock
import com.pennhousing.shift.shared.manager.hours.HoursKind
import com.pennhousing.shift.shared.manager.hours.WorkerHoursInput
import com.pennhousing.shift.shared.manager.hours.buildHouseHoursReport
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.rpc
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant

/*
 * The manager Hours report data layer (docs/manager-app/SPEC.md §6.5). The mobile analogue of
 * the Edge/HTTP layer the phase-13a test plan scopes out; the roll-up and coalescing live in
 * `manager/hours/HouseHours.kt` and ARE unit-tested.
 *
 * NO NEW BACKEND. Every read here already exists and is already correctly scoped:
 *
 *   * `worker_directory` — the roster. Owner-rights, active workers only, any authenticated
 *     worker may read it (the 2026-06-12 ruling; it is what the hand-off picker uses).
 *   * `shift_block_assignments` + its embedded `shift_blocks` — the occupied blocks. The SELECT
 *     policy (20260617000006) admits `user_can_build_schedule(auth.uid(), house_id)`, and since
 *     20260627000002 that predicate is house-agnostic for hm/bm/rsm. So an elevated manager can
 *     already read a Harnwell worker's Rodin pickup with their OWN token, which is what makes
 *     the away-shift breakdown possible without a service-role call.
 *   * `effective_weekly_caps` — granted to `authenticated`, and documented as returning global
 *     schedule config only. The cap is per-WEEK, not per-worker (there is no per-worker override
 *     table; `modify_weekly_cap` changes the global config), so one lookup covers the roster.
 *
 * AN SM'S AWAY LIST IS INHERENTLY PARTIAL, and that is not a bug to paper over.
 * `user_can_build_schedule` is scope-matched for `sm`, so their token cannot read another
 * house's assignments and their breakdown shows home-desk time only. [HouseHoursResult.partial]
 * reports that so the screen can say so honestly. Do NOT "fix" this by routing through a
 * service-role Edge Function: widening an SM's read is a stakeholder decision with a security
 * review attached, not an implementation detail.
 */
class HoursRepository(
    private val supabase: SupabaseClient,
) {
    /**
     * The week's hours for every worker whose home house is [houseId].
     *
     * [weekStart] is any instant inside the wanted week; it is snapped to the NY Monday, because
     * every cap and hours path in this system uses a Monday-to-Sunday week.
     *
     * [awayVisible] must be false for an SM, so the screen labels the breakdown truthfully
     * rather than implying a worker never left their desk.
     */
    suspend fun fetchHouseHours(
        houseId: String,
        houseName: String,
        weekStart: Instant,
        awayVisible: Boolean,
        zone: TimeZone = com.pennhousing.shift.shared.shifts.NEW_YORK,
    ): HouseHoursResult {
        val monday = nyMondayOf(weekStart, zone)
        val nextMonday = monday + 7.days

        val roster =
            runCatching {
                supabase
                    .from(VIEW_WORKER_DIRECTORY)
                    .select(Columns.list("user_id", "name", "home_house_id")) {
                        filter { eq("home_house_id", houseId) }
                        order("name", Order.ASCENDING)
                    }
                    .decodeList<RosterRow>()
            }.getOrDefault(emptyList())

        if (roster.isEmpty()) {
            return HouseHoursResult(
                report = buildHouseHoursReport(houseId, houseName, monday, emptyList(), zone),
                partial = !awayVisible,
            )
        }

        val userIds = roster.map { it.userId }

        // ONE bounded query. An embedded `!inner` join keeps the window filter on the block's
        // own start time, so this cannot degrade into "read every block in every house this
        // week" and hit the 1000-row PostgREST cap (the bug that silently truncated the float
        // carousel once already).
        val assignments =
            runCatching {
                supabase
                    .from(TABLE_ASSIGNMENTS)
                    .select(
                        Columns.raw(
                            "user_id,status,is_cross_house_pickup," +
                                "shift_blocks!inner(block_start_at,house_id,voided_at,houses!inner(name))",
                        ),
                    ) {
                        filter {
                            isIn("user_id", userIds)
                            isIn("status", COUNTING_STATUSES)
                            gte("shift_blocks.block_start_at", monday.toString())
                            lt("shift_blocks.block_start_at", nextMonday.toString())
                        }
                    }
                    .decodeList<AssignmentRow>()
            }.getOrDefault(emptyList())

        val cap = fetchWeekCap(monday, zone)
        val homeHouseById = roster.associate { it.userId to it.homeHouseId }
        val blocksByUser = mutableMapOf<String, MutableList<HoursBlock>>()

        assignments.forEach { row ->
            val block = row.block ?: return@forEach
            // A voided block is not worked time. Every status-filtered read path in this system
            // carries this guard as defense in depth (20260702000007).
            if (block.voidedAt != null) return@forEach
            val homeHouse = homeHouseById[row.userId] ?: return@forEach
            blocksByUser
                .getOrPut(row.userId) { mutableListOf() }
                .add(
                    HoursBlock(
                        start = Instant.parse(block.blockStartAt),
                        houseId = block.houseId,
                        houseName = block.house?.name ?: block.houseId,
                        kind = classify(row.status, block.houseId, homeHouse, row.isCrossHousePickup),
                    ),
                )
        }

        val workers =
            roster.map { person ->
                WorkerHoursInput(
                    userId = person.userId,
                    name = person.name,
                    homeHouseId = person.homeHouseId,
                    capHours = cap,
                    blocks = blocksByUser[person.userId].orEmpty(),
                )
            }

        return HouseHoursResult(
            report = buildHouseHoursReport(houseId, houseName, monday, workers, zone),
            partial = !awayVisible,
        )
    }

    /**
     * The week's effective cap in hours, or null when it could not be read. Never substitute a
     * hardcoded 20: the cap is server-authoritative and varies by season, and a wrong cap on
     * this screen is exactly the number a manager would act on.
     */
    private suspend fun fetchWeekCap(
        monday: Instant,
        zone: TimeZone,
    ): Double? =
        runCatching {
            val mondayDate = monday.toLocalDateTime(zone).date.toString()
            supabase.postgrest
                .rpc(
                    "effective_weekly_caps",
                    buildJsonObject {
                        put("p_from_week_start", mondayDate)
                        put("p_to_week_start", mondayDate)
                    },
                )
                .decodeList<CapRow>()
                .firstOrNull()
                ?.hoursCap
                ?.toDouble()
        }.getOrNull()

    /**
     * Which bucket a block falls in. Mirrors `apps/web/lib/data/hours.ts`, which mirrors the
     * canonical `worker_my_shifts` view. `is_cross_house_pickup` is trusted when present and the
     * house comparison is the fallback, because the column is only stamped on the pickup paths.
     */
    private fun classify(
        status: String,
        blockHouseId: String,
        homeHouseId: String,
        isCrossHousePickup: Boolean,
    ): HoursKind =
        when {
            status == "floated_in" || status == "pending_float_in" -> HoursKind.FLOATED_OUT
            status == "claimed" && (isCrossHousePickup || blockHouseId != homeHouseId) ->
                HoursKind.CROSS_HOUSE_PICKUP
            blockHouseId != homeHouseId -> HoursKind.FLOATED_OUT
            else -> HoursKind.HOME
        }

    /** The NY Monday 00:00 of the week containing [instant]. */
    private fun nyMondayOf(
        instant: Instant,
        zone: TimeZone,
    ): Instant {
        val ldt = instant.toLocalDateTime(zone)
        // Duration arithmetic from NY midnight, never wall-clock stepping (hard invariant #6).
        val midnight = LocalDateTime(ldt.year, ldt.month, ldt.day, 0, 0).toInstant(zone)
        return midnight - ldt.dayOfWeek.ordinal.days
    }

    private companion object {
        const val VIEW_WORKER_DIRECTORY = "worker_directory"
        const val TABLE_ASSIGNMENTS = "shift_block_assignments"

        /** The statuses that mean the worker actually holds the block. Mirrors the web report. */
        val COUNTING_STATUSES = listOf("scheduled", "claimed", "floated_in", "pending_float_in")
    }
}

/** The report, plus whether this reader could see everything in it. */
data class HouseHoursResult(
    val report: HouseHoursReport,
    /**
     * True when the reader's RLS scope cannot include away shifts (an SM). The screen must SAY
     * SO rather than rendering a breakdown that looks complete and is not.
     */
    val partial: Boolean,
)

// ----- Wire rows. -----

@Serializable
private data class RosterRow(
    @SerialName("user_id") val userId: String,
    val name: String,
    @SerialName("home_house_id") val homeHouseId: String,
)

@Serializable
private data class AssignmentRow(
    @SerialName("user_id") val userId: String,
    val status: String,
    @SerialName("is_cross_house_pickup") val isCrossHousePickup: Boolean = false,
    @SerialName("shift_blocks") val block: BlockRow? = null,
)

@Serializable
private data class BlockRow(
    @SerialName("block_start_at") val blockStartAt: String,
    @SerialName("house_id") val houseId: String,
    @SerialName("voided_at") val voidedAt: String? = null,
    @SerialName("houses") val house: HouseNameOnly? = null,
)

@Serializable
private data class HouseNameOnly(
    val name: String,
)

@Serializable
private data class CapRow(
    @SerialName("week_start_date") val weekStartDate: String,
    @SerialName("hours_cap") val hoursCap: Int,
    @SerialName("cap_enforcement") val capEnforcement: String,
)
