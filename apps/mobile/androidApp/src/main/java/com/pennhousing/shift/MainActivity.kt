package com.pennhousing.shift

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.auth.AppBootstrap
import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.auth.DataSource
import com.pennhousing.shift.shared.auth.StartDestination
import com.pennhousing.shift.shared.ack.parseFloatAckDeepLink
import com.pennhousing.shift.shared.breakclaim.withContext
import com.pennhousing.shift.shared.breakclaim.withOptOut
import com.pennhousing.shift.shared.data.parseProjectedHours
import com.pennhousing.shift.shared.data.withLivePoolFor
import com.pennhousing.shift.shared.data.BreakRepository
import com.pennhousing.shift.shared.data.ProfileSnapshot
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.withIncomingSwapEntries
import com.pennhousing.shift.shared.notifications.withPendingFloatEntry
import com.pennhousing.shift.shared.platform.AppConfig
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.notifications.withOutgoingSwapEntries
import com.pennhousing.shift.shared.swaps.swapCandidates
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.LoginRoute
import com.pennhousing.shift.ui.ShiftsApp
import com.pennhousing.shift.ui.kit.SkeletonShiftCard
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.launch

/**
 * Phase 13a / worker-auth — Android host for the worker app.
 *
 * Routes on launch through the pure [AppBootstrap.decide]:
 *  - no backend configured ⇒ (SHIFTS, DEMO): the original deterministic [DemoData]
 *    experience, unchanged — the Maestro flows depend on it;
 *  - backend configured + a valid restored session ⇒ (SHIFTS, LIVE): collect the
 *    worker's real week from [WorkerShiftsRepository.observeWorkerWeek];
 *  - backend configured + no/expired session ⇒ (LOGIN, LIVE): show the login screen,
 *    then wire the worker JWT and proceed to live shifts on success.
 *
 * The pure decision surface takes `now` as a parameter; the UI is allowed to read the
 * wall clock to supply it.
 */
class MainActivity : ComponentActivity() {
    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* best-effort; push is optional */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        maybeRequestNotificationPermission()

        val backendConfigured = AppConfig.supabaseUrl.isNotBlank()
        // T2-13: a float push tap / external deep link (pennshift://float-ack/{id})
        // opens the FULL-SCREEN FloatAckSurface on launch. Pure parser; null when the
        // app was launched normally.
        val launchFloatAckId = parseFloatAckDeepLink(intent?.dataString)

