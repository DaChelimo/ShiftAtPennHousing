package com.pennhousing.shift.ui

import android.content.Context
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.NotificationPriming
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.ui.onboarding.BreakTourPrefs
import com.pennhousing.shift.ui.onboarding.HouseGridTourPrefs
import com.pennhousing.shift.ui.onboarding.NotificationPrefs
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPrefs
import com.pennhousing.shift.ui.onboarding.PreferencesTourPrefs
import com.pennhousing.shift.ui.onboarding.ShiftTourPrefs
import com.pennhousing.shift.ui.onboarding.SwapTourPrefs

/**
 * Shared fixture for any Robolectric test that drives the REAL app shell (`ShiftsApp`).
 *
 * A first launch is not the state most screen tests mean to test: each of the six per-surface
 * tours auto-opens the first time you land on its screen, and those overlays swallow input, so
 * a test that just calls `setContent` and starts tapping silently interacts with an overlay
 * instead of the screen — it fails, but for a reason that has nothing to do with what it was
 * written to check. (That is exactly how this helper came about.)
 *
 * [markAllToursSeen] puts the app in the RETURNING-user state. Each tour keeps its own store,
 * so every one has to be seeded; a new tour added later must be added here too, or the shell
 * tests will start failing mysteriously. Each tour has its own dedicated coverage.
 *
 * The notification ask does NOT need seeding to unblock a test: since 2026-08-03 it is an
 * inline row rather than a blocking card, so it never covers the screen. The two contextual
 * flags are still burned here so a test asserting on the toast stack is not surprised by an
 * extra row riding a claim or swap success.
 */
internal object OnboardingTestState {
    fun markAllToursSeen(context: Context) {
        // Each interactive tour has its own namespace + done-key.
        ShiftTourPrefs.write(context, setOf(ShiftTour.DONE_KEY))
        PreferencesTourPrefs.write(context, setOf(PreferencesTour.DONE_KEY))
        BreakTourPrefs.write(context, setOf(BreakTour.DONE_KEY))
        SwapTourPrefs.write(context, setOf(SwapTour.DONE_KEY))
        HouseGridTourPrefs.write(context, setOf(HouseGridTour.DONE_KEY))
        OpenClaimTourPrefs.write(context, setOf(OpenClaimTour.DONE_KEY))

        // The two once-per-install contextual notification asks (after a claim, after a swap).
        NotificationPrefs.markAsked(context, NotificationPriming.ASKED_AFTER_CLAIM_KEY)
        NotificationPrefs.markAsked(context, NotificationPriming.ASKED_AFTER_SWAP_KEY)
    }
}
