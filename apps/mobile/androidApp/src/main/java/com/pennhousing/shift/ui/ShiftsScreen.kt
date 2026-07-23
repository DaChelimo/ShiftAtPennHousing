package com.pennhousing.shift.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.calendar.AgendaSwapMark
import com.pennhousing.shift.shared.calendar.CalendarAgenda
import com.pennhousing.shift.shared.calendar.CalendarAgendaItem
import com.pennhousing.shift.shared.calendar.CalendarDayHeader
import com.pennhousing.shift.shared.calendar.CalendarDaySection
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.CalendarWeekOverview
import com.pennhousing.shift.shared.calendar.TemplateSlot
import com.pennhousing.shift.shared.calendar.WeekDayCell
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.shared.viewmodel.AssistantViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarMode
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.data.ToastNotification
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.manager.AssignAdvisory
import com.pennhousing.shift.shared.manager.AssignOutcome
import com.pennhousing.shift.shared.manager.ForceTriggerOutcome
import com.pennhousing.shift.shared.manager.RosterWorker
import com.pennhousing.shift.shared.house.HouseGridBlock
import com.pennhousing.shift.shared.house.HouseGridDay
import com.pennhousing.shift.shared.house.HouseOption
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.house.wearsWorkerColor
import com.pennhousing.shift.shared.house.workerColor
import com.pennhousing.shift.shared.house.workerContrastText
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.samples.DemoFactory
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.model.OpenFeed
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.notifications.NotificationCategory
import com.pennhousing.shift.shared.notifications.NotificationRow
import com.pennhousing.shift.shared.notifications.UpdatesFeed
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.ClaimMeter
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.MyShiftCardState
import com.pennhousing.shift.shared.shifts.MyShiftRow
import com.pennhousing.shift.shared.shifts.MyShiftsTab
import com.pennhousing.shift.shared.shifts.OpenShiftCardState
import com.pennhousing.shift.shared.shifts.OpenShiftGroup
import com.pennhousing.shift.shared.shifts.OpenShiftRow
import com.pennhousing.shift.shared.shifts.OpenShiftSort
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.shifts.PartialClaimPlan
import com.pennhousing.shift.shared.shifts.PartialDropPlan
import com.pennhousing.shift.shared.network.TOAST_DURATION_MS
import com.pennhousing.shift.shared.shifts.CLAIM_SUCCESS_TOAST
import com.pennhousing.shift.shared.shifts.PICKUP_SUCCESS_TOAST_GENERIC
import com.pennhousing.shift.shared.shifts.claimMeter
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.permanentPickupToast
import com.pennhousing.shift.shared.shifts.subOpenShiftFor
import com.pennhousing.shift.shared.shifts.subShiftFor
import com.pennhousing.shift.shared.swaps.BlockRange
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.swaps.PendingSwapNotice
import com.pennhousing.shift.shared.swaps.SwapCandidate
import com.pennhousing.shift.shared.swaps.SwapDayCard
import com.pennhousing.shift.shared.swaps.SwapDecision
import com.pennhousing.shift.shared.swaps.SwapKind
import com.pennhousing.shift.shared.swaps.SwapLeg
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.swaps.SwapSegment
import com.pennhousing.shift.shared.swaps.buildSwapProposal
import com.pennhousing.shift.shared.swaps.buildSwapProposals
import com.pennhousing.shift.shared.swaps.firstFreeRange
import com.pennhousing.shift.shared.swaps.planSwapSpan
import com.pennhousing.shift.shared.swaps.SwapRow
import com.pennhousing.shift.shared.swaps.swapKindsFor
import com.pennhousing.shift.shared.swaps.swapPeople
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.shifts.weeklyHoursSummary
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.FloatCarouselUiState
import com.pennhousing.shift.shared.viewmodel.FloatCarouselViewModel
import com.pennhousing.shift.shared.breakclaim.BreakPhase
import com.pennhousing.shift.shared.onboarding.BreakTour
import com.pennhousing.shift.shared.onboarding.HouseGridTour
import com.pennhousing.shift.shared.onboarding.Onboarding
import com.pennhousing.shift.shared.onboarding.OnboardingTarget
import com.pennhousing.shift.shared.onboarding.OpenClaimTour
import com.pennhousing.shift.shared.onboarding.PreferencesTour
import com.pennhousing.shift.shared.onboarding.ShiftTour
import com.pennhousing.shift.shared.onboarding.SwapTour
import com.pennhousing.shift.shared.onboarding.TipTrigger
import com.pennhousing.shift.shared.viewmodel.BreakTourViewModel
import com.pennhousing.shift.shared.viewmodel.HouseGridTourViewModel
import com.pennhousing.shift.shared.viewmodel.OnboardingViewModel
import com.pennhousing.shift.shared.viewmodel.OpenClaimTourViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesTourViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftTourViewModel
import com.pennhousing.shift.shared.viewmodel.SwapTourViewModel
import androidx.compose.ui.geometry.Rect
import com.pennhousing.shift.ui.onboarding.AskAssistantButton
import com.pennhousing.shift.ui.onboarding.BreakTourHelpButton
import com.pennhousing.shift.ui.onboarding.BreakTourOverlay
import com.pennhousing.shift.ui.onboarding.BreakTourPointerCallout
import com.pennhousing.shift.ui.onboarding.BreakTourPointerStore
import com.pennhousing.shift.ui.onboarding.BreakTourPrefs
import com.pennhousing.shift.ui.onboarding.HouseGridTourHelpButton
import com.pennhousing.shift.ui.onboarding.HouseGridTourOverlay
import com.pennhousing.shift.ui.onboarding.HouseGridTourPointerCallout
import com.pennhousing.shift.ui.onboarding.HouseGridTourPointerStore
import com.pennhousing.shift.ui.onboarding.HouseGridTourPrefs
import com.pennhousing.shift.ui.onboarding.LocalOnboardingAnchors
import com.pennhousing.shift.ui.onboarding.OnboardingAnchors
import com.pennhousing.shift.ui.onboarding.OnboardingOverlay
import com.pennhousing.shift.ui.onboarding.NotificationPrimingHost
import com.pennhousing.shift.ui.onboarding.OnboardingPrefs
import com.pennhousing.shift.ui.onboarding.OpenClaimTourHelpButton
import com.pennhousing.shift.ui.onboarding.OpenClaimTourOverlay
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPointerCallout
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPointerStore
import com.pennhousing.shift.ui.onboarding.OpenClaimTourPrefs
import com.pennhousing.shift.ui.onboarding.PreferencesTourHelpButton
import com.pennhousing.shift.ui.onboarding.PreferencesTourOverlay
import com.pennhousing.shift.ui.onboarding.PreferencesTourPointerCallout
import com.pennhousing.shift.ui.onboarding.PreferencesTourPointerStore
import com.pennhousing.shift.ui.onboarding.PreferencesTourPrefs
import com.pennhousing.shift.ui.onboarding.ShiftTourHelpButton
import com.pennhousing.shift.ui.onboarding.ShiftTourOverlay
import com.pennhousing.shift.ui.onboarding.ShiftTourPointerCallout
import com.pennhousing.shift.ui.onboarding.ShiftTourPointerStore
import com.pennhousing.shift.ui.onboarding.ShiftTourPrefs
import com.pennhousing.shift.ui.onboarding.SwapTourHelpButton
import com.pennhousing.shift.ui.onboarding.SwapTourOverlay
import com.pennhousing.shift.ui.onboarding.SwapTourPointerCallout
import com.pennhousing.shift.ui.onboarding.SwapTourPointerStore
import com.pennhousing.shift.ui.onboarding.SwapTourPrefs
import com.pennhousing.shift.ui.onboarding.onboardingAnchor
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapCalendarUiState
import com.pennhousing.shift.shared.viewmodel.SwapCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.SwapDeal
import com.pennhousing.shift.shared.viewmodel.SwapLegSuggestion
import com.pennhousing.shift.shared.viewmodel.ShiftsTab
import com.pennhousing.shift.shared.viewmodel.ShiftsUiState
import com.pennhousing.shift.shared.viewmodel.SwapsTab
import com.pennhousing.shift.shared.viewmodel.SwapsUiState
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.DurationChip
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.SegmentedControl
import com.pennhousing.shift.ui.kit.ShiftAlertDialog
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftCard
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftSection
import com.pennhousing.shift.ui.kit.ShiftState
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.resolveDark
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Instant

// The constants MUST match each tab's render position in the PrimaryScrollableTabRow —
// selectedTabIndex positions the indicator by row position (a mismatched constant
// underlines the wrong tab; caught on the T3b emulator spot-check).
//
// "My Shifts" is now the Personal Calendar (the old picked-up/dropped/scheduled bucket
// tab was removed — a single chronological view reads clearer). It stays first.
private const val TAB_MY = 0 // chronological "My Shifts" (the Personal Calendar)
private const val TAB_OPEN = 1 // "Open Shifts" — My House / Others sub-tabs (§5.6 Tabs 2+3)
private const val TAB_HOUSE = 2 // §11.4 house schedule (T3b)
private const val TAB_UPDATES = 3
private const val TAB_PREFS = 4
private const val TAB_BREAK = 5
private const val TAB_SETTINGS = 6
private const val TAB_SWAPS = 7 // dedicated Swaps tab (DESIGN §6) — in the "More" sheet
private const val TAB_ASSISTANT = 8 // Desk Assistant chat — in the "More" sheet

// Open-Shifts sub-tabs (rendered inside TAB_OPEN).
private const val OPEN_SUB_HOME = 0 // "My House"
private const val OPEN_SUB_OTHER = 1 // "Others"

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

@Composable
private fun SpecTab(
    title: String,
    tag: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Tab(
        selected = selected,
        onClick = onClick,
        modifier = Modifier.testTag(tag),
        text = { Text(title, maxLines = 1) },
    )
}

/**
 * The Material 3 bottom navigation bar (BEHAVIORAL_SPECIFICATION §5.6). Four frequent
 * destinations — My Shifts, Open, House, Swaps — plus a "More" item that opens the
 * overflow sheet for the rest (Updates, Preferences, Break shifts, Settings). The unread
 * dot rides on "More" since Updates now lives inside it. Selectors: `tab_my_shifts` /
 * `tab_open_shifts` / `tab_house` / `tab_swaps`, plus `tab_more`.
 */
@Composable
private fun ShiftBottomNav(
    selectedIndex: Int,
    hasUnread: Boolean,
    onSelect: (Int) -> Unit,
    onMore: () -> Unit,
) {
    val c = ShiftTheme.colors
    val colors =
        NavigationBarItemDefaults.colors(
            selectedIconColor = MaterialTheme.colorScheme.primary,
            selectedTextColor = MaterialTheme.colorScheme.primary,
            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
            unselectedIconColor = c.sec,
            unselectedTextColor = c.ter,
        )
    NavigationBar(containerColor = c.surface, tonalElevation = 0.dp) {
        NavigationBarItem(
            selected = selectedIndex == TAB_MY,
            onClick = { onSelect(TAB_MY) },
            icon = { Icon(ShiftIcons.Calendar, contentDescription = null) },
            label = { Text("My Shifts", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_my_shifts").onboardingAnchor(OnboardingTarget.MY_SHIFTS_TAB),
        )
        NavigationBarItem(
            selected = selectedIndex == TAB_OPEN,
            onClick = { onSelect(TAB_OPEN) },
            icon = { Icon(ShiftIcons.Plus, contentDescription = null) },
            label = { Text("Open", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_open_shifts").onboardingAnchor(OnboardingTarget.OPEN_TAB),
        )
        NavigationBarItem(
            selected = selectedIndex == TAB_HOUSE,
            onClick = { onSelect(TAB_HOUSE) },
            icon = { Icon(ShiftIcons.Building, contentDescription = null) },
            label = { Text("House", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_house").onboardingAnchor(OnboardingTarget.HOUSE_TAB),
        )
        NavigationBarItem(
            selected = selectedIndex == TAB_SWAPS,
            onClick = { onSelect(TAB_SWAPS) },
            icon = { Icon(ShiftIcons.Refresh, contentDescription = null) },
            label = { Text("Swaps", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_swaps").onboardingAnchor(OnboardingTarget.SWAPS_TAB),
        )
        NavigationBarItem(
            // Secondary destinations now in "More": Updates, Preferences, Break, Settings.
            selected = selectedIndex in TAB_UPDATES..TAB_SETTINGS,
            onClick = onMore,
            icon = {
                if (hasUnread) {
                    BadgedBox(badge = { Badge() }) { Icon(ShiftIcons.MoreHorizontal, contentDescription = null) }
                } else {
                    Icon(ShiftIcons.MoreHorizontal, contentDescription = null)
                }
            },
            label = { Text("More", maxLines = 1) },
            colors = colors,
            modifier = Modifier.testTag("tab_more").onboardingAnchor(OnboardingTarget.MORE_TAB),
        )
    }
}

/** One row in the "More" overflow sheet — icon tile + title + chevron. */
@Composable
private fun MoreNavRow(
    title: String,
    icon: ImageVector,
    tag: String,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag(tag)
            .padding(horizontal = 6.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(c.surfaceVar),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = c.sec, modifier = Modifier.size(20.dp))
        }
        Text(title, color = c.ink, fontSize = 15.5.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
    }
}

/** Deliverable #7 — top-of-screen toast for a new Realtime `notifications` row. */
@Composable
private fun NotificationToast(toast: ToastNotification) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth().testTag("notification_toast"),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(toast.title, fontWeight = FontWeight.SemiBold)
            if (toast.body.isNotBlank()) Text(toast.body)
        }
    }
}

@Composable
private fun ShiftCardColumn(content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
}

/** The "This week — 14h of 20h soft cap" summary chip (design My-Shifts header). */
@Composable
private fun WeekTotalChip(
    weekHours: Double,
    breakProfile: Boolean,
    weekOffset: Int = 0,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    val summary = remember(weekHours, breakProfile) { weeklyHoursSummary(weekHours, breakProfile) }
    // The label follows the shown week so the hours never read as "this week" when
    // the worker has navigated forward/back.
    val label =
        when {
            weekOffset == 0 -> "This week"
            weekOffset == 1 -> "Next week"
            weekOffset == -1 -> "Last week"
            weekOffset > 1 -> "In $weekOffset weeks"
            else -> "${-weekOffset} weeks ago"
        }
    val mono = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp)
    Row(
        modifier
            .fillMaxWidth()
            .background(c.surface, RoundedCornerShape(12.dp))
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(horizontal = 13.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Clock, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(17.dp))
        Text(label, color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
        Text(summary.current, style = mono, color = c.ink)
        Text(summary.capLabel, style = mono.copy(fontWeight = FontWeight.Normal), color = c.ter)
    }
}

private fun MyShiftCardState.toKitState(): ShiftState =
    when (this) {
        MyShiftCardState.SCHEDULED -> ShiftState.SCHEDULED
        MyShiftCardState.PICKUP_HOME -> ShiftState.PICKUP_HOME
        MyShiftCardState.PICKUP_CROSS -> ShiftState.PICKUP_CROSS
        MyShiftCardState.FLOAT_OUT -> ShiftState.FLOAT_OUT
        MyShiftCardState.PENDING_FLOAT -> ShiftState.PENDING_FLOAT
        MyShiftCardState.BREAK_SHIFT -> ShiftState.BREAK
        MyShiftCardState.DROPPED -> ShiftState.DROPPED
    }

// ===================================================================
// Open Shifts — one tab, "My House" / "Others" sub-tabs (§5.6 Tabs 2+3).
// ===================================================================

/**
 * The "Open Shifts" tab: a secondary sub-tab row over the two open feeds — the
 * home-house feed (§5.6 Tab 2 / §5.1) and the cross-house feeds (§5.6 Tab 3). Both
 * are always in the snapshot; the sub-tab only switches which one renders. "My House"
 * is the default. The sub-tab selector ids (`tab_open_home` / `tab_open_other`) and the
 * feed-container ids below carry over from when these were two top-level tabs.
 */
@Composable
private fun OpenShiftsTabContent(
    state: ShiftsUiState,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: (String) -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
    // The header "?" that replays the interactive Open-Shifts claim tour, and its reported
    // bounds (for the one-time post-tour pointer callout to point at).
    onReplayOpenClaimTour: () -> Unit = {},
    onOpenClaimTourHelpPositioned: (Rect) -> Unit = {},
) {
    var sub by remember { mutableIntStateOf(OPEN_SUB_HOME) }
    var showWeekPicker by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
        PageTitle("Open Shifts") {
            OpenClaimTourHelpButton(
                onClick = onReplayOpenClaimTour,
                onPositioned = onOpenClaimTourHelpPositioned,
            )
        }
        SecondaryTabRow(selectedTabIndex = sub) {
            SpecTab("My House", "tab_open_home", sub == OPEN_SUB_HOME) {
                sub = OPEN_SUB_HOME
                vm.selectTab(ShiftsTab.OPEN_HOME)
            }
            SpecTab("Others", "tab_open_other", sub == OPEN_SUB_OTHER) {
                sub = OPEN_SUB_OTHER
                vm.selectTab(ShiftsTab.OPEN_OTHER)
            }
        }
        // The feed fills the space; the open-week navigator is pinned at the BOTTOM
        // (mirroring My Shifts) and scopes BOTH sub-tabs to one Mon-Sun week.
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (sub) {
                OPEN_SUB_HOME ->
                    HomeOpenTabContent(
                        tab = state.homeOpen,
                        vm = vm,
                        calendarVm = calendarVm,
                        currentWeeklyHours = currentWeeklyHours,
                        breakProfile = breakProfile,
                        onClaimed = onClaimed,
                        onClaimShift = onClaimShift,
                        onPickUpPermanent = onPickUpPermanent,
                        loadPermanentScope = loadPermanentScope,
                    )
                else ->
                    OtherHousesTabContent(
                        tab = state.otherHouses,
                        vm = vm,
                        calendarVm = calendarVm,
                        currentWeeklyHours = currentWeeklyHours,
                        breakProfile = breakProfile,
                        onClaimed = onClaimed,
                        onClaimShift = onClaimShift,
                        onPickUpPermanent = onPickUpPermanent,
                        loadPermanentScope = loadPermanentScope,
                    )
            }
        }
        WeekNavBar(
            title = weekOffsetTitle(state.openWeekOffset),
            rangeLabel = state.openWeekRangeLabel,
            onOpenPicker = { showWeekPicker = true },
            onPreviousWeek = vm::previousOpenWeek,
            onNextWeek = vm::nextOpenWeek,
            pickerTag = "open_week_picker_open",
            prevTag = "open_prev_week",
            nextTag = "open_next_week",
        )
    }

    if (showWeekPicker) {
        WeekPickerSheet(
            options = vm.openWeekOptions(),
            currentOffset = state.openWeekOffset,
            onPick = { offset ->
                vm.selectOpenWeekOffset(offset)
                showWeekPicker = false
            },
            onDismiss = { showWeekPicker = false },
            sheetTag = "open_week_picker_sheet",
            optionTag = "open_week_picker_option",
        )
    }
}

// ===================================================================
// Tab 2 — Open Shifts in My House (§5.6 Tab 2 / §5.1).
// ===================================================================

/**
 * Route a confirmed open-shift pickup to the right live write, then do the optimistic local
 * move. A WEEKLY opening → `claim-shift` ([onClaimShift]); a PERMANENT opening → the
 * `permanent-pickup` EF ([onPickUpPermanent], the real path — `claim-shift`'s permanent
 * branch 501s). The ViewModel's optimistic [ShiftsScreenViewModel.claim] is the same local
 * move for both (decision #13); the server stays authoritative and the next Realtime
 * snapshot reconciles. Shared by Tab 2 and Tab 3.
 */
private fun confirmOpenShift(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    onClaimShift: (OpenShift) -> Unit,
    onPickUpPermanent: (OpenShift) -> Unit,
    successMessage: String,
    onClaimed: (String) -> Unit,
) {
    if (shift.feed == OpenFeed.PERMANENT_OPENING) onPickUpPermanent(shift) else onClaimShift(shift)
    vm.claim(shift)
    // Mirror the pickup into the calendar ("My Shifts") so the claimed shift shows in the
    // agenda — and a re-pickup of a shift dropped here un-hides it.
    calendarVm.claim(shift)
    onClaimed(successMessage)
}

@Composable
private fun HomeOpenTabContent(
    tab: HomeOpenShiftsTab,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: (String) -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    var claimTarget by remember { mutableStateOf<OpenShift?>(null) }
    // Split the shown-week feed: upcoming shifts in the live section, already-started
    // ones in a collapsed-by-default "Earlier this week" card (greyed).
    val weeklySplit = remember(tab.weekly) { vm.pastUpcoming(tab.weekly) }

    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        item {
            ShiftSection(
                title = "Weekly open shifts",
                isEmpty = weeklySplit.upcoming.isEmpty(),
                modifier = Modifier.testTag("home_weekly_feed"),
                count = weeklySplit.upcoming.size,
                emptyText = "No open shifts in your house this week.",
                prominent = true,
                icon = ShiftIcons.Calendar,
                accent = ShiftTheme.colors.pickupDot,
            ) {
                ShiftCardColumn { weeklySplit.upcoming.forEach { OpenFeedCard(it, vm) { claimTarget = it } } }
            }
        }
        if (weeklySplit.past.isNotEmpty()) {
            item {
                PastOpenShiftsSection(past = weeklySplit.past, vm = vm) { claimTarget = it }
            }
        }
        item {
            ShiftSection(
                title = "Permanent openings",
                isEmpty = tab.permanentOpenings.isEmpty(),
                modifier = Modifier.testTag("home_permanent_feed"),
                count = tab.permanentOpenings.size,
                emptyText = "No permanent openings right now.",
                prominent = true,
                icon = ShiftIcons.Refresh,
                accent = ShiftTheme.colors.permanent.accent,
            ) {
                ShiftCardColumn { tab.permanentOpenings.forEach { OpenFeedCard(it, vm) { claimTarget = it } } }
            }
        }
    }

    claimTarget?.let { shift ->
        ClaimSheet(
            shift = shift,
            vm = vm,
            currentWeeklyHours = currentWeeklyHours,
            breakProfile = breakProfile,
            loadPermanentScope = loadPermanentScope,
            onConfirmed = { effective, message ->
                confirmOpenShift(effective, vm, calendarVm, onClaimShift, onPickUpPermanent, message, onClaimed)
            },
            onDismiss = { claimTarget = null },
        )
    }
}

/**
 * One open-shift feed card, driven by the shared
 * [com.pennhousing.shift.shared.shifts.toRow]: OPEN → Claim (filled), PERMANENT →
 * Pick up (tonal), UNPICKABLE → no action + "Locked" meta (§5.4 keeps the gap
 * visible past T-2h, withholding only the action). The card root + the action carry
 * the `open_shift_card` / `claim_button` selectors.
 */
@Composable
private fun OpenFeedCard(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    onClaim: () -> Unit,
) {
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    ShiftCard(
        state = row.state.toKitState(),
        houseInitial = row.houseInitial,
        timeLabel = row.timeLabel,
        modifier = Modifier.testTag("open_shift_card"),
        eyebrow = row.dayLabel,
        houseName = row.houseName,
        durationLabel = row.durationLabel,
        meta = row.meta,
        countLabel = row.countLabel,
        action =
            row.actionLabel?.let { label ->
                {
                    ShiftButton(
                        label,
                        onClaim,
                        modifier = Modifier.testTag("claim_button"),
                        variant = if (row.state == OpenShiftCardState.PERMANENT) ButtonVariant.Tonal else ButtonVariant.Filled,
                        size = ButtonSize.Sm,
                    )
                }
            },
    )
}

private fun OpenShiftCardState.toKitState(): ShiftState =
    when (this) {
        OpenShiftCardState.OPEN -> ShiftState.OPEN
        OpenShiftCardState.UNPICKABLE -> ShiftState.UNPICKABLE
        OpenShiftCardState.PERMANENT -> ShiftState.PERMANENT
    }

// ===================================================================
// Claim flow (§5.3 / §5.4) — the design `ClaimSheet`.
// ===================================================================

/**
 * The claim / pick-up sheet (worker-app.html `ClaimSheet`): a shift summary, the
 * "this brings your week to Xh of Yh" hours meter, and the §5.3 cap gating. A
 * soft-cap claim is a two-step confirm (warning banner → "Claim anyway" →
 * `claim_confirm_button`) so the Maestro `soft_cap_*` contract holds; a break
 * hard-cap claim disables the confirm. On confirm the sheet dismisses and the
 * screen shows the `claim_success` toast — the picked-up shift is already in My
 * Shifts (the optimistic [ShiftsScreenViewModel.claim], decision #13).
 *
 * T2-10 — an opening that coalesces several 30-min blocks gains a "How much can you
 * cover?" block-range slider (default: the whole opening, so the Maestro 02 whole-claim
 * path is unchanged). The hours meter + cap gating recompute from the SELECTED span,
 * and confirm claims only the selected blocks ([onConfirmed] receives the effective —
 * whole or sub — open shift). This applies to BOTH weekly openings and PERMANENT
 * pickups — a permanent pickup can take just a sub-range of the recurring slot (§8.4.3).
 */
@Composable
private fun ClaimSheet(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onConfirmed: (OpenShift, String) -> Unit,
    onDismiss: () -> Unit,
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    val c = ShiftTheme.colors
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    val permanent = row.state == OpenShiftCardState.PERMANENT
    // Dry-run the `permanent-pickup` EF so the confirm can show "Picking up N of M weeks ·
    // K skipped" (§8.4.3). Null until loaded / on the demo path → the plain recurring note.
    var permanentScope by remember(shift) { mutableStateOf<PermanentPickupScope?>(null) }
    LaunchedEffect(shift, permanent) {
        if (permanent) permanentScope = loadPermanentScope(shift)
    }

    // §5.3 partial claim (T2-10) — block indexes on the opening's grid, [from, to).
    val blockCount = shift.blockIds.size
    var rangeFrom by remember(shift) { mutableIntStateOf(0) }
    var rangeTo by remember(shift) { mutableIntStateOf(blockCount) }
    val claimPlan = vm.planClaimRange(shift, rangeFrom, rangeTo)
    // The shift the confirm actually claims: the SELECTED span (§5.3) — for BOTH a weekly
    // opening and a permanent pickup (a permanent pickup can take a sub-range of the slot).
    val effective = if (claimPlan.wholeShift) shift else subOpenShiftFor(shift, claimPlan)

    // Meter + cap gating recompute from the SELECTED span (§5.3).
    val meter =
        remember(shift, claimPlan, currentWeeklyHours, breakProfile) {
            claimMeter(currentWeeklyHours, hoursBetween(effective.start, effective.end), breakProfile)
        }
    val overHard = meter.verdict == ClaimCapVerdict.HARD_CAP_BLOCKED
    val overSoft = meter.verdict == ClaimCapVerdict.SOFT_CAP_WARNING
    var warningAccepted by remember { mutableStateOf(false) }

    ShiftBottomSheet(onDismiss = onDismiss, title = if (permanent) "Pick up permanently" else "Claim shift") {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Shift summary — badge + mono time + house · duration · day.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(
                    row.houseInitial,
                    if (permanent) c.permanent.tint else c.surfaceVar,
                    if (permanent) c.permanent.deep else c.ink,
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTimeHero.copy(fontSize = 20.sp), color = c.ink)
                    Text("${row.houseName} · ${row.durationLabel} · ${row.dayLabel}", color = c.sec, fontSize = 13.5.sp)
                }
            }

            if (permanent) PermanentRecurringNote(row, permanentScope)

            // §5.3 partial pickup — shown for BOTH weekly and permanent openings (>1 block),
            // so a permanent pickup can take just a sub-range of the recurring slot (§8.4.3).
            if (blockCount > 1) {
                ClaimRangeSelector(
                    plan = claimPlan,
                    blockCount = blockCount,
                    rangeFrom = rangeFrom,
                    rangeTo = rangeTo,
                    onRange = { from, to ->
                        rangeFrom = from
                        rangeTo = to
                    },
                )
            }

            ClaimHoursMeter(meter)

            if (overSoft) {
                ShiftBanner(
                    title = "Puts you over the 20h soft cap",
                    body = "Allowed this period, but your manager sees the overage.",
                    tone = BannerTone.Warning,
                    modifier = Modifier.testTag("soft_cap_warning_modal"),
                )
            }
            if (overHard) {
                ShiftBanner(
                    title = "Over the 40h limit, can't claim",
                    body = "Break-period hard cap. Drop another shift first.",
                    tone = BannerTone.Error,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ShiftButton("Cancel", onDismiss, modifier = Modifier.weight(1f), variant = ButtonVariant.Outlined)
                if (overSoft && !warningAccepted) {
                    ShiftButton(
                        "Claim anyway",
                        onClick = { warningAccepted = true },
                        modifier = Modifier.weight(1f).testTag("soft_cap_confirm_button"),
                    )
                } else {
                    ShiftButton(
                        // The duration ("Claim 1h"), not the range — the half-width
                        // button truncates "Claim 17:30 - 19:00" (emulator-verified);
                        // the selected range is already shown in the selector above.
                        when {
                            permanent && !claimPlan.wholeShift -> "Pick up ${claimPlan.durationLabel}"
                            permanent -> "Confirm pickup"
                            !claimPlan.wholeShift -> "Claim ${claimPlan.durationLabel}"
                            else -> "Claim shift"
                        },
                        onClick = {
                            // Permanent pickup of the WHOLE slot → "Picked up X of Y weeks"
                            // from the dry-run scope; a sub-range pickup or unknown scope →
                            // the generic confirmation; a weekly claim → the claim toast.
                            val scope = permanentScope
                            val message =
                                when {
                                    permanent && claimPlan.wholeShift && scope != null ->
                                        permanentPickupToast(
                                            weeksPickedUp = scope.weeksPickedUp,
                                            totalWeeks = scope.totalWeeksInScope,
                                            weeksSkipped = scope.weeksSkipped,
                                        )
                                    permanent -> PICKUP_SUCCESS_TOAST_GENERIC
                                    else -> CLAIM_SUCCESS_TOAST
                                }
                            onConfirmed(effective, message)
                            onDismiss()
                        },
                        modifier = Modifier.weight(1f).testTag("claim_confirm_button"),
                        enabled = !overHard,
                    )
                }
            }
        }
    }
}

