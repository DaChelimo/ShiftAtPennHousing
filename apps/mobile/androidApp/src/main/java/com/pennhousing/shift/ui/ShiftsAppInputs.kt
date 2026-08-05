package com.pennhousing.shift.ui

import com.pennhousing.shift.shared.settings.NotificationPreferences
import com.pennhousing.shift.shared.data.HouseHoursResult
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.notifications.ToastNotification
import com.pennhousing.shift.shared.house.HouseSeat
import com.pennhousing.shift.shared.manager.ManagerCapabilities
import com.pennhousing.shift.shared.manager.managerCapabilitiesOf
import com.pennhousing.shift.shared.viewmodel.CoverageViewModel
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.swaps.SwapProposal
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import kotlin.time.Instant

/**
 * [ShiftsApp]'s inputs, grouped so its contract reads as three ideas instead of 41 positional
 * parameters. The split is by role, which is also how the two call sites
 * ([com.pennhousing.shift.MainActivity]'s live/demo roots and the test harness) already think
 * about them:
 *
 * - [ShiftsViewModels] — the per-surface ViewModels, all built together.
 * - [ShiftsHostState] — the snapshot values the host feeds in (clock, floats, toasts, deep link).
 * - [ShiftsActions] — the best-effort write callbacks the host wires to Edge Functions; every one
 *   defaults to a no-op, which is exactly the demo/test behaviour (optimistic local move, no
 *   network), so a caller supplies only the actions it actually handles.
 *
 * ShiftsApp unpacks these back into locals at the top of its body, so the grouping is purely the
 * public contract; the screen logic below reads the same names it always has.
 */
internal data class ShiftsViewModels(
    val shiftsVm: ShiftsScreenViewModel,
    val ackVm: AckDeclineViewModel,
    val updatesVm: UpdatesViewModel,
    val swapsVm: SwapsViewModel,
    val calendarVm: CalendarViewModel,
    val houseVm: HouseScheduleViewModel,
    val preferencesVm: PreferencesViewModel,
    val breakCalendarVm: BreakCalendarViewModel,
    val settingsVm: SettingsViewModel,
    /**
     * MANAGER ONLY (docs/manager-app/SPEC.md §6.1). Null for a plain worker or an SM, which is
     * what keeps a worker's app byte-identical to before manager mode existed: no Coverage
     * tab, no banner, no subscription.
     */
    val coverageVm: CoverageViewModel? = null,
)

/**
 * The host-provided snapshot state. Read-only from the screen's side; the host owns the timers
 * that clear the transient toasts ([toast], [writeError], [claimSuccessMessage]).
 */
internal data class ShiftsHostState(
    // The worker's load instant (the sim-clock on live). The screen VMs embed their own `now`;
    // this builds the per-float ack detail VM for the carousel's tap-to-detail.
    val now: Instant,
    val currentWeeklyHours: Double,
    // Outstanding float requests for the My-Shifts carousel (§7.1), closest-start first. Live
    // host reads `worker_pending_floats`; demo seeds a couple. Empty → no carousel.
    val pendingFloats: List<PendingFloat> = emptyList(),
    // Floats RESOLVED in the last 24h for the collapsible recent section under the carousel.
    val recentFloats: List<RecentFloat> = emptyList(),
    val breakProfile: Boolean = false,
    val toast: ToastNotification? = null,
    // Non-null when a best-effort live write failed to reach the server, surfaced as a top error
    // toast so a swallowed EF failure no longer masquerades as success.
    val writeError: String? = null,
    // The open-shift claim / permanent-pickup confirmation toast, OWNED BY THE HOST so it can
    // reflect the real network outcome (full success, an informative partial note, or cleared on
    // a full failure).
    val claimSuccessMessage: String? = null,
    // Non-null when the app was opened from the float push / a `pennshift://float-ack/{id}` deep
    // link → present the full-screen ack surface on launch.
    val launchFloatAckId: String? = null,
    // The live worker id for swap initiation (null = demo → use [swapDemoSeats] for the week).
    val swapMeUserId: String? = null,
    val swapDemoSeats: List<HouseSeat> = emptyList(),
    /**
     * What manager surfaces this user gets (docs/manager-app/SPEC.md §5). Defaults to a plain
     * worker, so every existing call site and test is unaffected and a failed role read can
     * never accidentally read as privileged.
     *
     * This shapes the UI only. Every manager write re-checks authorization server-side.
     */
    val capabilities: ManagerCapabilities = managerCapabilitiesOf(emptyList(), homeHouseId = ""),
    /**
     * Non-null when the app was opened from an Allied coverage push → jump to Coverage and open
     * the Respond sheet for this request on launch.
     */
    val launchCoverageRequestId: String? = null,
    /**
     * MANAGER ONLY — the Hours report for the viewed house (docs/manager-app/SPEC.md §6.5). Null
     * while it loads, or for a plain worker who has no Hours tab.
     *
     * This is a plain snapshot rather than a ViewModel because the screen holds no state of its
     * own beyond which row is expanded, which is local UI state.
     */
    val hoursReport: HouseHoursResult? = null,
)

