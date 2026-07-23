package com.pennhousing.shift.ui.onboarding

import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.SwapTour

/**
 * The six tours' wirings, each pointing [rememberTourHost] at that tour's own seen-key
 * store, its own pointer flag, and its own auto-show rule. Nothing here is shared between
 * tours by design: persisting one tour's progress must never clobber another's.
 */
internal object TourWirings {
    val Shift =
        TourWiring(
            writeSeen = ShiftTourPrefs::write,
            pointerHasShown = ShiftTourPointerStore::hasShown,
            pointerMarkShown = ShiftTourPointerStore::markShown,
            shouldAutoShow = ShiftTour::shouldAutoShow,
        )

    val Preferences =
        TourWiring(
            writeSeen = PreferencesTourPrefs::write,
            pointerHasShown = PreferencesTourPointerStore::hasShown,
            pointerMarkShown = PreferencesTourPointerStore::markShown,
            shouldAutoShow = PreferencesTour::shouldAutoShow,
        )

    val Break =
        TourWiring(
            writeSeen = BreakTourPrefs::write,
            pointerHasShown = BreakTourPointerStore::hasShown,
            pointerMarkShown = BreakTourPointerStore::markShown,
            shouldAutoShow = BreakTour::shouldAutoShow,
        )

    val HouseGrid =
        TourWiring(
            writeSeen = HouseGridTourPrefs::write,
            pointerHasShown = HouseGridTourPointerStore::hasShown,
            pointerMarkShown = HouseGridTourPointerStore::markShown,
            shouldAutoShow = HouseGridTour::shouldAutoShow,
        )

    val OpenClaim =
        TourWiring(
            writeSeen = OpenClaimTourPrefs::write,
            pointerHasShown = OpenClaimTourPointerStore::hasShown,
            pointerMarkShown = OpenClaimTourPointerStore::markShown,
            shouldAutoShow = OpenClaimTour::shouldAutoShow,
        )

    /**
     * The swap-composer tour opens from inside ManageShiftSheet rather than on a tab
     * landing, so only [rememberTourSeenWriter] uses this; the pointer members are unused
     * but kept so the six wirings stay uniform.
     */
    val Swap =
        TourWiring(
            writeSeen = SwapTourPrefs::write,
            pointerHasShown = SwapTourPointerStore::hasShown,
            pointerMarkShown = SwapTourPointerStore::markShown,
            shouldAutoShow = SwapTour::shouldAutoShow,
        )
}
