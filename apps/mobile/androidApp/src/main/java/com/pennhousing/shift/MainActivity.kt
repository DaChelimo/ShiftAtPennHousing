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
import com.pennhousing.shift.shared.platform.AppConfig
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.LoginRoute
import com.pennhousing.shift.ui.ShiftsApp
import com.pennhousing.shift.ui.kit.SkeletonShiftCard
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlin.time.Clock
import kotlin.time.Instant

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
    ShiftsApp(
        shiftsVm = shiftsVm,
        ackVm = ackVm,
        updatesVm = updatesVm,
        currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
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

    // An in-session sign-in promotes us to live shifts without re-running the restore.
    var authedSession by remember { mutableStateOf<AuthSession?>(null) }

    when (val result = restored) {
        RestoreResult.Loading -> LoadingScreen()
        is RestoreResult.Loaded -> {
            val session = authedSession ?: result.session
            val decision = AppBootstrap.decide(backendConfigured = true, session = session, now = now)

            // decision.source is LIVE on this path; route on the start destination.
            if (decision.start == StartDestination.SHIFTS && decision.source == DataSource.LIVE && session != null) {
                // A session restored at launch (or just authenticated) is the live
                // worker — carry their JWT on every privileged request.
                LaunchedEffect(session.userId) { WorkerBackend.wireAccessToken() }
                LiveShiftsRoot(session = session, now = now)
            } else {
                LoginRoute(
                    gateway = WorkerBackend.authGateway,
                    onAuthenticated = { newSession ->
                        // Promote to live shifts; the SHIFTS branch's LaunchedEffect
                        // wires the live worker JWT onto privileged requests.
                        authedSession = newSession
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
 * The float-ack / Updates path keeps the demo [AckDeclineViewModel] for now.
 * TODO(worker-auth): live float-ack feed — the repo grows a pending-float query.
 */
@Composable
private fun LiveShiftsRoot(
    session: AuthSession,
    now: Instant,
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
            val ackVm = remember { AckDeclineViewModel(DemoData.pendingFloat(now), now) }
            val updatesVm = remember { UpdatesViewModel(DemoData.notifications(now), now) }
            ShiftsApp(
                shiftsVm = shiftsVm,
                ackVm = ackVm,
                updatesVm = updatesVm,
                currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
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
