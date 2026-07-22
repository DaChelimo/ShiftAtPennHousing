package com.pennhousing.shift.shared.onboarding

/*
 * NotificationPriming — the pure decision + copy for the "why we send alerts" primer that
 * REPLACES the cold OS permission dialog. Rendered natively per platform (Compose /
 * SwiftUI); this object is the shared source of truth for WHEN it shows and WHAT it says,
 * mirroring how `Onboarding` holds the tour/tip copy.
 *
 * The card is a PRE-permission primer: tapping [CONFIRM] fires the real OS request; tapping
 * [DISMISS] never touches it. Not touching the OS prompt on "Not now" is the whole point on
 * iOS, where the system dialog is a ONE-SHOT (a denial can only be reversed from Settings),
 * so a worker who declines the primer can still be re-asked at a more meaningful moment.
 *
 * It shows once the welcome tour is done, so setup is never interrupted by a permission
 * sheet, and only while the OS would actually surface a prompt (never asked yet) and the
 * worker has not already responded to the primer on this device.
 */
object NotificationPriming {
    /** Persisted once the worker taps Confirm OR Dismiss on the primer, so it shows once. */
    const val RESPONDED_KEY: String = "notif.primer.responded"

    const val TITLE: String = "Stay covered"
    const val BODY: String =
        "Shift pings you the moment a desk opens up, when you are floated to another house, " +
            "and when a shift needs your OK. Miss the ping, miss the shift."
    const val CONFIRM: String = "Turn on alerts"
    const val DISMISS: String = "Not now"

    /**
     * True when the priming card should be shown right now:
     *  - the welcome tour has finished or been skipped ([tourDone]), so the primer never
     *    interrupts first-run setup;
     *  - the OS would actually surface a system prompt ([osCanPrompt]) — the platform
     *    computes this (Android: API 33+ and POST_NOTIFICATIONS not granted; iOS:
     *    authorization status is `.notDetermined`). A worker who already granted, or who
     *    can no longer be prompted, is not shown a dead-end primer;
     *  - and the worker has not already responded to the primer on this device
     *    ([alreadyResponded]) — covers the "Not now" case within an install.
     */
    fun shouldShowPrimer(
        tourDone: Boolean,
        osCanPrompt: Boolean,
        alreadyResponded: Boolean,
    ): Boolean = tourDone && osCanPrompt && !alreadyResponded
}
