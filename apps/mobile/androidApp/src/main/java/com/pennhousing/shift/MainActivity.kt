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
import com.pennhousing.shift.shared.platform.SimClock
import com.pennhousing.shift.shared.preferences.PreferencePeriod
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.shifts.weeklyHours
import com.pennhousing.shift.shared.swaps.PendingSwap
import com.pennhousing.shift.shared.swaps.swapCandidates
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.BreakCalendarViewModel
import com.pennhousing.shift.shared.viewmodel.CalendarViewModel
import com.pennhousing.shift.shared.viewmodel.HouseScheduleViewModel
import com.pennhousing.shift.shared.viewmodel.PreferencesViewModel
import com.pennhousing.shift.shared.viewmodel.SettingsViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.shared.viewmodel.SwapsViewModel
import com.pennhousing.shift.shared.viewmodel.UpdatesViewModel
import com.pennhousing.shift.ui.LoginRoute
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
        currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
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
                // Re-keyed on clockEpoch: a foreground clock change tears down + rebuilds
                // the whole live tree, so `now` (and every VM built from it) is recaptured.
                key(clockEpoch) {
                    val now = remember { SimClock.now() }
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
        repo.observeWorkerWeek(session.userId)
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
                    delay(4000)
                    writeError = null
                }
            }
            // Rebuild the ViewModel whenever a fresh snapshot arrives (e.g. a float at
            // T-2h) OR a failed write asks to revert (revertKey).
            val shiftsVm =
                remember(snapshot, revertKey) {
                    ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now)
                }
            // Float ack: load the worker's live pending float (own `float_assignments`
            // row + own pending float-out blocks, both RLS-scoped); fall back to the demo
            // float while the read is in flight or when none is outstanding. Ack/decline
            // POST to `acknowledge-float` / `decline-float` (best-effort) when the
            // optimistic local transition succeeds. Mirrors the live-notifications pattern.
            val livePendingFloat by
                produceState<FloatAck?>(initialValue = null, session.userId, revertKey) {
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
            // House schedule (§11.4, T3b): the home house's week grid with contacts
            // (full-directory ruling). Falls back to the demo snapshot while loading.
            val liveHouseSchedule by
                produceState<HouseScheduleSnapshot?>(initialValue = null, session.userId) {
                    value = runCatching { repo.fetchHouseSchedule(session.userId) }.getOrNull()
                }
            val houseVm =
                remember(liveHouseSchedule) {
                    HouseScheduleViewModel(liveHouseSchedule ?: DemoData.houseSchedule(now), now, meUserId = session.userId)
                }
            // Preferences: load the worker's real active period (scheduling_periods now
            // worker-readable — migration 20260610000001); fall back to the demo period
            // while loading or when no period is open. Submit POSTs to `submit-preferences`.
            val prefsRepo = remember { WorkerBackend.preferencesRepository }
            val prefsScope = rememberCoroutineScope()
            // Run a best-effort live write and surface failure instead of swallowing it.
            // [block] returns whether the write was accepted (EF → `.ok`; a Postgrest
            // call → completed-without-throwing). On failure: raise the toast and (when
            // [revert]) bump [revertKey] so the optimistic move snaps back to server truth.
            fun launchWrite(revert: Boolean = true, block: suspend () -> Boolean) {
                prefsScope.launch {
                    val ok = runCatching { block() }.getOrDefault(false)
                    if (!ok) {
                        writeError = "Couldn't reach the server — your change wasn't saved. Try again."
                        if (revert) revertKey++
                    }
                }
            }
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
            // Settings: load the worker's real profile + live `broadcast_subscribed` (own
            // users / user_roles + houses, all RLS-readable); fall back to the demo profile
            // while the read is in flight. The broadcast toggle PATCHes the
            // `users-broadcast-subscription` EF (best-effort) — it is the ONLY interactive
            // notification channel (§10.1: personal float / shift-reminder / schedule-published
            // notifications are mandatory and non-silenceable, shown always-on/disabled).
            val profileRepo = remember { WorkerBackend.profileRepository }
            val liveProfile by
                produceState<ProfileSnapshot?>(initialValue = null, session.userId, revertKey) {
                    value = runCatching { profileRepo.fetchProfile(session.userId) }.getOrNull()
                }
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
                // D8 — the live "This week — Xh" total from the real snapshot (the demo
                // constant was a placeholder; dropped-still-open blocks don't count).
                currentWeeklyHours = remember(snapshot) { weeklyHours(snapshot.myShifts, now) },
                writeError = writeError,
                onSignOut = onSignOut,
                onSubmitPreferences = {
                    // POST the current edits, then flip to the optimistic submitted state
                    // (mirrors the Shifts screen's claim/drop). On failure surface the toast;
                    // do NOT revert (revert=false) — that would discard the worker's painted
                    // edits, which they should keep so they can retry the submit.
                    val payload = preferencesVm.submitPayload()
                    launchWrite(revert = false) { prefsRepo.submitPreferences(payload) }
                    preferencesVm.submit()
                },
                onDropShift = { shift, permanent ->
                    // POST the real drop while the ViewModel does the optimistic local move.
                    // Occurrence → `drop-shift`; the recurring slot → `permanent-drop`. On a
                    // SUCCESSFUL drop the next Realtime snapshot reconciles the UI; on FAILURE
                    // [launchWrite] toasts and reverts the card to server truth.
                    launchWrite { (if (permanent) repo.permanentDrop(shift) else repo.dropShift(shift)).ok }
                },
                onClaimShift = { shift ->
                    // POST the real claim → `claim-shift` while the ViewModel does the optimistic
                    // local pickup. The server is authoritative for the hours-cap, T-2h cutoff,
                    // cross-house eligibility and FCFS; the client gating was a pre-check. Success
                    // reconciles via Realtime; failure toasts + reverts the optimistic pickup.
                    // WEEKLY openings only — permanent openings route through onPickUpPermanent.
                    launchWrite { repo.claimShift(shift).ok }
                },
                onPickUpPermanent = { shift ->
                    // POST the real permanent pickup → the `permanent-pickup` EF. This is the REAL
                    // path (the prior `claim-shift` permanent branch 501s); the EF re-evaluates
                    // scope server-side (caps + conflicts, §8.4.3) and commits via
                    // `permanent_pickup_slot`. Success reconciles the full multi-week scope via
                    // Realtime; failure toasts + reverts the optimistic local move.
                    launchWrite { repo.permanentPickup(shift).ok }
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
                    launchWrite { repo.acknowledgeFloat(floatId).ok }
                },
                onDeclineFloat = { floatId ->
                    // POST the real decline → `decline-float`; the modal already flipped to
                    // DECLINED. Declining reopens the destination gap server-side. On failure
                    // toast + revert (the modal returns to PENDING).
                    launchWrite { repo.declineFloat(floatId).ok }
                },
                onClaimBreakRange = { blockIds ->
                    // POST the dragged block ids → `break-claim` (its claim_break_blocks RPC
                    // claims one open seat per block, FCFS/cap/Harnwell-trimmed server-side)
                    // while the picker did the optimistic local move; reconcile the picker to
                    // the server's ACTUAL claimed seats. Failure toasts + reverts (revertKey
                    // rebuilds the VM from server truth).
                    if (blockIds.isNotEmpty()) {
                        launchWrite {
                            val result = repo.claimBreakRange(blockIds)
                            if (result.claimedAssignmentIds.isNotEmpty()) {
                                breakCalendarVm.reconcileClaim(result.claimedAssignmentIds)
                            }
                            // Claiming NOTHING (window closed / all taken / EF rejected) is a
                            // failure — surface it (toast + revert) instead of a false success.
                            result.ok && result.claimedAssignmentIds.isNotEmpty()
                        }
                    }
                },
                onDropBreakSeats = { seatIds ->
                    // POST ONE `drop-shift` covering the run's seats (no break-specific drop
                    // RPC). Optimistic locally; failure toasts + reverts.
                    if (seatIds.isNotEmpty()) launchWrite { repo.dropBlocks(seatIds).ok }
                },
                onToggleBreakOptOut = { optedOut ->
                    // Persist the §4.4 "no break hours" opt-out → insert/delete the worker's own
                    // `break_optouts` row DIRECTLY via Postgrest (worker RLS permits it — no EF),
                    // while the picker already flipped its optimistic opted-out state. Targets the
                    // ACTIVE break id; a no-op when no live break is loaded (demo). A Postgrest
                    // throw → toast + revert (re-read the opt-out row → the toggle snaps back).
                    breakCalendarVm.breakId?.let { bid ->
                        launchWrite { breakRepo.setBreakOptOut(session.userId, bid, optedOut); true }
                    }
                },
                onToggleBroadcast = { subscribed ->
                    // PATCH the real broadcast subscription → `users-broadcast-subscription` while
                    // the settings ViewModel already flipped its optimistic toggle. The EF rejects
                    // an HM/BM subscribe (403) → toast + revert (re-read the profile → the toggle
                    // snaps back). This is the ONLY user-toggleable notification channel.
                    launchWrite { profileRepo.setBroadcastSubscription(session.userId, subscribed).ok }
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
                        val ok = runCatching { repo.acceptSwap(swapId).ok }.getOrDefault(false)
                        if (ok) {
                            swapRefreshKey++
                        } else {
                            writeError = "Couldn't accept the swap — please try again."
                            revertKey++
                        }
                    }
                },
                onRejectSwap = { swapId ->
                    // POST the real decline → `reject-swap` (idempotent — a non-pending swap 409s
                    // `not_pending`). On success reconcile via swapRefreshKey; on failure revert.
                    prefsScope.launch {
                        val ok = runCatching { repo.rejectSwap(swapId).ok }.getOrDefault(false)
                        if (ok) {
                            swapRefreshKey++
                        } else {
                            writeError = "Couldn't decline the swap — please try again."
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
                    val ok = runCatching { repo.createSwap(proposal).ok }.getOrDefault(false)
                    if (ok) {
                        swapsVm.addOutgoing(proposal)
                        swapRefreshKey++
                    } else {
                        writeError = "Couldn't propose the swap — please try again."
                    }
                    ok
                },
                onVoidSwap = { swapId ->
                    // POST the real void → `void-swap` (pending-only, own-party). On failure toast
                    // + revert (re-read outgoing swaps → the entry returns).
                    launchWrite { repo.voidSwap(swapId).ok }
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
