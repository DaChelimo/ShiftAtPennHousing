package com.pennhousing.shift

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.auth.AppBootstrap
import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.auth.DataSource
import com.pennhousing.shift.shared.auth.StartDestination
import com.pennhousing.shift.shared.ack.parseFloatAckDeepLink
import com.pennhousing.shift.shared.breakclaim.BreakCalendarSnapshot
import com.pennhousing.shift.shared.breakclaim.noBreakCalendar
import com.pennhousing.shift.shared.data.BreakRepository
import com.pennhousing.shift.shared.data.HomeHouseGate
import com.pennhousing.shift.shared.data.ProfileSnapshot
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.withIncomingSwapEntries
import com.pennhousing.shift.shared.notifications.withPendingFloatEntry
import com.pennhousing.shift.shared.network.ClaimOutcome
import com.pennhousing.shift.shared.network.EdgeResult
import com.pennhousing.shift.shared.network.TOAST_DURATION_MS
import com.pennhousing.shift.shared.network.WriteOp
import com.pennhousing.shift.shared.network.claimToast
import com.pennhousing.shift.shared.network.edgeErrorMessage
import com.pennhousing.shift.shared.network.swapAccepted
import com.pennhousing.shift.shared.platform.AppConfig
import com.pennhousing.shift.shared.platform.SimClock
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.shifts.CLAIM_SUCCESS_TOAST
import com.pennhousing.shift.shared.shifts.weeklyHours
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.swapCandidates
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.AssistantViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.HouseNotLiveScreen
import com.pennhousing.shift.ui.LoginRoute
import com.pennhousing.shift.ui.onboarding.WidgetPromptPrefs
import com.pennhousing.shift.widget.WidgetSync
import com.pennhousing.shift.ui.ShiftsApp
import com.pennhousing.shift.ui.kit.SkeletonShiftCard
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.ThemePrefs
import com.pennhousing.shift.ui.theme.rememberPersistedDarkTheme
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.delay
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
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // The POST_NOTIFICATIONS runtime request is no longer fired cold on launch. It is
        // now primed after the welcome tour finishes (NotificationPrimingHost in
        // ui/onboarding/Onboarding.kt), so the worker learns WHY alerts matter before the
        // OS dialog appears — and a decline never burns the one-shot iOS-style prompt.

        // Per-launch counter for the behavioral widget-add prompt (return-session gating).
        WidgetPromptPrefs.recordLaunch(this)

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
    val swapsVm = remember { SwapsViewModel(DemoData.pendingSwaps(now), now) }
    val calendarVm = remember { CalendarViewModel(snapshot.myShifts, now, pendingSwaps = DemoData.pendingSwaps(now)) }
    val houseVm = remember { HouseScheduleViewModel(DemoData.houseSchedule(now), now, meUserId = DemoData.DEMO_ME_USER_ID) }
    val preferencesVm = remember { PreferencesViewModel(DemoData.preferencePeriod(now)) }
    val breakCalendarVm = remember { BreakCalendarViewModel(DemoData.breakCalendar(now), now) }
    val assistantVm = remember { AssistantViewModel() }
    val context = LocalContext.current
    val settingsVm =
        remember {
            // Seed the in-session theme from the persisted choice so the toggle survives relaunch.
            SettingsViewModel(DemoData.settingsProfile(), DemoData.DEMO_BROADCAST_SUBSCRIBED, DemoData.DEMO_APP_VERSION)
                .apply { setTheme(ThemePrefs.read(context)) }
        }
    // The claim/pickup confirmation toast (host-owned, mirroring the live path). Demo has no
    // network, so it only ever carries the optimistic success message.
    var claimSuccessMessage by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(claimSuccessMessage) {
        if (claimSuccessMessage != null) {
            delay(TOAST_DURATION_MS)
            claimSuccessMessage = null
        }
    }
    // Feed the home-screen widget + derive the widget-prompt preview from the demo week.
    val widgetPreview = remember(now) { WidgetSync.firstUpcomingPreview(snapshot.myShifts, now) }
    LaunchedEffect(now) { WidgetSync.update(context, snapshot.myShifts, DemoData.pendingFloats(now), now) }
    ShiftsApp(
        shiftsVm = shiftsVm,
        ackVm = ackVm,
        updatesVm = updatesVm,
        swapsVm = swapsVm,
        calendarVm = calendarVm,
        houseVm = houseVm,
        preferencesVm = preferencesVm,
        breakCalendarVm = breakCalendarVm,
        settingsVm = settingsVm,
        assistantVm = assistantVm,
        currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
        now = now,
        widgetPreviewHouse = widgetPreview?.house,
        widgetPreviewWhen = widgetPreview?.let { "${it.dayLabel}, ${it.timeLabel}" },
        // Demo float-request carousel — two floats so the swipe + completion are visible.
        pendingFloats = remember(now) { DemoData.pendingFloats(now) },
        // Demo recent-floats history (accepted / declined / expired) for the section below it.
        recentFloats = remember(now) { DemoData.recentFloats(now) },
        // Demo has no backend session → sign-out is a no-op (login is the live path).
        onSignOut = {},
        launchFloatAckId = launchFloatAckId,
        // D2 + CALENDAR_REDESIGN — demo swap calendar over the demo house grid (no live write).
        swapMeUserId = null,
        swapDemoSeats = remember(now) { DemoData.houseSchedule(now).seats },
        // Demo has no backend: optimistically reflect each proposed leg in the Swaps tab so
        // the worker sees the result (the live path POSTs `create-swap` + refetches instead).
        // Always "succeeds" so the success toast shows.
        onCreateSwap = { swapsVm.addOutgoing(it); true },
        // Demo accept/decline of an incoming swap (Swaps tab + the My-Shifts popup): resolve
        // the Swaps list locally; the calendar popup un-tints its own card optimistically.
        onAcceptSwap = { swapsVm.resolveIncoming(it) },
        onRejectSwap = { swapsVm.resolveIncoming(it) },
        claimSuccessMessage = claimSuccessMessage,
        onClaimSuccessMessage = { claimSuccessMessage = it },
    )
}

