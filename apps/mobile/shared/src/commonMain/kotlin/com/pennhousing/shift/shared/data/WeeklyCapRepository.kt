package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.shifts.NEW_YORK
import com.pennhousing.shift.shared.shifts.WeeklyCap
import com.pennhousing.shift.shared.shifts.WeeklyCapSchedule
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.time.Instant

/**
 * The per-week hours cap, read from the server.
 *
 * Lives in its own file rather than in [WorkerShiftsRepository], which is the
 * already-quarantined God class the module AGENTS.md says not to grow.
 *
 * The cap is server config (`weekly_cap_overrides` → the week's `operating_calendar`
 * profiles → `operating_profiles.default_hours_cap`). The app previously had NO read
 * path for it at all and derived it from compiled-in constants, which is why an admin
 * raising the summer cap to 40h in /admin/operations changed nothing on mobile.
 *
 * Every failure resolves to [WeeklyCapSchedule.PENDING] rather than propagating: the cap
 * is chrome on a screen the worker is already reading, the server enforces the real
 * ceiling on every claim regardless, and losing the whole shift snapshot because a
 * secondary config read failed would be a far worse outcome than a fallback meter.
 */
class WeeklyCapRepository(
    private val supabase: SupabaseClient,
) {
    @Serializable
    private data class CapRow(
        @SerialName("week_start_date") val weekStartDate: String,
        @SerialName("hours_cap") val hoursCap: Double,
        @SerialName("cap_enforcement") val capEnforcement: String? = null,
    )

    /**
     * Caps for every week the app can navigate to around [now]: the navigable window's
     * first Monday (last week) through [WEEKS_AHEAD] weeks out, which covers both the
     * My-Shifts picker and the Open-Shifts picker's wider last-week..+4 range.
     *
     * ONE round trip for the whole window. Doing this per week would multiply the
     * refetch amplification that the Realtime debounce in [WorkerShiftsRepository]
     * exists to contain.
     */
    suspend fun fetchWindow(now: Instant): WeeklyCapSchedule {
        val firstMonday = mondayOf(now).plus(-WEEKS_BEHIND * DAYS_IN_WEEK, DateTimeUnit.DAY)
        val lastMonday = mondayOf(now).plus(WEEKS_AHEAD * DAYS_IN_WEEK, DateTimeUnit.DAY)
        val rows =
            runCatching {
                supabase.postgrest
                    .rpc(
                        "effective_weekly_caps",
                        buildJsonObject {
                            put("p_from_week_start", firstMonday.toString())
                            put("p_to_week_start", lastMonday.toString())
                        },
                    ).decodeList<CapRow>()
            }.getOrNull() ?: return WeeklyCapSchedule.PENDING

        return WeeklyCapSchedule.of(
            rows.map {
                Triple(it.weekStartDate, it.hoursCap, WeeklyCap.enforcementOf(it.capEnforcement))
            },
        )
    }

    private fun mondayOf(now: Instant): LocalDate {
        val date = now.toLocalDateTime(NEW_YORK).date
        return date.plus(-(date.dayOfWeek.isoDayNumber - 1), DateTimeUnit.DAY)
    }

    private companion object {
        const val DAYS_IN_WEEK = 7

        /** Matches `navigableWindowStart`: the window opens one week back. */
        const val WEEKS_BEHIND = 1

        /** The Open-Shifts picker offers up to +4; one spare week absorbs a clock skew. */
        const val WEEKS_AHEAD = 5
    }
}
