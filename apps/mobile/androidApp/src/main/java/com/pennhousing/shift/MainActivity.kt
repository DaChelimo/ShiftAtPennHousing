package com.pennhousing.shift

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.ack.parseFloatAckDeepLink
import com.pennhousing.shift.shared.auth.AppBootstrap
import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.auth.DataSource
import com.pennhousing.shift.shared.auth.StartDestination
import com.pennhousing.shift.shared.breakclaim.BreakCalendarSnapshot
import com.pennhousing.shift.shared.breakclaim.noBreakCalendar
import com.pennhousing.shift.shared.data.BreakRepository
import com.pennhousing.shift.shared.data.HomeHouseGate
import com.pennhousing.shift.shared.data.ProfileSnapshot
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.data.WorkerSnapshot
import com.pennhousing.shift.shared.house.HouseScheduleSnapshot
import com.pennhousing.shift.shared.data.CoverageWriteResult
import com.pennhousing.shift.shared.data.HouseHoursResult
import com.pennhousing.shift.shared.data.LadderCadence
import com.pennhousing.shift.shared.data.ProfileLoad
import com.pennhousing.shift.shared.live.LiveDefaults
import com.pennhousing.shift.shared.manager.CachedRoleShape
import com.pennhousing.shift.shared.manager.RoleShapeResolution
import com.pennhousing.shift.shared.manager.coverage.CoverageOutcome
import com.pennhousing.shift.shared.manager.coverage.CoverageRequest
import com.pennhousing.shift.shared.manager.resolveRoleShape
import com.pennhousing.shift.shared.manager.shouldRewriteRoleShape
import com.pennhousing.shift.shared.viewmodel.CoverageViewModel
import com.pennhousing.shift.ui.manager.ManagerModePrefs
import com.pennhousing.shift.ui.manager.dialPhoneNumber
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.PendingFloat
import com.pennhousing.shift.shared.model.RecentFloat
import com.pennhousing.shift.shared.network.ClaimOutcome
import com.pennhousing.shift.shared.network.EdgeResult
import com.pennhousing.shift.shared.network.TOAST_DURATION_MS
import com.pennhousing.shift.shared.network.WriteOp
import com.pennhousing.shift.shared.network.claimToast
import com.pennhousing.shift.shared.network.edgeErrorMessage
import com.pennhousing.shift.shared.network.swapAccepted
import com.pennhousing.shift.shared.notifications.IncomingSwap
import com.pennhousing.shift.shared.notifications.NotificationItem
import com.pennhousing.shift.shared.notifications.withIncomingSwapEntries
import com.pennhousing.shift.shared.notifications.withPendingFloatEntry
import com.pennhousing.shift.shared.platform.AppConfig
import com.pennhousing.shift.shared.platform.SimClock
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.shifts.CLAIM_SUCCESS_TOAST
import com.pennhousing.shift.shared.shifts.DROP_SUCCESS_TOAST
import com.pennhousing.shift.shared.shifts.weeklyHours
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.swapCandidates
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.settings.NotificationPreferences
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.HouseNotLiveScreen
import com.pennhousing.shift.ui.LoginRoute
import com.pennhousing.shift.ui.ShiftsActions
import com.pennhousing.shift.ui.ShiftsApp
import com.pennhousing.shift.ui.ShiftsHostState
import com.pennhousing.shift.ui.ShiftsViewModels
import com.pennhousing.shift.ui.SplashOverlay
import com.pennhousing.shift.ui.kit.SkeletonShiftCard
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.ThemePrefs
import com.pennhousing.shift.ui.theme.rememberPersistedDarkTheme
import com.pennhousing.shift.ui.theme.resolveDark
import com.pennhousing.shift.widget.WidgetSync
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
/**
 * Floor on how long the splash stays up. Not a delay before content: content that is ready
 * sooner still waits this out, so an instant launch does not flash the lockup for one frame.
 */
private const val SPLASH_MIN_VISIBLE_MS = 450L

/**
 * A transparent system-bar style whose icon tint is pinned to the IN-APP theme.
 *
 * `SystemBarStyle.dark` draws light (white) icons; `SystemBarStyle.light` draws dark icons
 * and needs a scrim colour for the API levels that cannot tint icons, so it gets the same
 * transparent value twice. Both are passed an explicit `detectDarkMode` via the factory
 * choice rather than letting `auto` read `Configuration.uiMode`, which is the OS appearance.
 */