/**
 * Backend-configured path. Restores any persisted session once, runs the bootstrap
 * decision, then shows login or live shifts. While the (suspending) restore is in
 * flight we show a loading state.
 */
@Composable
private fun LiveOrLoginRoot(launchFloatAckId: String? = null) {
    // Restore the session off the gateway exactly once. RestoreResult.Loading while in
    // flight; Loaded carries the (maybe-null) session AND the resolved business `now`.
    //
    // The business `now` is the SERVER's simulated clock (app_now()), captured via
    // WorkerBackend.syncSimClock — so the worker app's countdowns and ack-deadline checks
    // agree with the time-travelled web/orchestrator. Falls back to the device wall clock
    // when app_now() is unavailable (and in prod, where offset 0 makes SimClock.now() ==
    // the wall clock). Session VALIDITY below stays on the real wall clock — the Supabase
    // JWT is real, so a future sim-now must not expire it.
    val scope = rememberCoroutineScope()
    val restored by produceState<RestoreResult>(initialValue = RestoreResult.Loading) {
        WorkerBackend.syncSimClock()
        value = RestoreResult.Loaded(WorkerBackend.authGateway.currentSession())
    }

    // Re-read the dev sim-clock when the app returns to the foreground, so a clock change
    // made on the web is reflected WITHOUT a relaunch. `clockEpoch` only bumps when the
    // offset actually moved (syncSimClock returns true), and re-keys the live UI below so
    // every ViewModel rebuilds with the fresh `now`. Normal foregrounding (no clock change)
    // leaves the UI untouched.
    var clockEpoch by remember { mutableIntStateOf(0) }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    scope.launch { if (WorkerBackend.syncSimClock()) clockEpoch++ }
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // An in-session sign-in promotes us to live shifts without re-running the restore.
    var authedSession by remember { mutableStateOf<AuthSession?>(null) }
    // A sign-out forces LOGIN even though the launch-restored session is still cached.
    var signedOut by remember { mutableStateOf(false) }

    when (val result = restored) {
        RestoreResult.Loading -> LoadingScreen()
        is RestoreResult.Loaded -> {
            val session = if (signedOut) null else (authedSession ?: result.session)
            // Session validity uses the real wall clock (the JWT is real); the business
            // `now` below is the simulated clock.
            val decision =
                AppBootstrap.decide(backendConfigured = true, session = session, now = Clock.System.now())

            // decision.source is LIVE on this path; route on the start destination.
            if (decision.start == StartDestination.SHIFTS && decision.source == DataSource.LIVE && session != null) {
                // A session restored at launch (or just authenticated) is the live
                // worker — carry their JWT on every privileged request.
                LaunchedEffect(session.userId) { WorkerBackend.wireAccessToken() }
                val onSignOut = {
                    scope.launch { WorkerBackend.authGateway.signOut() }
                    authedSession = null
                    signedOut = true
                }
                // Staggered-launch gate: resolve whether this worker's home house is live.
                // null = still checking (show the loading skeleton). The repo fails OPEN, so a
                // transient error resolves to live rather than locking a real worker out.
                val gate by produceState<HomeHouseGate?>(initialValue = null, session.userId) {
                    value = WorkerBackend.shiftsRepository.fetchHomeHouseGate(session.userId)
                }
                when (val resolvedGate = gate) {
                    null -> LoadingScreen()
                    else ->
                        if (!resolvedGate.isLive) {
                            HouseNotLiveScreen(houseName = resolvedGate.houseName, onSignOut = onSignOut)
                        } else {
                            // Re-keyed on clockEpoch: a foreground clock change tears down +
                            // rebuilds the whole live tree, so `now` (and every VM built from
                            // it) is recaptured.
                            key(clockEpoch) {
                                val now = remember { SimClock.now() }
                                LiveShiftsRoot(
                                    session = session,
                                    now = now,
                                    launchFloatAckId = launchFloatAckId,
                                    onSignOut = onSignOut,
                                )
                            }
                        }
                }
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
        repo.observeWorkerWeek(session.userId, now)
    }.collectAsStateWithLifecycle(initialValue = null)

    when (val snapshot: WorkerSnapshot? = snapshotState) {
        null -> LoadingScreen()
        else -> {
            // Best-effort live writes (drop/claim/reclaim/pickup) flip the ViewModel
            // optimistically; a SUCCESSFUL write changes the DB and the next Realtime
            // snapshot reconciles the UI. A FAILED write (edge runtime down, timeout,
            // expired token) used to be swallowed silently, stranding the optimistic
            // card. `writeError` surfaces it as a top toast; bumping `revertKey` rebuilds
            // the ViewModel from the unchanged (server-truth) snapshot, discarding the
            // failed optimistic move — no refetch, since the snapshot never changed.
            var writeError by remember { mutableStateOf<String?>(null) }
            // Bumped on a failed best-effort write. It is a key on the optimistic-move
            // ViewModels (shifts/break rebuild from the unchanged snapshot) and on the
            // server-fetch producers below (ack/updates/settings/opt-out re-read from the
            // server) — so whichever optimistic move failed snaps back to server truth.
            var revertKey by remember { mutableIntStateOf(0) }
            // Bumped after a SUCCESSFUL swap create so the incoming/outgoing producers
            // re-read `swap_requests` (there is no Realtime channel on that table) and the
            // just-proposed leg shows in the Swaps→Outgoing list as the real, voidable row.
            var swapRefreshKey by remember { mutableIntStateOf(0) }
            LaunchedEffect(writeError) {
                if (writeError != null) {
                    delay(TOAST_DURATION_MS)
                    writeError = null
                }
            }
            // The open-shift claim / permanent-pickup confirmation toast (success or the
            // informative "claimed part of this shift" partial note). Owned HERE — the host
            // runs the network and knows the real outcome — so a partial pickup no longer
            // shows a red failure and a full failure no longer leaves a stale success toast.
            var claimSuccessMessage by remember { mutableStateOf<String?>(null) }
            LaunchedEffect(claimSuccessMessage) {
                if (claimSuccessMessage != null) {
                    delay(TOAST_DURATION_MS)
                    claimSuccessMessage = null
                }
            }
            // Rebuild the ViewModel whenever a fresh snapshot arrives (e.g. a float at
            // T-2h) OR a failed write asks to revert (revertKey).
            val shiftsVm =
                remember(snapshot, revertKey) {
                    ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now)
                }
            // Float requests: load ALL the worker's outstanding floats (the bounded,
            // RLS-scoped `worker_pending_floats` view — immune to the 1000-row personal-
            // calendar cap) for the My-Shifts carousel. The closest one also feeds the
            // deep-link ack VM + the Updates urgent entry. Empty list while in flight / when
            // none is outstanding — NO demo fallback on live, so a worker without a float
            // never sees a phantom one. Ack/decline POST `acknowledge-float`/`decline-float`.
            val livePendingFloats by
                produceState(initialValue = emptyList<PendingFloat>(), session.userId, revertKey) {
                    value = runCatching { repo.fetchPendingFloats(session.userId) }.getOrDefault(emptyList())
                }
            // Resolved floats from the last 24h (bounded `worker_recent_floats`) for the
            // collapsible recent-history section. Empty while in flight / when none.
            val liveRecentFloats by
                produceState(initialValue = emptyList<RecentFloat>(), session.userId, revertKey) {
                    value = runCatching { repo.fetchRecentFloats(session.userId) }.getOrDefault(emptyList())
                }
            val livePendingFloat = livePendingFloats.firstOrNull()?.toFloatAck()
            val ackVm = remember(livePendingFloat) { AckDeclineViewModel(livePendingFloat ?: DemoData.pendingFloat(now), now) }
            // Feed the home-screen widget from the live week + pending floats, and derive the
            // widget-prompt preview (the worker's real next shift).
            val widgetContext = LocalContext.current
            val widgetPreview = remember(snapshot.myShifts, now) { WidgetSync.firstUpcomingPreview(snapshot.myShifts, now) }
            LaunchedEffect(snapshot.myShifts, livePendingFloats) {
                WidgetSync.update(widgetContext, snapshot.myShifts, livePendingFloats, now)
            }
            // Updates: load the worker's real `notifications` rows (RLS-scoped) for the
            // feed; fall back to the demo notifications while the fetch is in flight or
            // if it fails. A `float_assigned` row now maps to the urgent FLOAT entry that
            // opens the ack hero; `withPendingFloatEntry` additionally guarantees the live
            // pending float (from `fetchPendingFloat`) is always represented even if its
            // notification row hasn't landed. Mirrors the live-preferences pattern.
            val liveNotifications by
                produceState<List<NotificationItem>?>(initialValue = null, session.userId, revertKey) {
                    value = runCatching { repo.fetchNotifications(session.userId) }.getOrNull()
                }
            // Incoming pending swaps (§8.2): the worker's own counterparty `swap_requests`
            // rows. They feed BOTH the Swaps tab (full Accept/Decline surface) and the
            // Updates deep-link mirrors (`withIncomingSwapEntries`).
            val liveIncomingSwaps by
                produceState(initialValue = emptyList<IncomingSwap>(), session.userId, revertKey, swapRefreshKey) {
                    value = runCatching { repo.fetchIncomingSwaps(session.userId) }.getOrDefault(emptyList())
                }
            // Pending swaps (BOTH directions) enriched with each side's span + deadline —
            // the source for the Swaps tab cards (give/get hours), the My-Shifts indicators,
            // and the incoming accept/decline popup. Re-read on swapRefreshKey so a
            // propose/accept/decline/cancel reconciles to server truth.
            val livePendingSwaps by
                produceState(initialValue = emptyList<PendingSwap>(), session.userId, revertKey, swapRefreshKey) {
                    value = runCatching { repo.fetchPendingSwaps() }.getOrDefault(emptyList())
                }
            val updatesVm =
                remember(liveNotifications, livePendingFloat, liveIncomingSwaps) {
                    val base = liveNotifications ?: DemoData.notifications(now)
                    UpdatesViewModel(
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
                        now,
                    )
                }
            // The dedicated Swaps tab (DESIGN §6) — enriched pending swaps (give/get hours).
            val swapsVm =
                remember(livePendingSwaps) {
                    SwapsViewModel(livePendingSwaps, now)
                }
            // Closed-house days (§3.4/§11.3, T2-12c): the worker's home house may be
            // closed on some of this week's dates — `house_closure` RPC per visible
            // date (best-effort; empty while loading / on failure → plain calendar).
            val closedDays by
                produceState(initialValue = emptySet<Int>(), session.userId) {
                    value = runCatching { repo.fetchCalendarClosedDays(session.userId) }.getOrDefault(emptySet())
                }
            // Keyed on revertKey too: a failed optimistic drop/claim (the calendar now
            // mutates locally) rebuilds the calendar from the unchanged snapshot, exactly
            // like the shifts VM above, so the agenda snaps back to server truth.
            val calendarVm =
                remember(snapshot, closedDays, revertKey, livePendingSwaps) {
                    CalendarViewModel(snapshot.myShifts, now, closedDays, livePendingSwaps)
                }
            // The worker's profile (own users / user_roles). Loaded here (above the House
            // VM) so its resolved role can gate the House-grid manager actions; it also
            // feeds the Settings screen below. Best-effort: null while in flight / on
            // failure. `isManager` = holds a schedule-manager role (anything but a plain
            // `sw`); the House VM combines it with the home-house check for `canManage`.
            val profileRepo = remember { WorkerBackend.profileRepository }
            val liveProfile by
                produceState<ProfileSnapshot?>(initialValue = null, session.userId, revertKey) {
                    value = runCatching { profileRepo.fetchProfile(session.userId) }.getOrNull()
                }
            // House schedule (§11.4, T3b): the home house's week grid with contacts
            // (full-directory ruling). Falls back to the demo snapshot while loading.
            val liveHouseSchedule by
                produceState<HouseScheduleSnapshot?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchHouseSchedule(session.userId) }.getOrNull()
                }
            val houseVm =
                remember(liveHouseSchedule, liveProfile) {
                    HouseScheduleViewModel(
                        liveHouseSchedule ?: DemoData.houseSchedule(now),
                        now,
                        meUserId = session.userId,
                        // Default false while the profile is loading (null role) so the
                        // manager actions never flash before the role is known.
                        isManager = liveProfile?.profile?.role?.let { it != "sw" } ?: false,
                    )
                }
            // Preferences: load the worker's real active period (scheduling_periods now
            // worker-readable — migration 20260610000001); fall back to the demo period
            // while loading or when no period is open. Submit POSTs to `submit-preferences`.
            val prefsRepo = remember { WorkerBackend.preferencesRepository }
            val prefsScope = rememberCoroutineScope()
            // Run a best-effort live EF write and surface failure with a DESCRIPTIVE,
            // classified message (the server's error code → human copy via [edgeErrorMessage])
            // instead of a single generic "couldn't reach the server". [block] returns the
            // raw [EdgeResult]; on a non-2xx: raise the classified toast and (when [revert])
            // bump [revertKey] so the optimistic move snaps back to server truth.
            fun launchWrite(op: WriteOp, revert: Boolean = true, block: suspend () -> EdgeResult) {
                prefsScope.launch {
                    val result = runCatching { block() }.getOrElse { EdgeResult(false, 0, "") }
                    if (!result.ok) {
                        writeError = edgeErrorMessage(op, result)
                        if (revert) revertKey++
                    }
                }
            }
            // Boolean variant for non-EF writes (Postgrest direct: preferences / opt-out),
            // which either complete or throw. A failure here is a transport/permission issue,
            // so it classifies off a status-0 [EdgeResult] (offline copy) with the op's verb.
            fun launchWriteBool(op: WriteOp, revert: Boolean = true, block: suspend () -> Boolean) {
                prefsScope.launch {
                    val ok = runCatching { block() }.getOrDefault(false)
                    if (!ok) {
                        writeError = edgeErrorMessage(op, EdgeResult(false, 0, ""))
                        if (revert) revertKey++
                    }
                }
            }
            // Bumped after a manager sets the deadline so the period (and its deadline chip)
            // refetches. Keyed into the produceState below.
            var deadlineRefreshKey by remember { mutableIntStateOf(0) }
            val livePeriod by
                produceState<PreferencePeriod?>(initialValue = null, session.userId, deadlineRefreshKey) {
                    value = runCatching { prefsRepo.fetchActivePreferencePeriod(session.userId) }.getOrNull()
                }
            val preferencesVm =
                remember(livePeriod, liveProfile) {
                    PreferencesViewModel(
                        livePeriod ?: DemoData.preferencePeriod(now),
                        // Manager (sm/hm/bm/rsm) sees the deadline-setter; a plain worker never does.
                        isManager = liveProfile?.profile?.role?.let { it != "sw" } ?: false,
                    )
                }
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
                produceState(initialValue = false, liveBreak, session.userId, revertKey) {
                    val bid = liveBreak?.breakId ?: return@produceState
                    value = runCatching { breakRepo.fetchBreakOptOut(session.userId, bid) }.getOrDefault(false)
                }
            // Break CALENDAR (Break redesign): the home-house grid scoped to the active
            // break window + the live phase; falls back to the demo calendar while the read
            // is in flight or when no break is current/upcoming.
            val liveBreakCalendar by
                produceState<BreakCalendarSnapshot?>(initialValue = null, liveBreak, session.userId, revertKey) {
                    val b = liveBreak ?: return@produceState
                    value = runCatching { repo.fetchBreakCalendarFor(session.userId, b) }.getOrNull()
                }
            val breakCalendarVm =
                remember(liveBreakCalendar, liveBreak, liveBreakOptedOut, revertKey) {
                    BreakCalendarViewModel(
                        // No live break → honest "no break" state, NOT the demo calendar
                        // (whose fake ids make claims silently fail). Demo build still uses
                        // DemoData.breakCalendar (see DemoRoot).
                        liveBreakCalendar ?: noBreakCalendar(session.userId, now),
                        now,
                        breakId = liveBreak?.breakId,
                        initialOptedOut = liveBreakOptedOut,
                    )
                }
            val assistantVm = remember { AssistantViewModel() }
            // Settings reuses `liveProfile` (loaded above the House VM): the worker's real
            // profile + live `broadcast_subscribed` (own users / user_roles + houses, all
            // RLS-readable); it falls back to the demo profile while the read is in flight.
            // The broadcast toggle PATCHes the `users-broadcast-subscription` EF (best-effort),
            // the ONLY interactive notification channel (§10.1: personal float / shift-reminder
            // / schedule-published notifications are mandatory, shown always-on/disabled).
            val settingsContext = LocalContext.current
            val settingsVm =
                remember(liveProfile) {
                    // Seed the in-session theme from the persisted choice (survives relaunch).
                    SettingsViewModel(
                        liveProfile?.profile ?: DemoData.settingsProfile(),
                        liveProfile?.broadcastSubscribed ?: DemoData.DEMO_BROADCAST_SUBSCRIBED,
                        DemoData.DEMO_APP_VERSION,
                    ).apply { setTheme(ThemePrefs.read(settingsContext)) }
                }
            ShiftsApp(
                shiftsVm = shiftsVm,
                ackVm = ackVm,
                updatesVm = updatesVm,
                swapsVm = swapsVm,
                calendarVm = calendarVm,
                houseVm = houseVm,
                preferencesVm = preferencesVm,
                breakCalendarVm = breakCalendarVm,
                settingsVm = settingsVm,
                assistantVm = assistantVm,
                // D8 — the live "This week — Xh" total from the real snapshot (the demo
                // constant was a placeholder; dropped-still-open blocks don't count).
                currentWeeklyHours = remember(snapshot) { weeklyHours(snapshot.myShifts, now) },
                now = now,
                widgetPreviewHouse = widgetPreview?.house,
                widgetPreviewWhen = widgetPreview?.let { "${it.dayLabel}, ${it.timeLabel}" },
                pendingFloats = livePendingFloats,
                recentFloats = liveRecentFloats,
                writeError = writeError,
                onSignOut = onSignOut,
                onSubmitPreferences = {
                    // POST the current edits, then flip to the optimistic submitted state
                    // (mirrors the Shifts screen's claim/drop). On failure surface the toast;
                    // do NOT revert (revert=false) — that would discard the worker's painted
                    // edits, which they should keep so they can retry the submit.
                    val payload = preferencesVm.submitPayload()
                    launchWriteBool(WriteOp.PREFERENCES, revert = false) { prefsRepo.submitPreferences(payload) }
                    preferencesVm.submit()
                },
                onSetDeadline = { year, month, day ->
                    // Manager-only (BSpec §4.2): set the active period's submission deadline.
                    // On success, confirm + refetch the period so the chip updates; on
                    // failure, the classified write toast explains (e.g. after the start date).
                    val periodId = livePeriod?.periodId
                    if (periodId != null) {
                        prefsScope.launch {
                            val ok =
                                runCatching { prefsRepo.setPreferenceDeadline(periodId, year, month, day) }
                                    .getOrDefault(false)
                            if (ok) {
                                claimSuccessMessage = "Deadline updated"
                                deadlineRefreshKey++
                            } else {
                                writeError = "That deadline could not be set. It must be on or before the period start."
                            }
                        }
                    }
                },
                onDropShift = { shift, permanent ->
                    // POST the real drop while the ViewModel does the optimistic local move.
                    // Occurrence → `drop-shift`; the recurring slot → `permanent-drop`. On a
                    // SUCCESSFUL drop the next Realtime snapshot reconciles the UI; on FAILURE
                    // [launchWrite] toasts and reverts the card to server truth.
                    launchWrite(if (permanent) WriteOp.PERMANENT_DROP else WriteOp.DROP) {
                        if (permanent) repo.permanentDrop(shift) else repo.dropShift(shift)
                    }
                },
                claimSuccessMessage = claimSuccessMessage,
                onClaimSuccessMessage = { claimSuccessMessage = it },
                onClaimShift = { shift ->
                    // POST the real claim → `claim-shift` while the ViewModel does the optimistic
                    // local pickup. The server is authoritative for the hours-cap, T-2h cutoff,
                    // cross-house eligibility and FCFS; the client gating was a pre-check. WEEKLY
                    // openings only — permanent openings route through onPickUpPermanent.
                    //
                    // claim-shift is per-block, so a coalesced card can land PARTIALLY (e.g. a
                    // sub-range overlapping an existing shift): full → accurate success toast,
                    // partial → an informative "claimed part of this shift" note (NOT a red
                    // failure — the bug this fixes), none → the classified error + revert.
                    prefsScope.launch {
                        val outcome = runCatching { repo.claimShift(shift) }.getOrElse { ClaimOutcome.offline() }
                        val toast = claimToast(WriteOp.CLAIM, outcome, CLAIM_SUCCESS_TOAST)
                        if (toast.isError) {
                            claimSuccessMessage = null
                            writeError = toast.message
                            revertKey++
                        } else {
                            writeError = null
                            claimSuccessMessage = toast.message
                        }
                    }
                },
                onPickUpPermanent = { shift ->
                    // POST the real permanent pickup → the `permanent-pickup` EF. This is the REAL
                    // path (the prior `claim-shift` permanent branch 501s); the EF re-evaluates
                    // scope server-side (caps + conflicts, §8.4.3) and commits via
                    // `permanent_pickup_slot`. Success reconciles the full multi-week scope via
                    // Realtime; failure clears the optimistic success toast, shows the classified
                    // error and reverts the optimistic local move.
                    prefsScope.launch {
                        val result = runCatching { repo.permanentPickup(shift) }.getOrElse { EdgeResult(false, 0, "") }
                        if (!result.ok) {
                            claimSuccessMessage = null
                            writeError = edgeErrorMessage(WriteOp.PERMANENT_PICKUP, result)
                            revertKey++
                        }
                    }
                },
                loadPermanentScope = { shift ->
                    // GET the `permanent-pickup` dry-run SCOPE for the "Picking up N of M weeks ·
                    // K skipped" confirmation — read-only, no commit. Null on any failure → the
                    // sheet falls back to the plain recurring note.
                    repo.permanentPickupScope(shift)
                },
                onAcknowledgeFloat = { floatId ->
                    // POST the real ack → `acknowledge-float` while the ack ViewModel already
                    // flipped to ACKNOWLEDGED. The worker's own ack is the one legitimate manual
                    // action under no-takeback (invariant #3). On failure toast + revert (re-read
                    // the pending float → the modal returns to PENDING so they can retry).
                    launchWrite(WriteOp.ACK_FLOAT) { repo.acknowledgeFloat(floatId) }
                },
                onDeclineFloat = { floatId ->
                    // POST the real decline → `decline-float`; the modal already flipped to
                    // DECLINED. Declining reopens the destination gap server-side. On failure
                    // toast + revert (the modal returns to PENDING).
                    launchWrite(WriteOp.DECLINE_FLOAT) { repo.declineFloat(floatId) }
                },
                onAcknowledgeAlliedPage = { blockId ->
                    // POST "I've called the desk" → `acknowledge-allied-page` (best-effort,
                    // staggered-rollout pilot). The Updates ViewModel already removed the row
                    // optimistically; the server resolves the ladder so no further rung fires.
                    // Quiet best-effort: if the POST fails, the next notifications snapshot
                    // reconciles (the still-unacknowledged alert re-appears).
                    prefsScope.launch { runCatching { repo.acknowledgeAlliedPage(blockId) } }
                },
                onClaimBreakRange = { blockIds ->
                    // POST the dragged block ids → `break-claim` (its claim_break_blocks RPC
                    // claims one open seat per block, FCFS/cap/Harnwell-trimmed server-side)
                    // while the picker did the optimistic local move; reconcile the picker to
                    // the server's ACTUAL claimed seats. Failure toasts + reverts (revertKey
                    // rebuilds the VM from server truth).
                    if (blockIds.isNotEmpty()) {
                        prefsScope.launch {
                            val result = runCatching { repo.claimBreakRange(blockIds) }.getOrNull()
                            if (result?.claimedAssignmentIds?.isNotEmpty() == true) {
                                breakCalendarVm.reconcileClaim(result.claimedAssignmentIds)
                            } else {
                                // Claiming NOTHING (window closed / all taken / EF rejected) — the
                                // server returns 200 with an empty list, so there is no error code
                                // to classify; describe the likely reasons and revert.
                                writeError =
                                    "Couldn't claim those break shifts. The sign-up window may be closed, or they were just taken."
                                revertKey++
                            }
                        }
                    }
                },
                onDropBreakSeats = { seatIds ->
                    // POST ONE `drop-shift` covering the run's seats (no break-specific drop
                    // RPC). Optimistic locally; failure toasts + reverts.
                    if (seatIds.isNotEmpty()) launchWrite(WriteOp.BREAK_DROP) { repo.dropBlocks(seatIds) }
                },
                onToggleBreakOptOut = { optedOut ->
                    // Persist the §4.4 "no break hours" opt-out → insert/delete the worker's own
                    // `break_optouts` row DIRECTLY via Postgrest (worker RLS permits it — no EF),
                    // while the picker already flipped its optimistic opted-out state. Targets the
                    // ACTIVE break id; a no-op when no live break is loaded (demo). A Postgrest
                    // throw → toast + revert (re-read the opt-out row → the toggle snaps back).
                    breakCalendarVm.breakId?.let { bid ->
                        launchWriteBool(WriteOp.PREFERENCES) {
                            breakRepo.setBreakOptOut(session.userId, bid, optedOut)
                            true
                        }
                    }
                },
                onToggleBroadcast = { subscribed ->
                    // PATCH the real broadcast subscription → `users-broadcast-subscription` while
                    // the settings ViewModel already flipped its optimistic toggle. The EF rejects
                    // an HM/BM subscribe (403) → toast + revert (re-read the profile → the toggle
                    // snaps back). This is the ONLY user-toggleable notification channel.
                    launchWrite(WriteOp.BROADCAST) { profileRepo.setBroadcastSubscription(session.userId, subscribed) }
                },
                onMarkAllRead = { unreadIds ->
                    // Persist the read receipts → loop the worker's unread ids through the
                    // `mark_notification_read` RPC (best-effort) while the Updates ViewModel already
                    // cleared the dots optimistically. Low-stakes (a read receipt) and `markAllRead`
                    // swallows per-id errors internally, so this stays fire-and-forget (no toast).
                    prefsScope.launch { repo.markAllRead(session.userId, unreadIds) }
                },
                launchFloatAckId = launchFloatAckId,
                onAcceptSwap = { swapId ->
                    // POST the real acceptance → `accept-swap`. EVERY type is acceptable now:
                    // permanent swaps auto-resolve their affected occurrences server-side. The
                    // server re-checks pending/expiry atomically (§8.2). On success bump
                    // swapRefreshKey so the swaps lists + calendar marks reconcile; on failure
                    // toast + revert (re-read → the entry returns as actionable).
                    prefsScope.launch {
                        val result = runCatching { repo.acceptSwap(swapId) }.getOrElse { EdgeResult(false, 0, "") }
                        // accept-swap returns 200 even on a logical no-op ({accepted:false,reason}),
                        // so confirm the body actually applied — otherwise classify the reason.
                        if (result.ok && swapAccepted(result.body)) {
                            swapRefreshKey++
                        } else {
                            writeError = edgeErrorMessage(WriteOp.ACCEPT_SWAP, result)
                            revertKey++
                        }
                    }
                },
                onRejectSwap = { swapId ->
                    // POST the real decline → `reject-swap` (idempotent — a non-pending swap 409s
                    // `not_pending`). On success reconcile via swapRefreshKey; on failure surface
                    // the classified reason + revert.
                    prefsScope.launch {
                        val result = runCatching { repo.rejectSwap(swapId) }.getOrElse { EdgeResult(false, 0, "") }
                        if (result.ok) {
                            swapRefreshKey++
                        } else {
                            writeError = edgeErrorMessage(WriteOp.DECLINE_SWAP, result)
                            revertKey++
                        }
                    }
                },
                // D2/D3 + CALENDAR_REDESIGN — the swap calendar fetches each week's house grid
                // live (per-week) keyed on the worker; no current-week candidate list needed.
                swapMeUserId = session.userId,
                swapDemoSeats = emptyList(),
                onCreateSwap = { proposal ->
                    // POST the real proposal → `create-swap`. The server is authoritative for §8
                    // eligibility/conflicts; a rejection creates nothing. On SUCCESS reflect the
                    // leg in the Swaps→Outgoing list immediately (optimistic) and bump
                    // swapRefreshKey to reconcile to the real voidable row (there's no Realtime
                    // on swap_requests). On FAILURE surface a swap-specific error toast. Returns
                    // the outcome so the sheet shows "Swap proposed" only on a real success.
                    val result = runCatching { repo.createSwap(proposal) }.getOrElse { EdgeResult(false, 0, "") }
                    if (result.ok) {
                        swapsVm.addOutgoing(proposal)
                        swapRefreshKey++
                    } else {
                        writeError = edgeErrorMessage(WriteOp.PROPOSE_SWAP, result)
                    }
                    result.ok
                },
                onVoidSwap = { swapId ->
                    // POST the real void → `void-swap` (pending-only, own-party). On failure surface
                    // the classified reason + revert (re-read outgoing swaps → the entry returns).
                    launchWrite(WriteOp.CANCEL_SWAP) { repo.voidSwap(swapId) }
                },
            )
        }
    }
}

/** Loading state for the worker's week — a skeleton My-Shifts list (design shimmer). */
@Composable
private fun LoadingScreen() {
    ShiftTheme(darkTheme = rememberPersistedDarkTheme()) {
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