/**
 * The §5.3 "How much can you cover?" block-range selector (T2-10): a stepped range
 * slider over the opening's 30-min blocks with a live "17:30 - 19:00 · 1h 30m"
 * summary. Defaults to the whole opening.
 */
@Composable
private fun ClaimRangeSelector(
    plan: PartialClaimPlan,
    blockCount: Int,
    rangeFrom: Int,
    rangeTo: Int,
    onRange: (Int, Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("claim_range_selector"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("How much can you cover?", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeShift) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
            modifier = Modifier.testTag("claim_range_label"),
        )
        RangeSlider(
            value = rangeFrom.toFloat()..rangeTo.toFloat(),
            onValueChange = { range ->
                val from = range.start.toInt().coerceIn(0, blockCount - 1)
                val to = range.endInclusive.toInt().coerceIn(from + 1, blockCount)
                onRange(from, to)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
        )
    }
}

/** The "this brings your week to {after}h of {cap}h" meter + progress bar (§5.3 caps). */
@Composable
private fun ClaimHoursMeter(meter: ClaimMeter) {
    val c = ShiftTheme.colors
    val overHard = meter.verdict == ClaimCapVerdict.HARD_CAP_BLOCKED
    val overSoft = meter.verdict == ClaimCapVerdict.SOFT_CAP_WARNING
    val emphasis =
        when {
            overHard -> c.danger.accent
            overSoft -> c.pending
            else -> c.ink
        }
    val barColor = if (overHard) {
        c.danger.accent
    } else if (overSoft) {
        c.pending
    } else {
        MaterialTheme.colorScheme.primary
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("This brings your week to", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Text(
                "${meter.afterLabel} of ${meter.capLabel}",
                style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
                color = emphasis,
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(50))
                .background(c.surfaceVar),
        ) {
            // Where you are now (ghost), then where this claim takes you (colored).
            Box(
                Modifier
                    .fillMaxWidth(meter.currentFraction.toFloat())
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(c.ink.copy(alpha = 0.22f)),
            )
            Box(
                Modifier
                    .fillMaxWidth(meter.afterFraction.toFloat())
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(barColor),
            )
        }
    }
}

/**
 * The recurring-slot note shown when picking up a permanent opening (design `ClaimSheet`).
 * When the `permanent-pickup` dry-run [scope] has resolved, it also shows the §8.4.3
 * "Picking up N of M weeks · K skipped" line so the worker sees how the slot lands against
 * their caps + existing shifts before committing; before that (or on the demo path) only
 * the plain recurring summary shows.
 */
@Composable
private fun PermanentRecurringNote(
    row: OpenShiftRow,
    scope: PermanentPickupScope?,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.permanent.tint)
            .padding(horizontal = 13.dp, vertical = 12.dp)
            .testTag("permanent_recurring_note"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text("Recurring · ${row.dayLabel} · ${row.timeLabel}", color = c.permanent.deep, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        row.meta?.let { Text("Repeats weekly: $it.", color = c.sec, fontSize = 12.5.sp) }
        scope?.let {
            val skipped = if (it.weeksSkipped > 0) " · ${it.weeksSkipped} skipped" else ""
            Text(
                "Picking up ${it.weeksPickedUp} of ${it.totalWeeksInScope} weeks$skipped",
                color = c.permanent.deep,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag("permanent_pickup_scope"),
            )
        }
    }
}

// ===================================================================
// Tab 3 — Open Shifts in Other Houses (§5.6 Tab 3).
// ===================================================================

@Composable
private fun OtherHousesTabContent(
    tab: OtherHousesTab,
    vm: ShiftsScreenViewModel,
    calendarVm: CalendarViewModel,
    currentWeeklyHours: Double,
    breakProfile: Boolean,
    onClaimed: (String) -> Unit,
    onClaimShift: (OpenShift) -> Unit = {},
    onPickUpPermanent: (OpenShift) -> Unit = {},
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    var claimTarget by remember { mutableStateOf<OpenShift?>(null) }
    // Screen-local UI state (the ViewModel stays data-only): the by-house / by-day sort
    // and the per-group collapsed set. Groups default to expanded; keys differ between the
    // two sort modes (house id vs "dow-N"), so switching sort naturally resets to expanded.
    var sortBy by remember { mutableStateOf(OpenShiftSort.BY_HOUSE) }
    val expanded = remember { mutableStateMapOf<String, Boolean>() }
    // Split the shown-week cross-house feed: upcoming ones group/sort as before, the
    // already-started ones go into the collapsed "Earlier this week" card.
    val split = remember(tab.openShifts) { vm.pastUpcoming(tab.openShifts) }
    val upcomingTab = remember(split.upcoming) { OtherHousesTab(split.upcoming) }
    val groups = remember(upcomingTab, sortBy) { upcomingTab.grouped(sortBy) }

    LazyColumn(
        Modifier.fillMaxSize().background(ShiftTheme.colors.bg).testTag("other_houses_tab"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (tab.isEmpty) {
            // §5.6 / decision #6 — no eligible cross-house feed (e.g. winter break).
            item {
                EmptyState(
                    title = "No eligible shifts elsewhere",
                    icon = ShiftIcons.Building,
                    body = "No open shifts at houses you can pick up at right now. Common during winter break.",
                )
            }
        } else {
            item {
                SegmentedControl(
                    options = listOf("By house", "By day"),
                    selectedIndex = if (sortBy == OpenShiftSort.BY_HOUSE) 0 else 1,
                    onSelect = { sortBy = if (it == 0) OpenShiftSort.BY_HOUSE else OpenShiftSort.BY_DAY },
                    modifier = Modifier.testTag("other_houses_sort"),
                )
            }
            groups.forEach { group ->
                item(key = "${sortBy.name}-${group.key}") {
                    CollapsibleGroup(
                        group = group,
                        sortBy = sortBy,
                        expanded = expanded[group.key] ?: true,
                        onToggle = { expanded[group.key] = !(expanded[group.key] ?: true) },
                    ) {
                        ShiftCardColumn {
                            group.shifts.forEach { OpenFeedCard(it, vm) { claimTarget = it } }
                        }
                    }
                }
            }
            if (split.past.isNotEmpty()) {
                item { PastOpenShiftsSection(past = split.past, vm = vm) { claimTarget = it } }
            }
        }
    }

    claimTarget?.let { shift ->
        ClaimSheet(
            shift = shift,
            vm = vm,
            currentWeeklyHours = currentWeeklyHours,
            breakProfile = breakProfile,
            loadPermanentScope = loadPermanentScope,
            onConfirmed = { effective, message ->
                confirmOpenShift(effective, vm, calendarVm, onClaimShift, onPickUpPermanent, message, onClaimed)
            },
            onDismiss = { claimTarget = null },
        )
    }
}

/**
 * A cross-house [group] rendered as a collapsible card: a tappable prominent header
 * (icon + title + count + a chevron that rotates when open) over its [content]. The whole
 * header toggles [onToggle]; the body animates open/closed. [sortBy] only picks the header
 * icon/accent (house vs day) so the two groupings read distinctly.
 */
@Composable
private fun CollapsibleGroup(
    group: OpenShiftGroup,
    sortBy: OpenShiftSort,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable () -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = if (sortBy == OpenShiftSort.BY_HOUSE) c.pickupDot else c.permanent.accent
    val icon = if (sortBy == OpenShiftSort.BY_HOUSE) ShiftIcons.Building else ShiftIcons.Calendar
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(
            group.title,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onToggle).testTag("group_header"),
            count = group.count,
            prominent = true,
            icon = icon,
            accent = accent,
            trailing = {
                Icon(
                    ShiftIcons.ChevronRight,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = c.ter,
                    modifier = Modifier.size(18.dp).rotate(if (expanded) 90f else 0f),
                )
            },
        )
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            content()
        }
    }
}

/**
 * The collapsed-by-default "Earlier this week" card: open shifts in the shown week that
 * have ALREADY started (greyed). Kept claimable for the edge case of a worker who just
 * worked an open shift and wants it on the books, but tucked away so it doesn't clutter
 * the live feed. Defaults CLOSED; the body renders at reduced opacity. Shared by the
 * My-House and Other-Houses feeds.
 */
@Composable
private fun PastOpenShiftsSection(
    past: List<OpenShift>,
    vm: ShiftsScreenViewModel,
    onClaim: (OpenShift) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val c = ShiftTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(
            "Earlier this week",
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { expanded = !expanded }.testTag("past_open_section"),
            count = past.size,
            prominent = true,
            icon = ShiftIcons.Clock,
            accent = c.ter,
            trailing = {
                Icon(
                    ShiftIcons.ChevronRight,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = c.ter,
                    modifier = Modifier.size(18.dp).rotate(if (expanded) 90f else 0f),
                )
            },
        )
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Box(Modifier.alpha(0.55f)) {
                ShiftCardColumn { past.forEach { OpenFeedCard(it, vm) { onClaim(it) } } }
            }
        }
    }
}

// ===================================================================
// Updates tab — §10.1 notifications feed + the §7 pending-float entry (Maestro 04).
// ===================================================================

/**
 * The Updates feed (worker-app.html `UpdatesScreen`): Today / Earlier groups of
 * notification rows (shared, tested [com.pennhousing.shift.shared.notifications.buildUpdatesFeed]).
 * The urgent float-assignment row carries the `pending_float_notification` selector and
 * opens the ack hero. Empty → "You're all caught up".
 *
 * T2-8 — a "Mark all read" affordance (the design's AppHeader trailing check, omitted in
 * T1-1) sits in the feed header when [hasUnread]. Tapping it fires [onMarkAllRead], which
 * optimistically clears the unread dots (and, on the live host, loops the worker's unread
 * ids through the `mark_notification_read` RPC). Hidden when nothing is unread.
 */
@Composable
private fun UpdatesTabContent(
    feed: UpdatesFeed,
    hasUnread: Boolean,
    onOpenAck: () -> Unit,
    onMarkAllRead: () -> Unit,
    onOpenSwaps: () -> Unit = {},
    onAcknowledgeAlliedPage: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg)) {
        PageTitle("Updates")
        if (feed.isEmpty) {
            Column(Modifier.fillMaxWidth().padding(top = 40.dp)) {
                EmptyState(
                    title = "You're all caught up",
                    icon = ShiftIcons.Bell,
                    body = "No new notifications. Float assignments and reminders show up here.",
                )
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                if (hasUnread) {
                    item { MarkAllReadHeader(onMarkAllRead) }
                }
                if (feed.today.isNotEmpty()) {
                    item {
                        NotificationGroup("Today", feed.today, onOpenAck, onOpenSwaps, onAcknowledgeAlliedPage)
                    }
                }
                if (feed.earlier.isNotEmpty()) {
                    item {
                        NotificationGroup("Earlier", feed.earlier, onOpenAck, onOpenSwaps, onAcknowledgeAlliedPage)
                    }
                }
            }
        }
    }
}

/** The Updates header trailing affordance — "Mark all read" (worker-app.html AppHeader trailing check). */
@Composable
private fun MarkAllReadHeader(onMarkAllRead: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onMarkAllRead)
                .testTag("mark_all_read")
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                ShiftIcons.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(17.dp),
            )
            Text("Mark all read", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun NotificationGroup(
    title: String,
    rows: List<NotificationRow>,
    onOpenAck: () -> Unit,
    onOpenSwaps: () -> Unit = {},
    onAcknowledgeAlliedPage: (String) -> Unit = {},
) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(title)
        rows.forEach { NotificationCard(it, onOpenAck, onOpenSwaps, onAcknowledgeAlliedPage) }
    }
}

