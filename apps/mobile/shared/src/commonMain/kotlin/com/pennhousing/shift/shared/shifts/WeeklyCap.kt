package com.pennhousing.shift.shared.shifts

import com.pennhousing.shift.shared.calendar.mondayOf
import kotlinx.datetime.TimeZone
import kotlin.time.Instant

/**
 * The weekly hours cap — SERVER-OWNED, per Mon..Sun week.
 *
 * This exists because the app used to decide the cap itself, from two compiled-in
 * constants picked by a `breakProfile` boolean that the live host never set. Every
 * worker was shown "20h soft cap" in every season, including a summer season an admin
 * had configured at 40h/hard, and no amount of admin configuration could move it.
 *
 * The cap is not a client concept. It is `weekly_cap_overrides` → the week's
 * `operating_calendar` profiles → `operating_profiles.default_hours_cap`, resolved by
 * the `effective_weekly_cap` SQL function. The client's job is to READ it and render it,
 * exactly as it does for `coverageLocked` / `deskCovered` on the open-shifts feed. Do
 * not reintroduce a client-side derivation: a season can set any cap it likes, so there
 * is no fixed set of values to branch on.
 */
enum class CapEnforcement {
    /** Over the cap warns, and the worker may proceed (§5.3). */
    SOFT,

    /** Over the cap is refused. The server refuses it too; this only saves a round trip. */
    HARD,
}

data class WeeklyCap(
    val hours: Double,
    val enforcement: CapEnforcement,
) {
    val isHard: Boolean get() = enforcement == CapEnforcement.HARD

    /** "soft cap" / "hard cap", for the "of 20h soft cap" summary chips. */
    val enforcementLabel: String get() = if (isHard) "hard cap" else "soft cap"

    /** "20h" / "37.5h". */
    val hoursLabel: String get() = formatHours(hours)

    companion object {
        /**
         * What to show before the caps have loaded, or if the read fails.
         *
         * The school-year default (soft 20h) is the deliberate choice over "no cap":
         * it is the value that is right most weeks of the year, and being SOFT it can
         * only ever produce a warning the worker may click through, never a block on a
         * claim the server would have allowed. The server is authoritative either way,
         * so a stale fallback costs an inaccurate meter, not an incorrect outcome.
         */
        val FALLBACK: WeeklyCap = WeeklyCap(SOFT_HOURS_CAP, CapEnforcement.SOFT)

        /** Map a `cap_enforcement_enum` value; anything unrecognized reads as soft. */
        fun enforcementOf(raw: String?): CapEnforcement = if (raw?.lowercase() == "hard") CapEnforcement.HARD else CapEnforcement.SOFT
    }
}

/**
 * Every week's cap across the navigable window, keyed by the ISO date of that week's
 * NY Monday.
 *
 * Keyed by String rather than LocalDate on purpose: this crosses the SKIE boundary into
 * Swift, and an ISO string is the one key representation that survives it unambiguously.
 *
 * A miss falls back rather than throwing. Misses are expected and benign — a worker can
 * navigate to a week outside the fetched window, and the snapshot arrives after first
 * composition — and a cap is chrome on a screen the worker is already reading.
 */
data class WeeklyCapSchedule(
    private val byWeekStart: Map<String, WeeklyCap> = emptyMap(),
    val fallback: WeeklyCap = WeeklyCap.FALLBACK,
) {
    /** The cap governing the NY week that contains [instant]. */
    fun capAt(
        instant: Instant,
        zone: TimeZone = NEW_YORK,
    ): WeeklyCap = byWeekStart[mondayOf(instant, zone).toString()] ?: fallback

    companion object {
        /** No server data yet: every week resolves to [WeeklyCap.FALLBACK]. */
        val PENDING: WeeklyCapSchedule = WeeklyCapSchedule()

        /** Build from `effective_weekly_caps` rows: (ISO Monday, hours, enforcement). */
        fun of(rows: List<Triple<String, Double, CapEnforcement>>): WeeklyCapSchedule =
            WeeklyCapSchedule(rows.associate { (week, hours, enforcement) -> week to WeeklyCap(hours, enforcement) })
    }
}