private fun systemBarStyle(darkTheme: Boolean): SystemBarStyle =
    if (darkTheme) {
        SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
    } else {
        SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
    }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Cold-start splash (Theme.ShiftPennHousing.Splash in the manifest supplies the
        // background). Kept on screen until the first Compose frame attaches below, at
        // which point SplashOverlay takes over showing the full lockup wordmark, since
        // the OS icon slot clips a wide image. See ui/SplashOverlay.kt.
        val splashScreen = installSplashScreen()
        var keepNativeSplash = true
        splashScreen.setKeepOnScreenCondition { keepNativeSplash }

        super.onCreate(savedInstanceState)
        // The persisted appearance choice, resolved without composition (see
        // ThemeChoice.resolveDark(Configuration) for why this cannot be the @Composable one).
        val initialDarkTheme = ThemePrefs.read(this).resolveDark(resources.configuration)
        // Explicit bar styles, NOT the no-arg default: SystemBarStyle.auto detects dark mode
        // from Configuration.uiMode (the SYSTEM appearance), so app-Dark on a system-Light
        // phone got light-mode bars with black clock/battery icons over our dark chrome.
        // ShiftTheme re-applies the appearance flags on every theme change; this only seeds
        // the frames that exist before the first composition.
        enableEdgeToEdge(
            statusBarStyle = systemBarStyle(initialDarkTheme),
            navigationBarStyle = systemBarStyle(initialDarkTheme),
        )
        // The POST_NOTIFICATIONS runtime request is no longer fired cold on launch. It is
        // raised by the inline ask on My Shifts (NotificationNudgeRow in
        // ui/onboarding/NotificationNudge.kt), so the worker sees WHY alerts matter, on the
        // screen where it matters, before the OS dialog appears.

        val backendConfigured = AppConfig.supabaseUrl.isNotBlank()
        // T2-13: a float push tap / external deep link (pennshift://float-ack/{id})
        // opens the FULL-SCREEN FloatAckSurface on launch. Pure parser; null when the
        // app was launched normally.
        val launchFloatAckId = parseFloatAckDeepLink(intent?.dataString)
        // `initialDarkTheme` (resolved above, before enableEdgeToEdge) is also what the splash
        // paints with: it comes from the non-Compose ThemeChoice.resolveDark(Configuration), a
        // plain field read, not the @Composable rememberPersistedDarkTheme() — see that
        // function's doc for why: the splash is the first thing SplashOverlay ever paints, and
        // isSystemInDarkTheme() can misresolve on exactly that first composition pass.
        setContent {
            LaunchedEffect(Unit) { keepNativeSplash = false }
            // The splash now stays up until there is something REAL to show: the login
            // screen, or the signed-in worker's own week. It used to hand off after a fixed
            // 450ms to the skeleton LoadingScreen, so a cold launch read as brand splash,
            // then a loading state, then the content.
            var contentReady by remember { mutableStateOf(false) }
            var minSplashElapsed by remember { mutableStateOf(false) }
            var splashCaption by remember { mutableStateOf<String?>(null) }
            LaunchedEffect(Unit) {
                delay(SPLASH_MIN_VISIBLE_MS)
                minSplashElapsed = true
            }
            Box(Modifier.fillMaxSize()) {
                if (backendConfigured) {
                    LiveOrLoginRoot(
                        launchFloatAckId = launchFloatAckId,
                        onContentReady = { contentReady = true },
                        // A fresh sign-in raises the splash again (this time saying so) while
                        // the worker's week loads, instead of parking them on a skeleton.
                        onSigningIn = {
                            splashCaption = "Signing you in"
                            contentReady = false
                        },
                    )
                } else {
                    DemoRoot(launchFloatAckId)
                    LaunchedEffect(Unit) { contentReady = true }
                }
                if (!contentReady || !minSplashElapsed) {
                    SplashOverlay(caption = splashCaption, darkTheme = initialDarkTheme)
                }
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
    // Feed the home-screen widget from the demo week.
    LaunchedEffect(now) { WidgetSync.update(context, snapshot.myShifts, DemoData.pendingFloats(now), now) }
    ShiftsApp(
        viewModels =
            ShiftsViewModels(
                shiftsVm = shiftsVm,
                ackVm = ackVm,
                updatesVm = updatesVm,
                swapsVm = swapsVm,
                calendarVm = calendarVm,
                houseVm = houseVm,
                preferencesVm = preferencesVm,
                breakCalendarVm = breakCalendarVm,
                settingsVm = settingsVm,
            ),
        hostState =
            ShiftsHostState(
                now = now,
                currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
                // Demo float-request carousel — two floats so the swipe + completion are visible.
                pendingFloats = remember(now) { DemoData.pendingFloats(now) },
                // Demo recent-floats history (accepted / declined / expired) for the section below it.
                recentFloats = remember(now) { DemoData.recentFloats(now) },
                claimSuccessMessage = claimSuccessMessage,
                launchFloatAckId = launchFloatAckId,
                // D2 + CALENDAR_REDESIGN — demo swap calendar over the demo house grid (no live write).
                swapMeUserId = null,
                swapDemoSeats = remember(now) { DemoData.houseSchedule(now).seats },
            ),
        actions =
            ShiftsActions(
                // Demo has no backend session → sign-out is a no-op (login is the live path).
                onSignOut = {},
                // Demo has no backend: optimistically reflect each proposed leg in the Swaps tab so
                // the worker sees the result (the live path POSTs `create-swap` + refetches instead).
                // Always "succeeds" so the success toast shows.
                onCreateSwap = {
                    swapsVm.addOutgoing(it)
                    true
                },
                // Demo accept/decline of an incoming swap (Swaps tab + the My-Shifts popup): resolve
                // the Swaps list locally; the calendar popup un-tints its own card optimistically.
                onAcceptSwap = { swapsVm.resolveIncoming(it) },
                onRejectSwap = { swapsVm.resolveIncoming(it) },
                onClaimSuccessMessage = { claimSuccessMessage = it },
            ),
    )
}

/**
 * Backend-configured path. Restores any persisted session once, runs the bootstrap
 * decision, then shows login or live shifts. While the (suspending) restore is in
 * flight we show a loading state.
 */
@Composable
private fun LiveOrLoginRoot(
    launchFloatAckId: String? = null,
    /** Called once this path is showing real content (login, the gate screen, or the week). */
    onContentReady: () -> Unit = {},
    /** Called the moment a sign-in succeeds, so the host can raise the splash while it loads. */
    onSigningIn: () -> Unit = {},
) {
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
                val signOutContext = LocalContext.current
                val onSignOut = {
                    scope.launch { WorkerBackend.authGateway.signOut() }
                    // Forget the remembered app shape. The user-id check in `resolveRoleShape`
                    // already prevents the next person inheriting these tabs, so this is belt and
                    // braces; it also stops a signed-out phone carrying a record of who last used
                    // it and what they could do.
                    ManagerModePrefs.clear(signOutContext)
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
                            LaunchedEffect(Unit) { onContentReady() }
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
                                    onWeekLoaded = onContentReady,
                                )
                            }
                        }
                }
            } else {
                LaunchedEffect(Unit) { onContentReady() }
                LoginRoute(
                    gateway = WorkerBackend.authGateway,
                    onAuthenticated = { newSession ->
                        // Promote to live shifts; the SHIFTS branch's LaunchedEffect
                        // wires the live worker JWT onto privileged requests.
                        onSigningIn()
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
    /** Fired on the first real week snapshot, so the host can drop the launch splash. */
    onWeekLoaded: () -> Unit = {},
) {
    val repo = remember { WorkerBackend.shiftsRepository }
    val swapRepo = remember { WorkerBackend.swapActivityRepository }
    val writeStore = remember { WorkerBackend.pendingWrites }
    // THE APP SHAPE, RESOLVED BEFORE THE FIRST FRAME (docs/manager-app/SPEC.md §5.1).
    //
    // Read SYNCHRONOUSLY here, above everything else, because the alternative is what this
    // replaced: capabilities came from a three-round-trip network read, so every cold launch drew
    // the WORKER shape first and then re-keyed the navigation when the roles arrived. For a
    // manager that flipped the bottom bar and the start destination on every single launch.
    //
    // `remember` keyed on the user id, not `produceState`: SharedPreferences serves from an
    // in-memory map after the first touch, so this is a lookup, not I/O. Nothing asynchronous can
    // go here without putting the flip back.
    val shapeContext = LocalContext.current
    val cachedShape = remember(session.userId) { ManagerModePrefs.read(shapeContext) }
    val shapeResolution = remember(cachedShape, session.userId) { resolveRoleShape(cachedShape, session.userId) }
    // On a HIT this is the manager's real shape from frame one. On a MISS it is a plain worker,
    // which is never SEEN, because the splash is held below until the server answers.
    val shapeFromCache =
        remember(shapeResolution) {
            (shapeResolution as? RoleShapeResolution.UseCached)?.capabilities
                ?: LiveDefaults.plainWorkerCapabilities()
        }

    val snapshotState by remember(session.userId) {
        repo.observeWorkerWeek(session.userId, now)
    }.collectAsStateWithLifecycle(initialValue = null)
    // Seat writes this client has started and the server has not answered. Drives the
    // in-progress cards that REPLACED the optimistic moves (shifts/PendingWrites.kt).
    val pendingWrites by writeStore.writes.collectAsStateWithLifecycle()

    when (val snapshot: WorkerSnapshot? = snapshotState) {
        // The launch splash is still covering this (see MainActivity.setContent); the
        // skeleton is what a POST-launch reload falls back to.
        null -> LoadingScreen()
        else -> {
            // The worker's own week is on screen. The splash drops once the app SHAPE is also
            // settled, which on a cache hit is already true and costs nothing.
            //
            // The only launch that waits here is the first one after a sign-in, when there is
            // nothing cached and guessing is exactly the flip we are removing. "Settled" includes
            // a FAILED read: we asked, we got nothing, and we open as a worker rather than hanging
            // on the splash. See `roleShapeSettled` below.
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
            // T-2h), a failed write asks to revert (revertKey), or a write starts/settles
            // (pendingWrites) so its in-progress card appears and then clears.
            val shiftsVm =
                remember(snapshot, revertKey, pendingWrites) {
                    ShiftsScreenViewModel(
                        snapshot.myShifts,
                        snapshot.openShifts,
                        now,
                        pendingWrites = pendingWrites,
                        // Server-owned per-week caps, carried on the snapshot. Nothing
                        // client-side decides the cap any more.
                        weeklyCaps = snapshot.weeklyCaps,
                    )
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
            // No live float outstanding = the inert LiveDefaults placeholder, NEVER the demo
            // float. Nothing routes here without a real float (the carousel is empty and no
            // Updates entry links to one), so this only ever backs an unreachable surface.
            val ackVm =
                remember(livePendingFloat) {
                    livePendingFloat?.let { AckDeclineViewModel(it, now) } ?: LiveDefaults.ackViewModel()
                }
            // Feed the home-screen widget from the live week + pending floats.
            val widgetContext = LocalContext.current
            LaunchedEffect(snapshot.myShifts, livePendingFloats) {
                WidgetSync.update(widgetContext, snapshot.myShifts, livePendingFloats, now)
            }
            // Updates: load the worker's real `notifications` rows (RLS-scoped) for the
            // feed; fall back to the demo notifications while the fetch is in flight or
            // if it fails. A `float_assigned` row now maps to the urgent FLOAT entry that
            // opens the ack hero; `withPendingFloatEntry` additionally guarantees the live
            // pending float (from `fetchPendingFloat`) is always represented even if its
            // notification row hasn't landed. Mirrors the live-preferences pattern.
            // Swaps + notifications, LIVE (2026-07-28). These were three produceStates keyed
            // on the VIEWING worker's own actions, which meant a request someone else sent,
            // or a decline someone else made, only appeared when an unrelated seat change
            // happened to re-run them. `swap_requests` is now in the Realtime publication and
            // [SwapActivityRepository] holds one shared channel over it + `notifications`, so
            // every swap event reaches both parties as it happens. `swapRefreshKey` is gone:
            // a local action needs no special key, the channel carries it like any other.
            val swapActivity by
                remember(session.userId) {
                    swapRepo.observeSwapActivity(session.userId)
                }.collectAsStateWithLifecycle(initialValue = null)
            val livePendingSwaps = swapActivity?.pendingSwaps ?: emptyList()
            val liveIncomingSwaps = swapActivity?.incomingSwaps ?: emptyList()
            val liveNotifications: List<NotificationItem>? = swapActivity?.notifications
            val updatesVm =
                remember(liveNotifications, livePendingFloat, liveIncomingSwaps) {
                    // Empty until the worker's own notifications land. NEVER the demo feed:
                    // that is what showed a signed-in worker fabricated swaps awaiting their
                    // action for the first seconds after launch (and forever, if the read failed).
                    val base = liveNotifications ?: emptyList()
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
            // Rebuilt on every new snapshot, on a pending-write change (so a claim/drop shows
            // its in-progress card and clears it), and on a swap change (the banner + marks).
            val calendarVm =
                remember(snapshot, closedDays, revertKey, livePendingSwaps, pendingWrites) {
                    CalendarViewModel(snapshot.myShifts, now, closedDays, livePendingSwaps, pendingWrites, snapshot.weeklyCaps)
                }
            // The worker's profile (own users / user_roles). Loaded here (above the House
            // VM) so its resolved role can gate the House-grid manager actions; it also
            // feeds the Settings screen below. Best-effort: null while in flight / on
            // failure. `isManager` = holds a schedule-manager role (anything but a plain
            // `sw`); the House VM combines it with the home-house check for `canManage`.
            val profileRepo = remember { WorkerBackend.profileRepository }
            // A LOAD STATE, not a nullable snapshot: the splash release below has to distinguish
            // "still asking" from "asked and it failed", or a manager on a dead connection would
            // stare at the wordmark forever.
            val profileLoad by
                produceState<ProfileLoad>(initialValue = ProfileLoad.Loading, session.userId, revertKey) {
                    value = ProfileLoad.Done(runCatching { profileRepo.fetchProfile(session.userId) }.getOrNull())
                }
            val liveProfile = profileLoad.snapshotOrNull
            // House schedule (§11.4, T3b): the home house's week grid with contacts
            // (full-directory ruling). Falls back to the demo snapshot while loading.
            val liveHouseSchedule by
                produceState<HouseScheduleSnapshot?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchHouseSchedule(session.userId) }.getOrNull()
                }
            val houseVm =
                remember(liveHouseSchedule, liveProfile) {
                    HouseScheduleViewModel(
                        // Blank grid while the real week loads, not somebody else's demo house.
                        liveHouseSchedule ?: LiveDefaults.emptyHouseSchedule(),
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
            //
            // [reconcile] additionally pulls a fresh snapshot once the write settles
            // (audit F9). Realtime cannot be relied on alone: postgres_changes evaluates
            // RLS against the NEW row, so if a concurrent writer reassigns a seat away
            // from this worker the row leaves their scope and NO event is delivered. The
            // optimistic card would then survive forever, showing a shift the server has
            // already given to somebody else. Left false for writes that touch no seat
            // (preferences, broadcast opt-in), whose refetch would be pure cost.
            fun launchWrite(
                op: WriteOp,
                revert: Boolean = true,
                reconcile: Boolean = true,
                block: suspend () -> EdgeResult,
            ) {
                prefsScope.launch {
                    val result = runCatching { block() }.getOrElse { EdgeResult(false, 0, "") }
                    if (!result.ok) {
                        writeError = edgeErrorMessage(op, result)
                        if (revert) revertKey++
                    }
                    if (reconcile) repo.refresh.request()
                }
            }

            // Boolean variant for non-EF writes (Postgrest direct: preferences / opt-out),
            // which either complete or throw. A failure here is a transport/permission issue,
            // so it classifies off a status-0 [EdgeResult] (offline copy) with the op's verb.
            fun launchWriteBool(
                op: WriteOp,
                revert: Boolean = true,
                reconcile: Boolean = false,
                block: suspend () -> Boolean,
            ) {
                prefsScope.launch {
                    val ok = runCatching { block() }.getOrDefault(false)
                    if (!ok) {
                        writeError = edgeErrorMessage(op, EdgeResult(false, 0, ""))
                        if (revert) revertKey++
                    }
                    if (reconcile) repo.refresh.request()
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
                        // No open period (or still loading) = an empty read-only week, not the
                        // demo period, whose fake block ids make a submit land nowhere.
                        livePeriod ?: LiveDefaults.emptyPreferencePeriod(),
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
            // Settings reuses `liveProfile` (loaded above the House VM): the worker's real
            // profile + live `broadcast_subscribed` (own users / user_roles + houses, all
            // RLS-readable); it falls back to the demo profile while the read is in flight.
            // The broadcast toggle PATCHes the `users-broadcast-subscription` EF (best-effort),
            // the ONLY interactive notification channel (§10.1: personal float / shift-reminder
            // / schedule-published notifications are mandatory, shown always-on/disabled).
            val settingsContext = LocalContext.current
            // The two configurable open-shift channels (BSpec §10.1). A worker with no row
            // gets the defaults, which is also what the server assumes, so "never opened
            // Settings" and "kept the defaults" are the same state everywhere.
            val liveNotificationPrefs by
                produceState(initialValue = NotificationPreferences(), session.userId, revertKey) {
                    value = profileRepo.fetchNotificationPreferences(session.userId)
                }
            val settingsVm =
                remember(liveProfile, liveNotificationPrefs) {
                    // Seed the in-session theme from the persisted choice (survives relaunch).
                    SettingsViewModel(
                        // A blank profile card until the real one loads. The demo profile put a
                        // different person's name, email and house in front of the worker.
                        liveProfile?.profile ?: LiveDefaults.emptySettingsProfile(),
                        liveProfile?.broadcastSubscribed ?: false,
                        DemoData.DEMO_APP_VERSION,
                        liveNotificationPrefs,
                    ).apply { setTheme(ThemePrefs.read(settingsContext)) }
                }
            // ----- Manager mode (docs/manager-app/SPEC.md). -----
            // Everything here is inert for a plain worker: `capabilities` defaults to no
            // manager surface, so the streams never subscribe and `coverageVm` stays null.
            // The shape actually used. The server's answer wins the moment it lands; until then
            // the cached shape stands.
            //
            // NOTE the fallback is `shapeFromCache`, NOT a plain worker. A failed or slow role read
            // must not strip a manager's Coverage tab: they would lose the alert surface precisely
            // when the network is flaky. This is safe because the cache shapes UI only and every
            // manager write is re-authorized server-side.
            // Is the app shape known enough to draw? True immediately on a cache hit; on a miss it
            // becomes true when the role read COMPLETES, success or failure.
            val roleShapeSettled =
                shapeResolution is RoleShapeResolution.UseCached || profileLoad is ProfileLoad.Done
            LaunchedEffect(roleShapeSettled) { if (roleShapeSettled) onWeekLoaded() }

            val capabilities = liveProfile?.capabilities ?: shapeFromCache
            // Write through only on a real change, so the common launch does no write at all and
            // `capabilities` stays value-identical across the reconcile. That identity is what
            // stops the navigation re-keying on `startRoute` and rebuilding its back stacks.
            LaunchedEffect(profileLoad, session.userId) {
                val snapshot = liveProfile ?: return@LaunchedEffect
                val fresh =
                    CachedRoleShape(
                        userId = session.userId,
                        homeHouseId = snapshot.homeHouseId,
                        roles = snapshot.roles,
                    )
                if (shouldRewriteRoleShape(cachedShape, fresh)) ManagerModePrefs.write(shapeContext, fresh)
            }
            val coverageContext = LocalContext.current
            val coverageRepo = remember { WorkerBackend.coverageRepository }
            // The configured ladder cadence, for an honest "escalates in 12m" countdown. Read
            // once per session: an admin retuning it mid-shift is not worth a poll.
            val ladderCadence by
                produceState(initialValue = LadderCadence(), capabilities.hasCoverage) {
                    if (capabilities.hasCoverage) value = coverageRepo.fetchLadderCadence()
                }
            // Live coverage requests. Realtime-backed, so an escalation landing on this manager
            // appears without a refresh. RLS scopes the rows, so no house filter is sent.
            val coverageRequests by
                produceState(initialValue = emptyList<CoverageRequest>(), capabilities.hasCoverage) {
                    if (capabilities.hasCoverage) coverageRepo.coverageStream().collect { value = it }
                }
            val coverageVm =
                remember(capabilities.hasCoverage, ladderCadence) {
                    if (capabilities.hasCoverage) {
                        CoverageViewModel(coverageRequests, now, ladderCadence.rungTimeoutMinutes)
                    } else {
                        null
                    }
                }
            // Feed later snapshots in rather than rebuilding the ViewModel, so an open Respond
            // sheet survives a Realtime update instead of being torn down mid-decision.
            LaunchedEffect(coverageRequests, coverageVm) { coverageVm?.refresh(coverageRequests) }

            val hoursRepo = remember { WorkerBackend.hoursRepository }
            val hoursReport by
                produceState<HouseHoursResult?>(initialValue = null, capabilities, revertKey) {
                    if (capabilities.hasManagerSurface) {
                        value =
                            runCatching {
                                hoursRepo.fetchHouseHours(
                                    houseId = capabilities.adminHouseId,
                                    houseName = liveProfile?.profile?.homeHouseName ?: capabilities.adminHouseId,
                                    weekStart = now,
                                    // An SM cannot read another house's assignments, so their
                                    // breakdown is home-desk only and the screen says so.
                                    awayVisible = capabilities.isScheduleAdmin,
                                )
                            }.getOrNull()
                    }
                }

            ShiftsApp(
                viewModels =
                    ShiftsViewModels(
                        shiftsVm = shiftsVm,
                        ackVm = ackVm,
                        updatesVm = updatesVm,
                        swapsVm = swapsVm,
                        calendarVm = calendarVm,
                        houseVm = houseVm,
                        preferencesVm = preferencesVm,
                        breakCalendarVm = breakCalendarVm,
                        settingsVm = settingsVm,
                        coverageVm = coverageVm,
                    ),
                hostState =
                    ShiftsHostState(
                        // D8 — the live "This week — Xh" total from the real snapshot (the demo
                        // constant was a placeholder; dropped-still-open blocks don't count).
                        currentWeeklyHours = remember(snapshot) { weeklyHours(snapshot.myShifts, now) },
                        now = now,
                        pendingFloats = livePendingFloats,
                        recentFloats = liveRecentFloats,
                        writeError = writeError,
                        claimSuccessMessage = claimSuccessMessage,
                        launchFloatAckId = launchFloatAckId,
                        // D2/D3 + CALENDAR_REDESIGN — the swap calendar fetches each week's house grid
                        // live (per-week) keyed on the worker; no current-week candidate list needed.
                        swapMeUserId = session.userId,
                        swapDemoSeats = emptyList(),
                        capabilities = capabilities,
                        hoursReport = hoursReport,
                    ),
                actions =
                    ShiftsActions(
                        onSignOut = onSignOut,
                        // Manager mode. These two are the only writes in this app that must
                        // report their result: a failed acknowledge has to revert so the banner
                        // returns and the ladder keeps escalating. Never queue them offline.
                        onAcknowledgeCoverage = { requestId ->
                            coverageRepo.acknowledge(requestId) != CoverageWriteResult.Failed
                        },
                        onCloseCoverage = { requestId, outcome, note ->
                            val parsed = CoverageOutcome.fromWire(outcome)
                            parsed != null &&
                                coverageRepo.close(requestId, parsed, note) != CoverageWriteResult.Failed
                        },
                        onCallPhone = { number -> if (number != null) dialPhoneNumber(coverageContext, number) },
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
                            // CONFIRMED, not optimistic (2026-07-28). The card stays where it is,
                            // marked busy, until `drop-shift` / `permanent-drop` answers. It used to
                            // leave the calendar the instant the worker tapped, which told them the
                            // shift was released before anything had been written.
                            val token = writeStore.beginDrop(shift.blockIds)
                            prefsScope.launch {
                                try {
                                    val op = if (permanent) WriteOp.PERMANENT_DROP else WriteOp.DROP
                                    val result =
                                        runCatching {
                                            if (permanent) repo.permanentDrop(shift) else repo.dropShift(shift)
                                        }.getOrElse { EdgeResult(false, 0, "") }
                                    if (result.ok) {
                                        claimSuccessMessage = DROP_SUCCESS_TOAST
                                    } else {
                                        writeError = edgeErrorMessage(op, result)
                                    }
                                    // Pull server truth BEFORE releasing the busy state, so the card
                                    // goes straight from "dropping" to the settled result. Releasing
                                    // first would flash the pre-write state in between.
                                    repo.refresh.request()
                                } finally {
                                    writeStore.end(token)
                                }
                            }
                        },
                        onClaimSuccessMessage = { claimSuccessMessage = it },
                        onClaimShift = { shift ->
                            // CONFIRMED, not optimistic (2026-07-28). `claim-shift` is ONE POST PER
                            // 30-MINUTE BLOCK, and each landed block emits a Realtime event that
                            // refetches the week, so the old optimistic path rendered a claimed shift
                            // ASSEMBLING ITSELF (16:00-16:30, then 16:00-17:00, ...) under an
                            // already-shown success toast. Registering the write instead holds the
                            // tapped card whole and busy, hides the half-written rows, and shows the
                            // outcome once every block has actually been answered for.
                            //
                            // The server stays authoritative for the hours cap, the T-2h cutoff,
                            // cross-house eligibility and FCFS. A coalesced card can still land
                            // PARTIALLY (a sub-range lost the race): full is a clean success, partial
                            // is the informative "claimed part of this shift" note, not a red failure.
                            val token = writeStore.beginClaim(shift)
                            prefsScope.launch {
                                try {
                                    val outcome = runCatching { repo.claimShift(shift) }.getOrElse { ClaimOutcome.offline() }
                                    val toast = claimToast(WriteOp.CLAIM, outcome, CLAIM_SUCCESS_TOAST)
                                    if (toast.isError) {
                                        claimSuccessMessage = null
                                        writeError = toast.message
                                    } else {
                                        writeError = null
                                        claimSuccessMessage = toast.message
                                    }
                                    // Audit F9, and now also what ENDS the in-progress card: a claim
                                    // moves rows into this worker's RLS scope one at a time, so only
                                    // a positive pull can tell us what actually landed.
                                    repo.refresh.request()
                                } finally {
                                    writeStore.end(token)
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
                                // Audit F9. Doubly needed here: permanent_pickup_slot has
                                // partial-success semantics by design (§8.4.3), so an `ok`
                                // response does not mean every week landed.
                                repo.refresh.request()
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
                                    repo.refresh.request() // audit F9
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
                        onToggleNotification = { prefs ->
                            // Persist both open-shift channels through
                            // `set_notification_preferences` (own-row, no user_id parameter).
                            // The switch already moved; a failure toasts and re-reads, so the
                            // toggle snaps back rather than lying about what the server holds.
                            launchWriteBool(WriteOp.PREFERENCES) { profileRepo.setNotificationPreferences(prefs) }
                        },
                        onToggleBroadcast = { subscribed ->
                            // PATCH the real broadcast subscription → `users-broadcast-subscription` while
                            // the settings ViewModel already flipped its optimistic toggle. The EF rejects
                            // an HM/BM subscribe (403) → toast + revert (re-read the profile → the toggle
                            // snaps back). This is the ONLY user-toggleable notification channel.
                            launchWrite(WriteOp.BROADCAST, reconcile = false) {
                                profileRepo.setBroadcastSubscription(session.userId, subscribed)
                            }
                        },
                        onMarkAllRead = { unreadIds ->
                            // Persist the read receipts → loop the worker's unread ids through the
                            // `mark_notification_read` RPC (best-effort) while the Updates ViewModel already
                            // cleared the dots optimistically. Low-stakes (a read receipt) and `markAllRead`
                            // swallows per-id errors internally, so this stays fire-and-forget (no toast).
                            prefsScope.launch { repo.markAllRead(session.userId, unreadIds) }
                        },
                        onAcceptSwap = { swapId ->
                            // POST the real acceptance → `accept-swap`. EVERY type is acceptable now:
                            // permanent swaps auto-resolve their affected occurrences server-side, and
                            // the server re-checks pending/expiry atomically (§8.2). Both lists now
                            // reconcile over Realtime (`swap_requests` is published), so there is no
                            // refresh key to bump; the explicit pulls below cover the rows that LEAVE
                            // each party's RLS scope, which Realtime structurally cannot report.
                            prefsScope.launch {
                                val result = runCatching { repo.acceptSwap(swapId) }.getOrElse { EdgeResult(false, 0, "") }
                                // accept-swap returns 200 even on a logical no-op ({accepted:false,reason}),
                                // so confirm the body actually applied — otherwise classify the reason.
                                if (!(result.ok && swapAccepted(result.body))) {
                                    writeError = edgeErrorMessage(WriteOp.ACCEPT_SWAP, result)
                                    revertKey++
                                }
                                // Audit F9. An accepted swap moves seats BETWEEN two workers, so one
                                // side's rows leave their RLS scope and Realtime tells them nothing.
                                repo.refresh.request()
                                swapRepo.refresh.request()
                            }
                        },
                        onRejectSwap = { swapId ->
                            // POST the real decline → `reject-swap` (idempotent — a non-pending swap 409s
                            // `not_pending`). The INITIATOR now learns about this without polling: the
                            // status flip is published on `swap_requests` and the DB trigger also files
                            // them a `swap_declined` notification. Previously neither happened, which is
                            // why a decline never reached the other side.
                            prefsScope.launch {
                                val result = runCatching { repo.rejectSwap(swapId) }.getOrElse { EdgeResult(false, 0, "") }
                                if (!result.ok) {
                                    writeError = edgeErrorMessage(WriteOp.DECLINE_SWAP, result)
                                    revertKey++
                                }
                                swapRepo.refresh.request()
                            }
                        },
                        onCreateSwap = { proposal ->
                            // POST the real proposal → `create-swap`. The server is authoritative for §8
                            // eligibility/conflicts; a rejection creates nothing. The worker's own side is
                            // held BUSY for the duration instead of being shown as already proposed, and
                            // the real row arrives over Realtime, so the synthetic "Your housemate"
                            // placeholder that used to be inserted here is gone. Returns the outcome so
                            // the sheet shows "Swap proposed" only on a real success.
                            val token = writeStore.beginSwap(proposal.initiatorAssignmentIds)
                            try {
                                val result = runCatching { repo.createSwap(proposal) }.getOrElse { EdgeResult(false, 0, "") }
                                if (!result.ok) {
                                    writeError = edgeErrorMessage(WriteOp.PROPOSE_SWAP, result)
                                }
                                swapRepo.refresh.request()
                                result.ok
                            } finally {
                                writeStore.end(token)
                            }
                        },
                        onVoidSwap = { swapId ->
                            // POST the real void → `void-swap` (pending-only, own-party). On failure surface
                            // the classified reason + revert (re-read outgoing swaps → the entry returns).
                            launchWrite(WriteOp.CANCEL_SWAP) { repo.voidSwap(swapId) }
                            swapRepo.refresh.request()
                        },
                    ),
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