/** One Updates row (worker-app.html `UpdateRow`). Urgent → float-tint card + left accent + "Action needed". */
@Composable
private fun NotificationCard(
    row: NotificationRow,
    onOpenAck: () -> Unit,
    onOpenSwaps: () -> Unit = {},
    onAcknowledgeAlliedPage: (String) -> Unit = {},
) {
    val c = ShiftTheme.colors
    val (icon, accent) =
        when (row.category) {
            NotificationCategory.FLOAT -> ShiftIcons.FloatOut to c.floatOut.accent
            NotificationCategory.REMINDER -> ShiftIcons.Warning to c.pending
            NotificationCategory.SHIFT_REMOVED -> ShiftIcons.ArrowDown to c.sec
            NotificationCategory.PERMANENT -> ShiftIcons.Refresh to c.permanent.accent
            NotificationCategory.PREFERENCES -> ShiftIcons.CheckCircle to c.success.accent
            NotificationCategory.SWAP -> ShiftIcons.Refresh to c.floatIn.accent
            NotificationCategory.INFO -> ShiftIcons.Bell to c.pickupDot
            NotificationCategory.ALLIED_PAGE -> ShiftIcons.Warning to c.floatOut.accent
        }
    val shape = RoundedCornerShape(14.dp)
    var box = Modifier.fillMaxWidth().clip(shape).background(if (row.urgent) c.floatSoft else c.surface)
    box = if (row.urgent) box else box.border(1.dp, c.divider, shape)
    if (row.opensAck) box = box.clickable(onClick = onOpenAck).testTag("pending_float_notification")
    // DESIGN §6 — a swap mirror deep-links to the Swaps tab (no inline actions).
    if (row.opensSwaps) box = box.clickable(onClick = onOpenSwaps).testTag("swap_request_notification")

    Box(box) {
        if (row.urgent) {
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(c.floatOut.accent),
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(accent.copy(alpha = 0.10f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(19.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(
                        row.title,
                        modifier = Modifier.weight(1f, fill = false),
                        color = c.ink,
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (row.unread) Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(c.pickupDot))
                }
                if (row.urgent) ActionNeededTag()
                Text(row.body, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)
                row.ackCountdownLabel?.let { countdown ->
                    // D7 — the §7 T-10m ack deadline, live at feed-load time.
                    Text(
                        countdown,
                        color = c.pending,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.testTag("float_ack_countdown"),
                    )
                }
                if (row.opensSwaps) {
                    // DESIGN §6 — the mirror points to the Swaps tab; actions live there.
                    Text(
                        "Tap to review in Swaps →",
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                if (row.opensAlliedPage && row.alliedPageBlockId != null) {
                    // Off-hours ladder ack (staggered-rollout pilot): confirm the desk was
                    // called so the ladder stops escalating (responsible worker -> SM -> desk).
                    val blockId = row.alliedPageBlockId!!
                    Box(
                        Modifier
                            .padding(top = 6.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(c.floatOut.accent)
                            .clickable { onAcknowledgeAlliedPage(blockId) }
                            .testTag("allied_page_ack")
                            .padding(horizontal = 14.dp, vertical = 9.dp),
                    ) {
                        Text(
                            "I have called the desk",
                            color = c.surface,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
            Text(row.timeLabel, style = ShiftTheme.type.monoId.copy(fontSize = 11.5.sp), color = c.ter)
        }
    }
}

/** The "Action needed" pill on an urgent (float) update — color + icon + text. */
@Composable
private fun ActionNeededTag() {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(c.floatOut.badge)
            .padding(start = 6.dp, top = 3.dp, end = 8.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(ShiftIcons.Warning, contentDescription = null, tint = c.floatOut.deep, modifier = Modifier.size(13.dp))
        Text("Action needed", color = c.floatOut.deep, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

// ===================================================================
// Swaps tab (DESIGN docs/swaps-enhancement/DESIGN.md §6) — a dedicated Incoming /
// Outgoing review surface. Incoming offers Accept (temporary) / Decline; Outgoing
// offers Cancel and groups co-created legs (decision 2026-06-15: independent legs).
// ===================================================================

@Composable
private fun SwapsTabContent(
    state: SwapsUiState,
    onSelectTab: (SwapsTab) -> Unit,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
    onVoidSwap: (String) -> Unit,
) {
    val tabIndex =
        when (state.selectedTab) {
            SwapsTab.ALL -> 0
            SwapsTab.INCOMING -> 1
            SwapsTab.OUTGOING -> 2
        }
    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg).testTag("swaps_screen")) {
        PageTitle("Swaps")
        SecondaryTabRow(selectedTabIndex = tabIndex) {
            SpecTab("All (${state.allCount})", "swaps_subtab_all", state.selectedTab == SwapsTab.ALL) {
                onSelectTab(SwapsTab.ALL)
            }
            SpecTab("Incoming (${state.incomingCount})", "swaps_subtab_incoming", state.selectedTab == SwapsTab.INCOMING) {
                onSelectTab(SwapsTab.INCOMING)
            }
            SpecTab("Outgoing (${state.outgoingCount})", "swaps_subtab_outgoing", state.selectedTab == SwapsTab.OUTGOING) {
                onSelectTab(SwapsTab.OUTGOING)
            }
        }
        when (state.selectedTab) {
            SwapsTab.ALL -> AllSwapsList(state.feed.all, onAcceptSwap, onRejectSwap, onVoidSwap)
            SwapsTab.INCOMING -> IncomingSwapsList(state.feed.incoming, onAcceptSwap, onRejectSwap)
            SwapsTab.OUTGOING -> OutgoingSwapsList(state.feed.outgoing, onVoidSwap)
        }
    }
}

/** The "All" list — incoming + outgoing merged, soonest-deadline first. Each row renders
 * its direction's actions (incoming → Accept/Decline, outgoing → Cancel). */
@Composable
private fun AllSwapsList(
    rows: List<SwapRow>,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
    onVoidSwap: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(top = 40.dp)) {
            EmptyState(
                title = "No swaps yet",
                icon = ShiftIcons.Refresh,
                body = "Swaps you receive or propose show up here, soonest first.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("swaps_all_list"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(rows, key = { _, it -> it.swapId }) { i, row ->
            val prev = rows.getOrNull(i - 1)
            if (row.groupId != null && row.groupId != prev?.groupId) {
                Text(
                    "Proposed together · ${row.groupSize} people",
                    color = ShiftTheme.colors.sec,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp).testTag("swaps_group_header"),
                )
            }
            if (row.incoming) IncomingSwapCard(row, onAcceptSwap, onRejectSwap) else OutgoingSwapCard(row, onVoidSwap)
        }
    }
}

@Composable
private fun IncomingSwapsList(
    rows: List<SwapRow>,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(top = 40.dp)) {
            EmptyState(
                title = "No incoming swaps",
                icon = ShiftIcons.Refresh,
                body = "When a housemate proposes a swap with you, it shows up here to accept or decline.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("swaps_incoming_list"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(rows, key = { it.swapId }) { row -> IncomingSwapCard(row, onAcceptSwap, onRejectSwap) }
    }
}

@Composable
private fun OutgoingSwapsList(
    rows: List<SwapRow>,
    onVoidSwap: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(top = 40.dp)) {
            EmptyState(
                title = "No outgoing swaps",
                icon = ShiftIcons.Refresh,
                body = "Swaps you propose (from a shift on My Shifts) wait here until your housemate responds.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("swaps_outgoing_list"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(rows, key = { _, it -> it.swapId }) { i, row ->
            // Co-created legs (decision 2026-06-15) get one "Proposed together" header.
            val prev = rows.getOrNull(i - 1)
            if (row.groupId != null && row.groupId != prev?.groupId) {
                Text(
                    "Proposed together · ${row.groupSize} people",
                    color = ShiftTheme.colors.sec,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp).testTag("swaps_group_header"),
                )
            }
            OutgoingSwapCard(row, onVoidSwap)
        }
    }
}

@Composable
private fun IncomingSwapCard(
    row: SwapRow,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
) {
    // Incoming cards carry a left accent stripe so they pop out in the merged All list.
    SwapCardFrame(leftAccent = MaterialTheme.colorScheme.primary) {
        SwapCardHeader(row)
        SwapExchangeRow(row)
        SwapDeadlineRow(row)
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ShiftButton(
                "Accept",
                onClick = { onAcceptSwap(row.swapId) },
                modifier = Modifier.weight(1f).testTag("swap_accept_button"),
                fullWidth = true,
            )
            ShiftButton(
                "Decline",
                onClick = { onRejectSwap(row.swapId) },
                modifier = Modifier.weight(1f).testTag("swap_reject_button"),
                variant = ButtonVariant.Outlined,
                fullWidth = true,
            )
        }
    }
}

@Composable
private fun OutgoingSwapCard(
    row: SwapRow,
    onVoidSwap: (String) -> Unit,
) {
    SwapCardFrame {
        SwapCardHeader(row)
        SwapExchangeRow(row)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SwapDeadlineRow(row, Modifier.weight(1f))
            Text(
                "Cancel",
                color = ShiftTheme.colors.danger.accent,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onVoidSwap(row.swapId) }
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .testTag("swap_void_button"),
            )
        }
    }
}

/**
 * Counterparty avatar + name + who-acts-next label ("Needs your response" / "Waiting on
 * Ben") + a small type chip. The label is accented for incoming (you act), muted for outgoing.
 */
@Composable
private fun SwapCardHeader(row: SwapRow) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        HouseBadge(row.counterpartyName.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(row.counterpartyName, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(row.directionLabel, color = if (row.incoming) primary else c.sec, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
        }
        Text(
            row.typeLabel,
            color = c.sec,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(c.surfaceVar).padding(horizontal = 9.dp, vertical = 3.dp),
        )
    }
}

/** The give ⇄ get block — the decision-critical hours, side by side. */
@Composable
private fun SwapExchangeRow(row: SwapRow) {
    // A one-directional transfer isn't a swap — drop the give/get split and lead with a single
    // full-width panel that reads "someone wants to give you these hours" / "you're offering …".
    if (row.isOneWayTransfer) {
        SwapTransferPanel(row)
        return
    }
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SwapSideBox("You give", row.give, c.surfaceVar, c.sec, Modifier.weight(1f))
        Text("⇄", color = c.sec, fontSize = 16.sp)
        SwapSideBox("You get", row.get, primary.copy(alpha = 0.08f), primary, Modifier.weight(1f))
    }
}

/**
 * The one-directional transfer panel — a single full-width blue block. Leads with the
 * receive/offer headline (never "give nothing / get this"), then the shift's hero time +
 * day + house. Replaces the two-box exchange when nothing is given in return.
 */
@Composable
private fun SwapTransferPanel(row: SwapRow) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    val side = row.transferSide
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(primary.copy(alpha = 0.08f))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("swap_transfer_panel"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                row.transferHeadline,
                color = primary,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (side != null) {
                Text(side.hours, color = primary, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
            }
        }
        // The time slot is the hero; fall back to the hours when the time isn't resolved yet.
        Text(side?.timeRange ?: side?.hours ?: "-", color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        val day = side?.dayLabel
        if (day != null) {
            Text(day, color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }
        SwapHouseLine(side?.houseName, primary)
    }
}

/** One side of the exchange — the TIME RANGE as the hero, the day beneath, hours a tiny chip. */
@Composable
private fun SwapSideBox(
    label: String,
    side: com.pennhousing.shift.shared.swaps.SwapSide?,
    bg: androidx.compose.ui.graphics.Color,
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Column(
        modifier.clip(RoundedCornerShape(10.dp)).background(bg).padding(horizontal = 11.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label.uppercase(), color = accent, fontSize = 10.5.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.4.sp)
            if (side?.timeRange != null) {
                Text(" · ${side.hours}", color = c.ter, fontSize = 10.5.sp, fontWeight = FontWeight.Medium)
            }
        }
        // The time slot is the hero; fall back to hours when the time isn't known yet.
        Text(side?.timeRange ?: side?.hours ?: "-", color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Medium)
        // The date is decision-critical too — render it as prominently as the house, not squint-small.
        Text(side?.dayLabel ?: if (side == null) "Nothing back" else "", color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        // The house this side is actually worked at (the float destination, if floated) — the
        // acceptor must see it before saying yes; an absent name (older row) just omits the line.
        SwapHouseLine(side?.houseName, accent)
    }
}

/**
 * The desk a swap side is worked at — a building glyph + the house name. Decision-critical
 * (the float destination, not the home house), so it's drawn in the side's accent colour.
 * Renders nothing when the house is unknown (an older read-model row without the column).
 */
@Composable
private fun SwapHouseLine(
    houseName: String?,
    accent: androidx.compose.ui.graphics.Color,
) {
    if (houseName == null) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(ShiftIcons.Building, contentDescription = null, tint = accent, modifier = Modifier.size(13.dp))
        Text(houseName, color = accent, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Clock + humanized countdown to expiry — tinted orange when the deadline is near. */
@Composable
private fun SwapDeadlineRow(
    row: SwapRow,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(ShiftIcons.Clock, contentDescription = null, tint = if (row.deadlineUrgent) c.pending else c.sec, modifier = Modifier.size(15.dp))
        Text(
            row.deadline,
            color = if (row.deadlineUrgent) c.pending else c.sec,
            fontSize = 13.sp,
            fontWeight = if (row.deadlineUrgent) FontWeight.Medium else FontWeight.Normal,
        )
    }
}

/** The shared card frame for a Swaps-tab row; [leftAccent] draws a left stripe (incoming). */
@Composable
private fun SwapCardFrame(
    leftAccent: androidx.compose.ui.graphics.Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = ShiftTheme.colors
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.divider, shape)
            .testTag("swap_request_row"),
    ) {
        if (leftAccent != null) {
            Box(Modifier.align(Alignment.CenterStart).width(3.dp).fillMaxHeight().background(leftAccent))
        }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

// ===================================================================
// Calendar tab — agenda-first Personal Calendar (current week only).
// ===================================================================

/**
 * The Personal Calendar (worker-app.html `CalendarScreen`, agenda-first): a static
 * "this week" header (NO week-picker — only the current week is exposed; arbitrary
 * weeks + the permanent template have no data), a Mon-Sun strip, and the selected
 * day's agenda with a live NOW line. All from the shared, tested
 * [com.pennhousing.shift.shared.calendar.buildCalendarWeek] / `buildCalendarAgenda`
 * over the same `MyShift` snapshot the Shifts screen renders.
 */
@Composable
private fun CalendarTabContent(
    vm: CalendarViewModel,
    shiftsVm: ShiftsScreenViewModel,
    breakProfile: Boolean = false,
    // §7.1 float-request carousel state + actions (the blue card stack under the hours
    // chip). Empty state → no carousel renders.
    floatCarousel: FloatCarouselUiState = FloatCarouselUiState(emptyList(), 0, false, emptyList()),
    onFloatAccept: (String) -> Unit = {},
    onFloatDecline: (String) -> Unit = {},
    onFloatDetail: (String) -> Unit = {},
    onDropShift: (MyShift, Boolean) -> Unit = { _, _ -> },
    swapMeUserId: String? = null,
    swapDemoSeats: List<HouseSeat> = emptyList(),
    onCreateSwap: suspend (SwapProposal) -> Boolean = { false },
    onSwapProposed: () -> Unit = {},
    // Accept / decline an INCOMING swap tapped from a flagged agenda card (best-effort
    // live POST is the host's; the popup resolves the calendar mark optimistically).
    onAcceptSwap: (String) -> Unit = {},
    onRejectSwap: (String) -> Unit = {},
    // Cancel (void) an OWN outgoing swap from the "swap pending" card.
    onVoidSwap: (String) -> Unit = {},
    // The header "?" that replays the interactive shift tour, and its reported bounds
    // (for the one-time post-tour pointer callout to point at).
    onReplayShiftTour: () -> Unit = {},
    onShiftTourHelpPositioned: (Rect) -> Unit = {},
    // The swap-composer tour's ViewModel, threaded down to the manage-shift sheet (its
    // autoStart trigger, overlay, help button, and pointer all render from inside the
    // sheet — see the swapTourVm comment where it's created in ShiftsApp).
    swapTourVm: SwapTourViewModel,
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    val swapScope = rememberCoroutineScope()
    var showWeekPicker by remember { mutableStateOf(false) }
    // Tapping an agenda card opens the manage-shift sheet (§5.2), which pages in-place to the
    // swap give/take picker (§8) — one sheet, no dismiss-and-re-present.
    var dropTarget by remember { mutableStateOf<MyShift?>(null) }
    // An incoming-swap card opens the accept/decline popup instead of the manage sheet.
    var decisionTarget by remember { mutableStateOf<SwapDecision?>(null) }
    // An OUTGOING-swap card opens the "swap pending" notice (cancel / keep waiting) — it can't
    // be dropped or swapped while the swap is live, so the drop sheet would just fail.
    var pendingNotice by remember { mutableStateOf<PendingSwapNotice?>(null) }
    val onShiftClick: (String) -> Unit = { id -> vm.shiftForCard(id)?.let { dropTarget = it } }
    val onSwapClick: (String) -> Unit = { swapId -> vm.decisionFor(swapId)?.let { decisionTarget = it } }
    val onPendingSwapClick: (String) -> Unit = { swapId -> vm.pendingSwapNoticeFor(swapId)?.let { pendingNotice = it } }

    if (showWeekPicker) {
        WeekPickerSheet(
            options = vm.weekOptions(),
            currentOffset = state.weekOffset,
            onPick = { offset ->
                vm.selectWeekOffset(offset)
                showWeekPicker = false
            },
            onDismiss = { showWeekPicker = false },
            onTemplate = {
                vm.showTemplate()
                showWeekPicker = false
            },
        )
    }

    if (state.mode == CalendarMode.TEMPLATE) {
        // D5 — the derived recurring typical week (honestly labelled; no template
        // entity exists, this is the union of SCHEDULED-kind slots in the snapshot).
        Column(Modifier.fillMaxSize().background(c.bg).testTag("calendar_template")) {
            PageTitle("My Shifts") {
                ShiftTourHelpButton(onClick = onReplayShiftTour, onPositioned = onShiftTourHelpPositioned)
            }
            ShiftBanner(
                title = "Viewing the recurring template",
                body = "Derived from your scheduled weeks. Permanent drops and swaps change every future week.",
                tone = BannerTone.Info,
                modifier = Modifier.padding(horizontal = 16.dp).testTag("template_banner"),
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (state.template.isEmpty()) {
                    EmptyState(
                        title = "No recurring slots",
                        icon = ShiftIcons.Calendar,
                        body = "Nothing in your SM-built schedule yet.",
                    )
                } else {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 24.dp),
                    ) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                state.template.forEach { slot -> TemplateSlotRow(slot) }
                            }
                        }
                    }
                }
            }
            // The week navigator now lives at the BOTTOM, above the nav bar.
            WeekNavBar(
                title = "Recurring template",
                rangeLabel = "Derived from your scheduled weeks",
                onOpenPicker = { showWeekPicker = true },
            )
        }
        return
    }

    Column(Modifier.fillMaxSize().background(c.bg).testTag("calendar_screen")) {
        PageTitle("My Shifts")
        // The "This week — Xh of cap" total, carried over from the old My-Shifts tab and
        // placed directly under the title (the hours always follow the shown week).
        WeekTotalChip(
            weekHours = state.weekHours,
            breakProfile = breakProfile,
            weekOffset = state.weekOffset,
            modifier = Modifier.padding(horizontal = 16.dp).testTag("week_total_chip"),
        )
        // §7.1 — the float-request carousel sits directly under the hours chip, above the
        // week/day content, so it shows in BOTH modes and an outstanding float can't be
        // missed. Renders nothing when there are no pending floats.
        FloatRequestCarousel(
            state = floatCarousel,
            onAccept = onFloatAccept,
            onDecline = onFloatDecline,
            onOpenDetail = onFloatDetail,
            modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
        )
        // The whole-week overview is the default; the Day segment drills into a single day.
        CalendarViewToggle(
            mode = state.mode,
            onWeek = vm::showWeek,
            onDay = { vm.selectDay(state.selectedDayIndex) },
        )
        // The Mon-Sun day picker only makes sense in Day mode (in Week mode every day is
        // already shown in the overview), so it expands in / collapses out with the mode.
        AnimatedVisibility(
            visible = state.mode == CalendarMode.DAY,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            WeekStrip(state.week, state.selectedDayIndex, vm::selectDay)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.mode == CalendarMode.DAY) {
                Column(Modifier.fillMaxSize()) {
                    DayHeaderRow(state.agenda.header)
                    if (state.agenda.isEmpty) {
                        if (state.agenda.header.closed) {
                            // §3.4/§11.3 (T2-12c): the home house is closed this date — no
                            // blocks exist to work, so say so instead of "day off".
                            EmptyState(
                                title = "House closed",
                                icon = ShiftIcons.Building,
                                body = "Your house is closed this day, so no desk shifts are scheduled.",
                            )
                        } else {
                            EmptyState(
                                title = "No shifts this day",
                                icon = ShiftIcons.Calendar,
                                body = "Enjoy the day off, or browse Open Shifts to pick one up.",
                            )
                        }
                    } else {
                        LazyColumn(
                            Modifier.fillMaxSize().testTag("calendar_agenda"),
                            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                        ) {
                            item {
                                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    state.agenda.items.forEach { AgendaItemRow(it, onShiftClick, onSwapClick, onPendingSwapClick) }
                                }
                            }
                        }
                    }
                }
            } else {
                CalendarWeekOverviewList(state.weekOverview, onShiftClick, onSwapClick, onPendingSwapClick)
            }
        }
        // The week navigator now lives at the BOTTOM, above the nav bar.
        WeekNavBar(
            title = weekOffsetTitle(state.weekOffset),
            rangeLabel = state.week.rangeLabel,
            onOpenPicker = { showWeekPicker = true },
            onPreviousWeek = vm::previousWeek,
            onNextWeek = vm::nextWeek,
        )
    }

    dropTarget?.let { shift ->
        // ONE sheet, two in-place pages (manage ⇄ swap) — "Choose who to swap with" pushes the
        // swap page inside the SAME sheet instead of dismissing + presenting a new one.
        ManageShiftSheet(
            shift = shift,
            vm = shiftsVm,
            breakProfile = breakProfile,
            onDismiss = { dropTarget = null },
            onDrop = { effective, permanent ->
                // Live host POSTs `drop-shift` / `permanent-drop`; the dropped (sub)shift
                // leaves the agenda (calendar VM) and becomes a vacant opening (shifts VM)
                // so it shows under Open Shifts — claimable, partial or full, by anyone.
                onDropShift(effective, permanent)
                vm.drop(effective.blockIds)
                shiftsVm.dropToOpen(effective)
            },
            swapKinds = swapKindsFor(shift, breakProfile),
            swapMeUserId = swapMeUserId,
            swapDemoSeats = swapDemoSeats,
            // Drop the worker's already-pending shifts from the give pool (defensive — the
            // pinned give is never pending, but a give-picker must not offer one).
            swapPendingGiveIds = vm.pendingGiveAssignmentIds(),
            onSubmitSwap = { proposals ->
                // Fire one create-swap per leg (independent legs). The "Swap proposed" toast
                // fires ONLY when every leg's write actually lands — a failed write surfaces
                // the host's red writeError toast instead of a false success.
                swapScope.launch {
                    val allOk = proposals.map { onCreateSwap(it) }.all { it }
                    if (allOk) onSwapProposed()
                }
            },
            swapTourVm = swapTourVm,
        )
    }

    decisionTarget?.let { decision ->
        SwapDecisionSheet(
            decision = decision,
            onAccept = {
                vm.resolveSwap(decision.swapId) // optimistic: the card un-tints
                onAcceptSwap(decision.swapId)
                decisionTarget = null
            },
            onDecline = {
                vm.resolveSwap(decision.swapId)
                onRejectSwap(decision.swapId)
                decisionTarget = null
            },
            onDismiss = { decisionTarget = null },
        )
    }

    pendingNotice?.let { notice ->
        PendingSwapNoticeSheet(
            notice = notice,
            onCancelSwap = {
                vm.resolveSwap(notice.swapId) // optimistic: the card un-tints
                onVoidSwap(notice.swapId)
                pendingNotice = null
            },
            // "Keep waiting" and the corner ✕ both just minimise the card — no action taken.
            onDismiss = { pendingNotice = null },
        )
    }
}

