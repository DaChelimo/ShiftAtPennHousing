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
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.network.TOAST_DURATION_MS
import com.pennhousing.shift.shared.notifications.ToastNotification
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.NotificationPriming
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.BreakTourViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.FloatCarouselViewModel
import com.pennhousing.shift.shared.viewmodel.HouseGridTourViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
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
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.manage.ManageShiftSheet
import com.pennhousing.shift.ui.manager.CoverageBanner
import com.pennhousing.shift.ui.manager.CoverageScreen
import com.pennhousing.shift.ui.manager.HoursScreen
import com.pennhousing.shift.ui.manager.NotAManagerPlaceholder
import com.pennhousing.shift.ui.navigation.MoreSheet
import com.pennhousing.shift.ui.navigation.ShiftBottomNav
import com.pennhousing.shift.ui.navigation.ShiftDestination
import com.pennhousing.shift.ui.navigation.rememberShiftNavigationState
import com.pennhousing.shift.ui.navigation.rememberShiftNavigator
import com.pennhousing.shift.ui.onboarding.BreakTourHelpButton
import com.pennhousing.shift.ui.onboarding.BreakTourOverlay
import com.pennhousing.shift.ui.onboarding.BreakTourPointerCallout
import com.pennhousing.shift.ui.onboarding.BreakTourPointerStore
import com.pennhousing.shift.ui.onboarding.BreakTourPrefs
import com.pennhousing.shift.ui.onboarding.HouseGridTourOverlay
import com.pennhousing.shift.ui.onboarding.HouseGridTourPointerCallout
import com.pennhousing.shift.ui.onboarding.HouseGridTourPointerStore
import com.pennhousing.shift.ui.onboarding.HouseGridTourPrefs
import com.pennhousing.shift.ui.onboarding.NotificationNudgeRow
import com.pennhousing.shift.ui.onboarding.NotificationPrefs
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
import com.pennhousing.shift.ui.onboarding.TourWirings
import com.pennhousing.shift.ui.onboarding.rememberNotificationNudge
import com.pennhousing.shift.ui.onboarding.rememberTourHost
import com.pennhousing.shift.ui.onboarding.rememberTourSeenWriter
import com.pennhousing.shift.ui.openshifts.OpenShiftsTabContent
import com.pennhousing.shift.ui.swaps.SwapsTabContent
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.resolveDark
import com.pennhousing.shift.ui.updates.UpdatesTabContent
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Instant

