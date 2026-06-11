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
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.platform.AppConfig
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
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

        setContent {
            if (backendConfigured) {
                LiveOrLoginRoot()
            } else {
                DemoRoot()
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
private fun DemoRoot() {
    val now = remember { Clock.System.now() }
    val snapshot = remember(now) { DemoData.snapshot(now) }
    val pendingFloat = remember(now) { DemoData.pendingFloat(now) }
    val shiftsVm = remember { ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now) }
    val ackVm = remember { AckDeclineViewModel(pendingFloat, now) }
    val updatesVm = remember { UpdatesViewModel(DemoData.notifications(now), now) }
    val calendarVm = remember { CalendarViewModel(snapshot.myShifts, now) }
    val preferencesVm = remember { PreferencesViewModel(DemoData.preferencePeriod(now)) }
    val breakClaimVm = remember { BreakClaimViewModel(DemoData.breakClaim(now)) }
    val settingsVm =
        remember { SettingsViewModel(DemoData.settingsProfile(), DemoData.DEMO_BROADCAST_SUBSCRIBED, DemoData.DEMO_APP_VERSION) }
    ShiftsApp(
        shiftsVm = shiftsVm,
        ackVm = ackVm,
        updatesVm = updatesVm,
        calendarVm = calendarVm,
        preferencesVm = preferencesVm,
        breakClaimVm = breakClaimVm,
        settingsVm = settingsVm,
        currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
        // Demo has no backend session → sign-out is a no-op (login is the live path).
        onSignOut = {},
    )
}

/**
 * Backend-configured path. Restores any persisted session once, runs the bootstrap
 * decision, then shows login or live shifts. While the (suspending) restore is in
 * flight we show a loading state.
 */
@Composable
private fun LiveOrLoginRoot() {
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
            // if it fails. `urgent`/`floatId` stay unset (the live pending-float linkage
            // is a later chunk) — this is feed-only. Mirrors the live-preferences pattern.
            val liveNotifications by
                produceState<List<NotificationItem>?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchNotifications(session.userId) }.getOrNull()
                }
            val updatesVm =
                remember(liveNotifications) {
                    UpdatesViewModel(liveNotifications ?: DemoData.notifications(now), now)
                }
            val calendarVm = remember(snapshot) { CalendarViewModel(snapshot.myShifts, now) }
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
            // Break-claim still runs on the demo snapshot (break-period name not worker-readable).
            val breakClaimVm = remember { BreakClaimViewModel(DemoData.breakClaim(now)) }
            // Settings runs on the demo profile until the profile read wires (users /
            // user_roles / houses are RLS-readable; no purpose-built profile view yet).
            val settingsVm =
                remember { SettingsViewModel(DemoData.settingsProfile(), DemoData.DEMO_BROADCAST_SUBSCRIBED, DemoData.DEMO_APP_VERSION) }
            ShiftsApp(
                shiftsVm = shiftsVm,
                ackVm = ackVm,
                updatesVm = updatesVm,
                calendarVm = calendarVm,
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
                    prefsScope.launch { repo.claimShift(shift) }
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
                    // POST the real break claim → `break-claim` (best-effort) while the picker
                    // does the optimistic local move. The server is authoritative for the 40h
                    // break HARD cap and the Harnwell training constraint (invariant #1); the
                    // client meter/gating was a pre-check. (The break pool itself is still
                    // demo-backed until `break_periods` is worker-readable — T2-2.)
                    prefsScope.launch { repo.claimBreak(assignmentId) }
                },
                onDropBreak = { assignmentId ->
                    // POST the real break drop → `drop-shift` (best-effort); reuses the generic
                    // drop EF (no break-specific drop RPC). The claimed break block's pool-row
                    // id is its block assignment_id. Optimistic locally; next snapshot reconciles.
                    prefsScope.launch { repo.dropShift(assignmentId) }
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