/**
 * The accept/decline popup for an INCOMING swap, opened by tapping a flagged My-Shifts
 * card. Shows what you give ⇄ what you get (a one-sided hand-off shows only its real
 * half), plus the type and deadline. Reuses the give ⇄ take "deal" layout shape.
 */
@Composable
private fun SwapDecisionSheet(
    decision: SwapDecision,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    ShiftBottomSheet(onDismiss = onDismiss, title = decision.title) {
        Column(
            Modifier.fillMaxWidth().testTag("swap_decision_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(decision.intro, color = c.ink, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text(
                    decision.typeLabel,
                    color = primary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(primary.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 3.dp),
                )
            }
            Text(decision.respondBy, color = c.sec, fontSize = 12.5.sp)

            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(BorderStroke(1.dp, c.divider), RoundedCornerShape(12.dp)),
            ) {
                decision.giveLabel?.let { give ->
                    Column(Modifier.fillMaxWidth().background(c.surfaceVar).padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("YOU GIVE", color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
                        Text(give, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                        SwapHouseLine(decision.giveHouse, c.sec)
                    }
                }
                decision.getLabel?.let { get ->
                    if (decision.giveLabel != null) Box(Modifier.fillMaxWidth().height(1.dp).background(c.divider))
                    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("YOU GET", color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
                        Text(get, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                        // Where you'd actually work if you accept — the float destination, when floated.
                        SwapHouseLine(decision.getHouse, primary)
                    }
                }
            }
            decision.note?.let { Text(it, color = c.ter, fontSize = 12.5.sp) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                ShiftButton(
                    "Accept",
                    onClick = onAccept,
                    modifier = Modifier.weight(1f).testTag("swap_decision_accept"),
                    fullWidth = true,
                )
                ShiftButton(
                    "Decline",
                    onClick = onDecline,
                    modifier = Modifier.weight(1f).testTag("swap_decision_decline"),
                    variant = ButtonVariant.Outlined,
                    fullWidth = true,
                )
            }
        }
    }
}

/**
 * The "swap pending" notice for a tapped OUTGOING-swap card — shown instead of the drop
 * sheet, since the shift is tied up in a swap the worker proposed (dropping/swapping it
 * would fail server-side with a generic error). Shows the shift clearly (day · date,
 * start-end, duration), explains the wait, and offers Cancel swap / Keep waiting. The
 * corner ✕ (from [ShiftBottomSheet]'s header) and "Keep waiting" both just minimise it.
 */
@Composable
private fun PendingSwapNoticeSheet(
    notice: PendingSwapNotice,
    onCancelSwap: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = MaterialTheme.colorScheme.primary
    ShiftBottomSheet(onDismiss = onDismiss, title = notice.title) {
        Column(
            Modifier.fillMaxWidth().testTag("pending_swap_notice_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // The shift itself — day · date on top, the start-end time big, duration chip.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(accent.copy(alpha = 0.08f))
                    .border(BorderStroke(1.dp, accent.copy(alpha = 0.30f)), RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(notice.dayLabel, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(notice.timeLabel, color = c.ink, style = ShiftTheme.type.monoTime)
                    DurationChip(notice.durationLabel)
                }
                SwapHouseLine(notice.houseName, accent)
                Row(
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(accent.copy(alpha = 0.14f))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(ShiftIcons.Refresh, contentDescription = null, tint = accent, modifier = Modifier.size(12.dp))
                    Text(notice.typeLabel, color = accent, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                }
            }
            Text(notice.body, color = c.ink, fontSize = 14.sp)
            Text(notice.waitingOn, color = c.sec, fontSize = 12.5.sp)

            ShiftButton(
                notice.keepWaitingLabel,
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth().testTag("pending_swap_keep_waiting"),
                fullWidth = true,
            )
            ShiftButton(
                notice.cancelLabel,
                onClick = onCancelSwap,
                modifier = Modifier.fillMaxWidth().testTag("pending_swap_cancel"),
                variant = ButtonVariant.Outlined,
                fullWidth = true,
            )
        }
    }
}

/** Renders one agenda row: the NOW divider or a shift card (shared by Day + Week views). */
@Composable
private fun AgendaItemRow(
    item: CalendarAgendaItem,
    onShiftClick: (String) -> Unit = {},
    onSwapClick: (String) -> Unit = {},
    onPendingSwapClick: (String) -> Unit = {},
) {
    val now = item.nowLabel
    val shift = item.shift
    if (now != null) {
        NowLine(now)
    } else if (shift != null) {
        val mark = item.swap
        AgendaShiftCard(
            shift,
            item.active,
            past = item.past,
            swap = mark,
            // INCOMING swap → accept/decline popup; OUTGOING swap → the "swap pending"
            // notice (cancel / keep waiting); no swap → the normal drop/swap sheet.
            onClick = {
                when {
                    mark == null -> onShiftClick(shift.id)
                    mark.incoming -> onSwapClick(mark.swapId)
                    else -> onPendingSwapClick(mark.swapId)
                }
            },
        )
    }
}

/** Week / Day segmented toggle in the calendar header. */
@Composable
private fun CalendarViewToggle(
    mode: CalendarMode,
    onWeek: () -> Unit,
    onDay: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(c.surfaceVar)
            .padding(3.dp)
            .testTag("calendar_view_toggle"),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        CalendarToggleSegment("Week", mode == CalendarMode.WEEK, onWeek, Modifier.testTag("calendar_view_week"))
        CalendarToggleSegment("Day", mode == CalendarMode.DAY, onDay, Modifier.testTag("calendar_view_day"))
    }
}

@Composable
private fun CalendarToggleSegment(
    label: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Text(
        label,
        modifier =
            modifier
                .clip(RoundedCornerShape(8.dp))
                .background(if (active) c.surface else Color.Transparent)
                .clickable(onClick = onClick)
                .padding(horizontal = 18.dp, vertical = 6.dp),
        color = if (active) c.ink else c.sec,
        fontSize = 13.sp,
        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
    )
}

/**
 * The whole-week overview (default calendar view): every Mon-Sun day as a section —
 * its header + agenda rows, empty days shown compactly. The NOW line appears only in
 * today's section (the shared builder gates it).
 *
 * On the ongoing week the shared builder folds days that already happened into
 * [CalendarWeekOverview.collapsedPastDays]; they render as one expandable card pinned at
 * the top ([PastDaysCard]) so today is the first day in view. Navigated and whole-past
 * weeks fold nothing, so [CalendarWeekOverview.activeDays] is the full Mon-Sun list.
 */
@Composable
private fun CalendarWeekOverviewList(
    overview: CalendarWeekOverview?,
    onShiftClick: (String) -> Unit = {},
    onSwapClick: (String) -> Unit = {},
    onPendingSwapClick: (String) -> Unit = {},
) {
    LazyColumn(
        Modifier.fillMaxSize().testTag("calendar_week_overview"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (overview?.hasCollapsedPast == true) {
            item(key = "calendar_past_days_card") {
                PastDaysCard(days = overview.collapsedPastDays, shiftCount = overview.collapsedShiftCount)
            }
        }
        overview?.activeDays?.forEach { section ->
            item {
                CalendarDaySectionBlock(section, onShiftClick, onSwapClick, onPendingSwapClick)
            }
        }
    }
}

/** One Mon-Sun day in the week overview: header + agenda rows, or the empty-day treatment. */
@Composable
private fun CalendarDaySectionBlock(
    section: CalendarDaySection,
    onShiftClick: (String) -> Unit,
    onSwapClick: (String) -> Unit,
    onPendingSwapClick: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier.fillMaxWidth().testTag("calendar_day_section"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        DayHeaderRow(section.header)
        if (section.isEmpty) {
            Text(
                if (section.header.closed) "House closed" else "No shifts",
                color = c.ter,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 18.dp, bottom = 4.dp),
            )
            // An empty TODAY still gets the NOW line (the shared builder always inserts one
            // for today), so the live time is visible even on a day off rather than only
            // appearing once a shift exists.
            section.items.firstOrNull { it.nowLabel != null }?.nowLabel?.let { NowLine(it) }
        } else {
            section.items.forEach { AgendaItemRow(it, onShiftClick, onSwapClick, onPendingSwapClick) }
        }
    }
}

/**
 * The ongoing week's already-passed days, folded into one expandable card at the top of
 * the week overview (collapsed by default, so today leads the list). Expanding reveals a
 * compact per-day mini row for each folded day: weekday + date + its held-hours summary
 * (or "No shifts"), with the day's shift(s) shown inline and read-only. Past shifts are
 * not actionable, so the cards carry no tap target.
 */
@Composable
private fun PastDaysCard(
    days: List<CalendarDaySection>,
    shiftCount: Int,
) {
    val c = ShiftTheme.colors
    var expanded by remember { mutableStateOf(false) }
    val subtitle =
        buildString {
            append("${days.size} ${if (days.size == 1) "day" else "days"}")
            if (shiftCount > 0) append(" · $shiftCount ${if (shiftCount == 1) "shift" else "shifts"}")
        }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surfaceVar)
            .testTag("calendar_past_days_card"),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 14.dp, vertical = 12.dp)
                .testTag("calendar_past_days_toggle"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = null,
                tint = c.sec,
                modifier = Modifier.size(16.dp).rotate(if (expanded) 90f else 0f),
            )
            Text(
                if (expanded) "Earlier this week" else "Show earlier this week",
                color = c.ink,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(subtitle, color = c.sec, fontSize = 12.5.sp)
        }
        AnimatedVisibility(visible = expanded) {
            Column(
                Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 10.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                days.forEach { section ->
                    Column(
                        Modifier.fillMaxWidth().testTag("calendar_past_day_row"),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(section.header.title, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("· ${section.header.dateLabel}", color = c.ter, fontSize = 13.sp)
                            }
                            val summary = section.header.summary
                            if (summary != null) {
                                Text(summary, color = c.sec, style = ShiftTheme.type.monoTime.copy(fontSize = 12.5.sp))
                            } else {
                                Text("No shifts", color = c.ter, fontSize = 12.5.sp)
                            }
                        }
                        section.items.filter { it.shift != null }.forEach { itemRow ->
                            AgendaShiftCard(
                                row = itemRow.shift!!,
                                active = false,
                                past = true,
                                swap = itemRow.swap,
                                onClick = null,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** A page header — the tab's title, top-left, big and near-black (the design's large title). */
@Composable
private fun PageTitle(
    title: String,
    modifier: Modifier = Modifier,
    // An optional trailing accessory (e.g. the My-Shifts tour help button). Defaults to
    // null so the other 9 call sites of this composable are unaffected.
    trailing: (@Composable () -> Unit)? = null,
) {
    if (trailing == null) {
        Text(
            title,
            modifier = modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp),
            color = ShiftTheme.colors.ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
        )
    } else {
        Row(
            modifier = modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, modifier = Modifier.weight(1f), color = ShiftTheme.colors.ink, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            trailing()
        }
    }
}

/** "This week" / "Next week" / … for a week [offset] (0 = current). */
private fun weekOffsetTitle(offset: Int): String =
    when {
        offset == 0 -> "This week"
        offset == 1 -> "Next week"
        offset == -1 -> "Last week"
        offset > 1 -> "In $offset weeks"
        else -> "${-offset} weeks ago"
    }

/**
 * The week navigator — a slim bar pinned at the BOTTOM of the My Shifts tab (above the
 * nav bar): ‹ {title} · {range} › with the centre tappable to open the week picker.
 * prev/next chevrons appear only when both handlers are supplied (template mode omits
 * them). Selectors carry over from the old top card so Maestro flow 09 is unchanged.
 */
@Composable
private fun WeekNavBar(
    title: String,
    rangeLabel: String,
    onOpenPicker: () -> Unit,
    onPreviousWeek: (() -> Unit)? = null,
    onNextWeek: (() -> Unit)? = null,
    // Selectors default to the My-Shifts (calendar) tags; the Open-Shifts bar overrides them.
    pickerTag: String = "calendar_week_picker_open",
    prevTag: String = "calendar_prev_week",
    nextTag: String = "calendar_next_week",
) {
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxWidth().background(c.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.divider))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onPreviousWeek != null) {
                Icon(
                    ShiftIcons.ChevronLeft,
                    contentDescription = "Previous week",
                    tint = c.sec,
                    modifier =
                        Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .clickable(onClick = onPreviousWeek)
                            .testTag(prevTag)
                            .padding(8.dp),
                )
            } else {
                Spacer(Modifier.size(40.dp))
            }
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onOpenPicker)
                    .testTag(pickerTag)
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(ShiftIcons.Calendar, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text(title, color = c.ink, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold)
                Text("  ·  $rangeLabel", color = c.sec, fontSize = 14.sp)
            }
            if (onNextWeek != null) {
                Icon(
                    ShiftIcons.ChevronRight,
                    contentDescription = "Next week",
                    tint = c.sec,
                    modifier =
                        Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .clickable(onClick = onNextWeek)
                            .testTag(nextTag)
                            .padding(8.dp),
                )
            } else {
                Spacer(Modifier.size(40.dp))
            }
        }
    }
}

/**
 * D5 — the week-picker sheet: quick weeks (last / this / next / +2 / +3) plus the
 * derived recurring-template entry. The pure `weekPickerOptions` labels each row.
 */
@Composable
private fun WeekPickerSheet(
    options: List<WeekOption>,
    currentOffset: Int,
    onPick: (Int) -> Unit,
    onDismiss: () -> Unit,
    // The Calendar tab offers the derived recurring template; My-Shifts does not
    // (null → the row is hidden).
    onTemplate: (() -> Unit)? = null,
    sheetTag: String = "week_picker_sheet",
    optionTag: String = "week_picker_option",
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, title = "Pick a week") {
        Column(
            Modifier.fillMaxWidth().testTag(sheetTag),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            options.forEach { option ->
                val selected = option.offset == currentOffset
                // "This week" (offset 0) always wears a brand-blue ring — the anchor —
                // while the selected week takes the soft `today` fill. Both can coexist.
                val isThisWeek = option.offset == 0
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (selected) c.today else c.surface)
                        .border(
                            if (isThisWeek) 1.5.dp else 1.dp,
                            if (isThisWeek) MaterialTheme.colorScheme.primary else c.divider,
                            RoundedCornerShape(12.dp),
                        )
                        .clickable { onPick(option.offset) }
                        .padding(horizontal = 13.dp, vertical = 11.dp)
                        .testTag(optionTag),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(option.label, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(option.rangeLabel, style = ShiftTheme.type.monoTime.copy(fontSize = 12.5.sp), color = c.sec)
                }
            }
            if (onTemplate != null) {
                // Derived, secondary entry — a calm gray that recedes into the sheet
                // background (no longer the pink permanent-state tint).
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.surfaceVar)
                        .border(1.dp, c.divider, RoundedCornerShape(12.dp))
                        .clickable(onClick = onTemplate)
                        .padding(horizontal = 13.dp, vertical = 11.dp)
                        .testTag("week_picker_template"),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Recurring template", color = c.sec, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text("derived", color = c.ter, fontSize = 12.5.sp)
                }
            }
        }
    }
}

/** One derived recurring slot ("Mon · 14:00 - 18:00 · Harnwell · seen 4 weeks"). */
@Composable
private fun TemplateSlotRow(slot: TemplateSlot) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("template_slot_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(slot.dayLabel, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(slot.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
            Text("${slot.houseName} · ${slot.durationLabel}", color = c.sec, fontSize = 12.5.sp)
        }
        Text(
            if (slot.weeksSeen > 1) "seen ${slot.weeksSeen} weeks" else "seen once",
            color = c.ter,
            fontSize = 11.5.sp,
        )
    }
}

/** Mon-Sun day picker: weekday letter, a date pill (selected fill / today ring), a shift dot. */
@Composable
private fun WeekStrip(
    week: CalendarWeek,
    selected: Int,
    onSelect: (Int) -> Unit,
    tag: String = "calendar_week_strip",
) {
    Row(
        Modifier.fillMaxWidth().testTag(tag).padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        week.days.forEach { day ->
            WeekDayCellView(day, day.index == selected, Modifier.weight(1f)) { onSelect(day.index) }
        }
    }
}

@Composable
private fun WeekDayCellView(
    day: WeekDayCell,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val blue = MaterialTheme.colorScheme.primary
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag("calendar_day_cell")
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(day.dayLetter, color = c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    when {
                        selected -> blue
                        day.closed -> c.surfaceVar // §3.4 closed-day cell — muted fill
                        else -> Color.Transparent
                    },
                )
                .then(if (day.isToday && !selected) Modifier.border(1.5.dp, blue, RoundedCornerShape(50)) else Modifier)
                .then(if (day.closed) Modifier.testTag("calendar_closed_day") else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                day.dateLabel,
                color =
                    when {
                        selected -> Color.White
                        day.closed -> c.ter
                        else -> c.ink
                    },
                fontSize = 14.sp,
                fontWeight = if (day.isToday) FontWeight.Bold else FontWeight.Medium,
            )
        }
        Box(
            Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(if (day.hasShifts) blue else Color.Transparent),
        )
    }
}

/** "Today · Jun 3" + a "2 shifts · 6h" summary. */
@Composable
private fun DayHeaderRow(header: CalendarDayHeader) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 10.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(header.title, color = c.ink, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Text("· ${header.dateLabel}", color = c.ter, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (header.closed) {
                // §3.4/§11.3 — the home house is closed this date.
                Text(
                    "Closed",
                    color = c.sec,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(50))
                            .background(c.surfaceVar)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                            .testTag("calendar_closed_chip"),
                )
            }
        }
        header.summary?.let { Text(it, style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp), color = c.sec) }
    }
}

/** The live "NOW · HH:mm" agenda divider (red dot + label + rule) — today only. */
@Composable
private fun NowLine(label: String) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(Modifier.size(9.dp).clip(RoundedCornerShape(50)).background(c.danger.accent))
        Text(
            label,
            style = ShiftTheme.type.monoTime.copy(fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
            color = c.danger.accent,
        )
        Box(
            Modifier
                .weight(1f)
                .height(1.5.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(c.danger.accent.copy(alpha = 0.45f)),
        )
    }
}

