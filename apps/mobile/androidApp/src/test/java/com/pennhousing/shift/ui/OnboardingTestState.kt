package com.pennhousing.shift.ui

import android.content.Context
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.Onboarding
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.ui.onboarding.BreakTourPrefs
import com.pennhousing.shift.ui.onboarding.HouseGridTourPrefs
import com.pennhousing.shift.ui.onboarding.NotificationPrefs
import com.pennhousing.shift.ui.onboarding.OnboardingPrefs
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPrefs
import com.pennhousing.shift.ui.onboarding.PreferencesTourPrefs
import com.pennhousing.shift.ui.onboarding.ShiftTourPrefs
import com.pennhousing.shift.ui.onboarding.SwapTourPrefs

/**
 * Shared fixture for any Robolectric test that drives the REAL app shell (`ShiftsApp`).
 *
 * A first launch is not the state most screen tests mean to test: the welcome tour opens over
 * everything, and each of the six per-surface tours auto-opens the first time you land on its
 * screen. Those overlays swallow input, so a test that just calls `setContent` and starts tapping
 * silently interacts with an overlay instead of the screen — it fails, but for a reason that has
 * nothing to do with what it was written to check. (That is exactly how this helper came about.)
 *
 * [markAllToursSeen] puts the app in the RETURNING-user state: every tour already dismissed and
 * the first-run notification primer PROMPT already answered, so nothing is floating above the
 * screen. Each of these keeps its own store, so every one has to be seeded — a new tour or prompt
 * added later must be added here too, or the shell tests will start failing mysteriously. The
 * tours and prompts have their own dedicated coverage.
 */
internal object OnboardingTestState {
    fun markAllToursSeen(context: Context) {
        // The welcome tour + the one-shot contextual tips share one store.
        val welcome =
            Onboarding.WELCOME_TOUR.map { it.key }.toSet() +
                Onboarding.CONTEXTUAL_TIPS.values.map { it.key }.toSet() +
                Onboarding.WELCOME_DONE_KEY
        OnboardingPrefs.write(context, welcome)

        // Each interactive tour has its own namespace + done-key.
        ShiftTourPrefs.write(context, setOf(ShiftTour.DONE_KEY))
        PreferencesTourPrefs.write(context, setOf(PreferencesTour.DONE_KEY))
        BreakTourPrefs.write(context, setOf(BreakTour.DONE_KEY))
        SwapTourPrefs.write(context, setOf(SwapTour.DONE_KEY))
        HouseGridTourPrefs.write(context, setOf(HouseGridTour.DONE_KEY))
        OpenClaimTourPrefs.write(context, setOf(OpenClaimTour.DONE_KEY))

        // The first-run notification-primer PROMPT is separate from the tours and renders as
        // its own blocking card, coming up as soon as the welcome tour is marked done — so
        // seeding only the tours trades one overlay for another.
        NotificationPrefs.markResponded(context)
    }
}
