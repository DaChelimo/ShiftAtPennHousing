package com.pennhousing.shift.shared.settings

/*
 * Settings / Profile — PURE presentation logic shared by both platforms, the settings
 * analogue of the other screens' presentation layers. Identity + the notification
 * channels + the appearance choice, with NO clock and NO I/O — the profile snapshot is
 * injected.
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
 *  - The mandatory channels (float, swap request, break sign-up, preferences, shift
 *    reminders, schedule published) have NO opt-out storage BY DESIGN (BSpec §10.1) and
 *    render always-on/disabled. The two "a shift opened up" channels are the only
 *    configurable ones and live in `notification_preferences`, written through the
 *    `set_notification_preferences` RPC (there is no direct table write path).
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
        "rsm" -> "Residential Services Manager"
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

/**
 * A notification channel. Only [NotificationRowModel.interactive] rows are toggleable,
 * and the split is a PRODUCT RULE, not a UI convenience (BSpec §10.1, 2026-07-28):
 *
 *  - MANDATORY, because each one either is time-critical or needs an answer from this
 *    worker: float assignments, swap requests and their resolutions, break sign-up
 *    opening, preference-window events, shift reminders, schedule published.
 *  - CONFIGURABLE, and there are exactly two, both "a shift opened up": openings at the
 *    worker's OWN house (on by default) and openings at OTHER houses (opt-in).
 *
 * Adding a channel here does NOT make it optional. Only the two OPEN_SHIFTS_* rows have
 * storage (`notification_preferences`); everything else is always on by construction.
 */
enum class NotificationChannel {
    FLOAT,
    SWAP_REQUESTS,
    BREAK_SIGNUP,
    PREFERENCES,
    SHIFT_REMINDERS,
    SCHEDULE_PUBLISHED,
    OPEN_SHIFTS_HOME_HOUSE,
    OPEN_SHIFTS_OTHER_HOUSES,
    GENERAL_UPDATES,
}

/**
 * The worker's two configurable channels, mirroring the `notification_preferences` row.
 * The defaults here MUST match the column defaults and `wants_open_shift_notification`:
 * a worker who has never opened Settings behaves exactly like one who kept the defaults.
 */
data class NotificationPreferences(
    val openShiftsHomeHouse: Boolean = true,
    val openShiftsOtherHouses: Boolean = false,
    /**
     * Minutes before a shift starts at which to remind this worker. Any subset of
     * [SHIFT_REMINDER_LEAD_TIMES]; EMPTY means no shift reminders, which is a supported
     * choice, not an unset value. Default is 1 hour alone.
     *
     * Mirrors `notification_preferences.shift_reminder_offsets` and
     * `worker_shift_reminder_offsets()`. If you change this default, change all three.
     */
    val shiftReminderOffsets: Set<Int> = setOf(60),
)

/**
 * The lead times a worker may pick, longest first (product decision 2026-07-28). The DB
 * rejects anything outside this set, so the UI and the constraint must agree.
 */
val SHIFT_REMINDER_LEAD_TIMES: List<Int> = listOf(120, 60, 30)

/** "2 hours before the shift" / "1 hour before the shift" / "30 minutes before the shift". */
fun shiftReminderLabel(offsetMinutes: Int): String =
    when {
        offsetMinutes >= 120 -> "${offsetMinutes / 60} hours before the shift"
        offsetMinutes >= 60 -> "${offsetMinutes / 60} hour before the shift"
        else -> "$offsetMinutes minutes before the shift"
    }

/**
 * The sub-line under the "Shift reminders" row: what the worker will actually get. Says
 * "Off" plainly when nothing is ticked, rather than leaving a blank that reads as a bug.
 */
fun shiftReminderSummary(offsets: Set<Int>): String =
    if (offsets.isEmpty()) {
        "Off. You will not be reminded before your shifts."
    } else {
        SHIFT_REMINDER_LEAD_TIMES.filter { it in offsets }.joinToString(", ") { shiftReminderLabel(it) }
    }

data class NotificationRowModel(
    val channel: NotificationChannel,
    val title: String,
    val sub: String,
    val on: Boolean,
    val interactive: Boolean,
)

/**
 * The notification rows the Settings screen renders. Order is deliberate: the mandatory
 * channels first (so a worker can SEE that a swap request will always reach them), then
 * the two they control.
 *
 * A mandatory row is shown on and disabled rather than hidden. Hiding it invites the
 * question "will I be told?"; showing it answers it.
 */