@Composable
private fun AgendaShiftCard(
    row: MyShiftRow,
    active: Boolean,
    past: Boolean = false,
    swap: AgendaSwapMark? = null,
    onClick: (() -> Unit)? = null,
) {
    if (swap == null) {
        ShiftCard(
            state = row.state.toKitState(),
            houseInitial = row.houseInitial,
            timeLabel = row.timeLabel,
            // A fully-passed shift is rendered slightly inactive (greyed); future and
            // in-progress shifts stay at full strength.
            modifier = Modifier.alpha(if (past) 0.55f else 1f).testTag("calendar_shift_card"),
            houseName = row.houseName,
            destination = row.destination,
            durationLabel = row.durationLabel,
            active = active,
            onClick = onClick,
        )
        return
    }
    // A shift with a pending swap gets a distinct tinted card: orange for an INCOMING
    // request (tap to respond), brand-blue for an OUTGOING one you proposed (just a marker).
    val c = ShiftTheme.colors
    val incoming = swap.incoming
    val accent = if (incoming) c.pending else MaterialTheme.colorScheme.primary
    val tint = if (incoming) c.warnSoft else MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .alpha(if (past) 0.55f else 1f)
            .clip(shape)
            .background(tint)
            .border(1.dp, accent.copy(alpha = 0.55f), shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("calendar_shift_card_swap"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HouseBadge(row.houseInitial, c.surface, c.ink)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(row.timeLabel, color = c.ink, style = ShiftTheme.type.monoTime)
                DurationChip(row.durationLabel)
            }
            row.houseName?.let { Text(it, color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium) }
        }
        Row(
            Modifier.clip(RoundedCornerShape(50)).background(c.surface).padding(horizontal = 9.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                if (incoming) ShiftIcons.Bell else ShiftIcons.Refresh,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(13.dp),
            )
            Text(if (incoming) "Swap request" else "Swap pending", color = accent, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }
    }
}

// ===================================================================
// House tab — §11.4 home-house schedule + contact lookup (T3b).
// ===================================================================

/**
 * The home-house schedule (§11.4, T3b) as an Excel-style WEEK GRID (design
 * `HouseScheduleScreen`) — the spreadsheet SWs are used to: a fixed left time rail
 * plus one Mon-Sun column per day, each desk block placed by the hour, concurrent
 * desks (Harnwell/Quad) side-by-side. The rail stays put while the days scroll
 * sideways; the week navigator (last week … +4) pages the grid. Tapping a staffed
 * block opens the contact sheet (worker name + phone per the full-directory ruling,
 * plus the house desk phone) — the "who do I swap with" affordance.
 *
 * [meUserId] is the live worker (its blocks read "You"); null = demo. The host fetches
 * each navigated week's grid (`fetchHouseScheduleForWeek`) — or generates the demo week
 * — and feeds it to the VM via `setWeekSeats`, exactly like the swap calendar.
 */
@Composable
private fun HouseTabContent(
    vm: HouseScheduleViewModel,
    meUserId: String?,
    // The header "?" that replays the interactive House-grid tour, and its reported bounds
    // (for the one-time post-tour pointer callout to point at).
    onReplayHouseGridTour: () -> Unit = {},
    onHouseGridTourHelpPositioned: (Rect) -> Unit = {},
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    val scope = rememberCoroutineScope()
    var contactTarget by remember { mutableStateOf<HouseGridBlock?>(null) }
    var showWeekPicker by remember { mutableStateOf(false) }
    var showHousePicker by remember { mutableStateOf(false) }

    // ── SM/HM/BM/RSM manager actions on a VACANT seat (BSpec §2.2 / §6.6). Only shown
    // when `state.canManage` (a manager on their OWN house). Tapping an open seat opens a
    // two-option chooser: assign a worker, or get coverage now (force a float lookup). The
    // async writes run in this composable's scope (the House tab already owns its own I/O),
    // never in the pure VM; a success refetches the shown week via `refreshKey`. ──
    var manageChoice by remember { mutableStateOf<HouseGridBlock?>(null) } // the two-option chooser
    var assignFor by remember { mutableStateOf<HouseGridBlock?>(null) } // the roster picker
    var forceFor by remember { mutableStateOf<HouseGridBlock?>(null) } // the force-trigger confirm
    var assignConfirm by remember { mutableStateOf<AssignConfirmState?>(null) } // soft-advisory confirm
    var roster by remember { mutableStateOf<List<RosterWorker>>(emptyList()) }
    var rosterLoading by remember { mutableStateOf(false) }
    var rosterSearch by remember { mutableStateOf("") }
    var managerToast by remember { mutableStateOf<Pair<String, ToastTone>?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }
    LaunchedEffect(managerToast) {
        if (managerToast != null) {
            delay(TOAST_DURATION_MS)
            managerToast = null
        }
    }

    // The shown house id — actions target the VIEWED house (a manager only ever manages
    // their home house, but this is explicit and matches the read path).
    val shownHouseId = state.selectedHouseId ?: state.homeHouseId

    fun runAssign(
        block: HouseGridBlock,
        worker: RosterWorker,
        override: Boolean,
    ) {
        scope.launch {
            when (val outcome = WorkerBackend.managerRepository.assignWorker(block.assignmentIds, worker.userId, override = override)) {
                is AssignOutcome.Assigned -> {
                    assignFor = null
                    assignConfirm = null
                    val n = outcome.count
                    managerToast = (if (n == 1) "Assigned to 1 block" else "Assigned to $n blocks") to ToastTone.Success
                    refreshKey++
                }
                is AssignOutcome.NeedsConfirm ->
                    assignConfirm = AssignConfirmState(block, worker, outcome.advisories)
                is AssignOutcome.Rejected -> {
                    assignConfirm = null
                    managerToast = outcome.message to ToastTone.Error
                }
                AssignOutcome.Failed -> {
                    assignConfirm = null
                    managerToast = "That could not be done. Try again." to ToastTone.Error
                }
            }
        }
    }

    fun runForce(block: HouseGridBlock) {
        val houseId = shownHouseId ?: return
        scope.launch {
            when (val outcome = WorkerBackend.managerRepository.forceTrigger(houseId, block.assignmentIds)) {
                is ForceTriggerOutcome.Triggered -> {
                    managerToast = (if (outcome.floatCount > 0) "Float assigned" else "Coverage started") to ToastTone.Success
                    refreshKey++
                }
                is ForceTriggerOutcome.Rejected -> managerToast = outcome.message to ToastTone.Error
                ForceTriggerOutcome.Failed -> managerToast = "That could not be done. Try again." to ToastTone.Error
            }
        }
    }

    // Load the shown house's roster whenever the assign picker opens.
    LaunchedEffect(assignFor?.id) {
        val target = assignFor
        if (target == null || shownHouseId == null) return@LaunchedEffect
        rosterSearch = ""
        rosterLoading = true
        roster = WorkerBackend.managerRepository.fetchHouseRoster(shownHouseId)
        rosterLoading = false
    }

    // The pickable houses (2026-06-23 cross-house ruling): live `fetchHouses`, demo list
    // otherwise. Loaded once; the switcher defaults to the worker's home house.
    LaunchedEffect(meUserId) {
        val houses =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchHouses() }.getOrDefault(emptyList())
            } else {
                DemoData.houses()
            }
        if (houses.isNotEmpty()) vm.setHouses(houses)
    }

    // Per-(house, week) seats: live fetch on the backend path, deterministic demo week
    // otherwise. Keyed on the selected house + weekOffset so switching house / paging weeks
    // reloads; setWeekSeats ignores stale fetches (wrong house OR week). `refreshKey` re-runs
    // it after a manager assign / force-trigger so the grid reflects the new state.
    val selectedHouseId = state.selectedHouseId
    LaunchedEffect(selectedHouseId, state.weekOffset, meUserId, refreshKey) {
        if (selectedHouseId == null) return@LaunchedEffect
        val seats =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchHouseGridForWeek(selectedHouseId, state.anchor)?.seats }
                    .getOrNull() ?: emptyList()
            } else {
                DemoData.houseWeekSeats(
                    state.anchor,
                    DemoData.DEMO_ME_USER_ID,
                    isHome = selectedHouseId == DemoData.DEMO_HOME_HOUSE_ID,
                )
            }
        vm.setWeekSeats(selectedHouseId, state.weekOffset, seats)
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().background(c.bg).testTag("house_screen")) {
            PageTitle("House") {
                HouseGridTourHelpButton(
                    onClick = onReplayHouseGridTour,
                    onPositioned = onHouseGridTourHelpPositioned,
                )
            }
            HouseHeaderCard(
                houseName = state.houseName,
                deskPhone = state.deskPhone,
                isHomeHouse = state.isHomeHouse,
                canSwitchHouse = state.canSwitchHouse,
                onOpenPicker = { if (state.canSwitchHouse) showHousePicker = true },
            )
            HouseLegend()
            Box(Modifier.weight(1f).fillMaxWidth().testTag("house_grid")) {
                HouseGrid(
                    grid = state.grid,
                    focusDayIndex = state.todayIndex,
                    nowMinOfDay = state.nowMinOfDay,
                    // Re-centre the scroll whenever the house or shown week changes.
                    focusKey = "${state.selectedHouseId}#${state.weekOffset}",
                    // A manager on their own house may tap an OPEN seat to manage it.
                    vacantTappable = state.canManage,
                    onBlockTap = {
                        if (it.vacant) {
                            if (state.canManage) manageChoice = it
                        } else {
                            contactTarget = it
                        }
                    },
                )
            }
            WeekNavBar(
                title = state.weekRelative,
                rangeLabel = state.weekRange,
                onOpenPicker = { showWeekPicker = true },
                onPreviousWeek = if (state.canPreviousWeek) vm::previousWeek else null,
                onNextWeek = if (state.canNextWeek) vm::nextWeek else null,
                pickerTag = "house_week_picker_open",
                prevTag = "house_prev_week",
                nextTag = "house_next_week",
            )
        }
        // Transient manager-action confirmation / error toast (the House tab owns its own
        // I/O, so it also owns this toast rather than routing through the host's toast row).
        managerToast?.let { (msg, tone) ->
            ShiftToast(
                message = msg,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("house_manage_toast"),
                tone = tone,
                icon = if (tone == ToastTone.Error) ShiftIcons.Warning else ShiftIcons.Check,
            )
        }
    }

    // The two-option chooser for a vacant seat (assign a worker / get coverage now).
    manageChoice?.let { block ->
        ManagerActionSheet(
            houseName = state.houseName,
            block = block,
            onAssign = {
                manageChoice = null
                assignFor = block
            },
            onForce = {
                manageChoice = null
                forceFor = block
            },
            onDismiss = { manageChoice = null },
        )
    }

    // The roster picker: search + tap a worker to assign.
    assignFor?.let { block ->
        AssignWorkerSheet(
            houseName = state.houseName,
            block = block,
            roster = roster,
            loading = rosterLoading,
            search = rosterSearch,
            onSearch = { rosterSearch = it },
            onPick = { worker -> runAssign(block, worker, override = false) },
            onDismiss = { assignFor = null },
        )
    }

    // Soft-advisory confirm (over-target / soft-cap / cannot / opted-out): re-submit with override.
    assignConfirm?.let { pending ->
        ShiftAlertDialog(
            title = "Assign anyway?",
            text = pending.advisories.joinToString("\n") { it.message },
            confirmLabel = "Assign anyway",
            onConfirm = { runAssign(pending.block, pending.worker, override = true) },
            onDismiss = { assignConfirm = null },
        )
    }

    // Force-trigger confirm.
    forceFor?.let { block ->
        ShiftAlertDialog(
            title = "Get coverage now",
            text = "Run a float lookup to cover this seat now?",
            confirmLabel = "Run coverage",
            onConfirm = {
                forceFor = null
                runForce(block)
            },
            onDismiss = { forceFor = null },
        )
    }

    if (showWeekPicker) {
        WeekPickerSheet(
            options = state.weekOptions,
            currentOffset = state.weekOffset,
            onPick = {
                vm.selectWeek(it)
                showWeekPicker = false
            },
            onDismiss = { showWeekPicker = false },
            sheetTag = "house_week_picker_sheet",
            optionTag = "house_week_picker_option",
        )
    }

    if (showHousePicker) {
        HousePickerSheet(
            houses = state.houses,
            selectedHouseId = state.selectedHouseId,
            homeHouseId = state.homeHouseId,
            onPick = {
                vm.selectHouse(it)
                showHousePicker = false
            },
            onDismiss = { showHousePicker = false },
        )
    }

    contactTarget?.let { block ->
        ContactSheet(
            block = block,
            deskPhone = state.deskPhone,
            deskHouseName = state.houseName,
            onDismiss = { contactTarget = null },
        )
    }
}

// ── Per-worker colours (docs/design/worker-colors.md) ───────────────────────────

/** A worker's full-strength colour plus the legible foreground that sits on it. */
private data class WorkerTint(val color: Color, val onColor: Color)

private fun rgb(hex: Int): Color = Color(0xFF000000L or hex.toLong())

/**
 * This block's occupant colour, or null when the block must keep its STATE colour
 * (vacant / float-in / pending) or carries no worker. The hash + palette live in the
 * shared module so they match `apps/web/lib/workerColor.ts` exactly.
 */
private fun HouseGridBlock.workerColorOrNull(): WorkerTint? {
    val uid = userId ?: return null
    if (!wearsWorkerColor()) return null
    return WorkerTint(rgb(workerColor(uid)), rgb(workerContrastText(uid)))
}

// ── House grid layout constants (design `HouseScheduleScreen`) ──────────────────
private val HOUSE_RAIL_W = 42.dp
private val HOUSE_HEADER_H = 46.dp
private val HOUSE_PX_PER_HOUR = 46.dp
private val HOUSE_LANE_W = 92.dp
private val HOUSE_LANE_GAP = 4.dp
private val HOUSE_COL_PAD = 6.dp
private val HOUSE_COL_GAP = 6.dp

/**
 * How far OTHER workers' seats recede on the house grid so mine is findable at a glance.
 * Mirrors iOS's `houseOtherOpacity`; keep the two in step.
 */
private const val HOUSE_OTHER_OPACITY = 0.5f

/** The legend strip (design): You / Float-in / Open, plus the swipe-sideways hint. */
@Composable
private fun HouseLegend() {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LegendSwatch(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.primary, "You")
        LegendSwatch(c.floatIn.tint, c.floatIn.accent, "Float-in")
        LegendSwatch(c.surface, c.outline, "Open", dashed = true)
        Spacer(Modifier.weight(1f))
        Text("Swipe", color = c.ter, fontSize = 11.sp)
        Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(13.dp))
    }
}

@Composable
private fun LegendSwatch(
    fill: Color,
    accent: Color,
    label: String,
    dashed: Boolean = false,
) {
    val c = ShiftTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(
            Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(fill)
                .then(if (dashed) Modifier.dashedBorder(accent, 3.dp) else Modifier.border(1.dp, accent, RoundedCornerShape(3.dp))),
        )
        Text(label, color = c.ter, fontSize = 11.5.sp)
    }
}

/**
 * The grid: a frozen left [HouseTimeRail] + horizontally-scrolling day columns, with a
 * frozen day-header row above. The header row and the body share one horizontal
 * `ScrollState` (so they scroll sideways together); the rail lives inside the vertical
 * scroll but outside the horizontal one, so it stays put when the days scroll sideways
 * — the load-bearing requirement.
 */
@Composable
private fun HouseGrid(
    grid: com.pennhousing.shift.shared.house.HouseGridWeek,
    focusDayIndex: Int,
    nowMinOfDay: Int,
    focusKey: String,
    onBlockTap: (HouseGridBlock) -> Unit,
    vacantTappable: Boolean = false,
) {
    val hScroll = rememberScrollState()
    val vScroll = rememberScrollState()
    val density = LocalDensity.current
    val laneCount = grid.laneCount
    val colW = HOUSE_LANE_W * laneCount + HOUSE_LANE_GAP * (laneCount - 1) + HOUSE_COL_PAD * 2
    val gridHeight = HOUSE_PX_PER_HOUR * ((grid.endMin - grid.startMin) / 60f)

    // Scroll to "now" when the shown week contains today (on open / house-switch / week
    // change): the today column comes into view (it may sit at the end of the week) and the
    // body scrolls down to the current hour. Other weeks have no "today" → no auto-scroll.
    LaunchedEffect(focusKey, focusDayIndex, grid.startMin, grid.endMin, grid.laneCount) {
        if (focusDayIndex < 0) return@LaunchedEffect
        val colWpx = with(density) { colW.toPx() }
        val gapPx = with(density) { HOUSE_COL_GAP.toPx() }
        hScroll.animateScrollTo((focusDayIndex * (colWpx + gapPx)).toInt().coerceAtLeast(0))
        val pxPerHour = with(density) { HOUSE_PX_PER_HOUR.toPx() }
        val y = (pxPerHour * ((nowMinOfDay - grid.startMin) / 60f) - pxPerHour).toInt().coerceAtLeast(0)
        vScroll.animateScrollTo(y)
    }

    Column(Modifier.fillMaxSize()) {
        // Frozen day-header row — scrolls sideways with the body, never vertically.
        Row(Modifier.fillMaxWidth().padding(start = 12.dp)) {
            Spacer(Modifier.width(HOUSE_RAIL_W))
            Row(
                Modifier.horizontalScroll(hScroll),
                horizontalArrangement = Arrangement.spacedBy(HOUSE_COL_GAP),
            ) {
                grid.days.forEach { day -> HouseDayHeader(day, colW) }
                Spacer(Modifier.width(8.dp))
            }
        }
        // Body — rail + columns scroll vertically together; columns also scroll sideways.
        Row(Modifier.weight(1f).fillMaxWidth().verticalScroll(vScroll).padding(start = 12.dp, top = 2.dp, bottom = 8.dp)) {
            HouseTimeRail(grid.startMin, grid.endMin, gridHeight)
            Row(
                Modifier.horizontalScroll(hScroll),
                horizontalArrangement = Arrangement.spacedBy(HOUSE_COL_GAP),
            ) {
                grid.days.forEach { day ->
                    HouseDayColumn(day, colW, gridHeight, grid.startMin, grid.endMin, onBlockTap, vacantTappable)
                }
                Spacer(Modifier.width(8.dp))
            }
        }
    }
}

/**
 * The 2-hour clock marks (e.g. 06:00, 08:00, …) strictly between [startMin] and [endMin] —
 * shared by the rail's labels and each day column's gridlines.
 */
private fun houseHourMarks(
    startMin: Int,
    endMin: Int,
): List<Int> {
    val marks = mutableListOf<Int>()
    var h = (startMin / 120 + 1) * 120
    while (h < endMin) {
        marks.add(h)
        h += 120
    }
    return marks
}

private fun fmtHm(min: Int): String = "${(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}"

/**
 * The fixed left time rail — frozen during sideways scroll. The top label is the EXACT grid
 * origin (e.g. "05:30" when that's the week's earliest actual shift start, not rounded to an
 * hour), then a label at every 2-hour clock mark, and a final label at the bottom bound.
 */
@Composable
private fun HouseTimeRail(
    startMin: Int,
    endMin: Int,
    gridHeight: Dp,
) {
    val c = ShiftTheme.colors
    val labels = remember(startMin, endMin) { (listOf(startMin) + houseHourMarks(startMin, endMin) + listOf(endMin)).distinct() }
    Box(Modifier.width(HOUSE_RAIL_W).height(gridHeight).testTag("house_time_rail")) {
        labels.forEach { m ->
            val y = (HOUSE_PX_PER_HOUR * ((m - startMin) / 60f) - 5.dp).coerceAtLeast(0.dp)
            Text(
                fmtHm(m),
                style = ShiftTheme.type.monoId.copy(fontSize = 10.sp),
                color = c.ter,
                modifier = Modifier.align(Alignment.TopEnd).offset(y = y).padding(end = 6.dp),
            )
        }
    }
}