        setContent {
            if (backendConfigured) {
                LiveOrLoginRoot(launchFloatAckId)
            } else {
                DemoRoot(launchFloatAckId)
            }
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

/**
 * No-backend path: EXACTLY the original demo behavior — shared ViewModels built from a
 * deterministic [DemoData] snapshot anchored to wall-clock `now`.
 */
@Composable
private fun DemoRoot(launchFloatAckId: String? = null) {
    val now = remember { Clock.System.now() }
    val snapshot = remember(now) { DemoData.snapshot(now) }
    val pendingFloat = remember(now) { DemoData.pendingFloat(now) }
    val shiftsVm = remember { ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now) }
    val ackVm = remember { AckDeclineViewModel(pendingFloat, now) }
    val updatesVm = remember { UpdatesViewModel(DemoData.notifications(now), now) }
    val calendarVm = remember { CalendarViewModel(snapshot.myShifts, now) }
    val houseVm = remember { HouseScheduleViewModel(DemoData.houseSchedule(now), now) }
    val preferencesVm = remember { PreferencesViewModel(DemoData.preferencePeriod(now)) }
    val breakClaimVm = remember { BreakClaimViewModel(DemoData.breakClaim(now)) }
    val settingsVm =
        remember { SettingsViewModel(DemoData.settingsProfile(), DemoData.DEMO_BROADCAST_SUBSCRIBED, DemoData.DEMO_APP_VERSION) }
    ShiftsApp(
        shiftsVm = shiftsVm,
        ackVm = ackVm,
        updatesVm = updatesVm,
        calendarVm = calendarVm,
        houseVm = houseVm,
        preferencesVm = preferencesVm,
        breakClaimVm = breakClaimVm,
        settingsVm = settingsVm,
        currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
        // Demo has no backend session → sign-out is a no-op (login is the live path).
        onSignOut = {},
        launchFloatAckId = launchFloatAckId,
        // D2 — demo swap candidates from the demo house grid (no live write).
        swapCandidates = remember(now) { swapCandidates(DemoData.houseSchedule(now).seats, excludeUserId = null) },
    )
}

/**
 * Backend-configured path. Restores any persisted session once, runs the bootstrap
 * decision, then shows login or live shifts. While the (suspending) restore is in
 * flight we show a loading state.
 */
@Composable
private fun LiveOrLoginRoot(launchFloatAckId: String? = null) {
    val now = remember { Clock.System.now() }

    // Restore the session off the gateway exactly once. null while loading; the
    // Optional wrapper distinguishes "still loading" from "loaded: no session".
    val restored by produceState<RestoreResult>(initialValue = RestoreResult.Loading) {
        value = RestoreResult.Loaded(WorkerBackend.authGateway.currentSession())
    }

    val scope = rememberCoroutineScope()
    // An in-session sign-in promotes us to live shifts without re-running the restore.
    var authedSession by remember { mutableStateOf<AuthSession?>(null) }
    // A sign-out forces LOGIN even though the launch-restored session is still cached.
    var signedOut by remember { mutableStateOf(false) }

    when (val result = restored) {
        RestoreResult.Loading -> LoadingScreen()
        is RestoreResult.Loaded -> {
            val session = if (signedOut) null else (authedSession ?: result.session)
            val decision = AppBootstrap.decide(backendConfigured = true, session = session, now = now)

            // decision.source is LIVE on this path; route on the start destination.
            if (decision.start == StartDestination.SHIFTS && decision.source == DataSource.LIVE && session != null) {
                // A session restored at launch (or just authenticated) is the live
                // worker — carry their JWT on every privileged request.
                LaunchedEffect(session.userId) { WorkerBackend.wireAccessToken() }
                LiveShiftsRoot(
                    session = session,
                    now = now,
                    launchFloatAckId = launchFloatAckId,
                    onSignOut = {
                        scope.launch { WorkerBackend.authGateway.signOut() }
                        authedSession = null
                        signedOut = true
                    },
                )
            } else {
                LoginRoute(
                    gateway = WorkerBackend.authGateway,
                    onAuthenticated = { newSession ->
                        // Promote to live shifts; the SHIFTS branch's LaunchedEffect
                        // wires the live worker JWT onto privileged requests.
                        authedSession = newSession
                        signedOut = false
                    },
                )
            }
        }
    }
}

/**
 * Live shifts: collect the worker's week from Supabase Realtime and build the shared
 * [ShiftsScreenViewModel] from the latest snapshot. A simple loading state shows until
 * the first emission.
 *
 * The Updates feed loads the worker's real `notifications` rows; the float-ack modal
 * loads the worker's live pending float (T1-4) and falls back to the demo float while
 * the read is in flight or when none is outstanding.
 */
@Composable
private fun LiveShiftsRoot(
    session: AuthSession,
    now: Instant,
    onSignOut: () -> Unit,
    launchFloatAckId: String? = null,
) {
    val repo = remember { WorkerBackend.shiftsRepository }
    val snapshotState by remember(session.userId) {
        repo.observeWorkerWeek(session.userId)
    }.collectAsStateWithLifecycle(initialValue = null)

    when (val snapshot: WorkerSnapshot? = snapshotState) {
        null -> LoadingScreen()
        else -> {
            // Rebuild the ViewModel whenever a fresh snapshot arrives (e.g. a float at T-2h).
            val shiftsVm = remember(snapshot) { ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now) }
            // Float ack: load the worker's live pending float (own `float_assignments`
            // row + own pending float-out blocks, both RLS-scoped); fall back to the demo
            // float while the read is in flight or when none is outstanding. Ack/decline
            // POST to `acknowledge-float` / `decline-float` (best-effort) when the
            // optimistic local transition succeeds. Mirrors the live-notifications pattern.
            val livePendingFloat by
                produceState<FloatAck?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchPendingFloat(session.userId) }.getOrNull()
                }
            val ackVm = remember(livePendingFloat) { AckDeclineViewModel(livePendingFloat ?: DemoData.pendingFloat(now), now) }
            // Updates: load the worker's real `notifications` rows (RLS-scoped) for the
            // feed; fall back to the demo notifications while the fetch is in flight or
            // if it fails. A `float_assigned` row now maps to the urgent FLOAT entry that
            // opens the ack hero; `withPendingFloatEntry` additionally guarantees the live
            // pending float (from `fetchPendingFloat`) is always represented even if its
            // notification row hasn't landed. Mirrors the live-preferences pattern.
            val liveNotifications by
                produceState<List<NotificationItem>?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchNotifications(session.userId) }.getOrNull()
                }
            // Incoming pending swaps (§8.2, T3a): the worker's own counterparty
            // `swap_requests` rows — `create-swap` writes no notification row, so the
            // feed synthesizes the actionable entries via `withIncomingSwapEntries`.
            val liveIncomingSwaps by
                produceState(initialValue = emptyList<IncomingSwap>(), session.userId) {
                    value = runCatching { repo.fetchIncomingSwaps(session.userId) }.getOrDefault(emptyList())
                }
            // Outgoing pending swaps (D4): the worker's own initiator rows — voidable.
            val liveOutgoingSwaps by
                produceState(initialValue = emptyList<IncomingSwap>(), session.userId) {
                    value = runCatching { repo.fetchOutgoingSwaps(session.userId) }.getOrDefault(emptyList())
                }
            val updatesVm =
                remember(liveNotifications, livePendingFloat, liveIncomingSwaps, liveOutgoingSwaps) {
                    val base = liveNotifications ?: DemoData.notifications(now)
                    UpdatesViewModel(
                        withOutgoingSwapEntries(
                            items =
                                withIncomingSwapEntries(
                                    items =
                                        withPendingFloatEntry(
                                            items = base,
                                            pendingFloatId = livePendingFloat?.floatId,
                                            pendingFloatStart = livePendingFloat?.floatStart,
                                            destinationHouseName = livePendingFloat?.destinationHouse?.name,
                                        ),
                                    swaps = liveIncomingSwaps,
                                ),
                            swaps = liveOutgoingSwaps,
                        ),
                        now,
                    )
                }
            // Closed-house days (§3.4/§11.3, T2-12c): the worker's home house may be
            // closed on some of this week's dates — `house_closure` RPC per visible
            // date (best-effort; empty while loading / on failure → plain calendar).
            val closedDays by
                produceState(initialValue = emptySet<Int>(), session.userId) {
                    value = runCatching { repo.fetchCalendarClosedDays(session.userId) }.getOrDefault(emptySet())
                }
            val calendarVm = remember(snapshot, closedDays) { CalendarViewModel(snapshot.myShifts, now, closedDays) }
            // House schedule (§11.4, T3b): the home house's week grid with contacts
            // (full-directory ruling). Falls back to the demo snapshot while loading.
            val liveHouseSchedule by
                produceState<HouseScheduleSnapshot?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchHouseSchedule(session.userId) }.getOrNull()
                }
            val houseVm =
                remember(liveHouseSchedule) {
                    HouseScheduleViewModel(liveHouseSchedule ?: DemoData.houseSchedule(now), now)
                }
            // Preferences: load the worker's real active period (scheduling_periods now
            // worker-readable — migration 20260610000001); fall back to the demo period
            // while loading or when no period is open. Submit POSTs to `submit-preferences`.
            val prefsRepo = remember { WorkerBackend.preferencesRepository }
            val prefsScope = rememberCoroutineScope()
            val livePeriod by
                produceState<PreferencePeriod?>(initialValue = null, session.userId) {
                    value = runCatching { prefsRepo.fetchActivePreferencePeriod(session.userId) }.getOrNull()
                }
            val preferencesVm =
                remember(livePeriod) { PreferencesViewModel(livePeriod ?: DemoData.preferencePeriod(now)) }
            // Break-claim: LIVE descriptive context (name + window + "only Harnwell open")
            // from the worker-readable `break_periods` (migration 20260611000002); the
            // claimable POOL itself is still demo-backed (live `worker_open_shifts` break
            // rows are a larger wiring, deferred). Fall back to the demo copy while the
            // read is in flight or when no break is current/upcoming.
            // The active break's identity + copy + the worker's current §4.4 opt-out (a row
            // in `break_optouts` → opted out). The id lets the no-break-hours toggle target
            // the real break; the toggle write goes DIRECTLY through Postgrest (worker RLS
            // already permits the own-row insert/delete — no EF). All best-effort: a null
            // read keeps the demo copy and a non-opted-out, no-id snapshot.
            val breakRepo = remember { WorkerBackend.breakRepository }
            val liveBreak by
                produceState<BreakRepository.ActiveBreak?>(initialValue = null, session.userId) {
                    value = runCatching { breakRepo.fetchActiveBreak() }.getOrNull()
                }
            val liveBreakOptedOut by
                produceState(initialValue = false, liveBreak, session.userId) {
                    val bid = liveBreak?.breakId ?: return@produceState
                    value = runCatching { breakRepo.fetchBreakOptOut(session.userId, bid) }.getOrDefault(false)
                }
            val breakClaimVm =
                remember(liveBreak, liveBreakOptedOut, snapshot) {
                    val demo = DemoData.breakClaim(now)
                    val withCopy = liveBreak?.let { demo.withContext(it.context) } ?: demo
                    // D6 — the pool itself is LIVE now: vacant break-window runs from the
                    // worker's open feed + already-claimed runs from worker_my_shifts.
                    val withPool =
                        liveBreak?.let { withCopy.withLivePoolFor(snapshot, it) } ?: withCopy
                    val breakSnapshot =
                        liveBreak?.let { withPool.withOptOut(it.breakId, liveBreakOptedOut) } ?: withPool
                    BreakClaimViewModel(breakSnapshot)
                }
            // Settings: load the worker's real profile + live `broadcast_subscribed` (own
            // users / user_roles + houses, all RLS-readable); fall back to the demo profile
            // while the read is in flight. The broadcast toggle PATCHes the
            // `users-broadcast-subscription` EF (best-effort) — it is the ONLY interactive
            // notification channel (§10.1: personal float / shift-reminder / schedule-published
            // notifications are mandatory and non-silenceable, shown always-on/disabled).
            val profileRepo = remember { WorkerBackend.profileRepository }
            val liveProfile by
                produceState<ProfileSnapshot?>(initialValue = null, session.userId) {
                    value = runCatching { profileRepo.fetchProfile(session.userId) }.getOrNull()
                }
            val settingsVm =
                remember(liveProfile) {
                    SettingsViewModel(
                        liveProfile?.profile ?: DemoData.settingsProfile(),
                        liveProfile?.broadcastSubscribed ?: DemoData.DEMO_BROADCAST_SUBSCRIBED,
                        DemoData.DEMO_APP_VERSION,
                    )
                }
            ShiftsApp(
                shiftsVm = shiftsVm,
                ackVm = ackVm,
                updatesVm = updatesVm,
                calendarVm = calendarVm,
                houseVm = houseVm,
                preferencesVm = preferencesVm,
                breakClaimVm = breakClaimVm,
                settingsVm = settingsVm,
                currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
                onSignOut = onSignOut,
                onSubmitPreferences = {
                    // POST the current edits, then flip to the optimistic submitted state
                    // (mirrors the Shifts screen's claim/drop). A failed POST simply means
                    // no row lands on the web oversight; the UI does not block on it.
                    val payload = preferencesVm.submitPayload()
                    prefsScope.launch { prefsRepo.submitPreferences(payload) }
                    preferencesVm.submit()
                },
                onDropShift = { shift, permanent ->
                    // POST the real drop (best-effort) while the ViewModel does the
                    // optimistic local move. Occurrence → `drop-shift`; the recurring
                    // slot → `permanent-drop`. A failed POST leaves the server unchanged;
                    // the next Realtime snapshot reconciles the UI.
                    prefsScope.launch {
                        if (permanent) repo.permanentDrop(shift) else repo.dropShift(shift)
                    }
                },
                onClaimShift = { shift ->
                    // POST the real claim → `claim-shift` (best-effort) while the ViewModel
                    // does the optimistic local pickup. The server is authoritative for the
                    // hours-cap, T-2h cutoff, cross-house eligibility and FCFS; the client
                    // gating was a pre-check. The next Realtime snapshot reconciles the UI.
                    // WEEKLY openings only — permanent openings route through onPickUpPermanent.
                    prefsScope.launch { repo.claimShift(shift) }
                },
                onPickUpPermanent = { shift ->
                    // POST the real permanent pickup → the `permanent-pickup` EF (best-effort).
                    // This is the REAL path (the prior `claim-shift` permanent branch 501s); the
                    // EF re-evaluates scope server-side (caps + conflicts, §8.4.3) and commits via
                    // `permanent_pickup_slot`. The ViewModel already did the optimistic local
                    // move; the next Realtime snapshot reconciles the full multi-week scope.
                    prefsScope.launch { repo.permanentPickup(shift) }
                },
                loadPermanentScope = { shift ->
                    // GET the `permanent-pickup` dry-run SCOPE for the "Picking up N of M weeks ·
                    // K skipped" confirmation — read-only, no commit. Null on any failure → the
                    // sheet falls back to the plain recurring note.
                    repo.permanentPickupScope(shift)
                },
                onReclaimShift = { shift ->
                    // Reclaim a dropped-still-open shift via the SAME `claim-shift` EF
                    // (its assignment_id is still vacant). Best-effort; optimistic locally.
                    prefsScope.launch { repo.reclaimShift(shift) }
                },
                onAcknowledgeFloat = { floatId ->
                    // POST the real ack → `acknowledge-float` (best-effort) while the ack
                    // ViewModel already flipped to ACKNOWLEDGED. The worker's own ack is the
                    // one legitimate manual action under no-takeback (invariant #3).
                    prefsScope.launch { repo.acknowledgeFloat(floatId) }
                },
                onDeclineFloat = { floatId ->
                    // POST the real decline → `decline-float` (best-effort); the modal already
                    // flipped to DECLINED. Declining reopens the destination gap server-side.
                    prefsScope.launch { repo.declineFloat(floatId) }
                },
                onClaimBreak = { assignmentId ->
                    // POST the real break claim per-block (D6 — the live pool run carries its
                    // blockIds) while the picker does the optimistic local move; the server
                    // stays authoritative (40h HARD cap + Harnwell, invariant #1). The EF's
                    // hours PROJECTION reconciles the meter (MATRIX §4.4 gap closed).
                    prefsScope.launch {
                        val result = repo.claimBreakBlocks(breakClaimVm.blockIdsFor(assignmentId))
                        if (result.ok) breakClaimVm.reconcileHours(parseProjectedHours(result.body))
                    }
                },
                onDropBreak = { assignmentId ->
                    // POST the real break drop → ONE `drop-shift` call covering the run's
                    // blocks (no break-specific drop RPC). Optimistic locally.
                    prefsScope.launch { repo.dropBlocks(breakClaimVm.blockIdsFor(assignmentId)) }
                },
                onToggleBreakOptOut = { optedOut ->
                    // Persist the §4.4 "no break hours" opt-out → insert/delete the worker's own
                    // `break_optouts` row DIRECTLY via Postgrest (worker RLS permits it — no EF),
                    // best-effort, while the picker already flipped its optimistic opted-out state.
                    // Targets the ACTIVE break id; a no-op when no live break is loaded (demo).
                    breakClaimVm.breakId?.let { bid ->
                        prefsScope.launch { breakRepo.setBreakOptOut(session.userId, bid, optedOut) }
                    }
                },
                onToggleBroadcast = { subscribed ->
                    // PATCH the real broadcast subscription → `users-broadcast-subscription`
                    // (best-effort) while the settings ViewModel already flipped its optimistic
                    // toggle. The EF rejects an HM/BM subscribe (403); the next profile read
                    // reconciles. This is the ONLY user-toggleable notification channel.
                    prefsScope.launch { profileRepo.setBroadcastSubscription(session.userId, subscribed) }
                },
                onMarkAllRead = { unreadIds ->
                    // Persist the read receipts → loop the worker's unread ids through the
                    // `mark_notification_read` RPC (best-effort) while the Updates ViewModel
                    // already cleared the dots optimistically. No new backend RPC (T2-8).
                    prefsScope.launch { repo.markAllRead(session.userId, unreadIds) }
                },
                launchFloatAckId = launchFloatAckId,
                onAcceptSwap = { swapId ->
                    // POST the real acceptance → `accept-swap` (best-effort; temporary swaps
                    // only — the feed never offers Accept on a permanent entry). The server
                    // re-checks pending/expiry atomically (§8.2); the feed entry already
                    // resolved optimistically and the next snapshot reconciles.
                    prefsScope.launch { repo.acceptSwap(swapId) }
                },
                onRejectSwap = { swapId ->
                    // POST the real decline → `reject-swap` (best-effort; idempotent — a
                    // non-pending swap 409s `not_pending` and nothing changes server-side).
                    prefsScope.launch { repo.rejectSwap(swapId) }
                },
                // D2/D3 — counterparty candidates from the live house grid (self excluded).
                swapCandidates =
                    remember(liveHouseSchedule) {
                        swapCandidates(liveHouseSchedule?.seats ?: emptyList(), excludeUserId = session.userId)
                    },
                onCreateSwap = { proposal ->
                    // POST the real proposal → `create-swap` (best-effort). The server is
                    // authoritative for §8 eligibility/conflicts; a rejection creates nothing.
                    prefsScope.launch { repo.createSwap(proposal) }
                },
                onVoidSwap = { swapId ->
                    // POST the real void → `void-swap` (best-effort; pending-only, own-party).
                    prefsScope.launch { repo.voidSwap(swapId) }
                },
            )
        }
    }
}

/** Loading state for the worker's week — a skeleton My-Shifts list (design shimmer). */
@Composable
private fun LoadingScreen() {
    ShiftTheme {
        Scaffold(modifier = Modifier.fillMaxSize().testTag("loading_screen")) { padding ->
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(ShiftTheme.colors.bg)
                        .padding(padding)
                        .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                repeat(5) { SkeletonShiftCard() }
            }
        }
    }
}

/** Distinguishes "session restore still running" from "restore done (maybe null)". */
private sealed interface RestoreResult {
    data object Loading : RestoreResult

    data class Loaded(
        val session: AuthSession?,
    ) : RestoreResult
}