// Open-Shifts sub-tabs (rendered inside ShiftDestination.OpenShifts).
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
internal fun ShiftsApp(
    viewModels: ShiftsViewModels,
    hostState: ShiftsHostState,
    actions: ShiftsActions = ShiftsActions(),
) {
    // Unpack the grouped inputs back into the names the body below has always used, so the
    // grouping is purely the public contract (see ShiftsAppInputs.kt) and the screen logic is
    // unchanged. onSubmitPreferences resolves its ViewModel-dependent default here, the one
    // place that carries both the action and the ViewModel.
    val shiftsVm = viewModels.shiftsVm
    val ackVm = viewModels.ackVm
    val updatesVm = viewModels.updatesVm
    val swapsVm = viewModels.swapsVm
    val calendarVm = viewModels.calendarVm
    val houseVm = viewModels.houseVm
    val preferencesVm = viewModels.preferencesVm
    val breakCalendarVm = viewModels.breakCalendarVm
    val settingsVm = viewModels.settingsVm
    val now = hostState.now
    val currentWeeklyHours = hostState.currentWeeklyHours
    val pendingFloats = hostState.pendingFloats
    val recentFloats = hostState.recentFloats
    val breakProfile = hostState.breakProfile
    val toast = hostState.toast
    val writeError = hostState.writeError
    val claimSuccessMessage = hostState.claimSuccessMessage
    val launchFloatAckId = hostState.launchFloatAckId
    val swapMeUserId = hostState.swapMeUserId
    val swapDemoSeats = hostState.swapDemoSeats
    val onSignOut = actions.onSignOut
    val onSubmitPreferences = actions.onSubmitPreferences ?: preferencesVm::submit
    val onSetDeadline = actions.onSetDeadline
    val onDropShift = actions.onDropShift
    val onClaimShift = actions.onClaimShift
    val onClaimSuccessMessage = actions.onClaimSuccessMessage
    val onPickUpPermanent = actions.onPickUpPermanent
    val loadPermanentScope = actions.loadPermanentScope
    val onAcknowledgeFloat = actions.onAcknowledgeFloat
    val onDeclineFloat = actions.onDeclineFloat
    val onClaimBreakRange = actions.onClaimBreakRange
    val onDropBreakSeats = actions.onDropBreakSeats
    val onToggleBreakOptOut = actions.onToggleBreakOptOut
    val onToggleBroadcast = actions.onToggleBroadcast
    val onToggleNotification = actions.onToggleNotification
    val onMarkAllRead = actions.onMarkAllRead
    val onAcceptSwap = actions.onAcceptSwap
    val onRejectSwap = actions.onRejectSwap
    val onAcknowledgeAlliedPage = actions.onAcknowledgeAlliedPage
    val onCreateSwap = actions.onCreateSwap
    val onVoidSwap = actions.onVoidSwap
    // Manager mode (docs/manager-app/SPEC.md). A plain worker has coverageVm == null and
    // default capabilities, so every branch below is inert for them.
    val coverageVm = viewModels.coverageVm
    val capabilities = hostState.capabilities
    val onAcknowledgeCoverage = actions.onAcknowledgeCoverage
    val onCloseCoverage = actions.onCloseCoverage
    val onCallPhone = actions.onCallPhone
    // The coverage writes are suspend (they must report success so a failure can revert), and
    // they are fired from tap handlers rather than from composition.
    val coverageAckScope = rememberCoroutineScope()
    // Appearance override: the settings VM holds the live choice so an in-app toggle
    // re-themes the whole app immediately (System → follow OS). Collected OUTSIDE the
    // theme so it can pick the palette.
    val settingsState by settingsVm.uiState.collectAsStateWithLifecycle()
    ShiftTheme(darkTheme = settingsState.theme.resolveDark()) {
        val state by shiftsVm.uiState.collectAsStateWithLifecycle()
        val updatesState by updatesVm.uiState.collectAsStateWithLifecycle()
        val swapsState by swapsVm.uiState.collectAsStateWithLifecycle()
        val breakState by breakCalendarVm.uiState.collectAsStateWithLifecycle()
        var showAckModal by remember { mutableStateOf(false) }
        var swapProposed by remember { mutableStateOf(false) }
        // T2-13 — full-screen ack on push/deep-link launch (once per launch id).
        var showFullScreenAck by remember(launchFloatAckId) { mutableStateOf(launchFloatAckId != null) }
        // Preferences save-safety (§4): a tab switch requested while the Preferences tab
        // has unsaved edits is deferred here until the guard sheet resolves it.
        var pendingTab by remember { mutableStateOf<ShiftDestination?>(null) }
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

        // Navigation 3 owns the back stack (see ui/navigation/). `current` replaces the old
        // `selectedIndex` Int, and every move — including the system back button — routes
        // through ShiftNavigator, so the unsaved-Preferences guard sits in exactly one place
        // instead of hanging off the forward-navigation helper only. The Calendar and
        // Open-Shifts destinations still read the same snapshot regardless of the
        // ShiftsScreenViewModel's own tab; the Open-Shifts sub-tabs set that themselves.
        // Manager mode: the Coverage tab is a manager's START destination, because it is the
        // one surface where a delay means a desk goes empty. A worker's start is unchanged.
        val coverageState = coverageVm?.uiState?.collectAsStateWithLifecycle()?.value
        val managerBar =
            remember(capabilities) {
                ShiftDestination.bottomBarFor(
                    hasCoverage = capabilities.hasCoverage,
                    isStudentManager = capabilities.isStudentManager,
                )
            }
        val navState = rememberShiftNavigationState(startRoute = ShiftDestination.startFor(capabilities.hasCoverage))
        val nav =
            rememberShiftNavigator(
                state = navState,
                // §4 save-safety: Preferences refuses to be left while it holds unsaved edits.
                canLeave = { from, _ -> from != ShiftDestination.Preferences || !preferencesVm.uiState.value.isDirty },
                onBlocked = { pendingTab = it },
            )
        val current = nav.current

        val onboardingContext = LocalContext.current

        // The notification ask. Re-read on every tab change so a grant made in the OS dialog
        // (or in system settings, after the row deep-links there) retires the row without a
        // restart. See ui/onboarding/NotificationNudge.kt for the shape and the shared
        // `NotificationPriming` for why this replaced the first-run modal.
        val notificationNudge = rememberNotificationNudge(refreshToken = current)
        // The two once-per-install contextual asks, latched when their moment first fires so
        // the row survives the recomposition that marks the flag.
        var askedAfterClaim by remember {
            mutableStateOf(NotificationPrefs.hasAsked(onboardingContext, NotificationPriming.ASKED_AFTER_CLAIM_KEY))
        }
        var askedAfterSwap by remember {
            mutableStateOf(NotificationPrefs.hasAsked(onboardingContext, NotificationPriming.ASKED_AFTER_SWAP_KEY))
        }
        // Each contextual row is LATCHED for the life of the toast it rides, and its
        // once-per-install flag is burned the moment it appears. Deriving visibility from the
        // flag instead would make the row erase itself in the same frame it rendered.
        var claimNudgeShowing by remember { mutableStateOf(false) }
        var swapNudgeShowing by remember { mutableStateOf(false) }
        LaunchedEffect(claimSuccessMessage, notificationNudge.granted) {
            if (claimSuccessMessage == null) {
                claimNudgeShowing = false
            } else if (!claimNudgeShowing &&
                NotificationPriming.shouldShowContextualNudge(notificationNudge.granted, askedAfterClaim)
            ) {
                claimNudgeShowing = true
                NotificationPrefs.markAsked(onboardingContext, NotificationPriming.ASKED_AFTER_CLAIM_KEY)
                askedAfterClaim = true
            }
        }
        LaunchedEffect(swapProposed, notificationNudge.granted) {
            if (!swapProposed) {
                swapNudgeShowing = false
            } else if (!swapNudgeShowing &&
                NotificationPriming.shouldShowContextualNudge(notificationNudge.granted, askedAfterSwap)
            ) {
                swapNudgeShowing = true
                NotificationPrefs.markAsked(onboardingContext, NotificationPriming.ASKED_AFTER_SWAP_KEY)
                askedAfterSwap = true
            }
        }

        // The six interactive tours. Each owns its OWN seen-key store and pointer flag
        // (persisting one must never clobber another) and auto-opens the first time the
        // worker reaches its surface. `rememberTourHost` holds the five effects they all used
        // to repeat verbatim; the per-tour keys and auto-show rule live in TourWirings. These
        // six ARE the app's onboarding now: the first-run welcome tour and the flat one-card
        // tips were cut on 2026-08-03 (BSpec §20.1). See ui/onboarding/TourHost.kt.
        val shiftTourVm = remember { ShiftTourViewModel(ShiftTourPrefs.read(onboardingContext)) }
        val shiftTourState by shiftTourVm.uiState.collectAsStateWithLifecycle()
        val shiftTour =
            rememberTourHost(
                wiring = TourWirings.Shift,
                seen = shiftTourState.seen,
                active = shiftTourState.active,
                autoStartWhen = current == ShiftDestination.MyShifts,
                onAutoStart = shiftTourVm::autoStart,
            )

        // Net-new teaching: no prior contextual tip existed for Preferences.
        val preferencesTourVm = remember { PreferencesTourViewModel(PreferencesTourPrefs.read(onboardingContext)) }
        val preferencesTourState by preferencesTourVm.uiState.collectAsStateWithLifecycle()
        val preferencesTour =
            rememberTourHost(
                wiring = TourWirings.Preferences,
                seen = preferencesTourState.seen,
                active = preferencesTourState.active,
                autoStartWhen = current == ShiftDestination.Preferences,
                onAutoStart = preferencesTourVm::autoStart,
            )

        // Keyed on the break PHASE, not a tab: it opens when a claim window does.
        val breakTourVm = remember { BreakTourViewModel(BreakTourPrefs.read(onboardingContext)) }
        val breakTourState by breakTourVm.uiState.collectAsStateWithLifecycle()
        val breakTour =
            rememberTourHost(
                wiring = TourWirings.Break,
                seen = breakTourState.seen,
                active = breakTourState.active,
                autoStartWhen = breakState.phase == BreakPhase.CLAIM_WINDOW,
                onAutoStart = breakTourVm::autoStart,
            )

        val houseGridTourVm = remember { HouseGridTourViewModel(HouseGridTourPrefs.read(onboardingContext)) }
        val houseGridTourState by houseGridTourVm.uiState.collectAsStateWithLifecycle()
        val houseGridTour =
            rememberTourHost(
                wiring = TourWirings.HouseGrid,
                seen = houseGridTourState.seen,
                active = houseGridTourState.active,
                autoStartWhen = current == ShiftDestination.House,
                onAutoStart = houseGridTourVm::autoStart,
            )

        val openClaimTourVm = remember { OpenClaimTourViewModel(OpenClaimTourPrefs.read(onboardingContext)) }
        val openClaimTourState by openClaimTourVm.uiState.collectAsStateWithLifecycle()
        val openClaimTour =
            rememberTourHost(
                wiring = TourWirings.OpenClaim,
                seen = openClaimTourState.seen,
                active = openClaimTourState.active,
                autoStartWhen = current == ShiftDestination.OpenShifts,
                onAutoStart = openClaimTourVm::autoStart,
            )

        // The swap-composer tour is the one exception. It does NOT auto-open on a landing:
        // it opens the first time the worker reaches the swap PAGE inside the manage-shift
        // sheet, having already chosen "Swap it" over "Drop the shift" (that decision is
        // ShiftTour's job), mirroring iOS's `ManageShiftSheet.onChange(of: page)`. The
        // ViewModel and seen-key store live here because
        // the Settings replay row shares them, but the autoStart trigger, overlay, help
        // button and pointer all render from INSIDE ManageShiftSheet: a root-level overlay
        // would render BEHIND the modal bottom sheet.
        val swapTourVm = remember { SwapTourViewModel(SwapTourPrefs.read(onboardingContext)) }
        val swapTourState by swapTourVm.uiState.collectAsStateWithLifecycle()
        rememberTourSeenWriter(TourWirings.Swap, swapTourState.seen)

        // Destination -> screen. Navigation 3 resolves whichever key is on the back stack
        // through this, so the routing table is one readable block instead of a `when` on an
        // Int buried in the Scaffold body.
        val shiftEntryProvider =
            entryProvider<NavKey> {
                // "My Shifts" is the chronological Personal Calendar now (the old
                // picked-up/dropped/scheduled bucket tab was removed). Drop/swap are
                // wired onto the agenda cards; a dropped shift leaves the agenda and
                // surfaces in the Open-Shifts tabs (no reclaim).
                entry<ShiftDestination.MyShifts> {
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
                        onShiftTourHelpPositioned = { shiftTour.helpRect = it },
                        swapTourVm = swapTourVm,
                    )
                }
                entry<ShiftDestination.OpenShifts> {
                    OpenShiftsTabContent(
                        state = state,
                        vm = shiftsVm,
                        calendarVm = calendarVm,
                        currentWeeklyHours = currentWeeklyHours,
                        onClaimed = { msg -> onClaimSuccessMessage(msg) },
                        onClaimShift = onClaimShift,
                        onPickUpPermanent = onPickUpPermanent,
                        loadPermanentScope = loadPermanentScope,
                        onReplayOpenClaimTour = openClaimTourVm::replay,
                        onOpenClaimTourHelpPositioned = { openClaimTour.helpRect = it },
                    )
                }
                entry<ShiftDestination.House> {
                    HouseTabContent(
                        vm = houseVm,
                        meUserId = swapMeUserId,
                        onReplayHouseGridTour = houseGridTourVm::replay,
                        onHouseGridTourHelpPositioned = { houseGridTour.helpRect = it },
                    )
                }
                entry<ShiftDestination.Updates> {
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
                        onOpenSwaps = { nav.navigate(ShiftDestination.Swaps) },
                        // Off-hours ladder ack: optimistic local resolve, then best-effort live POST.
                        onAcknowledgeAlliedPage = { blockId ->
                            updatesVm.acknowledgeAlliedPage(blockId)
                            onAcknowledgeAlliedPage(blockId)
                        },
                    )
                }
                entry<ShiftDestination.Swaps> {
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
                }
                entry<ShiftDestination.Preferences> {
                    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
                        PageTitle("Preferences") {
                            PreferencesTourHelpButton(
                                onClick = preferencesTourVm::replay,
                                onPositioned = { preferencesTour.helpRect = it },
                            )
                        }
                        PreferencesTabContent(preferencesVm, onSubmitPreferences, onSetDeadline = onSetDeadline)
                    }
                }
                entry<ShiftDestination.BreakShifts> {
                    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
                        PageTitle("Break shifts") {
                            BreakTourHelpButton(
                                onClick = breakTourVm::replay,
                                onPositioned = { breakTour.helpRect = it },
                            )
                        }
                        BreakCalendarTabContent(breakCalendarVm, onClaimBreakRange, onDropBreakSeats, onToggleBreakOptOut)
                    }
                }
                entry<ShiftDestination.Settings> {
                    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
                        PageTitle("Settings")
                        SettingsTabContent(
                            settingsVm,
                            onSignOut,
                            onToggleBroadcast,
                            onToggleNotification = onToggleNotification,
                        )
                    }
                }
                // ----- Manager mode (docs/manager-app/SPEC.md §6). -----
                // Both entries render an explanatory empty state rather than nothing when the
                // signed-in user is not a manager. A destination reachable only from a
                // role-gated bar should still be safe to land on: Nav3 restores a serialized
                // back stack across process death, so a manager whose role was revoked between
                // launches would otherwise get a blank screen.
                entry<ShiftDestination.Coverage> {
                    if (coverageVm != null && coverageState != null) {
                        CoverageScreen(
                            state = coverageState,
                            // Tapping a card ACKNOWLEDGES. The ViewModel flips local state and
                            // hands back the id to write; a failed write reverts so the banner
                            // returns and the ladder keeps going.
                            onRespond = { requestId ->
                                val toAck = coverageVm.openRespond(requestId)
                                if (toAck != null) {
                                    coverageAckScope.launch {
                                        if (!onAcknowledgeCoverage(toAck)) coverageVm.revertAcknowledge(toAck)
                                    }
                                }
                            },
                            onSelectOutcome = coverageVm::selectOutcome,
                            onCoverPersonally = coverageVm::coverPersonally,
                            onNoteChange = coverageVm::updateNote,
                            onSubmit = {
                                val intent = coverageVm.submitClose()
                                if (intent != null) {
                                    coverageAckScope.launch {
                                        val ok = onCloseCoverage(intent.requestId, intent.outcome.wire, intent.note, intent.assignSelf)
                                        if (!ok) coverageVm.revertClose(intent)
                                    }
                                }
                            },
                            onDismissSheet = coverageVm::dismissSheet,
                            onCallAllied = onCallPhone,
                            onClearAlreadyHandled = coverageVm::clearAlreadyHandled,
                        )
                    } else {
                        NotAManagerPlaceholder("Coverage")
                    }
                }
                entry<ShiftDestination.Hours> {
                    if (capabilities.hasManagerSurface) {
                        HoursScreen(
                            result = hostState.hoursReport,
                            // Verify an away shift: jump to the House tab on that house's
                            // CURRENT week. `selectHouse` resets to week offset 0, which always
                            // matches the Hours report's week (current week only, SPEC §6.5).
                            onOpenHouseCalendar = { houseId ->
                                houseVm.selectHouse(houseId)
                                nav.navigate(ShiftDestination.House)
                            },
                        )
                    } else {
                        NotAManagerPlaceholder("Hours")
                    }
                }
            }

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
                        current = current,
                        hasUnread = updatesState.hasUnread,
                        onSelect = nav::navigate,
                        onMore = { showMore = true },
                        bar = managerBar,
                        coverageBadgeCount = coverageState?.badgeCount ?: 0,
                    )
                },
            ) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) {
                    Column(Modifier.fillMaxSize()) {
                        // BSpec §20.2 — the standing notification ask, pinned above the
                        // schedule on My Shifts while alerts are off. My Shifts only: this is
                        // the surface where "a reminder before your shift" means something,
                        // and one ask per app is the point. It has no dismiss control, so it
                        // stays until alerts are actually on.
                        if (current == ShiftDestination.MyShifts &&
                            NotificationPriming.shouldShowStandingNudge(notificationNudge.granted)
                        ) {
                            NotificationNudgeRow(
                                body = NotificationPriming.BODY_MY_SHIFTS,
                                state = notificationNudge,
                                tag = "notification_nudge",
                            )
                        }
                        // §4.4 — while a break's claim window is open, promote the Break calendar
                        // with a visible banner from every other tab (it otherwise lives in More).
                        if (current != ShiftDestination.BreakShifts && breakState.phase == BreakPhase.CLAIM_WINDOW) {
                            BreakOpenBanner(breakState.breakName) { nav.navigate(ShiftDestination.BreakShifts) }
                        }
                        // BSpec §5.4a — while a house this manager covers has an
                        // UNACKNOWLEDGED coverage request, a non-dismissable banner rides on
                        // every screen. It disappears once somebody acknowledges (the count
                        // only includes action-required requests), so a manager already on
                        // the phone to Allied is not nagged. Deliberately not a full-screen
                        // takeover: the float-ack modal was moved off auto-cover for exactly
                        // that reason.
                        if (current != ShiftDestination.Coverage && coverageState?.showsBanner == true) {
                            CoverageBanner(
                                count = coverageState.badgeCount,
                                onOpen = { nav.navigate(ShiftDestination.Coverage) },
                            )
                        }
                        NavDisplay(
                            entries = navState.decoratedEntries(shiftEntryProvider),
                            onBack = { nav.goBack() },
                        )
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
                        // BSpec §20.2 — the two contextual asks, riding the success toast of an
                        // action whose payoff IS a push: the reminder for the shift just
                        // claimed, and the reply to the swap just sent. Latched (above) rather
                        // than derived, because writing the once-per-install flag would
                        // otherwise pull the row out from under the worker as it appeared.
                        if (claimNudgeShowing) {
                            NotificationNudgeRow(
                                body = NotificationPriming.BODY_AFTER_CLAIM,
                                state = notificationNudge,
                                tag = "notification_nudge_claim",
                            )
                        }
                        if (swapNudgeShowing) {
                            NotificationNudgeRow(
                                body = NotificationPriming.BODY_AFTER_SWAP,
                                state = notificationNudge,
                                tag = "notification_nudge_swap",
                            )
                        }
                        toast?.let { NotificationToast(it) }
                    }
                }
            }
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
                        shiftTour.showPointer = true
                    },
                )
            }
            // The one-time "look here" pointer at the header "?", positioned from the real
            // button's reported bounds so it always lands on the actual control.
            if (shiftTour.showPointer) {
                ShiftTourPointerCallout(targetRect = shiftTour.helpRect)
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
                        preferencesTour.showPointer = true
                    },
                )
            }
            if (preferencesTour.showPointer) {
                PreferencesTourPointerCallout(targetRect = preferencesTour.helpRect)
            }
            if (breakTourState.active) {
                BreakTourOverlay(
                    state = breakTourState,
                    onNext = breakTourVm::next,
                    onBack = breakTourVm::back,
                    onSkip = breakTourVm::skip,
                    onDismissOutside = {
                        breakTourVm.skip()
                        breakTour.showPointer = true
                    },
                )
            }
            if (breakTour.showPointer) {
                BreakTourPointerCallout(targetRect = breakTour.helpRect)
            }
            if (houseGridTourState.active) {
                HouseGridTourOverlay(
                    state = houseGridTourState,
                    onNext = houseGridTourVm::next,
                    onBack = houseGridTourVm::back,
                    onSkip = houseGridTourVm::skip,
                    onDismissOutside = {
                        houseGridTourVm.skip()
                        houseGridTour.showPointer = true
                    },
                )
            }
            if (houseGridTour.showPointer) {
                HouseGridTourPointerCallout(targetRect = houseGridTour.helpRect)
            }
            if (openClaimTourState.active) {
                OpenClaimTourOverlay(
                    state = openClaimTourState,
                    onNext = openClaimTourVm::next,
                    onBack = openClaimTourVm::back,
                    onSkip = openClaimTourVm::skip,
                    onDismissOutside = {
                        openClaimTourVm.skip()
                        openClaimTour.showPointer = true
                    },
                )
            }
            if (openClaimTour.showPointer) {
                OpenClaimTourPointerCallout(targetRect = openClaimTour.helpRect)
            }
            // The swap-composer tour overlay + pointer are rendered from INSIDE
            // ManageShiftSheet (via CalendarTabContent), not here — see the swapTourVm comment
            // above: a root-level overlay would render BEHIND the modal bottom sheet.
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
                    nav.navigateUnchecked(target)
                },
                onDiscardAndLeave = {
                    preferencesVm.revert()
                    pendingTab = null
                    nav.navigateUnchecked(target)
                },
                onKeepEditing = { pendingTab = null },
            )
        }

        if (showMore) {
            MoreSheet(
                capabilities = capabilities,
                managerBar = managerBar,
                nav = nav,
                onDismiss = { showMore = false },
            )
        }
    }
}