/** One Mon-Sun header cell (day + date), highlighted when it is today. */
@Composable
private fun HouseDayHeader(
    day: HouseGridDay,
    colW: Dp,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        Modifier
            .width(colW)
            .height(HOUSE_HEADER_H)
            .clip(RoundedCornerShape(10.dp))
            .background(if (day.isToday) primary.copy(alpha = 0.10f) else Color.Transparent),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(day.dayLabel, color = if (day.isToday) primary else c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Text(
            day.dateLabel,
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp),
            color = if (day.isToday) primary else c.ink,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** One day column: the surface card + 2-hour gridlines + the lane-placed blocks. */
@Composable
private fun HouseDayColumn(
    day: HouseGridDay,
    colW: Dp,
    gridHeight: Dp,
    startMin: Int,
    endMin: Int,
    onBlockTap: (HouseGridBlock) -> Unit,
    vacantTappable: Boolean = false,
) {
    val c = ShiftTheme.colors
    Box(
        Modifier
            .width(colW)
            .height(gridHeight)
            .clip(RoundedCornerShape(10.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(10.dp))
            .testTag("house_day_column"),
    ) {
        houseHourMarks(startMin, endMin).forEach { h ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .offset(y = HOUSE_PX_PER_HOUR * ((h - startMin) / 60f))
                    .background(c.divider.copy(alpha = 0.6f)),
            )
        }
        day.blocks.forEach { b -> HouseGridBlockCell(b, colW, startMin, day.isToday, onBlockTap, vacantTappable) }
    }
}

/**
 * One positioned desk block, coloured by its state (design `HouseBlock`).
 *
 * Two colour systems, in this order:
 *
 * 1. **Per-worker colour** (docs/design/worker-colors.md) — a plain SCHEDULED seat wears
 *    its occupant's own colour, a pure hash of their `user_id`, so the same person reads
 *    the same here and on the web calendars. Fill is that colour at 90%, the leading rail
 *    and border full strength, the name its precomputed contrast foreground.
 * 2. **State colour** — float-in, pending and vacant seats KEEP their state colours,
 *    because those carry meaning (a float must still read as a float).
 *
 * The "mine" emphasis rides on top of either: my shift TODAY keeps its solid brand ring
 * so it's still the one block that pops, exactly like the web card's `.scard-mine`
 * outline over a worker-tinted fill.
 */
@Composable
private fun HouseGridBlockCell(
    b: HouseGridBlock,
    colW: Dp,
    startMin: Int,
    isToday: Boolean,
    onTap: (HouseGridBlock) -> Unit,
    vacantTappable: Boolean = false,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    val onContainer = MaterialTheme.colorScheme.onPrimaryContainer
    val top = HOUSE_PX_PER_HOUR * ((b.startMin - startMin) / 60f)
    val height = (HOUSE_PX_PER_HOUR * ((b.endMin - b.startMin) / 60f) - 3.dp).coerceAtLeast(18.dp)
    // A desk that's never concurrent with another during this run (segmentLanes == 1) collapses
    // to one full-width column instead of a narrow lane next to empty space.
    val collapsed = b.segmentLanes <= 1
    val width = if (collapsed) colW - HOUSE_COL_PAD * 2 else HOUSE_LANE_W
    val x = if (collapsed) HOUSE_COL_PAD else HOUSE_COL_PAD + (HOUSE_LANE_W + HOUSE_LANE_GAP) * b.lane
    // mine + today → solid blue ring (the one block that should pop).
    val emphatic = b.mine && isToday && !b.floatIn
    val wc = b.workerColorOrNull()
    val (bg, accent, fg) =
        when {
            b.vacant -> Triple(c.surface, c.outline, c.ter)
            wc != null -> Triple(wc.color.copy(alpha = 0.90f), wc.color, wc.onColor)
            b.mine && b.floatIn -> Triple(c.floatIn.tint, c.floatIn.accent, c.floatIn.deep)
            b.mine && isToday -> Triple(c.today, primary, onContainer)
            b.mine -> Triple(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f), primary.copy(alpha = 0.5f), onContainer)
            b.pending -> Triple(c.surfaceVar, c.pending, c.ink)
            b.floatIn -> Triple(c.floatIn.tint, c.floatIn.accent, c.floatIn.deep)
            else -> Triple(c.surfaceVar, c.outline, c.ink)
        }
    // The time label keeps a hint of the worker's hue without losing contrast (web:
    // `color-mix(in srgb, F 75%, C 25%)`); on a state-coloured block it's just `fg`.
    val timeFg = if (wc != null) lerp(fg, wc.color, 0.25f) else fg
    val shape = RoundedCornerShape(8.dp)
    // Everyone else's seats recede so mine is findable at a glance: a grid where every seat
    // wears a saturated colour is pretty but useless for the one question a worker actually
    // asks ("where am I?"). Vacant seats are nobody's card and stay full strength (they're
    // the actionable open-seat affordance for a manager). The dimming applies only to the
    // background/border fill, never to the text, which must always render at full opacity.
    val blockAlpha = if (b.mine || b.vacant) 1f else HOUSE_OTHER_OPACITY
    val recededBg = bg.copy(alpha = bg.alpha * blockAlpha)
    val recededAccent = accent.copy(alpha = accent.alpha * blockAlpha)
    Box(
        Modifier
            .offset(x = x, y = top)
            .width(width)
            .height(height)
            .clip(shape)
            .background(recededBg)
            .then(
                when {
                    b.vacant -> Modifier.dashedBorder(recededAccent, 8.dp)
                    emphatic -> Modifier.border(1.5.dp, primary.copy(alpha = primary.alpha * blockAlpha), shape)
                    wc != null -> Modifier.border(1.dp, recededAccent, shape)
                    else -> Modifier.border(1.dp, accent.copy(alpha = 0.45f * blockAlpha), shape)
                },
            )
            .drawBehind { drawRect(color = recededAccent, size = Size(3.dp.toPx(), size.height)) }
            .clickable(enabled = !b.vacant || vacantTappable) { onTap(b) }
            .padding(start = 7.dp, end = 5.dp, top = 4.dp, bottom = 3.dp)
            .testTag("house_grid_block"),
    ) {
        Column {
            Text(b.timeLabel, style = ShiftTheme.type.monoId.copy(fontSize = 10.5.sp), color = timeFg, maxLines = 1)
            Text(
                b.workerLabel + if (b.mine && b.floatIn) " ·float" else "",
                color = fg,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (b.pending) {
                Text("Pending", color = c.pending, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

/** A dashed rounded outline (open blocks + the legend's "Open" swatch). */
private fun Modifier.dashedBorder(
    color: Color,
    cornerRadius: Dp,
): Modifier =
    drawBehind {
        drawRoundRect(
            color = color,
            style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f), 0f)),
            cornerRadius = CornerRadius(cornerRadius.toPx(), cornerRadius.toPx()),
        )
    }

/**
 * The house header — a DROPDOWN (2026-06-23 cross-house ruling): tapping anywhere opens
 * the house switcher, EXCEPT the desk-phone line, which dials the desk (ACTION_DIAL — the
 * device dialer opens with the number prefilled; it does NOT auto-call). Shows a "Your
 * house" marker for the worker's own house and a chevron when switching is available.
 */
@Composable
private fun HouseHeaderCard(
    houseName: String,
    deskPhone: String?,
    isHomeHouse: Boolean,
    canSwitchHouse: Boolean,
    onOpenPicker: () -> Unit,
) {
    val c = ShiftTheme.colors
    val context = LocalContext.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .clickable(enabled = canSwitchHouse, onClick = onOpenPicker)
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .testTag("house_picker_open"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HouseBadge(houseName.take(1), MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(houseName, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                if (isHomeHouse) {
                    Text(
                        "Your house",
                        color = MaterialTheme.colorScheme.primary,
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            if (deskPhone != null) {
                // The desk phone is its OWN tap target — dials, doesn't open the picker.
                Row(
                    Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$deskPhone"))) }
                        .padding(vertical = 2.dp, horizontal = 2.dp)
                        .testTag("house_call_desk"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(ShiftIcons.Phone, contentDescription = "Call desk", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(14.dp))
                    Text("Desk · $deskPhone", color = MaterialTheme.colorScheme.primary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            } else {
                Text("House schedule", color = c.sec, fontSize = 13.sp)
            }
        }
        if (canSwitchHouse) {
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = "Change house",
                tint = c.ter,
                modifier = Modifier.size(18.dp).rotate(90f),
            )
        }
    }
}

/** The house switcher (cross-house view): pick any house to read its schedule. */
@Composable
private fun HousePickerSheet(
    houses: List<HouseOption>,
    selectedHouseId: String?,
    homeHouseId: String?,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, title = "View a house") {
        Column(
            Modifier.fillMaxWidth().testTag("house_picker_sheet"),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            houses.forEach { house ->
                val selected = house.id == selectedHouseId
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f) else c.surface)
                        .border(1.dp, if (selected) MaterialTheme.colorScheme.primary else c.divider, RoundedCornerShape(12.dp))
                        .clickable { onPick(house.id) }
                        .padding(horizontal = 13.dp, vertical = 12.dp)
                        .testTag("house_picker_option"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    HouseBadge(house.name.take(1), c.surfaceVar, c.ink)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(house.name, color = c.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
                            if (house.id == homeHouseId) {
                                Text("Your house", color = MaterialTheme.colorScheme.primary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        Text(house.deskPhone?.let { "Desk · $it" } ?: "No desk phone", color = c.sec, fontSize = 12.sp)
                    }
                    if (selected) {
                        Icon(ShiftIcons.Check, contentDescription = "Selected", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

/**
 * The §11.4 contact sheet: who covers the run + a call affordance (the worker's
 * phone via the full-directory ruling; the desk phone as the fallback line).
 */
@Composable
private fun ContactSheet(
    block: HouseGridBlock,
    deskPhone: String?,
    deskHouseName: String?,
    onDismiss: () -> Unit,
) {
    val row = block
    val c = ShiftTheme.colors
    val context = LocalContext.current
    val name = row.workerName ?: "This shift"
    val tint = row.workerColorOrNull()
    val badgeBg = tint?.color ?: c.surfaceVar
    val badgeFg = tint?.onColor ?: c.ink
    // The float-in case: the person's own house is not the desk they're standing at, and
    // that is exactly what someone tapping the block needs to know.
    val houseLine =
        when {
            row.workerHouseName == null -> deskHouseName
            deskHouseName != null && !row.workerHouseName.equals(deskHouseName, ignoreCase = true) ->
                "${row.workerHouseName} (at $deskHouseName)"
            else -> row.workerHouseName
        }
    ShiftBottomSheet(onDismiss = onDismiss, title = "Shift details") {
        Column(
            Modifier.fillMaxWidth().testTag("contact_sheet"),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // The shift itself: what slot was tapped.
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.timeLabel,
                    style = ShiftTheme.type.monoTime,
                    color = c.ink,
                    modifier = Modifier.testTag("contact_time"),
                )
                Text(row.durationLabel(), color = c.sec, fontSize = 13.sp)
            }

            // The person on it, as a card.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(c.surfaceVar)
                    .border(1.dp, c.divider, RoundedCornerShape(14.dp))
                    .padding(14.dp)
                    .testTag("contact_person_card"),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    HouseBadge(name.take(1), badgeBg, badgeFg)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            name,
                            color = c.ink,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.testTag("contact_name"),
                        )
                        houseLine?.let {
                            Text(it, color = c.sec, fontSize = 13.5.sp, modifier = Modifier.testTag("contact_house"))
                        }
                    }
                }
                ContactDetailRow(
                    icon = ShiftIcons.Phone,
                    value = row.workerPhone ?: "No phone on file",
                    muted = row.workerPhone == null,
                    tag = "contact_phone",
                )
                ContactDetailRow(
                    icon = ShiftIcons.Mail,
                    value = row.workerEmail ?: "No email on file",
                    muted = row.workerEmail == null,
                    tag = "contact_email",
                )
            }

            row.workerPhone?.let { phone ->
                ShiftButton(
                    "Call $name",
                    onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.dialable()}"))) },
                    modifier = Modifier.fillMaxWidth().testTag("contact_call_button"),
                    icon = ShiftIcons.Phone,
                    fullWidth = true,
                )
            }
            row.workerEmail?.let { email ->
                ShiftButton(
                    "Email $name",
                    onClick = { context.startActivity(emailIntent(email, row.timeLabel)) },
                    modifier = Modifier.fillMaxWidth().testTag("contact_email_button"),
                    variant = ButtonVariant.Outlined,
                    icon = ShiftIcons.Mail,
                    fullWidth = true,
                )
            }
            deskPhone?.let { phone ->
                ShiftButton(
                    "Call the desk · $phone",
                    onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.dialable()}"))) },
                    modifier = Modifier.fillMaxWidth().testTag("contact_call_desk"),
                    variant = ButtonVariant.Outlined,
                    fullWidth = true,
                )
            }
        }
    }
}

/** One labelled contact line (phone / email) inside the person card. */
@Composable
private fun ContactDetailRow(
    icon: ImageVector,
    value: String,
    muted: Boolean,
    tag: String,
) {
    val c = ShiftTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null, tint = if (muted) c.ter else c.sec, modifier = Modifier.size(16.dp))
        Text(
            value,
            color = if (muted) c.ter else c.ink,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.testTag(tag),
        )
    }
}

/** "4h" / "30m" / "1h 30m" — the tapped slot's length, read off the grid's own minutes. */
private fun HouseGridBlock.durationLabel(): String {
    val mins = endMin - startMin
    val h = mins / 60
    val m = mins % 60
    return when {
        h == 0 -> "${m}m"
        m == 0 -> "${h}h"
        else -> "${h}h ${m}m"
    }
}

/** Strip spacing so `tel:` gets a clean number for the dialer to prefill. */
private fun String.dialable(): String = filterNot { it.isWhitespace() || it == '(' || it == ')' || it == '-' }

/**
 * ACTION_SENDTO on a `mailto:` uri — resolves ONLY to email apps (ACTION_SEND would also
 * offer every share target), with the tapped shift prefilled as the subject so the
 * recipient has context. Nothing is sent: the compose window opens for the worker.
 */
private fun emailIntent(
    email: String,
    timeLabel: String,
): Intent =
    Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).apply {
        putExtra(Intent.EXTRA_EMAIL, arrayOf(email))
        putExtra(Intent.EXTRA_SUBJECT, "Shift on $timeLabel")
    }

// ===================================================================
// Manager actions on a vacant seat (BSpec §2.2 add-a-worker / §6.6 force-trigger).
// Shown only when the signed-in user is a manager on their OWN house (state.canManage).
// ===================================================================

/** A soft-advisory confirm in flight: re-submit [block] for [worker] with `override = true`. */
private data class AssignConfirmState(
    val block: HouseGridBlock,
    val worker: RosterWorker,
    val advisories: List<AssignAdvisory>,
)

/**
 * The two-option chooser for a tapped OPEN seat: assign a specific worker, or ask the
 * system to find coverage now (force a float lookup). A thin bottom sheet with the house +
 * time range as context.
 */
@Composable
private fun ManagerActionSheet(
    houseName: String,
    block: HouseGridBlock,
    onAssign: () -> Unit,
    onForce: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, title = "Open seat") {
        Column(
            Modifier.fillMaxWidth().testTag("house_manage_sheet"),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("$houseName · ${block.timeLabel}", color = c.sec, fontSize = 14.sp)
            ShiftButton(
                "Assign a worker",
                onClick = onAssign,
                modifier = Modifier.fillMaxWidth().testTag("house_assign_worker_option"),
                icon = ShiftIcons.Plus,
                fullWidth = true,
            )
            ShiftButton(
                "Get coverage now",
                onClick = onForce,
                modifier = Modifier.fillMaxWidth().testTag("house_force_trigger"),
                variant = ButtonVariant.Outlined,
                fullWidth = true,
            )
        }
    }
}

/**
 * The add-a-worker roster picker (BSpec §2.2): the house's own workers, name-searchable.
 * Tapping a worker assigns them to the vacant run; the server owns the hard cap and the
 * soft-advisory confirm (handled by the caller via [onPick]'s outcome).
 */
@Composable
private fun AssignWorkerSheet(
    houseName: String,
    block: HouseGridBlock,
    roster: List<RosterWorker>,
    loading: Boolean,
    search: String,
    onSearch: (String) -> Unit,
    onPick: (RosterWorker) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val filtered =
        remember(roster, search) {
            if (search.isBlank()) roster else roster.filter { it.name.contains(search.trim(), ignoreCase = true) }
        }
    ShiftBottomSheet(onDismiss = onDismiss, title = "Assign worker") {
        Column(
            Modifier.fillMaxWidth().testTag("house_assign_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("$houseName · ${block.timeLabel}", color = c.sec, fontSize = 14.sp)
            RosterSearchField(value = search, onValue = onSearch)
            when {
                loading -> Text("Loading workers.", color = c.ter, fontSize = 14.sp)
                filtered.isEmpty() ->
                    Text(
                        if (roster.isEmpty()) "No workers to assign." else "No workers match your search.",
                        color = c.ter,
                        fontSize = 14.sp,
                    )
                else ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        filtered.forEach { worker ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(c.surface)
                                    .border(1.dp, c.divider, RoundedCornerShape(12.dp))
                                    .clickable { onPick(worker) }
                                    .padding(horizontal = 13.dp, vertical = 12.dp)
                                    .testTag("house_assign_worker_row"),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                HouseBadge(worker.name.take(1), c.surfaceVar, c.ink)
                                Text(worker.name, color = c.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
            }
        }
    }
}

/** A styled search field for the assign-worker roster picker (filters by worker name). */
@Composable
private fun RosterSearchField(
    value: String,
    onValue: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(c.surfaceVar)
            .border(BorderStroke(1.dp, c.divider), RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag("house_assign_search"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Search, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text("Search workers", color = c.ter, fontSize = 14.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                modifier = Modifier.fillMaxWidth().testTag("house_assign_search_field"),
                singleLine = true,
                textStyle = TextStyle(color = c.ink, fontSize = 14.sp),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                ShiftIcons.Close,
                contentDescription = "Clear",
                tint = c.sec,
                modifier = Modifier.size(18.dp).clip(RoundedCornerShape(50)).clickable { onValue("") },
            )
        }
    }
}

// ===================================================================
// Drop flow (§5.2) — occurrence vs permanent, short-notice warning.
// ===================================================================

private enum class ManagePage { Manage, Swap }

/**
 * The manage-shift sheet (§5.2 / §8) — ONE bottom sheet with two in-place pages: the
 * Drop/Swap chooser (Option C) and, when the worker proceeds to swap, the week-paged
 * give/take picker. "Choose who to swap with" PUSHES the swap page within the SAME sheet
 * (a back chevron returns) rather than dismissing and presenting a new sheet; the selected
 * range + scope carry into the give.
 */
@Composable
private fun ManageShiftSheet(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    breakProfile: Boolean,
    onDismiss: () -> Unit,
    onDrop: (MyShift, Boolean) -> Unit,
    swapKinds: List<SwapKind>,
    swapMeUserId: String?,
    swapDemoSeats: List<HouseSeat>,
    swapPendingGiveIds: Set<String>,
    onSubmitSwap: (List<SwapProposal>) -> Unit,
    // The swap-composer tour. Auto-opens the FIRST time the worker reaches the swap page
    // (not the manage page — Drop-vs-Swap is ShiftTour's job, not this tour's). See
    // ui/onboarding/SwapTourView.kt.
    swapTourVm: SwapTourViewModel,
) {
    var page by remember(shift) { mutableStateOf(ManagePage.Manage) }
    var swapGive by remember(shift) { mutableStateOf<MyShift?>(null) }
    var swapPermanent by remember(shift) { mutableStateOf(false) }
    val swapTourState by swapTourVm.uiState.collectAsStateWithLifecycle()
    // One-shot pointer callout on the swap page's help "?" after the tour first finishes.
    // Local to this sheet (mirrors iOS's `showSwapTourPointer` being `@State` on
    // `ManageShiftSheet`, not lifted to the top-level screen) — it only ever matters while
    // the sheet carrying the help button is still open.
    var swapTourHelpRect by remember { mutableStateOf<Rect?>(null) }
    var showSwapTourPointer by remember { mutableStateOf(false) }
    val context = LocalContext.current

    LaunchedEffect(page) {
        if (page == ManagePage.Swap) swapTourVm.autoStart()
    }
    LaunchedEffect(swapTourState.active) {
        if (!swapTourState.active &&
            !SwapTour.shouldAutoShow(swapTourState.seen) &&
            !SwapTourPointerStore.hasShown(context)
        ) {
            SwapTourPointerStore.markShown(context)
            showSwapTourPointer = true
        }
    }
    LaunchedEffect(showSwapTourPointer) {
        if (showSwapTourPointer) {
            delay(3200)
            showSwapTourPointer = false
        }
    }

    ShiftBottomSheet(
        onDismiss = onDismiss,
        title = if (page == ManagePage.Swap) "Propose a swap" else "Manage shift",
        onBack = if (page == ManagePage.Swap) ({ page = ManagePage.Manage }) else null,
    ) {
        Box(Modifier.fillMaxWidth()) {
            AnimatedContent(
                targetState = page,
                transitionSpec = {
                    // Forward (→ Swap) slides in from the right; Back slides in from the left.
                    if (targetState == ManagePage.Swap) {
                        (slideInHorizontally { it / 3 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 3 } + fadeOut())
                    } else {
                        (slideInHorizontally { -it / 3 } + fadeIn()) togetherWith (slideOutHorizontally { it / 3 } + fadeOut())
                    }
                },
                label = "manage_page",
            ) { p ->
                when (p) {
                    ManagePage.Manage ->
                        ManagePageContent(
                            shift = shift,
                            vm = vm,
                            breakProfile = breakProfile,
                            swapKinds = swapKinds,
                            onDrop = { sub, permanent ->
                                onDrop(sub, permanent)
                                onDismiss()
                            },
                            onProposeSwap = { sub, permanent ->
                                swapGive = sub
                                swapPermanent = permanent
                                page = ManagePage.Swap
                            },
                        )
                    ManagePage.Swap ->
                        swapGive?.let { give ->
                            SwapCalendarBody(
                                giveShift = give,
                                meUserId = swapMeUserId,
                                demoSeats = swapDemoSeats,
                                pendingGiveAssignmentIds = swapPendingGiveIds,
                                initialPermanent = swapPermanent,
                                onSubmit = { proposals ->
                                    onSubmitSwap(proposals)
                                    onDismiss()
                                },
                            )
                        }
                }
            }
            // The composer's own help "?", floating top-end since ShiftBottomSheet's own
            // header has no trailing accessory slot (its close X already owns that spot).
            if (page == ManagePage.Swap) {
                SwapTourHelpButton(
                    onClick = swapTourVm::replay,
                    onPositioned = { swapTourHelpRect = it },
                    modifier = Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp),
                )
            }
            // Gated on page == Swap too: a Settings "Replay swap tour" flips `active` true
            // immediately (before the sheet may even be open on this page), and it must stay
            // invisible until the worker actually reaches the swap page, not show over the
            // Drop/Swap manage page. Rendered as a sibling in this SAME Box (not a separate
            // Column row) so it overlaps the page content instead of stacking below it.
            if (swapTourState.active && page == ManagePage.Swap) {
                SwapTourOverlay(
                    state = swapTourState,
                    onNext = swapTourVm::next,
                    onBack = swapTourVm::back,
                    onSkip = swapTourVm::skip,
                    onDismissOutside = {
                        swapTourVm.skip()
                        showSwapTourPointer = true
                    },
                )
            }
            if (showSwapTourPointer) {
                SwapTourPointerCallout(targetRect = swapTourHelpRect)
            }
        }
    }
}

/**
 * Drop sheet (§5.2): the design's bottom sheet — scope radios (occurrence /
 * permanent), a short-notice warning, and a destructive confirm. The exact
 * "Drop this occurrence" / "Drop permanently" labels + the
 * `drop_*` selectors satisfy the Maestro contract. Both scopes drive the existing
 * optimistic-local [ShiftsScreenViewModel.drop] (decision #13); the §8.4 server
 * semantics of a permanent drop are a later step.
 *
 * T2-11 — when the displayed card coalesces several 30-min blocks, BOTH scopes gain
 * a "How much to drop" block-range slider (defaulting to the whole shift, so the
 * Maestro 03 whole-drop path is unchanged), so a permanent drop can release just a
 * sub-range of the recurring slot. The occurrence scope also offers a mid-shift "From
 * now" quick action (§5.2: a 17:51 drop opens a 17:30-anchored gap). The selected run
 * is dropped via the `drop-shift` / `permanent-drop` EF (its `assignment_ids` array);
 * the remaining blocks re-coalesce into their own card(s). The short-notice warning
 * anchors to the SELECTED gap start.
 */
@Composable
private fun ManagePageContent(
    shift: MyShift,
    vm: ShiftsScreenViewModel,
    breakProfile: Boolean,
    swapKinds: List<SwapKind>,
    // Confirm a drop of the SELECTED sub-shift (the parent owns the dismiss + optimistic move).
    onDrop: (MyShift, Boolean) -> Unit,
    // §8 pivot — navigate to the swap PAGE in the same sheet, carrying the SELECTED sub-shift
    // (range pre-fills the give) + whether the shared scope is Permanent (drives a permanent swap).
    onProposeSwap: (MyShift, Boolean) -> Unit,
) {
    val c = ShiftTheme.colors
    val row = remember(shift) { shift.toRow() }
    val options = vm.dropOptions(shift, breakProfile)
    val canSwap = swapKinds.isNotEmpty()
    val canSwapPermanently = SwapKind.PERMANENT in swapKinds

    // Drop ⇄ Swap are equal-weight intents (Option C). The scope + range below are SHARED by
    // both — picking a range then switching to Swap carries that range into the give.
    var swapIntent by remember(shift) { mutableStateOf(false) }
    var permanentScope by remember(shift) { mutableStateOf(false) }

    // Permanent validity is per-intent: drop → recurring slot; swap → a permanent swap exists.
    val permanentAllowed = if (swapIntent) canSwapPermanently else options.canDropPermanently
    // The shared scope row only shows when SOME intent supports permanent; otherwise the card
    // is always this-week and the control would be a lone disabled segment.
    val scopeRowVisible = options.canDropPermanently || canSwapPermanently

    // §5.2 partial range — block indexes on the shift's own grid, [from, to). SHARED across
    // both intents (the swap pivot pins subShiftFor(shift, plan) as the give).
    val blockCount = shift.blockIds.size
    var rangeFrom by remember(shift) { mutableIntStateOf(0) }
    var rangeTo by remember(shift) { mutableIntStateOf(blockCount) }
    val partialPlan = vm.planDropRange(shift, rangeFrom, rangeTo)
    val fromNowIndex = remember(shift) { vm.dropFromNowIndex(shift) }
    // Short-notice gates the DROP confirm only — a swap proposal isn't a short-notice drop.
    val shortNotice = !swapIntent && partialPlan.shortNotice

    Column(
        Modifier.fillMaxWidth().testTag("manage_shift_sheet"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(row.houseInitial, c.surfaceVar, c.ink)
                Column {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
                    Text("${row.houseName ?: row.destination ?: ""} · ${row.durationLabel}", color = c.sec, fontSize = 13.sp)
                }
            }

            // Equal-weight intent choice — Drop vs Swap (§5.2 / §8).
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                IntentCard(
                    modifier = Modifier.weight(1f),
                    selected = !swapIntent,
                    title = "Drop the shift",
                    body = "Opens for others to claim.",
                    icon = ShiftIcons.Calendar,
                    enabled = true,
                    tag = "intent_drop",
                    onClick = {
                        swapIntent = false
                        if (!options.canDropPermanently) permanentScope = false
                    },
                )
                IntentCard(
                    modifier = Modifier.weight(1f),
                    selected = swapIntent,
                    title = "Swap it",
                    body = "Trade with a housemate.",
                    icon = ShiftIcons.Refresh,
                    enabled = canSwap,
                    tag = "intent_swap",
                    onClick = {
                        if (canSwap) {
                            swapIntent = true
                            if (!canSwapPermanently) permanentScope = false
                        }
                    },
                )
            }

            // Shared scope — drives BOTH the drop (this-week vs permanent release) and the
            // swap (this-week vs permanent swap).
            if (scopeRowVisible) {
                ScopeSegmentedControl(
                    permanent = permanentScope,
                    permanentEnabled = permanentAllowed,
                    onThisWeek = { permanentScope = false },
                    onPermanent = { if (permanentAllowed) permanentScope = true },
                )
            }

            // §5.2 partial range — shown when the card spans >1 block. SHARED: it sizes the
            // drop AND pre-fills the swap give. The mid-shift "From now" stays this-week-only.
            if (blockCount > 1) {
                DropRangeSelector(
                    plan = partialPlan,
                    blockCount = blockCount,
                    rangeFrom = rangeFrom,
                    rangeTo = rangeTo,
                    fromNowIndex = if (permanentScope) null else fromNowIndex,
                    onRange = { from, to ->
                        rangeFrom = from
                        rangeTo = to
                    },
                )
            }

            // Short-notice is a non-blocking heads-up, NOT a gate: a red-outlined caution
            // that sits directly above the (red) Drop button so the consequence reads as
            // part of that action. The drop stays one tap away.
            if (shortNotice) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.danger.tint)
                        .border(1.dp, c.danger.accent, RoundedCornerShape(12.dp))
                        .padding(horizontal = 13.dp, vertical = 11.dp)
                        .testTag("drop_short_notice_warning"),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        ShiftIcons.Warning,
                        contentDescription = null,
                        tint = c.danger.accent,
                        modifier = Modifier.size(18.dp).padding(top = 1.dp),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Starts within 20 minutes", color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                        Text(
                            "Short-notice drop. Your manager is notified immediately to arrange cover.",
                            color = c.sec,
                            fontSize = 13.sp,
                        )
                    }
                }
            }

            if (swapIntent) {
                // §8 pivot — navigate to the swap page carrying the SELECTED sub-shift + scope.
                ShiftButton(
                    "Choose who to swap with",
                    onClick = { onProposeSwap(subShiftFor(shift, partialPlan), permanentScope) },
                    modifier = Modifier.fillMaxWidth().testTag("swap_continue_button"),
                    fullWidth = true,
                )
            } else {
                ShiftButton(
                    when {
                        permanentScope -> "Drop permanently"
                        !partialPlan.wholeShift -> "Drop ${partialPlan.rangeLabel}"
                        else -> "Drop this week"
                    },
                    // [onDrop] owns the whole move (live POST + the optimistic two-VM shuffle:
                    // leave the agenda, appear in the open feed) AND the dismiss. BOTH scopes drop
                    // the SELECTED sub-shift — its blockIds are the contiguous run the EF receives;
                    // the rest re-coalesce. A whole-shift selection (the default) drops the whole slot.
                    onClick = { onDrop(subShiftFor(shift, partialPlan), permanentScope) },
                    modifier = Modifier.fillMaxWidth().testTag("drop_confirm_button"),
                    variant = ButtonVariant.DestructiveFilled,
                    fullWidth = true,
                )
            }
        }
}

