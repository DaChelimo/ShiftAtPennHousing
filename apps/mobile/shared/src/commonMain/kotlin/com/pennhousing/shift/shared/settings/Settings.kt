package com.pennhousing.shift.shared.settings

import com.pennhousing.shift.shared.shifts.BREAK_HOURS_CAP
import com.pennhousing.shift.shared.shifts.SOFT_HOURS_CAP
import com.pennhousing.shift.shared.shifts.formatHours

/*
 * Settings / Profile — PURE presentation logic shared by both platforms, the settings
 * analogue of the other screens' presentation layers. Identity + the notification
 * channels + the appearance choice + the (read-only) hours limits, with NO clock and
 * NO I/O — the profile snapshot is injected.
 *
 * DATA AVAILABILITY (this is a NEW screen — checked before building):
 *  - Identity is READABLE: a worker can SELECT their own `users` row (name, email,
 *    home_house_id) + own `user_roles` (role) + `houses` (name) — all RLS-allowed.
 *    (There is no purpose-built profile view, so the live read joins those tables;
 *    today the screen renders the demo profile, with the read path documented.)
 *  - `users.broadcast_subscribed` ("General updates") is the ONE user-toggleable
 *    channel — there is **no authenticated UPDATE policy on `users`**, so the write
 *    goes through the `users-broadcast-subscription` Edge Function (it also blocks
 *    HM/BM from subscribing). Kept optimistic-local here (mirroring the Shifts
 *    screen's claim/drop); the EF is the documented write path.
 *  - Float assignments are ALWAYS ON by spec (§7). Shift-reminders /
 *    schedule-published have **no per-category opt-out backing** (only
 *    broadcast_subscribed has storage) → shown always-on/disabled, NOT fabricated.
 *  - The hours limits are the shared constants (soft 20h / break-hard 40h).
 *  - Theme is client-only (no backend); applying it app-wide is a host concern.
 *  - Sign out uses the existing `AuthGateway.signOut`.
 */

/** Appearance preference (client-only). */
enum class ThemeChoice { SYSTEM, LIGHT, DARK }

fun ThemeChoice.label(): String =
    when (this) {
        ThemeChoice.SYSTEM -> "System"
        ThemeChoice.LIGHT -> "Light"
        ThemeChoice.DARK -> "Dark"
    }

/** Segmented order: System · Light · Dark. */
val THEME_CHOICES: List<ThemeChoice> = listOf(ThemeChoice.SYSTEM, ThemeChoice.LIGHT, ThemeChoice.DARK)

/** Map a raw `user_roles.role` to a display label. */
fun roleLabel(role: String): String =
    when (role.lowercase()) {
        "sw" -> "Student Worker"
        "sm" -> "Shift Manager"
        "hm" -> "House Manager"
        "bm" -> "Building Manager"
        else -> "Staff"
    }

/** First letter of [name], for the avatar monogram. */
fun initialOf(name: String): String = name.trim().firstOrNull()?.uppercase() ?: "?"

/** The worker's identity, from their own `users` / `user_roles` / `houses` rows. */
data class SettingsProfile(
    val name: String,
    val email: String,
    val role: String,
    val homeHouseName: String,
) {
    val initial: String get() = initialOf(name)
    val roleLabel: String get() = roleLabel(role)

    /** "Harnwell College House · Student Worker" — the profile-card subtitle. */
    val subtitle: String get() = "$homeHouseName · $roleLabel"
}

/** A notification channel — only [interactive] rows are user-toggleable. */
enum class NotificationChannel { FLOAT, SHIFT_REMINDERS, SCHEDULE_PUBLISHED, GENERAL_UPDATES }

data class NotificationRowModel(
    val channel: NotificationChannel,
    val title: String,
    val sub: String,
    val on: Boolean,
    val interactive: Boolean,
)

/**
 * The four notification rows. Only GENERAL_UPDATES is user-toggleable (binds to
 * `users.broadcast_subscribed`); FLOAT is always-on by spec; SHIFT_REMINDERS /
 * SCHEDULE_PUBLISHED have no opt-out backing → always-on/disabled (see GAP above).
 */
fun buildNotificationRows(broadcastSubscribed: Boolean): List<NotificationRowModel> =
    listOf(
        NotificationRowModel(
            NotificationChannel.FLOAT,
            "Float assignments",
            "Always on — time-critical",
            on = true,
            interactive = false,
        ),
        NotificationRowModel(
            NotificationChannel.SHIFT_REMINDERS,
            "Shift reminders",
            "Always on — before each shift",
            on = true,
            interactive = false,
        ),
        NotificationRowModel(
            NotificationChannel.SCHEDULE_PUBLISHED,
            "Schedule published",
            "Always on",
            on = true,
            interactive = false,
        ),
        NotificationRowModel(
            NotificationChannel.GENERAL_UPDATES,
            "General updates",
            "House-wide broadcasts",
            on = broadcastSubscribed,
            interactive = true,
        ),
    )

/** The read-only "Hours & limits" display values, from the shared caps. */
data class HoursLimits(
    val softCapLabel: String,
    val hardCapLabel: String,
)

fun hoursLimits(): HoursLimits = HoursLimits(softCapLabel = formatHours(SOFT_HOURS_CAP), hardCapLabel = formatHours(BREAK_HOURS_CAP))