/**
 * The host's best-effort write callbacks. Each POSTs an Edge Function on the live host while the
 * relevant ViewModel does the optimistic local move; every one defaults to a no-op, which is the
 * demo/test path (no network). [onSubmitPreferences] is the one exception — null here means "use
 * the Preferences ViewModel's own local submit", resolved inside ShiftsApp because the default
 * needs a ViewModel this holder does not carry.
 */
internal data class ShiftsActions(
    val onSignOut: () -> Unit = {},
    // Null → ShiftsApp falls back to preferencesVm::submit (the local-only optimistic flip).
    val onSubmitPreferences: (() -> Unit)? = null,
    // Manager-only (§4.2): set the active period's submission deadline (year, month 1..12, day).
    val onSetDeadline: ((Int, Int, Int) -> Unit)? = null,
    val onDropShift: (MyShift, Boolean) -> Unit = { _, _ -> },
    // WEEKLY openings only; permanent openings route through [onPickUpPermanent].
    val onClaimShift: (OpenShift) -> Unit = {},
    val onClaimSuccessMessage: (String?) -> Unit = {},
    val onPickUpPermanent: (OpenShift) -> Unit = {},
    // Live host GETs the `permanent-pickup` dry-run SCOPE for the "N of M weeks · K skipped"
    // confirmation; demo returns null (the sheet shows the plain note).
    val loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
    val onAcknowledgeFloat: (String) -> Unit = {},
    val onDeclineFloat: (String) -> Unit = {},
    // Break CALENDAR drag (§4.4): the dragged claimable block ids.
    val onClaimBreakRange: (List<String>) -> Unit = {},
    // The claimed seats' assignment ids to drop.
    val onDropBreakSeats: (List<String>) -> Unit = {},
    // The NEW desired opted-out state for the §4.4 "no break hours" opt-out.
    val onToggleBreakOptOut: (Boolean) -> Unit = {},
    // The NEW desired broadcast / "General updates" subscription state.
    val onToggleBroadcast: (Boolean) -> Unit = {},
    // The WHOLE new set of configurable open-shift notification channels (BSpec §10.1);
    // the RPC upserts both columns, so both travel together.
    val onToggleNotification: (NotificationPreferences) -> Unit = {},
    // The worker's still-unread notification ids when "Mark all read" is tapped.
    val onMarkAllRead: (List<String>) -> Unit = {},
    val onAcceptSwap: (String) -> Unit = {},
    val onRejectSwap: (String) -> Unit = {},
    // Off-hours ladder ack (staggered-rollout pilot): the block id.
    val onAcknowledgeAlliedPage: (String) -> Unit = {},
    val onCreateSwap: suspend (SwapProposal) -> Boolean = { false },
    val onVoidSwap: (String) -> Unit = {},
    // ----- Manager mode (docs/manager-app/SPEC.md §6.1). -----
    /**
     * "I am handling this" — fired the moment the Respond sheet OPENS, not on a button. Stops
     * the ladder and the reminders. The Boolean the host reports back is whether the write
     * landed; false means the ViewModel must revert so the banner returns and the alert keeps
     * going. NEVER queue this offline.
     */
    val onAcknowledgeCoverage: suspend (String) -> Boolean = { false },
    /** Record the outcome and close: (requestId, outcome wire value, note). */
    val onCloseCoverage: suspend (String, String, String?) -> Boolean = { _, _, _ -> false },
    /** Dial the desk / Allied. The host opens a `tel:` intent; null number → no-op. */
    val onCallPhone: (String?) -> Unit = {},
    /** One more attempt at an internal float before committing to Allied, from the Respond sheet. */
    val onForceTriggerCoverage: (String) -> Unit = {},
)
