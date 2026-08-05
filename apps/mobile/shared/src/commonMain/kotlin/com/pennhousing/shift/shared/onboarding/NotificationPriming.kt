package com.pennhousing.shift.shared.onboarding

/*
 * NotificationPriming — the pure decision + copy for the in-app ask that precedes the OS
 * notification permission dialog. Rendered natively per platform (Compose / SwiftUI); this
 * object is the shared source of truth for WHEN it shows and WHAT it says.
 *
 * REDESIGNED 2026-08-03. The previous shape was a single blocking full-screen card fired
 * once, at the tail of first-run onboarding, with a three-line body and a "Not now" opt-out.
 * It converted badly for a structural reason: at that moment the worker has no shifts yet,
 * so there is nothing to be reminded about, and a modal at the end of setup reads as one
 * more thing to dismiss. Declining also burned the single ask, because "Not now" marked the
 * primer responded for the whole install.
 *
 * It is now a NON-BLOCKING inline row shown at moments where the payoff is concrete:
 *
 *  - STANDING, on My Shifts, above the schedule, for as long as alerts are off. It has NO
 *    dismiss control by design: it is one thin row that costs nothing to scroll past, so a
 *    worker who ignores it today still finds it the day they actually want a reminder.
 *  - CONTEXTUAL, at most once each per install, right after an action whose payoff IS a
 *    push: claiming an open shift, and sending a swap or hand-off request. The reply or the
 *    reminder is the thing being offered, so the ask is no longer hypothetical.
 *
 * Copy is one line everywhere. The old body went unread.
 *
 * The button adapts to what the OS will actually do ([confirmLabel]). Because the standing
 * row now persists until alerts are ON, it WILL outlive the point where the OS stops
 * surfacing a dialog (Android silently ignores the request after two denials; iOS only
 * prompts while authorization is `.notDetermined`). Past that point the row deep-links to
 * the app's notification settings instead, so the button is never a no-op.
 *
 * Persistence of the contextual asked-flags is a platform concern (SharedPreferences on
 * Android, UserDefaults on iOS). These are per-device UX flags, not server state.
 */
object NotificationPriming {
    /** One line, stated as the benefit. Shown standing on My Shifts. */
    const val BODY_MY_SHIFTS: String = "Turn on alerts to get reminders before your shifts."

    /** Shown once, right after a successful claim: the reminder is for the shift just taken. */
    const val BODY_AFTER_CLAIM: String = "Turn on alerts to get a reminder before this shift."

    /** Shown once, right after a swap or hand-off is sent: the reply arrives as a push. */
    const val BODY_AFTER_SWAP: String = "Turn on alerts to know as soon as they respond."

    /** Primary action while the OS will still raise its own dialog. */
    const val CONFIRM: String = "Turn on"

    /** Primary action once the OS will no longer prompt, so the row opens app settings. */
    const val CONFIRM_SETTINGS: String = "Open settings"

    /** Persisted once the after-claim contextual row has been shown, so it shows once. */
    const val ASKED_AFTER_CLAIM_KEY: String = "notif.asked.claim"

    /** Persisted once the after-swap contextual row has been shown, so it shows once. */
    const val ASKED_AFTER_SWAP_KEY: String = "notif.asked.swap"

    /**
     * The standing My-Shifts row: shown whenever alerts are off, full stop. No dismiss flag
     * and no first-run gate, so a worker who ignores it, or who turns alerts off later in
     * system settings, is offered it again the next time they open their schedule.
     */
    fun shouldShowStandingNudge(granted: Boolean): Boolean = !granted

    /**
     * A contextual row after a claim / swap send: only while alerts are off, and only if
     * that specific moment has not already asked on this device ([alreadyAsked], keyed by
     * [ASKED_AFTER_CLAIM_KEY] / [ASKED_AFTER_SWAP_KEY]). Two extra asks per install is the
     * whole budget; repeating on every claim would be the nagging the modal was cut for.
     */
    fun shouldShowContextualNudge(
        granted: Boolean,
        alreadyAsked: Boolean,
    ): Boolean = !granted && !alreadyAsked

    /**
     * What the button should say. [osCanPrompt] is computed by the platform (Android: API
     * 33+ and POST_NOTIFICATIONS not granted; iOS: authorization status is `.notDetermined`).
     * When it is false the OS dialog is spent, so the row must route to settings instead of
     * firing a request that does nothing.
     */
    fun confirmLabel(osCanPrompt: Boolean): String = if (osCanPrompt) CONFIRM else CONFIRM_SETTINGS
}