/**
 * One equal-weight intent card in the manage-shift sheet (Option C) — "Drop the shift" /
 * "Swap it". A disabled card (no swap available) dims and ignores taps.
 */
@Composable
private fun IntentCard(
    modifier: Modifier,
    selected: Boolean,
    title: String,
    body: String,
    icon: ImageVector,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) primary.copy(alpha = 0.08f) else Color.Transparent)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) primary else c.divider), RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.4f)
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(icon, contentDescription = null, tint = if (selected) primary else c.sec, modifier = Modifier.size(20.dp))
        Text(title, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
        Text(body, color = c.sec, fontSize = 11.5.sp, lineHeight = 14.sp)
    }
}

/**
 * The shared this-week / permanent scope selector (manage-shift sheet). "Permanent" dims and
 * ignores taps when the current intent can't go permanent (e.g. a pickup or float card).
 */
@Composable
private fun ScopeSegmentedControl(
    permanent: Boolean,
    permanentEnabled: Boolean,
    onThisWeek: () -> Unit,
    onPermanent: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(c.surfaceVar)
            .padding(3.dp)
            .testTag("scope_segmented"),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        ScopeSegment("This week only", selected = !permanent, enabled = true, tag = "scope_this_week", modifier = Modifier.weight(1f), onClick = onThisWeek)
        ScopeSegment("Permanent", selected = permanent, enabled = permanentEnabled, tag = "scope_permanent", modifier = Modifier.weight(1f), onClick = onPermanent)
    }
}

@Composable
private fun ScopeSegment(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    tag: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) c.surface else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.4f)
            .padding(vertical = 8.dp)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) c.ink else c.sec,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

/**
 * The §5.2 "How much to drop" block-range selector (T2-11): a stepped range
 * slider over the card's 30-min blocks with a live "17:30 - 19:00 · 1h 30m"
 * summary, plus the mid-shift "From now" quick action when `now` falls inside
 * the shift. Defaults to the whole shift.
 */
@Composable
private fun DropRangeSelector(
    plan: PartialDropPlan,
    blockCount: Int,
    rangeFrom: Int,
    rangeTo: Int,
    fromNowIndex: Int?,
    onRange: (Int, Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("drop_range_selector"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("How much", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            if (fromNowIndex != null) {
                Text(
                    "From now",
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { onRange(fromNowIndex, blockCount) }
                            .testTag("drop_from_now")
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        }
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeShift) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
            modifier = Modifier.testTag("drop_range_label"),
        )
        RangeSlider(
            value = rangeFrom.toFloat()..rangeTo.toFloat(),
            onValueChange = { range ->
                val from = range.start.toInt().coerceIn(0, blockCount - 1)
                val to = range.endInclusive.toInt().coerceIn(from + 1, blockCount)
                onRange(from, to)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
        )
    }
}

// ===================================================================
// Swap proposal (§8.1-§8.4, D2/D3) — initiate a swap from a My-Shifts card.
// ===================================================================

/**
 * The swap-proposal sheet: pick the swap kind the card supports (§8 — float
 * cards propose a float swap; scheduled cards a this-week or permanent swap;
 * pickups a this-week swap), then the counterparty — a housemate's run from
 * the §11.4 house grid for temporary swaps, a PERSON for permanent swaps. The
 * server (`create-swap` + packages/core eligibility) stays authoritative; a
 * rejected proposal simply creates nothing and the feed never shows it.
 */
/** A committed leg in the compose flow (UI-side; resolved to a [SwapLeg] at submit). */
private data class PendingSwapLeg(
    val candidate: SwapCandidate,
    val give: BlockRange,
    val giveLabel: String,
    val takeBlockIds: List<String>,
    val takeLabel: String,
)

@Composable
private fun SwapSheet(
    shift: MyShift,
    kinds: List<SwapKind>,
    candidates: List<SwapCandidate>,
    onSubmit: (List<SwapProposal>) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val row = remember(shift) { shift.toRow() }
    var kind by remember { mutableStateOf(kinds.first()) }
    val options = remember(kind, candidates) { if (kind == SwapKind.PERMANENT) swapPeople(candidates) else candidates }
    val blockCount = shift.blockIds.size

    // Multi-party = INDEPENDENT LEGS (decision 2026-06-15). `committed` holds the legs
    // already added; `picked` + `give` + `take` are the leg currently being composed.
    // A new `kind` resets everything (permanent has no legs/partial).
    var committed by remember(kind) { mutableStateOf<List<PendingSwapLeg>>(emptyList()) }
    var picked by remember(kind) { mutableStateOf<SwapCandidate?>(null) }
    var give by remember(kind) { mutableStateOf<BlockRange?>(null) }
    var take by remember(kind) { mutableStateOf<BlockRange?>(null) }

    val isTemp = kind != SwapKind.PERMANENT
    val allocated = remember(committed) { committed.flatMap { it.give.from until it.give.to }.toSet() }
    val giveOverlaps = give?.let { (it.from until it.to).any { i -> i in allocated } } ?: false
    val allAllocated = allocated.size >= blockCount

    fun defaultGive(): BlockRange? = if (blockCount <= 1) BlockRange(0, blockCount) else firstFreeRange(blockCount, allocated)

    fun pick(candidate: SwapCandidate) {
        picked = candidate
        take = BlockRange(0, candidate.seatIds.size)
        if (give == null || giveOverlaps) give = defaultGive()
    }

    fun currentLeg(): SwapLeg? {
        val cand = picked ?: return null
        val g = give ?: return null
        if ((g.from until g.to).any { it in allocated }) return null
        val gPlan = planSwapSpan(shift.blockIds, shift.start, shift.end, g.from, g.to)
        val t = take ?: BlockRange(0, cand.seatIds.size)
        val tPlan = planSwapSpan(cand.seatIds, cand.start, cand.end, t.from, t.to)
        return SwapLeg(cand, gPlan.blockIds, tPlan.blockIds)
    }

    fun addLeg() {
        val cand = picked ?: return
        val g = give ?: return
        val gPlan = planSwapSpan(shift.blockIds, shift.start, shift.end, g.from, g.to)
        val t = take ?: BlockRange(0, cand.seatIds.size)
        val tPlan = planSwapSpan(cand.seatIds, cand.start, cand.end, t.from, t.to)
        committed = committed + PendingSwapLeg(cand, g, gPlan.rangeLabel, tPlan.blockIds, tPlan.rangeLabel)
        val newAllocated = allocated + (g.from until g.to)
        picked = null
        take = null
        give = if (blockCount <= 1) null else firstFreeRange(blockCount, newAllocated)
    }

    val readyLeg = currentLeg()
    val canPropose = committed.isNotEmpty() || readyLeg != null

    ShiftBottomSheet(onDismiss = onDismiss, title = "Propose a swap") {
        Column(
            Modifier.fillMaxWidth().testTag("swap_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(row.houseInitial, c.surfaceVar, c.ink)
                Column {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
                    Text("${row.houseName ?: row.destination ?: ""} · ${row.durationLabel} · ${row.dayLabel}", color = c.sec, fontSize = 13.sp)
                }
            }

            if (kinds.size > 1) {
                ScopeOption(
                    selected = kind == SwapKind.SHIFT,
                    title = "Swap this week's occurrence",
                    body = "You take theirs, they take yours, this week only.",
                    icon = ShiftIcons.Refresh,
                    accent = MaterialTheme.colorScheme.primary,
                    tag = "swap_kind_shift",
                    onClick = { kind = SwapKind.SHIFT },
                )
                ScopeOption(
                    selected = kind == SwapKind.PERMANENT,
                    title = "Swap permanently",
                    body = "Transfers this whole recurring slot for the rest of the period.",
                    icon = ShiftIcons.Refresh,
                    accent = c.permanent.accent,
                    tag = "swap_kind_permanent",
                    onClick = { kind = SwapKind.PERMANENT },
                )
            } else if (kind == SwapKind.FLOAT) {
                Text(
                    "Float swap: a housemate takes your float assignment.",
                    color = c.sec,
                    fontSize = 13.sp,
                )
            }

            // Committed legs (multi-party). Each is independent — remove one without
            // touching the others. Shown only when there is more than the in-progress leg.
            if (committed.isNotEmpty()) {
                Column(
                    Modifier.testTag("swap_legs"),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    SectionHeader("Swapping with ${committed.size + if (readyLeg != null) 1 else 0}")
                    committed.forEachIndexed { i, leg ->
                        CommittedLegRow(leg = leg, onRemove = { committed = committed.filterIndexed { j, _ -> j != i } })
                    }
                }
            }

            SectionHeader(
                when {
                    kind == SwapKind.PERMANENT -> "Who takes the slot?"
                    committed.isEmpty() -> "Whose shift do you want?"
                    else -> "Add another person"
                },
            )
            if (options.isEmpty()) {
                Text("No housemates with shifts this week to swap with.", color = c.ter, fontSize = 13.sp)
            } else {
                Column(
                    Modifier.testTag("swap_candidate_list"),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    options.take(8).forEach { candidate ->
                        SwapCandidateRow(
                            candidate = candidate,
                            personOnly = kind == SwapKind.PERMANENT,
                            selected = picked?.userId == candidate.userId && picked?.seatIds == candidate.seatIds,
                            onClick = { if (kind == SwapKind.PERMANENT) picked = candidate else pick(candidate) },
                        )
                    }
                }
            }

            // §8.1 partial block pickers — only for temporary swaps with a picked
            // counterparty and a sub-dividable span. Default to the whole free run.
            if (isTemp && picked != null) {
                give?.let { g ->
                    if (blockCount > 1) {
                        SwapRangeSelector(
                            title = "Your hours to give",
                            plan = planSwapSpan(shift.blockIds, shift.start, shift.end, g.from, g.to),
                            blockCount = blockCount,
                            range = g,
                            tag = "swap_give_range",
                            onRange = { from, to -> give = BlockRange(from, to) },
                        )
                    }
                }
                picked?.let { cand ->
                    val t = take ?: BlockRange(0, cand.seatIds.size)
                    if (cand.seatIds.size > 1) {
                        SwapRangeSelector(
                            title = "Hours you want from ${cand.workerName}",
                            plan = planSwapSpan(cand.seatIds, cand.start, cand.end, t.from, t.to),
                            blockCount = cand.seatIds.size,
                            range = t,
                            tag = "swap_take_range",
                            onRange = { from, to -> take = BlockRange(from, to) },
                        )
                    }
                }
                if (giveOverlaps) {
                    Text(
                        "Those hours overlap another swap, so pick different hours.",
                        color = c.floatOut.deep,
                        fontSize = 12.5.sp,
                        modifier = Modifier.testTag("swap_overlap_warning"),
                    )
                }
                if (!allAllocated) {
                    ShiftButton(
                        "Add another person",
                        onClick = { addLeg() },
                        modifier = Modifier.fillMaxWidth().testTag("swap_add_leg_button"),
                        variant = ButtonVariant.Tonal,
                        fullWidth = true,
                        enabled = readyLeg != null,
                    )
                }
            }

            ShiftButton(
                if (kind == SwapKind.PERMANENT || committed.size + (if (readyLeg != null) 1 else 0) <= 1) {
                    "Propose swap"
                } else {
                    "Propose ${committed.size + (if (readyLeg != null) 1 else 0)} swaps"
                },
                onClick = {
                    if (kind == SwapKind.PERMANENT) {
                        picked?.let { onSubmit(listOf(buildSwapProposal(SwapKind.PERMANENT, shift, it))) }
                    } else {
                        val legs = committed.map { SwapLeg(it.candidate, shift.blockIds.subList(it.give.from, it.give.to), it.takeBlockIds) }
                        val all = legs + listOfNotNull(readyLeg)
                        if (all.isNotEmpty()) onSubmit(buildSwapProposals(kind, shift, all))
                    }
                    onDismiss()
                },
                modifier = Modifier.fillMaxWidth().testTag("swap_submit_button"),
                fullWidth = true,
                enabled = if (kind == SwapKind.PERMANENT) picked != null else canPropose,
            )
        }
    }
}

/**
 * Calendar swap sheet (CALENDAR_REDESIGN.md) — the week-paged give/take picker (Android
 * mirror of iOS `SwapCalendarSheetView`). The tapped shift is the pinned "give"; the
 * worker pages weeks and taps a housemate's shift to "take" (or, in Hand-off mode, picks
 * a recipient to give to). Live: fetches each shown week's house grid; demo: the seeded
 * current week. Whole-run swaps in v1.
 */
@Composable
private fun SwapCalendarBody(
    giveShift: MyShift,
    meUserId: String?,
    demoSeats: List<HouseSeat>,
    onSubmit: (List<SwapProposal>) -> Unit,
    pendingGiveAssignmentIds: Set<String> = emptySet(),
    // Carries the shared manage-shift scope: opens straight into a permanent swap (when the
    // give is permanent-eligible) instead of a this-week swap.
    initialPermanent: Boolean = false,
) {
    val c = ShiftTheme.colors
    val vm =
        remember(giveShift, meUserId, pendingGiveAssignmentIds, initialPermanent) {
            DemoFactory.swapCalendarViewModel(giveShift, meUserId ?: "demo", false, pendingGiveAssignmentIds, initialPermanent)
        }
    val state by vm.uiState.collectAsStateWithLifecycle()
    // Fetch the shown week's housemate grid on every week change (live), or feed the demo
    // seats. Keyed on weekOffset so prev/next reloads; setWeekSeats ignores stale fetches.
    LaunchedEffect(state.weekOffset, meUserId) {
        val seats =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchHouseScheduleForWeek(meUserId, state.anchor)?.seats }
                    .getOrNull() ?: emptyList()
            } else {
                demoSeats
            }
        vm.setWeekSeats(state.weekOffset, seats)
    }
    // The §8.5 hand-off recipient directory (cross-house) — fetched once; the picker is
    // a people roster, independent of which week the give shift sits in.
    LaunchedEffect(meUserId) {
        val directory =
            if (meUserId != null) {
                runCatching { WorkerBackend.shiftsRepository.fetchWorkerDirectory() }.getOrNull().orEmpty()
            } else {
                DemoData.workerDirectory()
            }
        vm.setWorkerDirectory(directory)
    }
    Column(
        Modifier.fillMaxWidth().testTag("swap_calendar_sheet"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
            if (state.legs.isNotEmpty()) {
                Column(Modifier.testTag("swap_legs"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.legs.forEachIndexed { i, leg ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.surfaceVar)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(leg.workerName, color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                Text(leg.summary, color = c.sec, fontSize = 12.sp)
                            }
                            Text(
                                "✕",
                                color = c.sec,
                                fontSize = 13.sp,
                                modifier = Modifier.clip(RoundedCornerShape(50)).clickable { vm.removeLeg(i) }.padding(6.dp),
                            )
                        }
                    }
                }
            }

            // After banking a leg, the one-tap "give the next part to the same person too"
            // shortcut (the chosen same-person flow): two non-contiguous parts of one shift to
            // one person stay independent legs, but feel like one intent.
            state.suggestion?.let { sug -> SwapSuggestionChip(sug) { vm.acceptSuggestion() } }

            state.deal?.let { deal -> SwapDealCard(deal, handoff = state.handoff, permanent = state.permanent) }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                SwapModePill("Swap", selected = !state.handoff, modifier = Modifier.weight(1f).testTag("swap_mode_swap")) { vm.setHandoff(false) }
                SwapModePill("Hand off", selected = state.handoff, modifier = Modifier.weight(1f).testTag("swap_mode_handoff")) { vm.setHandoff(true) }
            }

            // Hand-off (§8.5) is NOT a calendar exchange — you just pick who covers the
            // shift. So in hand-off mode the whole week/day/take calendar is replaced by
            // the cross-house recipient directory below.
            if (state.handoff) {
                HandoffRecipientPicker(
                    state = state,
                    onPick = { vm.pickRecipient(it) },
                    onQuery = { vm.setHandoffQuery(it) },
                )
            } else {
            // ── "Your shift" controls — PROMINENT, above the calendar. Partial swaps are
            // uncommon but heavily used; the old hidden "adjust hours" link was
            // undiscoverable. The give-duration control shows whenever your shift is
            // splittable — for a plain swap AND a permanent swap (§8.1/§8.3 partial).
            if (state.giveSplittable) {
                state.give?.let { g ->
                    // Once a part is banked, the shift fragments — show the segmented timeline
                    // (locked zones + tap-to-focus) above the slider; the slider then only
                    // adjusts "how much" within the focused free run.
                    if (state.giveSegments.any { it.locked }) {
                        SwapTimelineStrip(state.giveSegments, tag = "swap_give_timeline", activeVerb = "Giving") { vm.focusGiveRun(it) }
                    }
                    SwapRangeSelector(
                        title = if (state.permanent) "How much of your slot to give?" else "How much of your shift to give?",
                        plan = planSwapSpan(g.seatIds, g.start, g.end, state.giveFrom, state.giveTo),
                        blockCount = state.giveBlockCount,
                        runFrom = state.giveRunFrom,
                        runTo = state.giveRunTo,
                        range = BlockRange(state.giveFrom, state.giveTo),
                        tag = "swap_give_range",
                        onRange = { from, to -> vm.setGiveRange(from, to) },
                    )
                }
            }

            if (state.permanentToggleVisible) {
                PermanentToggleCard(on = state.permanent) { vm.togglePermanent() }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("‹", color = c.ink, fontSize = 22.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { vm.previousWeek() }.testTag("swap_week_prev").padding(horizontal = 10.dp))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.weekRange, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Text(state.weekRelative, color = c.ter, fontSize = 12.sp)
                }
                Text("›", color = c.ink, fontSize = 22.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { vm.nextWeek() }.testTag("swap_week_next").padding(horizontal = 10.dp))
            }

            Row(Modifier.fillMaxWidth().testTag("swap_day_strip"), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                state.days.forEach { d ->
                    val sel = d.index == state.selectedDayIndex
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable { vm.selectDay(d.index) }.padding(vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(d.dayLetter, color = c.sec, fontSize = 11.sp)
                        Box(
                            Modifier.size(28.dp).clip(RoundedCornerShape(50)).background(if (sel) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(d.dateLabel, color = if (sel) androidx.compose.ui.graphics.Color.White else c.ink, fontSize = 13.sp)
                        }
                        Box(Modifier.size(4.dp).clip(RoundedCornerShape(50)).background(if (d.hasShifts) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent))
                    }
                }
            }

            SectionHeader(if (state.permanent) "Swap your slot with whom?" else "Whose shift do you want?")
            when {
                state.loadingWeek -> Text("Loading housemates…", color = c.ter, fontSize = 13.sp)
                state.day.others.isEmpty() -> Text("No housemates on this day. Try another day or week.", color = c.ter, fontSize = 13.sp)
                else ->
                    Column(Modifier.testTag("swap_take_list"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.day.others.forEach { card -> SwapTakeCard(card, selected = state.take == card) { vm.pickTake(card) } }
                    }
            }

            // Take hours — contextual to the picked person (1:1 shift/float swaps only; a
            // permanent swap is person-level, so this is hidden when permanent is on).
            if (state.take != null && state.takeSplittable) {
                state.take?.let { t ->
                    // Re-taking a counterparty shift you already took part of: the taken blocks
                    // render locked (two-budget rule, keyed per counterparty shift).
                    if (state.takeSegments.any { it.locked }) {
                        SwapTimelineStrip(state.takeSegments, tag = "swap_take_timeline", activeVerb = "Taking") { vm.focusTakeRun(it) }
                    }
                    SwapRangeSelector(
                        title = "Hours you want from ${t.workerName}",
                        plan = planSwapSpan(t.seatIds, t.start, t.end, state.takeFrom, state.takeTo),
                        blockCount = state.takeBlockCount,
                        runFrom = state.takeRunFrom,
                        runTo = state.takeRunTo,
                        range = BlockRange(state.takeFrom, state.takeTo),
                        tag = "swap_take_range",
                        onRange = { from, to -> vm.setTakeRange(from, to) },
                    )
                }
            }

            if (state.canAddLeg) {
                ShiftButton(
                    "+ Add another person",
                    onClick = { vm.addLeg() },
                    modifier = Modifier.fillMaxWidth().testTag("swap_add_leg"),
                    variant = ButtonVariant.Tonal,
                    fullWidth = true,
                )
            }
            } // end !handoff calendar block

            val legCount = state.legs.size + (if (state.take != null) 1 else 0)
            ShiftButton(
                when {
                    state.handoff -> "Hand off shift"
                    legCount > 1 -> "Propose $legCount swaps"
                    else -> "Propose swap"
                },
                onClick = { onSubmit(vm.proposals()) },
                modifier = Modifier.fillMaxWidth().testTag("swap_submit_button"),
                fullWidth = true,
                enabled = state.canPropose,
            )
    }
}

