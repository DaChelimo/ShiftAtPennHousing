package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.network.TOAST_DURATION_MS
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.Onboarding
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.TipTrigger
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.AssistantViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.BreakTourViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.FloatCarouselViewModel
import com.pennhousing.shift.shared.viewmodel.HouseGridTourViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.OnboardingViewModel
import com.pennhousing.shift.shared.viewmodel.OpenClaimTourViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesTourViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftTourViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapTourViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.calendar.CalendarTabContent
import com.pennhousing.shift.ui.common.NotificationToast
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.house.HouseTabContent
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.manage.ManageShiftSheet
import com.pennhousing.shift.ui.navigation.MoreNavRow
import com.pennhousing.shift.ui.navigation.ShiftBottomNav
import com.pennhousing.shift.ui.onboarding.AskAssistantButton
import com.pennhousing.shift.ui.onboarding.BreakTourHelpButton
import com.pennhousing.shift.ui.onboarding.BreakTourOverlay
import com.pennhousing.shift.ui.onboarding.BreakTourPointerCallout
import com.pennhousing.shift.ui.onboarding.BreakTourPointerStore
import com.pennhousing.shift.ui.onboarding.BreakTourPrefs
import com.pennhousing.shift.ui.onboarding.HouseGridTourOverlay
import com.pennhousing.shift.ui.onboarding.HouseGridTourPointerCallout
import com.pennhousing.shift.ui.onboarding.HouseGridTourPointerStore
import com.pennhousing.shift.ui.onboarding.HouseGridTourPrefs
import com.pennhousing.shift.ui.onboarding.LocalOnboardingAnchors
import com.pennhousing.shift.ui.onboarding.NotificationPrimingHost
import com.pennhousing.shift.ui.onboarding.OnboardingAnchors
import com.pennhousing.shift.ui.onboarding.OnboardingOverlay
import com.pennhousing.shift.ui.onboarding.OnboardingPrefs
import com.pennhousing.shift.ui.onboarding.OpenClaimTourOverlay
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPointerCallout
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPointerStore
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPrefs
import com.pennhousing.shift.ui.onboarding.PreferencesTourHelpButton
import com.pennhousing.shift.ui.onboarding.PreferencesTourOverlay
import com.pennhousing.shift.ui.onboarding.PreferencesTourPointerCallout
import com.pennhousing.shift.ui.onboarding.PreferencesTourPointerStore
import com.pennhousing.shift.ui.onboarding.PreferencesTourPrefs
import com.pennhousing.shift.ui.onboarding.ShiftTourOverlay
import com.pennhousing.shift.ui.onboarding.ShiftTourPointerCallout
import com.pennhousing.shift.ui.onboarding.ShiftTourPointerStore
import com.pennhousing.shift.ui.onboarding.ShiftTourPrefs
import com.pennhousing.shift.ui.onboarding.SwapTourPrefs
import com.pennhousing.shift.ui.openshifts.OpenShiftsTabContent
import com.pennhousing.shift.ui.swaps.SwapsTabContent
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.resolveDark
import com.pennhousing.shift.ui.updates.UpdatesTabContent
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Instant

// The constants MUST match each tab's render position in the PrimaryScrollableTabRow —
// selectedTabIndex positions the indicator by row position (a mismatched constant
// underlines the wrong tab; caught on the T3b emulator spot-check).
//
// "My Shifts" is now the Personal Calendar (the old picked-up/dropped/scheduled bucket
// tab was removed — a single chronological view reads clearer). It stays first.
internal const val TAB_MY = 0 // chronological "My Shifts" (the Personal Calendar)
internal const val TAB_OPEN = 1 // "Open Shifts" — My House / Others sub-tabs (§5.6 Tabs 2+3)
internal const val TAB_HOUSE = 2 // §11.4 house schedule (T3b)
internal const val TAB_UPDATES = 3
internal const val TAB_PREFS = 4
internal const val TAB_BREAK = 5
internal const val TAB_SETTINGS = 6
internal const val TAB_SWAPS = 7 // dedicated Swaps tab (DESIGN §6) — in the "More" sheet
internal const val TAB_ASSISTANT = 8 // Desk Assistant chat — in the "More" sheet

// Open-Shifts sub-tabs (rendered inside TAB_OPEN).
internal const val OPEN_SUB_HOME = 0 // "My House"
internal const val OPEN_SUB_OTHER = 1 // "Others"