fun buildNotificationRows(
    prefs: NotificationPreferences,
    broadcastSubscribed: Boolean,
): List<NotificationRowModel> =
    listOf(
        NotificationRowModel(
            NotificationChannel.FLOAT,
            "Float assignments",
            "Always on (you have to respond)",
            on = true,
            interactive = false,
        ),
        NotificationRowModel(
            NotificationChannel.SWAP_REQUESTS,
            "Swap requests",
            "Always on (you have to respond)",
            on = true,
            interactive = false,
        ),
        NotificationRowModel(
            NotificationChannel.BREAK_SIGNUP,
            "Break sign-up opening",
            "Always on (first come, first served)",
            on = true,
            interactive = false,
        ),
        NotificationRowModel(
            NotificationChannel.PREFERENCES,
            "Preferences and deadlines",
            "Always on",
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
            NotificationChannel.SHIFT_REMINDERS,
            "Shift reminders",
            shiftReminderSummary(prefs.shiftReminderOffsets),
            // ON means "at least one lead time is ticked". The row expands to the three
            // checkboxes; the switch itself is not the control, the checkboxes are.
            on = prefs.shiftReminderOffsets.isNotEmpty(),
            interactive = true,
        ),
        // These two render as ONE "Open shift notifications" card with two sub-toggles
        // (the UI groups them by channel; see OPEN_SHIFTS_GROUP_TITLE/SUB below), the
        // same pattern SHIFT_REMINDERS uses for its lead-time checkboxes. They stay two
        // separate channels/columns underneath because they persist and toggle independently.
        NotificationRowModel(
            NotificationChannel.OPEN_SHIFTS_HOME_HOUSE,
            "At my house",
            "When someone drops a shift at your house",
            on = prefs.openShiftsHomeHouse,
            interactive = true,
        ),
        NotificationRowModel(
            NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES,
            "At other houses",
            "When a shift you could pick up opens elsewhere",
            on = prefs.openShiftsOtherHouses,
            interactive = true,
        ),
        NotificationRowModel(
            NotificationChannel.GENERAL_UPDATES,
            "General updates",
            "House-wide broadcasts",
            on = broadcastSubscribed,
            interactive = true,
        ),
    )

/** Apply a toggle to [prefs]. Returns [prefs] unchanged for a non-configurable channel. */
fun NotificationPreferences.toggled(channel: NotificationChannel): NotificationPreferences =
    when (channel) {
        NotificationChannel.OPEN_SHIFTS_HOME_HOUSE -> copy(openShiftsHomeHouse = !openShiftsHomeHouse)
        NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES -> copy(openShiftsOtherHouses = !openShiftsOtherHouses)
        // Flipping the whole row off clears every lead time; flipping it back on restores
        // the default rather than an empty set, which would be an "on" row that does nothing.
        NotificationChannel.SHIFT_REMINDERS ->
            copy(shiftReminderOffsets = if (shiftReminderOffsets.isEmpty()) setOf(60) else emptySet())
        else -> this
    }

/**
 * Tick or untick ONE lead time. Unticking the last one is allowed and means "no shift
 * reminders": all, some, or none are all reachable from here. An unsupported offset is
 * ignored rather than stored, since the server rejects it anyway.
 */
fun NotificationPreferences.withShiftReminderToggled(offsetMinutes: Int): NotificationPreferences {
    if (offsetMinutes !in SHIFT_REMINDER_LEAD_TIMES) return this
    return copy(
        shiftReminderOffsets =
            if (offsetMinutes in shiftReminderOffsets) {
                shiftReminderOffsets - offsetMinutes
            } else {
                shiftReminderOffsets + offsetMinutes
            },
    )
}

// The Settings screen used to carry a read-only "Hours & limits" group showing a static
// 20h soft cap / 40h break hard cap. It was removed (2026-07-29) along with the rest of
// the client-side cap constants: the cap is per-week server config (see
// `effective_weekly_caps`), so a fixed pair of numbers on a settings screen could only
// ever be wrong once a season set its own cap.

/**
 * Header copy for the merged "Open shift notifications" card (BSpec §10.1, amended
 * 2026-08-06): [NotificationChannel.OPEN_SHIFTS_HOME_HOUSE] and
 * [NotificationChannel.OPEN_SHIFTS_OTHER_HOUSES] used to render as two unrelated peer
 * rows; they are one concept (a shift opened up) with two independent toggles, same as
 * the shift-reminder lead times.
 */
const val OPEN_SHIFTS_GROUP_TITLE = "Open shift notifications"
const val OPEN_SHIFTS_GROUP_SUB = "When a shift opens up for pickup"

/**
 * The Settings redesign (2026-08-06) collapsed the six mandatory (non-interactive)
 * notification rows behind a disclosure so the two configurable groups (shift reminders,
 * open shifts) and General updates are not competing for attention with rows a worker
 * cannot change. This is the label for that disclosure's summary row.
 */
fun alwaysOnNotificationsLabel(count: Int): String = "Always-on notifications ($count)"

/**
 * Privacy Policy / Terms of Service, hosted as real pages on the guide site
 * (`apps/docs`, deployed at shiftatpenn.com/guide) rather than in-app text, so the one
 * legal source of truth (the markdown files under `docs/legal`) is never forked. Settings
 * links out to these; there is no offline/in-app fallback copy.
 */
const val PRIVACY_POLICY_URL = "https://shiftatpenn.com/guide/legal/privacy"
const val TERMS_OF_SERVICE_URL = "https://shiftatpenn.com/guide/legal/terms"