/**
 * The give ⇄ take "deal" card at the top of the swap sheet — the always-visible review of
 * the forming proposal. The give side is pinned from the tapped shift; the take side fills
 * in as the worker picks (or stays a muted placeholder). The connector is `⇄` for a swap,
 * `→` for a hand-off; a "Permanent" tag rides the card when the swap is permanent.
 */
@Composable
private fun SwapDealCard(
    deal: SwapDeal,
    handoff: Boolean,
    permanent: Boolean,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(BorderStroke(1.dp, c.divider), RoundedCornerShape(14.dp))
            .testTag("swap_deal_card"),
    ) {
        // Give side (always present) — sits on a tinted surface to read as "what leaves you".
        Column(
            Modifier.fillMaxWidth().background(c.surfaceVar).padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("YOU GIVE", color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp, modifier = Modifier.weight(1f))
                if (permanent) {
                    Text(
                        "Permanent",
                        color = primary,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(primary.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
            Text(deal.giveTitle, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(deal.giveDetail, color = c.sec, fontSize = 13.sp)
        }
        // Connector — a divider broken by a tinted ⇄ / → badge.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.weight(1f).height(1.dp).background(c.divider))
            Box(
                Modifier.size(28.dp).clip(RoundedCornerShape(50)).background(primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (handoff) "→" else "⇄", color = primary, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
            Box(Modifier.weight(1f).height(1.dp).background(c.divider))
        }
        // Take side — filled once a counterparty is picked, else a muted prompt.
        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp)) {
            Text(deal.takeEyebrow.uppercase(), color = c.sec, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp)
            if (deal.takeTitle == null) {
                Text(deal.takePlaceholder, color = c.ter, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
            } else {
                Row(
                    Modifier.padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    HouseBadge(deal.takeInitial ?: "?", c.surfaceVar, c.ink)
                    Column(Modifier.weight(1f)) {
                        Text(deal.takeTitle!!, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        deal.takeDetail?.let { Text(it, color = c.sec, fontSize = 13.sp) }
                    }
                }
            }
        }
    }
}

@Composable
private fun SwapModePill(
    title: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Box(
        modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) MaterialTheme.colorScheme.primary else c.surfaceVar)
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title,
            color = if (selected) androidx.compose.ui.graphics.Color.White else c.ink,
            fontSize = 13.5.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
        )
    }
}

/**
 * The permanent-swap toggle as a prominent card (§8.3) — promoted from the old tiny
 * bottom checkbox. Visible up front (the give shift is pinned), and partial-aware: the
 * give-duration control above still applies, so a worker can permanently hand off just
 * part of a recurring slot.
 */
@Composable
private fun PermanentToggleCard(
    on: Boolean,
    onToggle: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (on) primary.copy(alpha = 0.08f) else c.surface)
            .border(BorderStroke(if (on) 1.5.dp else 1.dp, if (on) primary else c.divider), RoundedCornerShape(12.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag("swap_permanent_toggle"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(if (on) primary else androidx.compose.ui.graphics.Color.Transparent)
                .border(if (on) 0.dp else 1.5.dp, if (on) primary else c.outline, RoundedCornerShape(6.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (on) Text("✓", color = androidx.compose.ui.graphics.Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f)) {
            Text("Make it permanent", color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text("Swap this slot every week for the rest of the period", color = c.sec, fontSize = 12.5.sp)
        }
    }
}

@Composable
private fun SwapTakeCard(
    card: SwapDayCard,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else c.surface)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else c.divider), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_take_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(card.workerName.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(card.workerName, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text("${card.timeLabel} · ${card.durationLabel}", color = c.sec, fontSize = 12.5.sp)
        }
        if (selected) Text("✓", color = MaterialTheme.colorScheme.primary, fontSize = 16.sp)
    }
}

/**
 * Hand-off (§8.5) recipient directory — replaces the swap calendar with a people picker:
 * a "My House" tab (the worker's own-house roster, flat) and an "Others" tab (every other
 * house, grouped + searchable, since 10+ houses × ~8 workers is too long to scan). Only
 * workers eligible to receive THIS shift are listed (the VM pre-filters via
 * `buildHandoffDirectory`); the server stays authoritative on create/accept.
 */
@Composable
private fun HandoffRecipientPicker(
    state: SwapCalendarUiState,
    onPick: (HandoffWorker) -> Unit,
    onQuery: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    var tab by remember { mutableStateOf(0) } // 0 = My House, 1 = Others
    val dir = state.handoffDirectory
    Column(Modifier.fillMaxWidth().testTag("handoff_picker"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            SwapModePill("My House", selected = tab == 0, modifier = Modifier.weight(1f).testTag("handoff_tab_my_house")) { tab = 0 }
            SwapModePill("Others", selected = tab == 1, modifier = Modifier.weight(1f).testTag("handoff_tab_others")) { tab = 1 }
        }
        if (tab == 0) {
            if (dir.myHouse.isEmpty()) {
                Text("No eligible workers in your house.", color = c.ter, fontSize = 13.sp, modifier = Modifier.testTag("handoff_my_house_empty"))
            } else {
                Column(Modifier.testTag("handoff_my_house_list"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    dir.myHouse.forEach { w ->
                        HandoffWorkerRow(w, selected = state.recipient?.userId == w.userId, showHouse = false) { onPick(w) }
                    }
                }
            }
        } else {
            HandoffSearchField(value = state.handoffQuery, onValue = onQuery)
            if (dir.others.isEmpty()) {
                Text(
                    if (state.handoffQuery.isBlank()) "No eligible workers in other houses." else "No matches for \"${state.handoffQuery}\".",
                    color = c.ter,
                    fontSize = 13.sp,
                    modifier = Modifier.testTag("handoff_others_empty"),
                )
            } else {
                Column(Modifier.testTag("handoff_others_list"), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    dir.others.forEach { group ->
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                group.houseName.uppercase(),
                                color = c.sec,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                letterSpacing = 0.5.sp,
                                modifier = Modifier.testTag("handoff_house_group"),
                            )
                            group.workers.forEach { w ->
                                HandoffWorkerRow(w, selected = state.recipient?.userId == w.userId, showHouse = false) { onPick(w) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One pickable hand-off recipient (name + optional house), selected-state highlighted. */
@Composable
private fun HandoffWorkerRow(
    worker: HandoffWorker,
    selected: Boolean,
    showHouse: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else c.surface)
            .border(BorderStroke(if (selected) 1.5.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else c.divider), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("handoff_worker_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(worker.name.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(worker.name, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            if (showHouse) Text(worker.homeHouseName, color = c.sec, fontSize = 12.5.sp)
        }
        if (selected) Text("✓", color = MaterialTheme.colorScheme.primary, fontSize = 16.sp)
    }
}

/** A styled search field for the hand-off "Others" tab — filters by worker / house name. */
@Composable
private fun HandoffSearchField(
    value: String,
    onValue: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(c.surfaceVar)
            .border(BorderStroke(1.dp, c.divider), RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag("handoff_search"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Search, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text("Search workers or houses", color = c.ter, fontSize = 14.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                modifier = Modifier.fillMaxWidth().testTag("handoff_search_field"),
                singleLine = true,
                textStyle = TextStyle(color = c.ink, fontSize = 14.sp),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                ShiftIcons.Close,
                contentDescription = "Clear",
                tint = c.sec,
                modifier = Modifier.size(18.dp).clip(RoundedCornerShape(50)).clickable { onValue("") }.testTag("handoff_search_clear"),
            )
        }
    }
}

/** A committed leg chip — "→ Ben · give 14:00-15:00 ⇄ take 09:00-10:00" + remove. */
@Composable
private fun CommittedLegRow(
    leg: PendingSwapLeg,
    onRemove: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.surfaceVar)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_leg_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(leg.candidate.workerName, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            Text("Give ${leg.giveLabel} · take ${leg.takeLabel}", color = c.sec, fontSize = 12.5.sp)
        }
        Icon(
            ShiftIcons.Close,
            contentDescription = "Remove",
            tint = c.sec,
            modifier =
                Modifier
                    .size(20.dp)
                    .clip(RoundedCornerShape(50))
                    .clickable(onClick = onRemove)
                    .testTag("swap_leg_remove"),
        )
    }
}

/**
 * The §8.1 "how much" block-range selector for a swap span — a stepped RangeSlider over
 * the span's 30-min blocks with a live "14:00 - 15:00 · 1h" summary (mirrors the drop /
 * claim partial selectors). Defaults to the whole span.
 */
@Composable
private fun SwapRangeSelector(
    title: String,
    plan: com.pennhousing.shift.shared.swaps.SwapSpanSelection,
    blockCount: Int,
    range: BlockRange,
    tag: String,
    onRange: (Int, Int) -> Unit,
    // The free run the handles are clamped to (so they can't cross a locked zone). Defaults
    // to the whole span — the legacy quick-swap sheet has no locked runs.
    runFrom: Int = 0,
    runTo: Int = blockCount,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(plan.dayLabel, color = c.sec, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeSpan) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
        )
        val lo = runFrom.coerceIn(0, (blockCount - 1).coerceAtLeast(0))
        val hi = runTo.coerceIn(lo + 1, blockCount)
        RangeSlider(
            value = range.from.toFloat().coerceIn(lo.toFloat(), hi.toFloat())..range.to.toFloat().coerceIn(lo.toFloat(), hi.toFloat()),
            onValueChange = { r ->
                val from = r.start.toInt().coerceIn(lo, hi - 1)
                val to = r.endInclusive.toInt().coerceIn(from + 1, hi)
                onRange(from, to)
            },
            valueRange = lo.toFloat()..hi.toFloat(),
            steps = (hi - lo - 1).coerceAtLeast(0),
        )
    }
}

/**
 * The segmented give/take timeline — one track per shift, locked zones greyed (with the
 * receiver's name / "Taken"), the active selection accented, free runs tap-to-focus. Shown
 * only once a part is reserved, so the common single-leg case stays a plain slider.
 */
@Composable
private fun SwapTimelineStrip(
    segments: List<SwapSegment>,
    tag: String,
    activeVerb: String,
    onFocus: (Int) -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.fillMaxWidth().testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        segments.forEach { seg ->
            val weight = (seg.to - seg.from).coerceAtLeast(1).toFloat()
            val base =
                when {
                    seg.locked -> c.surfaceVar
                    seg.active -> primary.copy(alpha = 0.10f)
                    else -> c.surface
                }
            val borderColor = if (seg.active) primary else if (seg.locked) c.divider else c.outline
            Column(
                Modifier
                    .weight(weight)
                    .clip(shape)
                    .background(base)
                    .border(if (seg.active) 1.5.dp else 1.dp, borderColor, shape)
                    .then(if (!seg.locked && !seg.active) Modifier.clickable { onFocus(seg.from) } else Modifier)
                    .testTag(if (seg.locked) "swap_seg_locked" else if (seg.active) "swap_seg_active" else "swap_seg_free")
                    .padding(horizontal = 6.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(seg.rangeLabel, color = if (seg.locked) c.ter else c.ink, fontSize = 10.5.sp, maxLines = 1, softWrap = false)
                Text(
                    when {
                        seg.locked -> seg.note ?: "Given"
                        seg.active -> activeVerb
                        else -> "Tap"
                    },
                    color = if (seg.active) primary else c.ter,
                    fontSize = 10.sp,
                    fontWeight = if (seg.active) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
    }
}

/** The same-person "give the next part to X too" chip (accent, one tap → [acceptSuggestion]). */
@Composable
private fun SwapSuggestionChip(
    suggestion: SwapLegSuggestion,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val primary = MaterialTheme.colorScheme.primary
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(primary.copy(alpha = 0.08f))
            .border(1.dp, primary.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_suggestion"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("+", color = primary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        Text(suggestion.label, color = primary, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        Text("›", color = primary, fontSize = 16.sp)
    }
}

/** One pickable counterparty row — a run (temporary swaps) or a person (permanent). */
@Composable
private fun SwapCandidateRow(
    candidate: SwapCandidate,
    personOnly: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = MaterialTheme.colorScheme.primary
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.08f) else c.surface)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) accent else c.divider, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("swap_candidate_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(candidate.workerName.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(candidate.workerName, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            if (!personOnly) {
                Text(
                    "${candidate.dayLabel} · ${candidate.timeLabel} · ${candidate.durationLabel}",
                    color = c.sec,
                    fontSize = 12.5.sp,
                )
            }
        }
        if (selected) {
            Icon(ShiftIcons.CheckCircle, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
        }
    }
}

/** A radio-style drop-scope option (design `ScopeOption`). */
@Composable
private fun ScopeOption(
    selected: Boolean,
    title: String,
    body: String,
    icon: ImageVector,
    accent: Color,
    tag: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    val c = ShiftTheme.colors
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) accent.copy(alpha = 0.08f) else c.surface)
            .border(if (selected) 1.5.dp else 1.dp, if (selected) accent else c.divider, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .alpha(if (enabled) 1f else 0.5f)
            .padding(12.dp)
            .testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.size(20.dp).clip(RoundedCornerShape(50)).border(2.dp, if (selected) accent else c.outline, RoundedCornerShape(50)),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(accent))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(body, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)
        }
        Icon(icon, contentDescription = null, tint = if (selected) accent else c.ter, modifier = Modifier.size(20.dp))
    }
}