/**
 * Phase 13a — the worker's Shifts screen (BEHAVIORAL_SPECIFICATION.md §5.6).
 *
 * The three spec tabs (My Shifts / Open in My House / Open in Other Houses) plus
 * an Updates tab where a pending float surfaces (the ack/decline modal opens from
 * it). All decision logic comes from the shared [ShiftsScreenViewModel]; this is
 * native Compose UI over it (the Fruitties split). Selector ids match
 * `apps/mobile/maestro/README.md`.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun ShiftsApp(
    shiftsVm: ShiftsScreenViewModel,
    ackVm: AckDeclineViewModel,
    updatesVm: UpdatesViewModel,
    swapsVm: SwapsViewModel,
    calendarVm: CalendarViewModel,
    houseVm: HouseScheduleViewModel,
    preferencesVm: PreferencesViewModel,
    breakCalendarVm: BreakCalendarViewModel,
    settingsVm: SettingsViewModel,
    assistantVm: AssistantViewModel,
    currentWeeklyHours: Double,
    // The worker's load instant (the sim-clock on live) — builds the per-float ack
    // detail VM for the carousel's tap-to-detail. The screen VMs embed their own `now`.
    now: Instant,
    // Outstanding float requests for the My-Shifts carousel (§7.1), closest-start first.
    // Live host reads `worker_pending_floats`; demo seeds a couple. Empty → no carousel.
    pendingFloats: List<PendingFloat> = emptyList(),
    // Floats RESOLVED in the last 24h for the collapsible recent section under the carousel.
    recentFloats: List<RecentFloat> = emptyList(),
    breakProfile: Boolean = false,
    toast: ToastNotification? = null,
    // Non-null when a best-effort live write (drop/claim/reclaim/pickup/…) failed to
    // reach the server — surfaced as a top error toast so a swallowed EF failure no
    // longer masquerades as success. The host clears it after a few seconds and reverts
    // the optimistic move; demo defaults to null (no live writes).
    writeError: String? = null,
    onSignOut: () -> Unit = {},
    // Live host POSTs to `submit-preferences` then flips the optimistic state; demo
    // defaults to the local-only flip (the screen's own ViewModel.submit).
    onSubmitPreferences: () -> Unit = preferencesVm::submit,
    // Manager-only (BSpec §4.2): set the active period's submission deadline (year, month
    // 1..12, day). Null in the demo host (no live write); the setter card only renders when
    // the ViewModel reports `canSetDeadline`.
    onSetDeadline: ((Int, Int, Int) -> Unit)? = null,
    // Live host POSTs to `drop-shift` / `permanent-drop` on confirm (best-effort) while
    // the ViewModel still does the optimistic local move; demo defaults to no live write.
    onDropShift: (MyShift, Boolean) -> Unit = { _, _ -> },
    // Live host POSTs to `claim-shift` on confirm (best-effort) while the ViewModel still
    // does the optimistic local pickup; demo defaults to no live write. Used for WEEKLY
    // openings only — permanent openings route through [onPickUpPermanent].
    onClaimShift: (OpenShift) -> Unit = {},
    // The open-shift claim / permanent-pickup confirmation toast, OWNED BY THE HOST so it can
    // reflect the real network outcome (full success, an informative partial-pickup note, or
    // cleared on a full failure). The sheet sets it optimistically via [onClaimSuccessMessage];
    // the host's claim handler then overrides it once the per-block result is known.
    claimSuccessMessage: String? = null,
    onClaimSuccessMessage: (String?) -> Unit = {},
    // Live host POSTs to the `permanent-pickup` EF on confirm of a PERMANENT opening
    // (best-effort) — the real permanent-pickup path (the prior `claim-shift` permanent
    // returned 501). The ViewModel still does the optimistic local pickup; demo = no write.
    onPickUpPermanent: (OpenShift) -> Unit = {},
    // Live host GETs the `permanent-pickup` dry-run SCOPE for the design's "Picking up N of
    // M weeks · K skipped" confirmation; demo returns null (the sheet shows the plain note).
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
    // Live host POSTs to `acknowledge-float` / `decline-float` (best-effort) while the
    // ack ViewModel still does the optimistic local phase transition; demo defaults to
    // no live write. The argument is the float id the modal is showing.
    onAcknowledgeFloat: (String) -> Unit = {},
    onDeclineFloat: (String) -> Unit = {},
    // Break CALENDAR drag (§4.4): live host POSTs the dragged block ids to `break-claim`
    // (best-effort) and reconciles the picker to the server's actual claimed seats while
    // the picker does the optimistic local move; demo = no write. Argument = the dragged
    // claimable block ids.
    onClaimBreakRange: (List<String>) -> Unit = {},
    // Live host POSTs a `drop-shift` covering the run's seats; demo = no write. Argument =
    // the claimed seats' assignment ids.
    onDropBreakSeats: (List<String>) -> Unit = {},
    // Live host writes the §4.4 "no break hours" opt-out (own `break_optouts` row, insert/
    // delete) DIRECTLY via Postgrest while the picker flips its optimistic opted-out state;
    // demo defaults to no live write. The argument is the NEW desired opted-out state.
    onToggleBreakOptOut: (Boolean) -> Unit = {},
    // Live host PATCHes `users-broadcast-subscription` (best-effort) while the settings
    // ViewModel still does the optimistic local toggle; demo defaults to no live write.
    // The argument is the NEW desired subscription state. Only the broadcast / "General
    // updates" channel is interactive — the three personal-notif rows stay disabled (§10.1).
    onToggleBroadcast: (Boolean) -> Unit = {},
    // Live host loops the worker's still-unread notification ids through the
    // `mark_notification_read` RPC (best-effort) when "Mark all read" is tapped; the Updates
    // ViewModel does the optimistic local clear. Demo defaults to local-only (no write).
    onMarkAllRead: (List<String>) -> Unit = {},
    // Live host POSTs `accept-swap` / `reject-swap` (best-effort) when an incoming swap
    // entry's Accept/Decline is tapped (T3a); the Updates ViewModel already resolved the
    // entry optimistically. Demo defaults to local-only. The argument is the swap id.
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
    // Live host POSTs `acknowledge-allied-page` (best-effort) when a worker taps "I've
    // called the desk" on an off-hours ladder alert (staggered-rollout pilot); the Updates
    // ViewModel already resolved the entry optimistically. Demo = local-only. Arg = block id.
    onAcknowledgeAlliedPage: (String) -> Unit = {},
    // T2-13: non-null when the app was opened from the float push notification / a
    // `pennshift://float-ack/{floatId}` deep link → present the FULL-SCREEN ack
    // surface on launch (the ack VM already targets the worker's pending float).
    launchFloatAckId: String? = null,
    // D2/D3 + CALENDAR_REDESIGN: swap initiation via the week-paged calendar. [swapMeUserId]
    // is the live worker (null = demo → use [swapDemoSeats] for the current week); the
    // calendar fetches each navigated week's house grid live. `onCreateSwap` POSTs.
    swapMeUserId: String? = null,
    swapDemoSeats: List<HouseSeat> = emptyList(),
    onCreateSwap: suspend (SwapProposal) -> Boolean = { false },
    // D4 — cancel an own outgoing pending swap → `void-swap` (best-effort).
    onVoidSwap: (String) -> Unit = {},
) {
    // Appearance override: the settings VM holds the live choice so an in-app toggle
    // re-themes the whole app immediately (System → follow OS). Collected OUTSIDE the
    // theme so it can pick the palette.
    val settingsState by settingsVm.uiState.collectAsStateWithLifecycle()
    ShiftTheme(darkTheme = settingsState.theme.resolveDark()) {
        val state by shiftsVm.uiState.collectAsStateWithLifecycle()
        val updatesState by updatesVm.uiState.collectAsStateWithLifecycle()
        val swapsState by swapsVm.uiState.collectAsStateWithLifecycle()
        val breakState by breakCalendarVm.uiState.collectAsStateWithLifecycle()
        var selectedIndex by remember { mutableIntStateOf(TAB_MY) }
        var showAckModal by remember { mutableStateOf(false) }
        var swapProposed by remember { mutableStateOf(false) }
        // T2-13 — full-screen ack on push/deep-link launch (once per launch id).
        var showFullScreenAck by remember(launchFloatAckId) { mutableStateOf(launchFloatAckId != null) }
        // Preferences save-safety (§4): a tab switch requested while the Preferences tab
        // has unsaved edits is deferred here until the guard sheet resolves it.
        var pendingTab by remember { mutableStateOf<Int?>(null) }
        // Overflow ("More") bottom sheet — the episodic destinations.
        var showMore by remember { mutableStateOf(false) }

        // Auto-dismiss the transient confirmation toasts so they don't linger forever; the
        // effect restarts whenever the state changes (matches iOS's .task(id:) auto-dismiss).
        // writeError and claimSuccessMessage carry their own timers where the host owns them.
        LaunchedEffect(swapProposed) {
            if (swapProposed) {
                delay(TOAST_DURATION_MS)
                swapProposed = false
            }
        }

        // Float-request carousel (§7.1): the closest-first stack of outstanding floats on
        // My Shifts. Accept/Decline POST the EF (host) AND advance the local stack; tapping
        // a card opens the full ack hero for THAT float. Rebuilt whenever the live
        // `worker_pending_floats` read changes.
        val carouselVm = remember(pendingFloats, recentFloats, now) { FloatCarouselViewModel(pendingFloats, now, recentFloats) }
        val carouselState by carouselVm.uiState.collectAsStateWithLifecycle()
        // Which float (if any) the worker tapped to see in the full ack hero.
        var floatDetail by remember { mutableStateOf<PendingFloat?>(null) }
        // The "all handled" confirmation — reuses the auto-dismissing success-toast slot so
        // the worker knows they've cleared the whole stack (accept OR decline).
        LaunchedEffect(carouselState.allHandled) {
            if (carouselState.allHandled) {
                onClaimSuccessMessage(
                    if (carouselState.total > 1) "All float requests handled" else "Float request handled",
                )
            }
        }

        // TAB_MY (calendar) and TAB_OPEN read the same snapshot regardless of the
        // ShiftsScreenViewModel's selected tab; the Open-Shifts sub-tabs set it themselves.
        fun navigateTo(target: Int) {
            selectedIndex = target
        }

        // Leaving Preferences with unsaved edits → defer the move + raise the guard sheet.
        fun requestTab(target: Int) {
            if (selectedIndex == TAB_PREFS && target != TAB_PREFS && preferencesVm.uiState.value.isDirty) {
                pendingTab = target
            } else {
                navigateTo(target)
            }
        }

        // Onboarding (the first-run welcome tour + one-time contextual tips). The shared
        // OnboardingViewModel sequences everything; here we seed it from the persisted
        // seen-keys, persist on change, kick off the tour once, and raise tips as the
        // worker first reaches each root-level surface. See ui/onboarding/Onboarding.kt.
        val onboardingContext = LocalContext.current
        val onboardingVm = remember { OnboardingViewModel(OnboardingPrefs.read(onboardingContext)) }
        val onboardingState by onboardingVm.uiState.collectAsStateWithLifecycle()
        val onboardingAnchors = remember { OnboardingAnchors() }
        LaunchedEffect(Unit) { onboardingVm.start() }
        LaunchedEffect(onboardingState.seen) { OnboardingPrefs.write(onboardingContext, onboardingState.seen) }
        LaunchedEffect(selectedIndex) {
            when (selectedIndex) {
                TAB_MY -> onboardingVm.triggerTip(TipTrigger.MY_SHIFTS)
                // The Open-Shifts claim tour (openClaimTourVm, below) supersedes this flat
                // tip — its whole point is teaching one-time vs permanent pickup, which the
                // tip never covered.
                // The House-grid tour (houseGridTourVm, below) supersedes this flat tip.
                TAB_SWAPS -> onboardingVm.triggerTip(TipTrigger.INCOMING_SWAP)
            }
        }
        // The Break tour (breakTourVm, below) supersedes the old flat break-window tip.
        LaunchedEffect(carouselState.total) {
            if (carouselState.total > 0) onboardingVm.triggerTip(TipTrigger.FLOAT_REQUEST)
        }

        // The interactive "Manage a shift" tour (replaces the old My-Shifts contextual tip).
        // Own seen-key store; auto-opens on the first My-Shifts landing once the welcome
        // tour is done, re-openable from the header "?" and the Settings row. See
        // ui/onboarding/ShiftTourView.kt (Compose port of iosApp's ShiftTourView.swift).
        val shiftTourVm = remember { ShiftTourViewModel(ShiftTourPrefs.read(onboardingContext)) }
        val shiftTourState by shiftTourVm.uiState.collectAsStateWithLifecycle()
        LaunchedEffect(shiftTourState.seen) { ShiftTourPrefs.write(onboardingContext, shiftTourState.seen) }
        var shiftTourHelpRect by remember { mutableStateOf<Rect?>(null) }
        var showTourPointer by remember { mutableStateOf(false) }
        LaunchedEffect(selectedIndex) {
            if (selectedIndex == TAB_MY && Onboarding.WELCOME_DONE_KEY in onboardingState.seen) {
                shiftTourVm.autoStart()
            }
        }
        // After the tour first finishes, point at the header "?" once so the re-entry point
        // is learned, then it auto-fades (LaunchedEffect below).
        LaunchedEffect(shiftTourState.active) {
            if (!shiftTourState.active &&
                !ShiftTour.shouldAutoShow(shiftTourState.seen) &&
                !ShiftTourPointerStore.hasShown(onboardingContext)
            ) {
                ShiftTourPointerStore.markShown(onboardingContext)
                showTourPointer = true
            }
        }
        LaunchedEffect(showTourPointer) {
            if (showTourPointer) {
                kotlinx.coroutines.delay(4000)
                showTourPointer = false
            }
        }

        // Four more interactive tours, same shape as shiftTourVm's block above: own
        // seen-key store, auto-open on first landing (once the welcome tour is done),
        // replayable from a header "?" + the Settings row. See
        // docs/onboarding-android-port-plan.md / ui/onboarding/{Feature}TourView.kt (Compose
        // ports of iosApp's {Feature}TourView.swift).
        val preferencesTourVm = remember { PreferencesTourViewModel(PreferencesTourPrefs.read(onboardingContext)) }
        val preferencesTourState by preferencesTourVm.uiState.collectAsStateWithLifecycle()
        LaunchedEffect(preferencesTourState.seen) { PreferencesTourPrefs.write(onboardingContext, preferencesTourState.seen) }
        var preferencesTourHelpRect by remember { mutableStateOf<Rect?>(null) }
        var showPreferencesTourPointer by remember { mutableStateOf(false) }
        LaunchedEffect(selectedIndex) {
            // No prior Tier-2 tip existed for Preferences; this is net-new teaching.
            if (selectedIndex == TAB_PREFS && Onboarding.WELCOME_DONE_KEY in onboardingState.seen) {
                preferencesTourVm.autoStart()
            }
        }
        LaunchedEffect(preferencesTourState.active) {
            if (!preferencesTourState.active &&
                !PreferencesTour.shouldAutoShow(preferencesTourState.seen) &&
                !PreferencesTourPointerStore.hasShown(onboardingContext)
            ) {
                PreferencesTourPointerStore.markShown(onboardingContext)
                showPreferencesTourPointer = true
            }
        }
        LaunchedEffect(showPreferencesTourPointer) {
            if (showPreferencesTourPointer) {
                kotlinx.coroutines.delay(4000)
                showPreferencesTourPointer = false
            }
        }

        val breakTourVm = remember { BreakTourViewModel(BreakTourPrefs.read(onboardingContext)) }
        val breakTourState by breakTourVm.uiState.collectAsStateWithLifecycle()
        LaunchedEffect(breakTourState.seen) { BreakTourPrefs.write(onboardingContext, breakTourState.seen) }
        var breakTourHelpRect by remember { mutableStateOf<Rect?>(null) }
        var showBreakTourPointer by remember { mutableStateOf(false) }
        LaunchedEffect(breakState.phase) {
            // The interactive Break tour supersedes the old flat break-window tip.
            if (breakState.phase == BreakPhase.CLAIM_WINDOW && Onboarding.WELCOME_DONE_KEY in onboardingState.seen) {
                breakTourVm.autoStart()
            }
        }
        LaunchedEffect(breakTourState.active) {
            if (!breakTourState.active &&
                !BreakTour.shouldAutoShow(breakTourState.seen) &&
                !BreakTourPointerStore.hasShown(onboardingContext)
            ) {
                BreakTourPointerStore.markShown(onboardingContext)
                showBreakTourPointer = true
            }
        }
        LaunchedEffect(showBreakTourPointer) {
            if (showBreakTourPointer) {
                kotlinx.coroutines.delay(4000)
                showBreakTourPointer = false
            }
        }

        val houseGridTourVm = remember { HouseGridTourViewModel(HouseGridTourPrefs.read(onboardingContext)) }
        val houseGridTourState by houseGridTourVm.uiState.collectAsStateWithLifecycle()
        LaunchedEffect(houseGridTourState.seen) { HouseGridTourPrefs.write(onboardingContext, houseGridTourState.seen) }
        var houseGridTourHelpRect by remember { mutableStateOf<Rect?>(null) }
        var showHouseGridTourPointer by remember { mutableStateOf(false) }
        LaunchedEffect(selectedIndex) {
            // The interactive House-grid tour supersedes the old flat "Call the desk" tip.
            if (selectedIndex == TAB_HOUSE && Onboarding.WELCOME_DONE_KEY in onboardingState.seen) {
                houseGridTourVm.autoStart()
            }
        }
        LaunchedEffect(houseGridTourState.active) {
            if (!houseGridTourState.active &&
                !HouseGridTour.shouldAutoShow(houseGridTourState.seen) &&
                !HouseGridTourPointerStore.hasShown(onboardingContext)
            ) {
                HouseGridTourPointerStore.markShown(onboardingContext)
                showHouseGridTourPointer = true
            }
        }
        LaunchedEffect(showHouseGridTourPointer) {
            if (showHouseGridTourPointer) {
                kotlinx.coroutines.delay(4000)
                showHouseGridTourPointer = false
            }
        }

        val openClaimTourVm = remember { OpenClaimTourViewModel(OpenClaimTourPrefs.read(onboardingContext)) }
        val openClaimTourState by openClaimTourVm.uiState.collectAsStateWithLifecycle()
        LaunchedEffect(openClaimTourState.seen) { OpenClaimTourPrefs.write(onboardingContext, openClaimTourState.seen) }
        var openClaimTourHelpRect by remember { mutableStateOf<Rect?>(null) }
        var showOpenClaimTourPointer by remember { mutableStateOf(false) }
        LaunchedEffect(selectedIndex) {
            // The interactive Open-Shifts claim tour supersedes the old flat Open-Shifts tip
            // (its whole point is teaching one-time vs permanent pickup, which the tip never
            // covered).
            if (selectedIndex == TAB_OPEN && Onboarding.WELCOME_DONE_KEY in onboardingState.seen) {
                openClaimTourVm.autoStart()
            }
        }
        LaunchedEffect(openClaimTourState.active) {
            if (!openClaimTourState.active &&
                !OpenClaimTour.shouldAutoShow(openClaimTourState.seen) &&
                !OpenClaimTourPointerStore.hasShown(onboardingContext)
            ) {
                OpenClaimTourPointerStore.markShown(onboardingContext)
                showOpenClaimTourPointer = true
            }
        }
        LaunchedEffect(showOpenClaimTourPointer) {
            if (showOpenClaimTourPointer) {
                kotlinx.coroutines.delay(4000)
                showOpenClaimTourPointer = false
            }
        }

        // The swap-composer tour. Unlike the four tours above, this one does NOT auto-open
        // on a tab landing — it opens the FIRST time the worker reaches the swap PAGE inside
        // the manage-shift sheet (after already choosing "Swap it" over "Drop the shift" on
        // the prior page; that Drop-vs-Swap decision is ShiftTour's job, not this tour's),
        // and is intentionally NOT gated on the welcome tour being done (mirrors iOS's
        // `ManageShiftSheet.onChange(of: page)`, which carries no such gate either — by the
        // time a worker reaches this deep into a flow, welcome-tour sequencing no longer
        // applies). The ViewModel + seen-key store live HERE (shared by the Settings replay
        // row); the autoStart trigger, overlay, help button, and one-time pointer all render
        // from INSIDE ManageShiftSheet itself (nested inside CalendarTabContent) since a
        // root-level overlay would render BEHIND the modal bottom sheet — mirrors iOS's
        // `showSwapTourPointer` being `@State` local to its `ManageShiftSheet`, not lifted to
        // the top-level `ContentView`.
        val swapTourVm = remember { SwapTourViewModel(SwapTourPrefs.read(onboardingContext)) }
        val swapTourState by swapTourVm.uiState.collectAsStateWithLifecycle()
        LaunchedEffect(swapTourState.seen) { SwapTourPrefs.write(onboardingContext, swapTourState.seen) }

        CompositionLocalProvider(LocalOnboardingAnchors provides onboardingAnchors) {
            Box(Modifier.fillMaxSize()) {
                Scaffold(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            // Maestro matches Compose testTags only when they surface as
                            // resource-ids — without this every `id:` selector silently fails.
                            .semantics { testTagsAsResourceId = true }
                            .testTag("shifts_screen"),
                    // Bottom nav (Material 3): four frequent destinations + a "More" overflow
                    // sheet for the episodic ones (Preferences / Break shifts / Settings).
                    bottomBar = {
                        ShiftBottomNav(
                            selectedIndex = selectedIndex,
                            hasUnread = updatesState.hasUnread,
                            onSelect = { requestTab(it) },
                            onMore = { showMore = true },
                        )
                    },
                    // The "Ask" affordance lives on the My-Shifts home screen ONLY. It used to ride
                    // every tab, but a floating button that follows you everywhere is noise rather
                    // than discoverability: it covers content on feeds and grids where the Assistant
                    // isn't what you came to do. The Assistant stays reachable from "More" everywhere.
                    // The first-run tour rings this button (on My Shifts, where the tour runs).
                    floatingActionButton = {
                        if (selectedIndex == TAB_MY) {
                            AskAssistantButton(onClick = { navigateTo(TAB_ASSISTANT) })
                        }
                    },
                ) { padding ->
                    Box(Modifier.fillMaxSize().padding(padding)) {
                        Column(Modifier.fillMaxSize()) {
                            // §4.4 — while a break's claim window is open, promote the Break calendar
                            // with a visible banner from every other tab (it otherwise lives in More).
                            if (selectedIndex != TAB_BREAK && breakState.phase == BreakPhase.CLAIM_WINDOW) {
                                BreakOpenBanner(breakState.breakName) { navigateTo(TAB_BREAK) }
                            }
                            when (selectedIndex) {
                                // "My Shifts" is the chronological Personal Calendar now (the old
                                // picked-up/dropped/scheduled bucket tab was removed). Drop/swap are
                                // wired onto the agenda cards; a dropped shift leaves the agenda and
                                // surfaces in the Open-Shifts tabs (no reclaim).
                                TAB_MY ->
                                    CalendarTabContent(
                                        vm = calendarVm,
                                        shiftsVm = shiftsVm,
                                        breakProfile = breakProfile,
                                        // §7.1 float-request carousel under the hours chip. Accept/Decline
                                        // POST the EF and advance the stack; tapping a card opens the hero.
                                        floatCarousel = carouselState,
                                        onFloatAccept = { id ->
                                            onAcknowledgeFloat(id)
                                            carouselVm.acknowledge(id)
                                        },
                                        onFloatDecline = { id ->
                                            onDeclineFloat(id)
                                            carouselVm.decline(id)
                                        },
                                        onFloatDetail = { id -> floatDetail = pendingFloats.firstOrNull { it.floatId == id } },
                                        onDropShift = onDropShift,
                                        swapMeUserId = swapMeUserId,
                                        swapDemoSeats = swapDemoSeats,
                                        onCreateSwap = onCreateSwap,
                                        onSwapProposed = { swapProposed = true },
                                        // Incoming-swap accept/decline tapped from a flagged agenda card —
                                        // same host POSTs as the Swaps tab; the Swaps list resolves too.
                                        onAcceptSwap = { swapId ->
                                            swapsVm.resolveIncoming(swapId)
                                            onAcceptSwap(swapId)
                                        },
                                        onRejectSwap = { swapId ->
                                            swapsVm.resolveIncoming(swapId)
                                            onRejectSwap(swapId)
                                        },
                                        // Cancel an OWN outgoing swap from the "swap pending" card tapped on
                                        // a flagged agenda shift — same host POST as the Swaps tab's Cancel.
                                        onVoidSwap = { swapId ->
                                            swapsVm.cancelOutgoing(swapId)
                                            onVoidSwap(swapId)
                                        },
                                        onReplayShiftTour = shiftTourVm::replay,
                                        onShiftTourHelpPositioned = { shiftTourHelpRect = it },
                                        swapTourVm = swapTourVm,
                                    )
                                TAB_OPEN ->
                                    OpenShiftsTabContent(
                                        state = state,
                                        vm = shiftsVm,
                                        calendarVm = calendarVm,
                                        currentWeeklyHours = currentWeeklyHours,
                                        breakProfile = breakProfile,
                                        onClaimed = { msg -> onClaimSuccessMessage(msg) },
                                        onClaimShift = onClaimShift,
                                        onPickUpPermanent = onPickUpPermanent,
                                        loadPermanentScope = loadPermanentScope,
                                        onReplayOpenClaimTour = openClaimTourVm::replay,
                                        onOpenClaimTourHelpPositioned = { openClaimTourHelpRect = it },
                                    )
                                TAB_HOUSE ->
                                    HouseTabContent(
                                        vm = houseVm,
                                        meUserId = swapMeUserId,
                                        onReplayHouseGridTour = houseGridTourVm::replay,
                                        onHouseGridTourHelpPositioned = { houseGridTourHelpRect = it },
                                    )
                                TAB_UPDATES ->
                                    UpdatesTabContent(
                                        feed = updatesState.feed,
                                        hasUnread = updatesState.hasUnread,
                                        onOpenAck = { showAckModal = true },
                                        onMarkAllRead = {
                                            // Optimistic local clear (returns the ids that were unread),
                                            // then best-effort live persist via the host callback.
                                            onMarkAllRead(updatesVm.markAllRead())
                                        },
                                        // DESIGN §6 — an incoming-swap row is a MIRROR: tapping it
                                        // deep-links to the Swaps tab (where Accept/Decline live).
                                        onOpenSwaps = { navigateTo(TAB_SWAPS) },
                                        // Off-hours ladder ack: optimistic local resolve, then best-effort live POST.
                                        onAcknowledgeAlliedPage = { blockId ->
                                            updatesVm.acknowledgeAlliedPage(blockId)
                                            onAcknowledgeAlliedPage(blockId)
                                        },
                                    )
                                TAB_SWAPS ->
                                    SwapsTabContent(
                                        state = swapsState,
                                        onSelectTab = swapsVm::selectTab,
                                        // Incoming Accept/Decline + outgoing Cancel: optimistic local
                                        // resolve (the row leaves its list), then best-effort live POST.
                                        onAcceptSwap = { swapId ->
                                            swapsVm.resolveIncoming(swapId)
                                            onAcceptSwap(swapId)
                                        },
                                        onRejectSwap = { swapId ->
                                            swapsVm.resolveIncoming(swapId)
                                            onRejectSwap(swapId)
                                        },
                                        onVoidSwap = { swapId ->
                                            swapsVm.cancelOutgoing(swapId)
                                            onVoidSwap(swapId)
                                        },
                                    )
                                TAB_PREFS ->
                                    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
                                        PageTitle("Preferences") {
                                            PreferencesTourHelpButton(
                                                onClick = preferencesTourVm::replay,
                                                onPositioned = { preferencesTourHelpRect = it },
                                            )
                                        }
                                        PreferencesTabContent(preferencesVm, onSubmitPreferences, onSetDeadline = onSetDeadline)
                                    }
                                TAB_BREAK ->
                                    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
                                        PageTitle("Break shifts") {
                                            BreakTourHelpButton(
                                                onClick = breakTourVm::replay,
                                                onPositioned = { breakTourHelpRect = it },
                                            )
                                        }
                                        BreakCalendarTabContent(breakCalendarVm, onClaimBreakRange, onDropBreakSeats, onToggleBreakOptOut)
                                    }
                                TAB_SETTINGS ->
                                    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
                                        PageTitle("Settings")
                                        SettingsTabContent(
                                            settingsVm,
                                            onSignOut,
                                            onToggleBroadcast,
                                            onReplayTour = onboardingVm::replayTour,
                                            onReplayShiftTour = {
                                                requestTab(TAB_MY)
                                                shiftTourVm.replay()
                                            },
                                            onReplayPreferencesTour = {
                                                requestTab(TAB_PREFS)
                                                preferencesTourVm.replay()
                                            },
                                            onReplayBreakTour = {
                                                requestTab(TAB_BREAK)
                                                breakTourVm.replay()
                                            },
                                            // The swap composer lives in a sheet, not a tab — priming it
                                            // here means it fires the next time the worker reaches the
                                            // swap page (see ManageShiftSheet's page == Swap gating).
                                            onReplaySwapTour = {
                                                requestTab(TAB_MY)
                                                swapTourVm.replay()
                                            },
                                            onReplayHouseGridTour = {
                                                requestTab(TAB_HOUSE)
                                                houseGridTourVm.replay()
                                            },
                                            onReplayOpenClaimTour = {
                                                requestTab(TAB_OPEN)
                                                openClaimTourVm.replay()
                                            },
                                        )
                                    }
                                TAB_ASSISTANT -> AssistantScreen(assistantVm)
                            }
                        }
                        // Toasts now sit at the BOTTOM (above the nav bar) — the intuitive place
                        // for transient confirmations; a swallowed write failure no longer hides.
                        Column(
                            Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth()
                                .padding(bottom = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            writeError?.let {
                                // A swallowed EF write failure (edge runtime down, timeout, expired
                                // token) used to be invisible — the optimistic card stayed put while
                                // the server never changed. Surface it; the host reverts to server truth.
                                ShiftToast(
                                    message = it,
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp)
                                            .testTag("write_error"),
                                    tone = ToastTone.Error,
                                    icon = ShiftIcons.Warning,
                                )
                            }
                            claimSuccessMessage?.let { msg ->
                                ShiftToast(
                                    message = msg,
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp)
                                            .testTag("claim_success"),
                                    tone = ToastTone.Success,
                                    icon = ShiftIcons.Check,
                                )
                            }
                            if (swapProposed) {
                                ShiftToast(
                                    message = "Swap proposed. Your housemate has been asked",
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 16.dp)
                                            .testTag("swap_proposed_toast"),
                                    tone = ToastTone.Success,
                                    icon = ShiftIcons.Check,
                                )
                            }
                            toast?.let { NotificationToast(it) }
                        }
                    }
                }
                OnboardingOverlay(
                    state = onboardingState,
                    anchors = onboardingAnchors,
                    onNext = onboardingVm::next,
                    onBack = onboardingVm::back,
                    onSkip = onboardingVm::skipTour,
                    onDismissTip = onboardingVm::dismissTip,
                )
                // Notification priming — once the welcome tour is done, explain WHY alerts matter
                // and (only on Confirm) fire the real OS permission request. Replaces the cold
                // launch-time prompt that used to fire in MainActivity.onCreate.
                NotificationPrimingHost(tourDone = Onboarding.WELCOME_DONE_KEY in onboardingState.seen)
                // The interactive "Manage a shift" tour — above the whole screen; auto-opens on the
                // first My-Shifts landing and on replay (from the header "?" or Settings row).
                if (shiftTourState.active) {
                    ShiftTourOverlay(
                        state = shiftTourState,
                        onNext = shiftTourVm::next,
                        onBack = shiftTourVm::back,
                        onSkip = shiftTourVm::skip,
                        // Tapping away is a quick "not now", not the natural finish the one-time
                        // store gates on -- always re-point at the header "?" so the worker still
                        // learns where to pick the tour back up, every time this happens.
                        onDismissOutside = {
                            shiftTourVm.skip()
                            showTourPointer = true
                        },
                    )
                }
                // The one-time "look here" pointer at the header "?", positioned from the real
                // button's reported bounds so it always lands on the actual control.
                if (showTourPointer) {
                    ShiftTourPointerCallout(targetRect = shiftTourHelpRect)
                }
                // Four more interactive tours, identical shape to shiftTourVm's block above.
                if (preferencesTourState.active) {
                    PreferencesTourOverlay(
                        state = preferencesTourState,
                        onNext = preferencesTourVm::next,
                        onBack = preferencesTourVm::back,
                        onSkip = preferencesTourVm::skip,
                        onDismissOutside = {
                            preferencesTourVm.skip()
                            showPreferencesTourPointer = true
                        },
                    )
                }
                if (showPreferencesTourPointer) {
                    PreferencesTourPointerCallout(targetRect = preferencesTourHelpRect)
                }
                if (breakTourState.active) {
                    BreakTourOverlay(
                        state = breakTourState,
                        onNext = breakTourVm::next,
                        onBack = breakTourVm::back,
                        onSkip = breakTourVm::skip,
                        onDismissOutside = {
                            breakTourVm.skip()
                            showBreakTourPointer = true
                        },
                    )
                }
                if (showBreakTourPointer) {
                    BreakTourPointerCallout(targetRect = breakTourHelpRect)
                }
                if (houseGridTourState.active) {
                    HouseGridTourOverlay(
                        state = houseGridTourState,
                        onNext = houseGridTourVm::next,
                        onBack = houseGridTourVm::back,
                        onSkip = houseGridTourVm::skip,
                        onDismissOutside = {
                            houseGridTourVm.skip()
                            showHouseGridTourPointer = true
                        },
                    )
                }
                if (showHouseGridTourPointer) {
                    HouseGridTourPointerCallout(targetRect = houseGridTourHelpRect)
                }
                if (openClaimTourState.active) {
                    OpenClaimTourOverlay(
                        state = openClaimTourState,
                        onNext = openClaimTourVm::next,
                        onBack = openClaimTourVm::back,
                        onSkip = openClaimTourVm::skip,
                        onDismissOutside = {
                            openClaimTourVm.skip()
                            showOpenClaimTourPointer = true
                        },
                    )
                }
                if (showOpenClaimTourPointer) {
                    OpenClaimTourPointerCallout(targetRect = openClaimTourHelpRect)
                }
                // The swap-composer tour overlay + pointer are rendered from INSIDE
                // ManageShiftSheet (via CalendarTabContent), not here — see the swapTourVm comment
                // above: a root-level overlay would render BEHIND the modal bottom sheet.
            }
        }

        if (showAckModal) {
            FloatAcknowledgmentModal(
                ackVm = ackVm,
                onAcknowledgeFloat = onAcknowledgeFloat,
                onDeclineFloat = onDeclineFloat,
                onClose = { showAckModal = false },
            )
        }

        if (showFullScreenAck) {
            // T2-13 — push-launched full-screen FloatAckSurface, over everything.
            FloatAcknowledgmentFullScreen(
                ackVm = ackVm,
                onAcknowledgeFloat = onAcknowledgeFloat,
                onDeclineFloat = onDeclineFloat,
                onClose = { showFullScreenAck = false },
            )
        }

        // §7.1 — tap-for-detail on a carousel card opens the full ack hero for THAT float
        // (a per-float ack VM, independent of the deep-link `ackVm`). Accept/Decline POST
        // the EF, advance the carousel stack, and dismiss.
        floatDetail?.let { f ->
            val detailVm = remember(f) { AckDeclineViewModel(f.toFloatAck(), now) }
            FloatAcknowledgmentModal(
                ackVm = detailVm,
                onAcknowledgeFloat = { id ->
                    onAcknowledgeFloat(id)
                    carouselVm.acknowledge(id)
                },
                onDeclineFloat = { id ->
                    onDeclineFloat(id)
                    carouselVm.decline(id)
                },
                onClose = { floatDetail = null },
            )
        }

        pendingTab?.let { target ->
            // §4 save-safety — leaving Preferences with unsaved edits.
            PrefUnsavedChangesSheet(
                onSubmitAndLeave = {
                    onSubmitPreferences()
                    pendingTab = null
                    navigateTo(target)
                },
                onDiscardAndLeave = {
                    preferencesVm.revert()
                    pendingTab = null
                    navigateTo(target)
                },
                onKeepEditing = { pendingTab = null },
            )
        }

        if (showMore) {
            // The "More" overflow sheet — episodic destinations (Preferences once a
            // semester, Break shifts only during breaks, Settings rarely). Rows keep the
            // original tab selectors; the Maestro flows open More first, then tap them.
            ShiftBottomSheet(onDismiss = { showMore = false }, title = "More") {
                Column(Modifier.testTag("more_sheet"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    MoreNavRow("Updates", ShiftIcons.Bell, "tab_updates") {
                        showMore = false
                        requestTab(TAB_UPDATES)
                    }
                    MoreNavRow("Preferences", ShiftIcons.Heart, "tab_preferences") {
                        showMore = false
                        requestTab(TAB_PREFS)
                    }
                    MoreNavRow("Break shifts", ShiftIcons.Snowflake, "tab_break") {
                        showMore = false
                        requestTab(TAB_BREAK)
                    }
                    MoreNavRow("Settings", ShiftIcons.Tune, "tab_settings") {
                        showMore = false
                        requestTab(TAB_SETTINGS)
                    }
                    MoreNavRow("Assistant", ShiftIcons.Sparkle, "tab_assistant") {
                        showMore = false
                        requestTab(TAB_ASSISTANT)
                    }
                }
            }
        }
    }
}
