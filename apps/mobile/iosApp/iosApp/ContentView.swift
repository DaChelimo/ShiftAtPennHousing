import SwiftUI
import Shared

/// Phase 13a — the worker Shifts screen in SwiftUI (BEHAVIORAL_SPECIFICATION.md §5.6).
///
/// Native UI over the shared `ShiftsScreenViewModel` (the Fruitties split). The
/// three spec tabs plus an Updates tab where a pending float surfaces. Selector
/// `accessibilityIdentifier`s match `apps/mobile/maestro/README.md` so the same
/// Maestro flows run on the iOS simulator.

/// Observes a Kotlin `StateFlow<ShiftsUiState>` (exposed by SKIE) as `@Published`.
/// D8 — the live host calls `activateLive`: the worker's REAL week streams in via
/// `observeWorkerWeek` (Realtime) and the VM is rebuilt per emission, exactly like
/// Android's `LiveShiftsRoot` (reads were demo-backed on iOS before; writes were live).
@MainActor
final class ShiftsObservable: ObservableObject {
    private(set) var vm: ShiftsScreenViewModel
    @Published var state: ShiftsUiState
    /// The live "This week — Xh" total (demo constant until live activates).
    @Published var weeklyHours: Double = DemoFactory.shared.demoWeeklyHours
    private var task: Task<Void, Never>?
    private var liveTask: Task<Void, Never>?
    private var live = false

    init(vm: ShiftsScreenViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        subscribe()
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        pushWidget(state)
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState {
                self.state = s
                self.pushWidget(s)
            }
        }
    }

    /// Mirror the worker's own + open shifts (as shown) into the home-screen widgets.
    /// Driven off the UI state so BOTH the demo and live builds keep the widget in step.
    private func pushWidget(_ s: ShiftsUiState) {
        let open = s.homeOpen.weekly + s.homeOpen.permanentOpenings + s.otherHouses.openShifts
        WidgetSync.update(myShifts: s.myShifts.inDisplayOrder(), openShifts: open)
    }


    // ---- Foreground lifecycle gate (cost audit F-11) ----
    // Android has one via collectAsStateWithLifecycle, which stops collection below
    // STARTED. iOS had NONE: activateLive started a raw Task, the app's scenePhase
    // handler only re-synced the sim clock, and liveTask?.cancel() appeared only in
    // deinit. The OS does eventually suspend a backgrounded app's network activity, but
    // that is the OS's behaviour, not the app's, and it is neither immediate nor
    // something to rely on for a metered Realtime connection.
    //
    // Suspending drops this collector, which (with the repository's shared, refcounted
    // flow) releases the Realtime channel once the last collector goes. Resuming
    // re-subscribes and re-fetches — deliberately accepted as slightly slower on resume
    // and cheaper the rest of the time.
    private var liveRepo: WorkerShiftsRepository?
    private var liveUserId: String?

    /// Release the live subscription when the app leaves the foreground.
    func suspendLive() {
        liveTask?.cancel()
        liveTask = nil
        live = false
    }

    /// Re-establish the live subscription on return to the foreground. No-op if the
    /// worker never went live in the first place (demo build).
    func resumeLive() {
        guard let repo = liveRepo, let userId = liveUserId else { return }
        activateLive(repo: repo, userId: userId)
    }

    func activateLive(repo: WorkerShiftsRepository, userId: String) {
        liveRepo = repo
        liveUserId = userId
        guard !live else { return }
        live = true
        liveTask = Task { [weak self] in
            // Initial snapshot + a fresh one on every Realtime change (RLS-scoped). Pass
            // the business `now` (SimClock-resolved) so a time-travelled window matches the
            // displayed weeks — SKIE did NOT default the new Kotlin `now` param.
            for await snapshot in repo.observeWorkerWeek(userId: userId, now: DemoFactory.shared.now()) {
                guard let self else { return }
                self.vm = DemoFactory.shared.shiftsViewModel(snapshot: snapshot)
                self.weeklyHours = DemoFactory.shared.weeklyHoursFor(snapshot: snapshot)
                // subscribe() pushes the fresh shifts to the home-screen widgets.
                self.subscribe()
            }
        }
    }

    /// Discard a failed optimistic move by rebuilding the VM from a fresh server fetch.
    /// A failed write left the DB unchanged, so no Realtime emission arrives to reconcile
    /// the UI on its own — this re-reads server truth and rebuilds (the dropped/claimed
    /// card snaps back). Best-effort: a failed re-fetch leaves the optimistic move until
    /// the next Realtime change.
    func revertToServer(repo: WorkerShiftsRepository, userId: String) async {
        guard let snapshot = try? await repo.fetchWorkerWeek(userId: userId, now: DemoFactory.shared.now()) else { return }
        self.vm = DemoFactory.shared.shiftsViewModel(snapshot: snapshot)
        self.weeklyHours = DemoFactory.shared.weeklyHoursFor(snapshot: snapshot)
        self.subscribe()
    }

    deinit {
        task?.cancel()
        liveTask?.cancel()
    }
}

/// Observes the Personal-Calendar `StateFlow` (its `selectDay` mutates state, so —
/// unlike the static Updates feed — it must be observed). The live host calls
/// `activateLive` to overlay the worker's closed-house days (§3.4/§11.3, T2-12c):
/// it fetches the Mon..Sun closed indexes via the `house_closure` RPC and swaps in
/// a VM built with them (re-subscribing the observation).
@MainActor
final class CalendarObservable: ObservableObject {
    private(set) var vm: CalendarViewModel
    @Published var state: CalendarUiState
    private var task: Task<Void, Never>?
    private var live = false

    init(vm: CalendarViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        subscribe()
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    /// Live host: fetch the worker's closed-house day indexes (best-effort; an empty
    /// set keeps the demo VM) and rebuild the calendar VM with them. `DemoFactory`
    /// supplies `now` Kotlin-side; the Set flows Kotlin→Swift→Kotlin opaquely.
    // Foreground lifecycle gate — see ShiftsObservable.suspendLive (cost audit F-11).
    // This observable is the reason F-11 mattered most: it collected the SAME
    // observeWorkerWeek flow as ShiftsObservable, so iOS held two Realtime channels and
    // ran two refetch loops per worker. The repository now shares one flow between them;
    // this gate stops both while backgrounded.
    private var liveRepo: WorkerShiftsRepository?
    private var liveUserId: String?

    func suspendLive() {
        liveTask?.cancel()
        liveTask = nil
        live = false
    }

    func resumeLive() {
        guard let repo = liveRepo, let userId = liveUserId else { return }
        activateLive(repo: repo, userId: userId)
    }

    func activateLive(repo: WorkerShiftsRepository, userId: String) {
        liveRepo = repo
        liveUserId = userId
        guard !live else { return }
        live = true
        liveTask = Task { [weak self] in
            // D8 — the calendar reads the REAL week too (closed days overlaid once).
            let closed = (try? await repo.fetchCalendarClosedDays(userId: userId)) ?? Set()
            for await snapshot in repo.observeWorkerWeek(userId: userId, now: DemoFactory.shared.now()) {
                guard let self else { return }
                // Re-read pending swaps per tick so an accept/decline (which fires a realtime
                // assignment change) reconciles the My-Shifts swap marks to server truth.
                let swaps = (try? await repo.fetchPendingSwaps()) ?? []
                self.vm = DemoFactory.shared.calendarViewModel(snapshot: snapshot, closedDayIndexes: closed, pendingSwaps: swaps)
                self.subscribe()
            }
        }
    }

    /// Re-read the worker's week from server truth after a failed optimistic drop/swap, so the
    /// card returns to the agenda. Best-effort: a failed fetch leaves the optimistic move.
    func refreshFromServer(repo: WorkerShiftsRepository, userId: String) async {
        let closed = (try? await repo.fetchCalendarClosedDays(userId: userId)) ?? Set()
        let swaps = (try? await repo.fetchPendingSwaps()) ?? []
        guard let snapshot = try? await repo.fetchWorkerWeek(userId: userId, now: DemoFactory.shared.now()) else { return }
        self.vm = DemoFactory.shared.calendarViewModel(snapshot: snapshot, closedDayIndexes: closed, pendingSwaps: swaps)
        self.subscribe()
    }

    /// The accept/decline popup model for a tapped INCOMING-swap card (nil for outgoing).
    func decisionFor(_ swapId: String) -> SwapDecision? { vm.decisionFor(swapId: swapId) }

    /// Optimistically drop a swap mark after accept/decline so its card un-tints at once.
    func resolveSwap(_ swapId: String) {
        vm.resolveSwap(swapId: swapId)
        state = vm.uiState.value
    }

    private var liveTask: Task<Void, Never>?

    deinit { task?.cancel() }
}

/// Holds the Updates-tab `UpdatesViewModel`. Demo by default; the backend-configured
/// host calls `activateLive` (mirroring the Android `MainActivity` live wiring): it
/// loads the worker's real `notifications` rows (RLS-scoped) and swaps the demo VM for
/// a live one. A `float_assigned` notification row now maps to the urgent FLOAT entry
/// that opens the §7 ack hero; `withPendingFloatEntry` (via the DemoFactory overload)
/// additionally guarantees the live pending float is reachable even if its notification
/// row hasn't landed. The feed is static (no in-VM mutation), so this just republishes.
@MainActor
final class UpdatesObservable: ObservableObject {
    @Published private(set) var feed: UpdatesFeed
    private var vm: UpdatesViewModel
    private var live = false

    var hasUnread: Bool { vm.uiState.value.hasUnread }

    init(vm: UpdatesViewModel) {
        self.vm = vm
        self.feed = vm.uiState.value.feed
    }

    /// Live host: load the real notifications + the worker's pending float + incoming
    /// pending swaps (§8.2, T3a), rebuild the VM (merging the pending-float + swap
    /// entries), republish the feed. Falls back to the demo feed (no swap) when the
    /// notifications fetch fails. `DemoFactory` supplies `now` Kotlin-side so we avoid
    /// bridging a `kotlin.time.Instant`.
    func activateLive(repo: WorkerShiftsRepository, userId: String) async {
        guard !live else { return }
        live = true
        guard let items = try? await repo.fetchNotifications(userId: userId) else { return }
        let float = try? await repo.fetchPendingFloat(userId: userId)
        let swaps = (try? await repo.fetchIncomingSwaps(userId: userId)) ?? []
        vm = DemoFactory.shared.updatesViewModel(notifications: items, float: float ?? nil, swaps: swaps)
        feed = vm.uiState.value.feed
    }

    /// Re-read the feed from server truth (e.g. after acting on a swap in the Swaps tab so
    /// the mirror clears). Same fetch as `activateLive`, minus the `!live` guard.
    func refreshFromServer(repo: WorkerShiftsRepository, userId: String) async {
        guard let items = try? await repo.fetchNotifications(userId: userId) else { return }
        let float = try? await repo.fetchPendingFloat(userId: userId)
        let swaps = (try? await repo.fetchIncomingSwaps(userId: userId)) ?? []
        vm = DemoFactory.shared.updatesViewModel(notifications: items, float: float ?? nil, swaps: swaps)
        feed = vm.uiState.value.feed
    }

    /// Optimistic "Mark all read" (T2-8): flip every unread item to read in the shared VM,
    /// republish the regrouped feed, and return the ids that were unread for the live host
    /// to persist via the `mark_notification_read` RPC. Idempotent (empty when nothing unread).
    @discardableResult
    func markAllRead() -> [String] {
        let ids = vm.markAllRead()
        feed = vm.uiState.value.feed
        return ids
    }

    /// Optimistic resolution of an incoming swap mirror (DESIGN §6) — kept so the host can
    /// clear the Updates mirror after the worker acts in the Swaps tab.
    func resolveSwap(_ swapId: String) {
        vm.resolveSwap(swapId: swapId)
        feed = vm.uiState.value.feed
    }

    /// Optimistic resolution of an off-hours Allied-page ladder alert (staggered-rollout
    /// pilot): the worker tapped "I've called the desk", so the row leaves the feed.
    func acknowledgeAlliedPage(_ blockId: String) {
        vm.acknowledgeAlliedPage(blockId: blockId)
        feed = vm.uiState.value.feed
    }
}

/// Holds the Swaps-tab `SwapsViewModel` (DESIGN §6) — the dedicated Incoming / Outgoing
/// review surface. Demo by default; the live host calls `activateLive` to load the
/// worker's real pending `swap_requests` rows. Mirrors `HouseObservable` (subscribes to
/// the VM's `StateFlow`); the optimistic accept/decline/cancel mutate the VM and the
/// subscription republishes.
@MainActor
final class SwapsObservable: ObservableObject {
    private(set) var vm: SwapsViewModel
    @Published var state: SwapsUiState
    private var task: Task<Void, Never>?
    private var live = false

    init(vm: SwapsViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        subscribe()
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    func activateLive(repo: WorkerShiftsRepository, userId: String) async {
        guard !live else { return }
        live = true
        let pending = (try? await repo.fetchPendingSwaps()) ?? []
        vm = DemoFactory.shared.swapsViewModel(pendingSwaps: pending)
        subscribe()
    }

    /// Re-read the enriched pending swaps after an action so the lists reconcile.
    func refreshFromServer(repo: WorkerShiftsRepository, userId: String) async {
        let pending = (try? await repo.fetchPendingSwaps()) ?? []
        vm = DemoFactory.shared.swapsViewModel(pendingSwaps: pending)
        subscribe()
    }

    func selectTab(_ t: SwapsTab) { vm.selectTab(tab: t) }
    func resolveIncoming(_ id: String) { vm.resolveIncoming(swapId: id) }
    func cancelOutgoing(_ id: String) { vm.cancelOutgoing(swapId: id) }
    func addOutgoing(_ proposal: SwapProposal) { vm.addOutgoing(proposal: proposal) }

    deinit { task?.cancel() }
}

/// Holds the float-ack `AckDeclineViewModel`. Demo by default; the backend-configured
/// host calls `activateLive` (mirroring the Android `MainActivity` live wiring): it
/// loads the worker's live pending float (own `float_assignments` row + own pending
/// float-out blocks, both RLS-scoped) and swaps the demo VM for a live one. Falls back
/// to the demo float (no swap) while the read is in flight or when none is outstanding.
@MainActor
final class AckHostObservable: ObservableObject {
    @Published private(set) var vm: AckDeclineViewModel
    private var live = false

    init() {
        self.vm = DemoFactory.shared.ackViewModel()
    }

    /// Live host: load the worker's pending float, rebuild the VM. `DemoFactory`
    /// supplies `now` Kotlin-side so we avoid bridging a `kotlin.time.Instant`.
    func activateLive(repo: WorkerShiftsRepository, userId: String) async {
        guard !live else { return }
        live = true
        guard let float = try? await repo.fetchPendingFloat(userId: userId) else { return }
        vm = DemoFactory.shared.ackViewModel(float: float)
    }

    /// Re-read the pending float after a failed optimistic ack/decline so the modal
    /// returns to its server phase (PENDING) and the worker can retry. Same fetch as
    /// `activateLive`, minus the `!live` guard.
    func refreshFromServer(repo: WorkerShiftsRepository, userId: String) async {
        guard let float = try? await repo.fetchPendingFloat(userId: userId) else { return }
        vm = DemoFactory.shared.ackViewModel(float: float)
    }
}

/// Holds the My-Shifts float-request carousel (§7.1) — the closest-first stack of the
/// worker's outstanding floats. Builds a `FloatCarouselViewModel` from a list of
/// `PendingFloat` (live `fetchPendingFloats` or `DemoData.pendingFloats`) and observes
/// its `StateFlow`. Accept/Decline are the SAME local advance (the host POSTs
/// `acknowledge-float` / `decline-float`); `allHandled` flips true only when the LAST
/// float resolves, which the host turns into the "all handled" confirmation toast.
/// Mirrors Android's `carouselVm` wiring in `ShiftsScreen`.
@MainActor
final class FloatCarouselObservable: ObservableObject {
    private(set) var vm: FloatCarouselViewModel
    /// The floats the VM was built from — tapping a card resolves its `PendingFloat` to
    /// open the full ack hero for THAT float.
    private(set) var floats: [PendingFloat]
    private(set) var recentFloats: [RecentFloat]
    @Published var state: FloatCarouselUiState
    private var task: Task<Void, Never>?

    init(floats: [PendingFloat], recentFloats: [RecentFloat] = []) {
        self.floats = floats
        self.recentFloats = recentFloats
        let vm = FloatCarouselViewModel(floats: floats, now: DemoFactory.shared.now(), recentFloats: recentFloats)
        self.vm = vm
        self.state = vm.uiState.value
        subscribe()
        WidgetSync.update(pendingFloats: floats)
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    /// Rebuild the VM from a fresh float list (the live `fetchPendingFloats` read). A new
    /// `now` is sampled so the cards' respondable/deadline state is decided at load time.
    func rebuild(floats: [PendingFloat], recentFloats: [RecentFloat] = []) {
        self.floats = floats
        self.recentFloats = recentFloats
        vm = FloatCarouselViewModel(floats: floats, now: DemoFactory.shared.now(), recentFloats: recentFloats)
        subscribe()
        // Keep the home-screen float banner in step with the in-app carousel.
        WidgetSync.update(pendingFloats: floats)
    }

    func acknowledge(_ floatId: String) { vm.acknowledge(floatId: floatId) }
    func decline(_ floatId: String) { vm.decline(floatId: floatId) }

    /// The `PendingFloat` for a tapped card, so the host can open the ack hero on it.
    func float(_ floatId: String) -> PendingFloat? { floats.first { $0.floatId == floatId } }

    deinit { task?.cancel() }
}

private enum Tab: Int { case mine, openShifts, house, updates, preferences, breakShifts, settings, swaps, assistant }

/// Observes the §11.4 house-schedule `StateFlow` (T3b), now week-paged (last week … +4).
/// Demo by default; the live host calls `activateLive` to swap in the worker's real
/// `house_schedule_grid` snapshot. On every week change the view's `.task(id:weekOffset)`
/// calls `loadWeek`, which fetches that week's grid (live) or generates the demo week and
/// feeds it to the VM (`setWeekSeats`) — exactly like the swap calendar.
@MainActor
final class HouseObservable: ObservableObject {
    private(set) var vm: HouseScheduleViewModel
    @Published var state: HouseScheduleUiState
    private var task: Task<Void, Never>?
    private var live = false
    private var repo: WorkerShiftsRepository?
    private var userId: String?
    /// The signed-in user holds a schedule-manager role (sm/hm/bm/rsm). Threaded into the
    /// live VM so `canManage` gates the House-grid open-seat actions (best-effort; false
    /// on the demo path and on a failed profile read).
    private var isManager = false

    init(vm: HouseScheduleViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        subscribe()
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    /// The pickable houses for the switcher (2026-06-23 cross-house ruling): live
    /// `fetchHouses`, demo list otherwise. The switcher defaults to the home house.
    func loadHouses() async {
        let houses: [HouseOption]
        if let repo {
            houses = (try? await repo.fetchHouses()) ?? []
        } else {
            houses = DemoFactory.shared.houses()
        }
        if !houses.isEmpty { vm.setHouses(options: houses) }
    }

    /// Supply the shown house+week's seats: live fetch on the backend path, the
    /// deterministic demo week otherwise. `setWeekSeats` ignores a stale fetch (the user
    /// navigated to another week OR switched houses).
    func loadWeek() async {
        let off = vm.uiState.value.weekOffset
        let anchor = vm.uiState.value.anchor
        guard let houseId = vm.uiState.value.selectedHouseId else { return }
        let seats: [HouseSeat]
        if let repo {
            seats = (try? await repo.fetchHouseGridForWeek(houseId: houseId, anchor: anchor))?.seats ?? []
        } else {
            seats = DemoFactory.shared.houseWeekSeats(anchor: anchor, isHome: houseId == DemoFactory.shared.demoHomeHouseId)
        }
        vm.setWeekSeats(forHouseId: houseId, forOffset: off, seats: seats)
    }

    func prevWeek() { vm.previousWeek() }
    func nextWeek() { vm.nextWeek() }
    func selectWeek(_ offset: Int) { vm.selectWeek(offset: Int32(offset)) }
    func selectHouse(_ houseId: String) { vm.selectHouse(houseId: houseId) }

    func activateLive(repo: WorkerShiftsRepository, userId: String, isManager: Bool) async {
        guard !live else { return }
        live = true
        self.repo = repo
        self.userId = userId
        self.isManager = isManager
        guard let snapshot = try? await repo.fetchHouseSchedule(userId: userId) else { return }
        // Build the live VM directly (rather than via DemoFactory) so the manager flag can be
        // threaded; `now` still comes Kotlin-side via DemoFactory to avoid bridging an Instant.
        vm = HouseScheduleViewModel(snapshot: snapshot, now: DemoFactory.shared.now(), meUserId: userId, isManager: isManager)
        subscribe()
        await loadHouses()
        await loadWeek()
    }

    deinit { task?.cancel() }
}

struct ShiftsRootView: View {
    /// Optional sign-out hook from the live host (demo passes nil → no-op).
    var onSignOut: () -> Void = {}
    /// The authenticated worker's id on the backend-configured path (nil in demo).
    /// When set, the Preferences tab loads the worker's real period and submits live.
    var liveUserId: String? = nil

    // Drives the foreground gate on the two live worker-week collectors (cost audit
    // F-11). The app-level scenePhase observer in iOSApp.swift handles only the sim
    // clock; the teardown belongs here, where the observables live.
    @Environment(\.scenePhase) private var scenePhase

    @StateObject private var model = ShiftsObservable(vm: DemoFactory.shared.shiftsViewModel())
    @StateObject private var calendarModel = CalendarObservable(vm: DemoFactory.shared.calendarViewModelWithSwaps())
    @StateObject private var houseModel = HouseObservable(vm: DemoFactory.shared.houseScheduleViewModel())
    @StateObject private var prefsModel = PreferencesObservable(vm: DemoFactory.shared.preferencesViewModel())
    @StateObject private var breakModel = BreakCalendarObservable(vm: DemoFactory.shared.breakCalendarViewModel())
    @StateObject private var settingsModel = SettingsObservable(vm: DemoFactory.shared.settingsViewModel())
    @StateObject private var ackModel = AckHostObservable()
    @StateObject private var updatesModel = UpdatesObservable(vm: DemoFactory.shared.updatesViewModel())
    @StateObject private var swapsModel = SwapsObservable(vm: DemoFactory.shared.swapsViewModel())
    @StateObject private var assistantModel = AssistantObservable()
    // Onboarding — the first-run welcome tour + one-time contextual tips. The shared
    // OnboardingViewModel sequences everything; this wrapper seeds it from the persisted
    // seen-keys and persists on change. See Onboarding.swift.
    @StateObject private var onboardingModel = OnboardingObservable()
    // The interactive "Manage a shift" tour (replaces the old My-Shifts contextual tip).
    // Own seen-key store; auto-opens on the first My-Shifts landing after the welcome tour,
    // re-openable from the header "?" and the Settings row. See ShiftTourView.swift.
    @StateObject private var shiftTourModel = ShiftTourObservable()
    // One-shot pointer callout on the header "?" after the tour first finishes (auto-fades).
    @State private var showTourPointer = false
    // Five more interactive tours, same shape as shiftTourModel — each with its own
    // seen-key store, each superseding a plain Tier-2 tip (or, for Swap/House grid, adding
    // teaching that didn't exist before). See docs/design/interactive-onboarding-pattern.md.
    @StateObject private var preferencesTourModel = PreferencesTourObservable()
    @State private var showPreferencesTourPointer = false
    @StateObject private var breakTourModel = BreakTourObservable()
    @State private var showBreakTourPointer = false
    @StateObject private var swapTourModel = SwapTourObservable()
    @State private var showSwapTourPointer = false
    @StateObject private var houseGridTourModel = HouseGridTourObservable()
    @State private var showHouseGridTourPointer = false
    @StateObject private var openClaimTourModel = OpenClaimTourObservable()
    @State private var showOpenClaimTourPointer = false
    // §7.1 — the My-Shifts float-request carousel. Demo-seeded (two floats) so the swipe +
    // completion are visible in the login-bypass build; the live host rebuilds it from the
    // worker's real `worker_pending_floats` read in `.task`.
    @StateObject private var floatCarouselModel = FloatCarouselObservable(
        floats: DemoData().pendingFloats(now: DemoFactory.shared.now()),
        recentFloats: DemoData().recentFloats(now: DemoFactory.shared.now()))
    @Environment(\.colorScheme) private var scheme

    @State private var tab: Tab = .mine
    // Open-Shifts sub-tab: 0 = My House, 1 = Others.
    @State private var openSub = 0
    // Others-tab grouping: by house (Quad, DuBois, …) or by weekday (Mon, Tue, …).
    @State private var openSort: OpenShiftSort = .byHouse
    // Collapsed Others-tab group keys (house id or "dow-N"); absent = expanded.
    @State private var collapsedGroups: Set<String> = []
    // §4 save-safety — a tab switch requested while Preferences has unsaved edits is
    // deferred here until the guard dialog resolves it.
    @State private var pendingTab: Tab?
    // The Assistant has no bottom-bar item of its own (it opens from the My-Shifts FAB or
    // the More sheet, from whichever tab the worker was on), so its back button needs
    // somewhere to return to. Captured in `openAssistant()`, not derived from `tab` later,
    // since `tab` is already `.assistant` by the time the Assistant's own header renders.
    @State private var previousBeforeAssistant: Tab = .mine
    @State private var dropTarget: MyShift?
    @State private var claimTarget: OpenShift?
    @State private var showAck = false
    // §7.1 — the float the worker tapped in the carousel to see in the full ack hero.
    // Identified so `.sheet(item:)` presents it; nil = no detail open.
    @State private var floatDetail: IdentifiedFloatDetail?
    // The success toast after a claim / permanent pickup; carries the "Picked up X of Y
    // weeks" message for a pickup, the fixed claim message otherwise. Nil = no toast.
    @State private var claimSuccessMessage: String?
    // Non-nil when a best-effort live write (drop/claim/reclaim/pickup) failed to reach
    // the server. Surfaced as a top error toast (so a swallowed EF failure no longer
    // masquerades as success) and auto-cleared; the optimistic card is reverted to
    // server truth via `model.revertToServer`.
    @State private var writeError: String?
    @State private var swapProposed = false
    /// How long a transient toast stays on screen, in nanoseconds — derived from the shared
    /// `TOAST_DURATION_MS` single source of truth so both platforms match.
    private var toastDurationNanos: UInt64 { UInt64(WriteFeedbackKt.TOAST_DURATION_MS) * 1_000_000 }
    // Incoming-swap accept/decline popup, opened from a flagged My-Shifts card.
    @State private var decisionTarget: IdentifiedSwapDecision?
    // OUTGOING-swap "swap pending" notice (cancel / keep waiting), opened from a flagged
    // My-Shifts card — replaces the drop sheet for a shift tied up in a swap you proposed.
    @State private var pendingNotice: IdentifiedPendingSwapNotice?
    // D5 — week-picker sheet (Calendar tab).
    @State private var showWeekPicker = false
    // Open-Shifts week-picker sheet + the collapsed "Earlier this week" past card.
    @State private var showOpenWeekPicker = false
    @State private var pastOpenExpanded = false
    // My-Shifts week overview: the collapsed "Earlier this week" card that folds away the
    // ongoing week's already-passed days (collapsed by default).
    @State private var pastDaysExpanded = false
    // The bottom-bar "More" overflow sheet (episodic destinations).
    @State private var showMore = false
    // T2-13 — push/deep-link routed full-screen ack (AppDelegate / onOpenURL set it).
    @ObservedObject private var deepLink = DeepLinkRouter.shared
    // Notification priming — the pre-permission primer shown after the welcome tour.
    // `notifOsCanPrompt` is resolved asynchronously (UNUserNotificationCenter settings)
    // once the tour is done; `notifPrimerResponded` is the once-per-install guard.
    @State private var notifPrimerResponded = NotificationPrimingStore.hasResponded()
    @State private var notifOsCanPrompt = false

    /// Run a best-effort live write and surface failure instead of swallowing it. `op`
    /// returns whether the EF accepted the write (`EdgeResult.ok`); on failure the error
    /// toast is raised, `onFailure` runs (e.g. clear a success flag), and — when `revert`
    /// — the optimistic My-Shifts move is rolled back to server truth. The task is
    /// `@MainActor`-isolated so UI mutations stay on the main thread; the `await op()`
    /// network call still suspends off the UI. Mirrors Android's `launchWrite`.
    ///
    /// `reconcile` re-reads server truth after a SUCCESSFUL write too (audit F9). Relying
    /// on Realtime alone has a structural hole: `postgres_changes` applies RLS to the NEW
    /// row, so when a concurrent writer reassigns a seat away from this worker the row
    /// leaves their scope and no event is delivered at all. The optimistic card would then
    /// survive indefinitely, showing a shift the server has already handed to someone
    /// else. A pull after the write sees current truth either way. Left off for writes
    /// that touch no seat.
    private func liveWrite(
        _ writeOp: WriteOp,
        revert: Bool = true,
        reconcile: Bool = true,
        onFailure: @escaping () async -> Void = {},
        _ op: @escaping () async -> EdgeResult?
    ) {
        Task { @MainActor in
            let result = await op() ?? EdgeResult(ok: false, status: 0, body: "")
            if !result.ok {
                // Descriptive, classified copy (the server's error code → human message)
                // instead of a single generic "couldn't reach the server".
                writeError = WriteFeedbackKt.edgeErrorMessage(op: writeOp, result: result)
                await onFailure()
                if revert, let uid = liveUserId {
                    await model.revertToServer(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                }
            } else if reconcile, let uid = liveUserId {
                await model.revertToServer(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                await calendarModel.refreshFromServer(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
            }
        }
    }

    /// Boolean variant for non-EF writes (Postgrest direct: opt-out / broadcast toggle),
    /// which either complete or throw. A failure classifies off a status-0 result (offline
    /// copy) with the op's verb — mirrors Android's `launchWriteBool`.
    private func liveWriteBool(
        _ writeOp: WriteOp,
        revert: Bool = true,
        reconcile: Bool = false,
        onFailure: @escaping () async -> Void = {},
        _ op: @escaping () async -> Bool
    ) {
        liveWrite(writeOp, revert: revert, reconcile: reconcile, onFailure: onFailure) {
            (await op()) ? EdgeResult(ok: true, status: 200, body: "") : EdgeResult(ok: false, status: 0, body: "")
        }
    }

    /// Revert a failed break claim/drop by re-reading the live pool from the server.
    private func revertBreak() async {
        guard let uid = liveUserId else { return }
        await breakModel.refreshFromServer(
            shiftsRepo: WorkerBackend.shared.shiftsRepository,
            breakRepo: WorkerBackend.shared.breakRepository,
            userId: uid
        )
    }

    /// Revert a failed ack/decline by re-reading the pending float (modal → PENDING).
    private func revertAck() async {
        guard let uid = liveUserId else { return }
        await ackModel.refreshFromServer(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
    }

    /// Revert a failed swap accept/reject/void by re-reading the Updates feed.
    private func revertUpdates() async {
        guard let uid = liveUserId else { return }
        await updatesModel.refreshFromServer(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
    }

    /// Revert a failed drop by re-reading the calendar week (the dropped card returns to
    /// the agenda; the open-feed entry is rolled back via `model.revertToServer`).
    private func revertCalendar() async {
        guard let uid = liveUserId else { return }
        await calendarModel.refreshFromServer(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
    }

    /// The break CALENDAR — rendered outside the shared ScrollView so its bottom action bar
    /// pins above the nav and the grid scrolls within its own area.
    private var breakTab: some View {
        BreakCalendarScreen(
            model: breakModel,
            // Live host POSTs the dragged block ids → `break-claim` (its claim_break_blocks
            // RPC claims one open seat per block, FCFS/cap/Harnwell-trimmed server-side) while
            // the picker did the optimistic move; reconcile to the server's ACTUAL claimed
            // seats. demo (liveUserId == nil) = local-only.
            onClaimRange: liveUserId == nil ? nil : { blockIds in
                guard !blockIds.isEmpty else { return }
                let repo = WorkerBackend.shared.shiftsRepository
                let vm = breakModel.vm
                Task { @MainActor in
                    let result = try? await repo.claimBreakRange(blockIds: blockIds)
                    if let claimed = result?.claimedAssignmentIds, !claimed.isEmpty {
                        vm.reconcileClaim(claimedAssignmentIds: claimed)
                    } else {
                        // Claiming NOTHING (window closed / all taken / EF rejected): the server
                        // returns 200 with an empty list, so there is no error code to classify —
                        // describe the likely reasons and revert.
                        writeError = "Couldn't claim those break shifts. The sign-up window may be closed, or they were just taken."
                        await revertBreak()
                    }
                }
            },
            // POST ONE `drop-shift` covering the run's seats (no break-specific RPC).
            onDropSeats: liveUserId == nil ? nil : { seatIds in
                guard !seatIds.isEmpty else { return }
                let repo = WorkerBackend.shared.shiftsRepository
                liveWrite(.breakDrop, revert: false, onFailure: revertBreak) {
                    try? await repo.dropBlocks(assignmentIds: seatIds)
                }
            },
            // Live host writes the §4.4 "no break hours" opt-out (own `break_optouts` row)
            // DIRECTLY via Postgrest while the picker flips its optimistic state; demo =
            // local-only. On failure toast + flip the toggle back.
            onToggleOptOut: liveUserId == nil ? nil : { optedOut in
                guard let uid = liveUserId, let bid = breakModel.vm.breakId else { return }
                let repo = WorkerBackend.shared.breakRepository
                liveWriteBool(.preferences, revert: false, onFailure: { _ = breakModel.vm.toggleOptedOut() }) {
                    (try? await repo.setBreakOptOut(userId: uid, breakId: bid, optedOut: optedOut)) != nil
                }
            },
            onReplayTour: { breakTourModel.replay() }
        )
    }

    /// True once the first-run welcome tour has finished or been skipped (the shared
    /// predicate flips to "no longer show the tour").
    private var onboardingTourDone: Bool {
        !Onboarding.shared.shouldShowWelcomeTour(seen: onboardingModel.state.seen)
    }

    /// If the tour is done and the worker has not responded to the primer yet, ask the OS
    /// whether a prompt would still surface (never-asked), so the primer can appear.
    private func refreshNotifPrimerEligibility() {
        guard onboardingTourDone, !notifPrimerResponded else { return }
        NotificationAuthorizer.osCanPrompt { notifOsCanPrompt = $0 }
    }

    /// Auto-starts the interactive tour for whichever root tab is currently showing, once the
    /// first-run welcome tour is done. Shared by the initial landing (`.onAppear`, since the
    /// default tab is `.mine` and SwiftUI's `onChange` never fires for an unchanged initial
    /// value), by tab changes, and by the welcome tour finishing while already parked on a tab.
    private func autoStartTourForCurrentTab() {
        guard onboardingTourDone else { return }
        switch tab {
        case .mine: shiftTourModel.autoStart()
        case .openShifts: openClaimTourModel.autoStart()
        case .house: houseGridTourModel.autoStart()
        case .preferences: preferencesTourModel.autoStart()
        default: break
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // §4.4 — while a break's claim window is open, promote the Break calendar with a
            // visible banner from every other tab (it otherwise lives in the More overflow).
            if breakModel.state.phase == .claimWindow && tab != .breakShifts {
                BreakOpenBanner(breakName: breakModel.state.breakName) { tab = .breakShifts }
            }
            // The break calendar and the House grid manage their OWN scroll + a bottom bar
            // pinned above the nav, so they render OUTSIDE the shared ScrollView (the grid is
            // a bounded scroll window with its week navigator pinned to the screen bottom);
            // every other tab scrolls as one page.
            Group {
                if tab == .breakShifts {
                    breakTab
                } else if tab == .house {
                    houseTab
                } else if tab == .assistant {
                    AssistantTabView(model: assistantModel, onBack: { requestTab(previousBeforeAssistant) })
                } else if tab == .preferences {
                    // Preferences owns its own bounded scroll window (pinned header + a
                    // scrolling timeline), so it renders OUTSIDE the shared page ScrollView.
                    // Nesting it inside was the scroll-vs-paint bug: the paint canvas locks
                    // the scroll view it sits in, but an OUTER scroll view stayed free to pan,
                    // so a drag on the grid scrolled the page and never painted.
                    PreferencesScreen(model: prefsModel, onReplayTour: { preferencesTourModel.replay() })
                } else {
                    ScrollView {
                        switch tab {
                        // "My Shifts" is the chronological Personal Calendar; "Open Shifts"
                        // collapses the two open feeds under a My-House / Others sub-tab.
                        case .mine: calendarTab
                        case .openShifts: openShiftsTab
                        case .house: EmptyView() // rendered above, outside the ScrollView
                        case .updates: updates
                        case .swaps: swapsTab
                        case .preferences: EmptyView() // rendered above, outside the ScrollView
                        case .breakShifts: EmptyView() // rendered above, outside the ScrollView
                        case .assistant: EmptyView() // rendered above, outside the ScrollView
                        case .settings: SettingsScreen(
                            model: settingsModel,
                            onSignOut: onSignOut,
                            // Live host PATCHes `users-broadcast-subscription` while the settings
                            // VM does the optimistic local toggle; demo (liveUserId == nil) =
                            // local-only. The EF 403s an HM/BM subscribe → toast + flip back.
                            onToggleBroadcast: liveUserId == nil ? nil : { subscribed in
                                guard let uid = liveUserId else { return }
                                let repo = WorkerBackend.shared.profileRepository
                                liveWrite(.broadcast, revert: false, reconcile: false, onFailure: { settingsModel.vm.toggleBroadcast() }) {
                                    try? await repo.setBroadcastSubscription(userId: uid, subscribed: subscribed)
                                }
                            },
                            onReplayTour: { onboardingModel.replay() },
                            onReplayShiftTour: {
                                requestTab(.mine)
                                shiftTourModel.replay()
                            },
                            onReplayPreferencesTour: {
                                requestTab(.preferences)
                                preferencesTourModel.replay()
                            },
                            onReplayBreakTour: {
                                requestTab(.breakShifts)
                                breakTourModel.replay()
                            },
                            onReplaySwapTour: {
                                // The swap composer lives in a sheet, not a tab — priming it
                                // here means it fires the next time the worker reaches the
                                // swap page (see ManageShiftSheet's page==.swap gating).
                                requestTab(.mine)
                                swapTourModel.replay()
                            },
                            onReplayHouseGridTour: {
                                requestTab(.house)
                                houseGridTourModel.replay()
                            },
                            onReplayOpenClaimTour: {
                                requestTab(.openShifts)
                                openClaimTourModel.replay()
                            }
                        )
                        }
                    }
                }
            }
            // Toasts now sit at the BOTTOM (above the tab bar) — the intuitive place
            // for transient confirmations, and clear of the notch / status bar.
            .overlay(alignment: .bottom) { toastStack }
            // The "Ask" affordance lives on the My-Shifts home screen ONLY. It used to ride
            // every tab, but a floating button that follows you everywhere is noise rather
            // than discoverability: it covers content on feeds and grids where the Assistant
            // isn't what you came to do. The Assistant stays reachable from "More" everywhere.
            // The first-run tour rings this button (on My Shifts, where the tour runs).
            .overlay(alignment: .bottomTrailing) {
                if tab == .mine {
                    AskAssistantButtonView { openAssistant() }
                        .padding(.trailing, 16)
                        .padding(.bottom, 14)
                }
            }

            // The week navigator lives at the BOTTOM (above the tab bar) on My Shifts.
            if tab == .mine {
                weekNavBar
            }
            // The Open-Shifts feeds get their OWN week navigator (last week … +4 weeks).
            if tab == .openShifts {
                openWeekNavBar
            }

            Divider()

            bottomBar
        }
        // Full-bleed black behind every tab, regardless of content height — short screens
        // (Settings/Preferences) used to leave the tail of the shared ScrollView unpainted,
        // falling through to the system default and reading grey/lighter next to the other
        // (content-filled) tabs that appeared black. One root paint keeps every tab identical.
        .background(ShiftColors.resolve(scheme).bg.ignoresSafeArea())
        // A dedicated, non-wrapping marker view carries this identifier — NOT the container
        // itself. Applying `.accessibilityIdentifier` directly to a plain VStack/ZStack that
        // wraps many interactive descendants causes SwiftUI to leak that identifier onto every
        // descendant accessibility element in the XCUITest tree (confirmed empirically: every
        // bottom-nav button reported `identifier == "shifts_screen"` instead of its own
        // `tab_my_shifts`/`tab_open_shifts`/etc), silently breaking every identifier-based
        // XCUITest query in the app. A real, independent leaf element (Color.clear) does not
        // have this problem.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("shifts_screen")
        }
        // The spotlight + coach-mark overlay, above the whole screen (tab bar included).
        // Anchors are collected from the tab items + Ask button via onboardingAnchor(_:).
        .overlayPreferenceValue(OnboardingAnchorKey.self) { anchors in
            GeometryReader { proxy in
                OnboardingOverlayView(
                    model: onboardingModel,
                    ringRect: { id in anchors[id].map { proxy[$0] } },
                    fullSize: proxy.size
                )
            }
        }
        // The interactive "Manage a shift" tour — replaces the plain My-Shifts tip. Above the
        // whole screen; auto-opens on the first My-Shifts landing (below) and on replay.
        .overlay {
            if shiftTourModel.state.active {
                // Tapping away is a quick "not now", not the natural finish the one-time
                // store gates on below -- always re-point at the header "?" so the worker
                // still learns where to pick the tour back up, every time this happens.
                ShiftTourView(
                    model: shiftTourModel,
                    onDismissOutside: {
                        showTourPointer = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                            showTourPointer = false
                        }
                    }
                )
                .transition(.opacity)
            }
        }
        // The one-time "look here" pointer at the header "?", positioned from its real
        // anchor (ShiftTourHelpAnchorKey) so it always lands on the actual button. Non-modal:
        // it floats above the now-fully-interactive My-Shifts screen and fades on its own.
        .overlayPreferenceValue(ShiftTourHelpAnchorKey.self) { anchor in
            GeometryReader { proxy in
                if showTourPointer, let anchor {
                    ShiftTourPointerCallout(targetRect: proxy[anchor], fullSize: proxy.size)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.25), value: showTourPointer)
        }
        // After the tour first finishes, point at the header "?" once so the re-entry point
        // is learned, then auto-fade it a few seconds later. Fires when the tour closes
        // (active -> false) and it is now done.
        .onChange(of: shiftTourModel.state.active) { active in
            if !active, shiftTourModel.isDone, !ShiftTourPointerStore.hasShown() {
                ShiftTourPointerStore.markShown()
                showTourPointer = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                    showTourPointer = false
                }
            }
        }
        // Four more interactive tours, identical shape to shiftTourModel's block above:
        // overlay the tour when active, a pointer callout at its own help "?" once it first
        // finishes. House grid / Open-shifts claim / Break supersede a plain Tier-2 tip (see
        // the .onChange(of: tab) / breakModel.state.phase triggers below); Preferences adds
        // teaching that had no tip before. Each is its own `ViewModifier` (below) rather than
        // an inline chain here — chaining all 12 overlay/onChange calls directly on `body`
        // pushed the Swift type-checker over its complexity limit ("unable to type-check this
        // expression in reasonable time"); one `.modifier(...)` call per tour keeps `body`'s
        // own chain short while each tour's own (much smaller) chain type-checks on its own.
        .modifier(PreferencesTourOverlay(model: preferencesTourModel, showPointer: $showPreferencesTourPointer))
        .modifier(BreakTourOverlay(model: breakTourModel, showPointer: $showBreakTourPointer))
        .modifier(HouseGridTourOverlay(model: houseGridTourModel, showPointer: $showHouseGridTourPointer))
        .modifier(OpenClaimTourOverlay(model: openClaimTourModel, showPointer: $showOpenClaimTourPointer))
        // Notification priming — once the welcome tour is done, explain WHY alerts matter
        // and (only on Confirm) fire the real OS permission request. Replaces the cold
        // launch-time request that used to fire in AppDelegate.
        .overlay {
            if NotificationPriming.shared.shouldShowPrimer(
                tourDone: onboardingTourDone,
                osCanPrompt: notifOsCanPrompt,
                alreadyResponded: notifPrimerResponded
            ) {
                NotificationPrimingCardView(
                    onConfirm: {
                        NotificationAuthorizer.request()
                        NotificationPrimingStore.markResponded()
                        notifPrimerResponded = true
                    },
                    onDismiss: {
                        NotificationPrimingStore.markResponded()
                        notifPrimerResponded = true
                    }
                )
            }
        }
        // Kick off the first-run tour, and raise one-time tips as the worker first reaches
        // each root-level surface (mirrors the Android LaunchedEffects). Also auto-starts the
        // current tab's interactive tour for the initial landing, since the default tab is
        // `.mine` and `.onChange(of: tab)` never fires for an unchanged initial value.
        .onAppear {
            onboardingModel.start()
            refreshNotifPrimerEligibility()
            autoStartTourForCurrentTab()
        }
        // When the tour finishes (or was already done for a returning worker), ask the OS
        // whether a notification prompt would still surface, so the primer can appear, and
        // auto-start the current tab's tour if the worker is still parked on it.
        .onChange(of: onboardingTourDone) { done in
            if done {
                refreshNotifPrimerEligibility()
                autoStartTourForCurrentTab()
            }
        }
        .onChange(of: tab) { newTab in
            switch newTab {
            case .mine:
                // The interactive shift tour supersedes the old My-Shifts tip. Gate on the
                // welcome tour being done so orientation and this teaching don't overlap.
                if onboardingTourDone { shiftTourModel.autoStart() }
            case .openShifts:
                // The claim tour supersedes the old Open-Shifts tip on iOS (its whole point
                // is teaching one-time vs permanent pickup, which the flat tip never covered).
                if onboardingTourDone { openClaimTourModel.autoStart() }
            case .house:
                // The House-grid tour supersedes the old flat "Call the desk" tip on iOS.
                if onboardingTourDone { houseGridTourModel.autoStart() }
            case .swaps: onboardingModel.vm.triggerTip(trigger: .incomingSwap)
            case .preferences:
                // No prior Tier-2 tip existed for Preferences; this is net-new teaching.
                if onboardingTourDone { preferencesTourModel.autoStart() }
            default: break
            }
        }
        .onChange(of: breakModel.state.phase) { phase in
            // The Break tour supersedes the old flat break-window tip on iOS.
            if phase == .claimWindow, onboardingTourDone { breakTourModel.autoStart() }
        }
        .onChange(of: floatCarouselModel.state.total) { total in
            if total > 0 { onboardingModel.vm.triggerTip(trigger: .floatRequest) }
        }
        .onChange(of: deepLink.requestedRoute) { route in
            // A widget tile asked to land on a specific tab.
            guard let route else { return }
            switch route {
            case .myShifts: requestTab(.mine)
            case .updates: requestTab(.updates)
            case .openShifts(let scope):
                openSub = (scope == .otherHouses) ? 1 : 0
                requestTab(.openShifts)
            }
            deepLink.requestedRoute = nil
        }
        .sheet(isPresented: $showMore) { moreSheet }
        .confirmationDialog(
            "Unsaved preferences",
            isPresented: Binding(get: { pendingTab != nil }, set: { if !$0 { pendingTab = nil } }),
            titleVisibility: .visible
        ) {
            // §4 save-safety — leaving Preferences with unsaved edits.
            Button("Save & leave") {
                let target = pendingTab
                prefsModel.submit()
                pendingTab = nil
                if let target { navigateTo(target) }
            }
            Button("Discard & leave", role: .destructive) {
                let target = pendingTab
                prefsModel.vm.revert()
                pendingTab = nil
                if let target { navigateTo(target) }
            }
            Button("Keep editing", role: .cancel) { pendingTab = nil }
        } message: {
            Text("You've changed your preferences but haven't saved them. Save them before leaving, or discard them.")
        }
        .sheet(item: $dropTarget) { shift in
            // ONE sheet, two in-place pages (manage ⇄ swap). Drop from the calendar agenda: the
            // dropped (sub)shift leaves the agenda (calendar VM) and becomes a vacant opening in
            // the Open-Shifts tabs (shifts VM). "Choose who to swap with" pages to the give/take
            // picker inside the SAME sheet (no dismiss-and-re-present).
            ManageShiftSheet(
                vm: model.vm,
                shift: shift,
                onDrop: { droppedShift, permanent in
                    // Optimistic two-VM move (demo + live).
                    calendarModel.vm.drop(blockIds: droppedShift.blockIds)
                    model.vm.dropToOpen(shift: droppedShift)
                    // Live host POSTs the real drop (best-effort); on failure surface the toast,
                    // revert the calendar (the card returns) + the open feed (model.revertToServer).
                    if liveUserId != nil {
                        let repo = WorkerBackend.shared.shiftsRepository
                        liveWrite(permanent ? .permanentDrop : .drop, onFailure: revertCalendar) {
                            if permanent {
                                return try? await repo.permanentDrop(shift: droppedShift)
                            } else {
                                return try? await repo.dropShift(shift: droppedShift)
                            }
                        }
                    }
                },
                swapKinds: swapKindsFor(shift: shift, breakProfile: false),
                meUserId: liveUserId,
                repo: liveUserId != nil ? WorkerBackend.shared.shiftsRepository : nil,
                demoSeats: houseModel.state.seats,
                // Drop the worker's already-pending shifts from the give pool (defensive — the
                // pinned give is never pending, but a give-picker must not offer one).
                pendingGiveAssignmentIds: calendarModel.vm.pendingGiveAssignmentIds(),
                onSubmitSwap: { proposals in
                    // Multi-party = INDEPENDENT LEGS (decision 2026-06-15): fire one
                    // `create-swap` per leg so one failing never affects the others. The
                    // server stays authoritative for §8 eligibility/conflicts.
                    if let uid = liveUserId {
                        let repo = WorkerBackend.shared.shiftsRepository
                        for proposal in proposals {
                            Task { @MainActor in
                                // "Swap proposed" + the Outgoing row show ONLY when the write
                                // actually lands; a failed write raises the red writeError toast.
                                // There is no Realtime on swap_requests, so refetch to surface
                                // the real, voidable row after the optimistic add.
                                let result = (try? await repo.createSwap(proposal: proposal)) ?? EdgeResult(ok: false, status: 0, body: "")
                                if result.ok {
                                    swapsModel.addOutgoing(proposal)
                                    await swapsModel.refreshFromServer(repo: repo, userId: uid)
                                    swapProposed = true
                                } else {
                                    writeError = WriteFeedbackKt.edgeErrorMessage(op: .proposeSwap, result: result)
                                }
                            }
                        }
                    } else {
                        // Demo: optimistically reflect each leg in the Swaps tab.
                        proposals.forEach { swapsModel.addOutgoing($0) }
                        swapProposed = true
                    }
                },
                swapTourModel: swapTourModel
            )
        }
        .sheet(item: $decisionTarget) { wrapped in
            SwapDecisionSheetView(
                decision: wrapped.decision,
                onAccept: {
                    calendarModel.resolveSwap(wrapped.decision.swapId) // optimistic: card un-tints
                    actOnSwap(wrapped.decision.swapId, accept: true)
                    decisionTarget = nil
                },
                onDecline: {
                    calendarModel.resolveSwap(wrapped.decision.swapId)
                    actOnSwap(wrapped.decision.swapId, accept: false)
                    decisionTarget = nil
                },
                onClose: { decisionTarget = nil }
            )
        }
        .sheet(item: $pendingNotice) { wrapped in
            PendingSwapNoticeSheetView(
                notice: wrapped.notice,
                onCancel: {
                    calendarModel.resolveSwap(wrapped.notice.swapId) // optimistic: card un-tints
                    voidSwap(wrapped.notice.swapId)
                    pendingNotice = nil
                },
                // "Keep waiting" and the corner ✕ both just minimise the card — no action.
                onClose: { pendingNotice = nil }
            )
        }
        .sheet(item: $claimTarget) { shift in
            ClaimFlowSheet(
                vm: model.vm,
                shift: shift,
                currentWeeklyHours: model.weeklyHours,
                // Live host GETs the `permanent-pickup` dry-run SCOPE for the "Picking up N of
                // M weeks · K skipped" confirmation; demo (no live user) → nil = plain note.
                loadPermanentScope: liveUserId == nil ? nil : { s in
                    let repo = WorkerBackend.shared.shiftsRepository
                    return try? await repo.permanentPickupScope(shift: s)
                },
                onConfirmed: { effective, message in
                    // Live host POSTs the real pickup (best-effort) while the ViewModel does the
                    // optimistic local pickup. A WEEKLY opening → `claim-shift` (per selected
                    // block — `effective` is the §5.3 partial selection, T2-10); a PERMANENT
                    // opening → the `permanent-pickup` EF (the real path — `claim-shift`'s
                    // permanent branch 501s). Server stays authoritative for cap/T-2h/FCFS and
                    // the multi-week §8.4.3 scope; the next Realtime snapshot reconciles. Demo =
                    // local-only.
                    model.vm.claim(shift: effective)
                    // Mirror the pickup into the calendar ("My Shifts") so the claimed shift
                    // shows in the agenda — and a re-pickup of a shift dropped here un-hides it.
                    calendarModel.vm.claim(shift: effective)
                    claimSuccessMessage = message // optimistic; the live path corrects it below
                    if liveUserId != nil {
                        let repo = WorkerBackend.shared.shiftsRepository
                        if effective.feed == .permanentOpening {
                            // Permanent pickup: on failure clear the optimistic toast, show the
                            // classified error and revert (shifts VM + calendar).
                            liveWrite(.permanentPickup, onFailure: { claimSuccessMessage = nil; await revertCalendar() }) {
                                try? await repo.permanentPickup(shift: effective)
                            }
                        } else {
                            // Weekly claim is per-block, so a coalesced card can land PARTIALLY
                            // (e.g. a sub-range overlapping an existing shift): full → accurate
                            // success; partial → an informative "claimed part of this shift" note
                            // (NOT a red failure — the bug this fixes); none → classified error.
                            Task { @MainActor in
                                let outcome = (try? await repo.claimShift(shift: effective)) ?? ClaimOutcome.companion.offline()
                                let toast = WriteFeedbackKt.claimToast(op: .claim, outcome: outcome, successMessage: message)
                                if toast.isError {
                                    claimSuccessMessage = nil
                                    writeError = toast.message
                                    await revertCalendar()
                                    if let uid = liveUserId {
                                        await model.revertToServer(repo: repo, userId: uid)
                                    }
                                } else {
                                    writeError = nil
                                    claimSuccessMessage = toast.message
                                    // Audit F9. A PARTIAL claim is not an error, but the
                                    // optimistic move added the WHOLE coalesced span and
                                    // pulled all of its blocks from the open feed, so the
                                    // worker would keep seeing blocks they do not hold.
                                    // claim-shift is one POST per block, so losing FCFS on
                                    // some of them is the expected concurrent outcome. Pull
                                    // server truth on every success, partial or not: a seat
                                    // taken from under this worker emits no Realtime event,
                                    // because the row leaves their RLS scope.
                                    await revertCalendar()
                                    if let uid = liveUserId {
                                        await model.revertToServer(repo: repo, userId: uid)
                                    }
                                }
                            }
                        }
                    }
                }
            )
        }
        .sheet(isPresented: $showAck) {
            ackSurface
        }
        .sheet(item: $floatDetail) { wrapped in
            // §7.1 — tapping a carousel card opens the existing full float-ack hero for THAT
            // float. Acting here POSTs the same EF AND advances the carousel stack (so the
            // resolved card drops), exactly like the on-card Accept/Decline.
            FloatAcknowledgmentView(
                vm: DemoFactory.shared.ackViewModel(float: wrapped.float.toFloatAck()),
                onAcknowledge: liveUserId == nil ? nil : { id in
                    acceptFloat(id)
                    floatCarouselModel.acknowledge(id)
                },
                onDecline: liveUserId == nil ? nil : { id in
                    declineFloat(id)
                    floatCarouselModel.decline(id)
                }
            )
        }
        .fullScreenCover(
            // T2-13 — push-launched FULL-SCREEN FloatAckSurface (same hero as the sheet).
            isPresented: Binding(
                get: { deepLink.floatAckId != nil },
                set: { if !$0 { deepLink.floatAckId = nil } }
            )
        ) {
            ackSurface
        }
        .task(id: writeError) {
            // Auto-dismiss the write-failure toast after a few seconds (restarts if a new
            // failure replaces it). `Task.sleep` throws on cancellation → silently ignore.
            guard writeError != nil else { return }
            try? await Task.sleep(nanoseconds: toastDurationNanos)
            writeError = nil
        }
        .task(id: claimSuccessMessage) {
            // Auto-dismiss the claim/pickup confirmation toast, mirroring writeError.
            guard claimSuccessMessage != nil else { return }
            try? await Task.sleep(nanoseconds: toastDurationNanos)
            claimSuccessMessage = nil
        }
        .task(id: swapProposed) {
            // Auto-dismiss the swap-proposed toast, mirroring writeError.
            guard swapProposed else { return }
            try? await Task.sleep(nanoseconds: toastDurationNanos)
            swapProposed = false
        }
        .task(id: floatCarouselModel.state.allHandled) {
            // §7.1 — when the LAST float resolves (accept OR decline), reuse the auto-dismissing
            // success-toast slot to confirm the whole stack is cleared. `allHandled` flips
            // false→true exactly once, so this fires once per cleared stack.
            guard floatCarouselModel.state.allHandled else { return }
            claimSuccessMessage =
                floatCarouselModel.state.total > 1 ? "All float requests handled" : "Float request handled"
        }
        .onChange(of: scenePhase) { phase in
            // Cost audit F-11: release the Realtime subscription while backgrounded, and
            // re-establish it on return. Brings iOS to parity with Android, which already
            // gates collection through collectAsStateWithLifecycle. Only the two live
            // worker-week collectors are gated — they are the ones holding Realtime
            // channels; the rest are one-shot fetches with nothing to suspend.
            switch phase {
            case .background:
                model.suspendLive()
                calendarModel.suspendLive()
            case .active:
                model.resumeLive()
                calendarModel.resumeLive()
            default:
                break
            }
        }
        .task {
            // Backend-configured path: load the worker's real active period + wire the
            // live submit. Demo (liveUserId == nil) keeps the DemoFactory period.
            if let uid = liveUserId {
                // D8 — live READS for the week + calendar (writes were already live).
                model.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                // The worker's highest role gates the manager surfaces (House open-seat
                // actions + the preferences deadline-setter). Best-effort; defaults to worker.
                let role = (try? await WorkerBackend.shared.profileRepository.fetchProfile(userId: uid))?.profile.role
                let isManager = (role ?? "sw") != "sw"
                await prefsModel.activateLive(
                    repo: WorkerBackend.shared.preferencesRepository, userId: uid, isManager: isManager
                )
                await updatesModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                await swapsModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                await ackModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                // §7.1 — load ALL the worker's outstanding floats (bounded, RLS-scoped
                // `worker_pending_floats` view) for the My-Shifts carousel and rebuild the VM.
                // Empty list on live with none outstanding → the carousel hides (NO demo
                // fallback on live, so a worker without a float never sees a phantom one).
                let liveFloats = (try? await WorkerBackend.shared.shiftsRepository.fetchPendingFloats(userId: uid)) ?? []
                let liveRecentFloats = (try? await WorkerBackend.shared.shiftsRepository.fetchRecentFloats(userId: uid)) ?? []
                floatCarouselModel.rebuild(floats: liveFloats, recentFloats: liveRecentFloats)
                await settingsModel.activateLive(repo: WorkerBackend.shared.profileRepository, userId: uid)
                // Closed-house days + the live week for the calendar (§3.4/§11.3 + D8).
                calendarModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                // The home-house grid + contacts (§11.4, T3b). A manager (sm/hm/bm/rsm) also
                // gets the open-seat actions on the home house (reusing `isManager` above).
                await houseModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid, isManager: isManager)
                // Live break CALENDAR (Break redesign): the home-house grid scoped to the
                // active break window + phase + §4.4 opt-out.
                await breakModel.activateLive(
                    shiftsRepo: WorkerBackend.shared.shiftsRepository,
                    breakRepo: WorkerBackend.shared.breakRepository,
                    userId: uid
                )
            }
        }
    }

    /// §7.1 carousel Accept — the SAME EF path the ack hero uses. POST `acknowledge-float`
    /// (best-effort) on the live path; demo is local-only (the VM advance is the move). The
    /// carousel VM is NOT reverted on failure — a float reappears on the next live read.
    private func acceptFloat(_ floatId: String) {
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        liveWrite(.ackFloat, revert: false) {
            try? await repo.acknowledgeFloat(floatId: floatId)
        }
    }

    /// §7.1 carousel Decline — POST `decline-float` (best-effort) on the live path.
    private func declineFloat(_ floatId: String) {
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        liveWrite(.declineFloat, revert: false) {
            try? await repo.declineFloat(floatId: floatId)
        }
    }

    /// The ack hero — presented as a sheet (Updates row) AND as the T2-13 push-launched
    /// full-screen cover. Live host POSTs `acknowledge-float` / `decline-float`
    /// (best-effort) when the optimistic local transition succeeds; demo = local-only.
    private var ackSurface: some View {
        FloatAcknowledgmentView(
            vm: ackModel.vm,
            onAcknowledge: liveUserId == nil ? nil : { floatId in
                let repo = WorkerBackend.shared.shiftsRepository
                liveWrite(.ackFloat, revert: false, onFailure: revertAck) {
                    try? await repo.acknowledgeFloat(floatId: floatId)
                }
            },
            onDecline: liveUserId == nil ? nil : { floatId in
                let repo = WorkerBackend.shared.shiftsRepository
                liveWrite(.declineFloat, revert: false, onFailure: revertAck) {
                    try? await repo.declineFloat(floatId: floatId)
                }
            }
        )
    }

    // MARK: tabs

    /// Transient bottom toasts (write failure / claim success / swap proposed). They
    /// float just above the tab bar now — the intuitive place for confirmations.
    private var toastStack: some View {
        VStack(spacing: 8) {
            if let writeError {
                // A swallowed EF write failure (edge runtime down, timeout, expired token)
                // used to be invisible — the optimistic card stayed put while the server
                // never changed. Surface it; the failed move is reverted to server truth.
                ShiftToast(message: writeError, tone: .error, systemIcon: ShiftIcons.warning)
                    .accessibilityIdentifier("write_error")
            }
            if let claimSuccessMessage {
                // The sheet dismisses on confirm (so the tab bar stays reachable for
                // the Maestro flow); this toast carries the `claim_success` selector.
                ShiftToast(message: claimSuccessMessage, tone: .success, systemIcon: ShiftIcons.check)
                    .accessibilityIdentifier("claim_success")
            }
            if swapProposed {
                // D2 — the server stays authoritative; the request shows under Updates once created.
                ShiftToast(message: "Swap proposed. Your housemate has been asked", tone: .success, systemIcon: ShiftIcons.check)
                    .accessibilityIdentifier("swap_proposed_toast")
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    /// True when the active tab is one of the overflow ("More") destinations.
    private var isSecondary: Bool {
        tab == .updates || tab == .preferences || tab == .breakShifts || tab == .settings || tab == .assistant
    }

    /// The native-style BOTTOM tab bar (iOS HIG): four frequent destinations plus a
    /// "More" item that opens a sheet for the episodic ones (Preferences once a
    /// semester, Break shifts only during breaks, Settings rarely). Replaces the old
    /// top horizontal-scrolling tab strip.
    private var bottomBar: some View {
        let c = ShiftColors.resolve(scheme)
        return HStack(alignment: .top, spacing: 0) {
            barItem("My Shifts", ShiftIcons.calendar, "tab_my_shifts", selected: tab == .mine) { requestTab(.mine) }
                .onboardingAnchor(OnboardingAnchorId.myShifts)
            barItem("Open", ShiftIcons.plus, "tab_open_shifts", selected: tab == .openShifts) { requestTab(.openShifts) }
                .onboardingAnchor(OnboardingAnchorId.open)
            barItem("House", ShiftIcons.building, "tab_house", selected: tab == .house) { requestTab(.house) }
                .onboardingAnchor(OnboardingAnchorId.house)
            barItem("Swaps", ShiftIcons.refresh, "tab_swaps", selected: tab == .swaps) { requestTab(.swaps) }
                .onboardingAnchor(OnboardingAnchorId.swaps)
            barItem("More", ShiftIcons.more, "tab_more", selected: isSecondary, badge: updatesModel.hasUnread) { showMore = true }
                .onboardingAnchor(OnboardingAnchorId.more)
        }
        .padding(.top, 7)
        .padding(.bottom, 2)
        .background(c.surface)
    }

    private func barItem(
        _ title: String,
        _ icon: String,
        _ id: String,
        selected: Bool,
        badge: Bool = false,
        _ action: @escaping () -> Void
    ) -> some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: action) {
            VStack(spacing: 4) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: icon)
                        .font(.system(size: 24, weight: selected ? .semibold : .regular))
                        .frame(height: 28)
                    if badge {
                        Circle().fill(c.danger.accent).frame(width: 8, height: 8).offset(x: 8, y: -1)
                    }
                }
                Text(title).font(ShiftFont.sans(11.5, selected ? .semibold : .medium))
            }
            .foregroundColor(selected ? c.blue : c.sec)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// The "More" overflow sheet — the episodic destinations. Keeps the bottom bar to
    /// four frequent tabs while every screen stays one or two taps away.
    private var moreSheet: some View {
        let c = ShiftColors.resolve(scheme)
        return VStack(spacing: 0) {
            HStack {
                Text("More").font(ShiftFont.sans(19, .bold)).foregroundColor(c.ink)
                Spacer()
                Button(action: { showMore = false }) {
                    Image(systemName: ShiftIcons.close)
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(c.sec)
                        .frame(width: 30, height: 30).background(c.surfaceVar).clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 6)

            moreRow("Updates", ShiftIcons.bell, "tab_updates", .updates)
            moreRow("Preferences", ShiftIcons.heart, "tab_preferences", .preferences)
            moreRow("Break shifts", ShiftIcons.snowflake, "tab_break", .breakShifts)
            moreRow("Settings", ShiftIcons.tune, "tab_settings", .settings)
            moreRow("Assistant", ShiftIcons.sparkles, "tab_assistant", .assistant)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Slight fade+rise as the overflow menu opens (matches the shared drawers).
        .sheetContentEntrance()
        .background(c.bg)
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping VStack leaks onto every descendant element in the XCUITest tree, shadowing
        // tab_updates/tab_preferences/tab_break/tab_settings/tab_assistant.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("more_sheet")
        }
        .presentationDetents([.height(368)])
        .presentationDragIndicator(.visible)
    }

    private func moreRow(_ title: String, _ icon: String, _ id: String, _ which: Tab) -> some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: {
            showMore = false
            if which == .assistant { openAssistant() } else { requestTab(which) }
        }) {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 18)).foregroundColor(c.sec)
                    .frame(width: 38, height: 38).background(c.surfaceVar)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text(title).font(ShiftFont.sans(15.5, .medium)).foregroundColor(c.ink)
                Spacer()
                Image(systemName: ShiftIcons.chevronRight).font(.system(size: 14, weight: .semibold)).foregroundColor(c.ter)
            }
            .padding(.horizontal, 18).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private func navigateTo(_ which: Tab) {
        tab = which
        switch which {
        case .mine: model.vm.selectTab(tab: .myShifts)
        case .openShifts: model.vm.selectTab(tab: openSub == 0 ? .openHome : .openOther)
        case .house, .updates, .swaps, .preferences, .breakShifts, .settings, .assistant: break
        }
    }

    /// Leaving Preferences with unsaved edits → defer the move + raise the guard dialog.
    private func requestTab(_ which: Tab) {
        if tab == .preferences, which != .preferences, prefsModel.state.isDirty {
            pendingTab = which
        } else {
            navigateTo(which)
        }
    }

    /// Opens the Assistant, capturing wherever the worker was so its back button can return
    /// there — see `previousBeforeAssistant`.
    private func openAssistant() {
        previousBeforeAssistant = tab
        requestTab(.assistant)
    }

    private func kitState(_ s: MyShiftCardState) -> ShiftState {
        switch s {
        case .scheduled: return .scheduled
        case .pickupHome: return .pickupHome
        case .pickupCross: return .pickupCross
        case .floatOut: return .floatOut
        case .pendingFloat: return .pendingFloat
        case .breakShift: return .breakShift
        case .dropped: return .dropped
        default: return .scheduled
        }
    }

    // MARK: Open Shifts — one tab, "My House" / "Others" sub-tabs (§5.6 Tabs 2+3)

    /// The "Open Shifts" tab: a sub-tab segmented control over the two open feeds — the
    /// home-house feed and the cross-house feeds. Both are always in the snapshot; the
    /// sub-tab only switches which one renders. "My House" is the default. The sub-tab
    /// ids (`tab_open_home` / `tab_open_other`) carry over from the former top-level tabs.
    private var openShiftsTab: some View {
        let c = ShiftColors.resolve(scheme)
        return VStack(spacing: 0) {
            PageTitle(title: "Open Shifts") {
                OpenClaimTourHelpButton { openClaimTourModel.replay() }
            }
            HStack(spacing: 3) {
                calendarToggleSegment("My House", openSub == 0, c, fill: true) {
                    openSub = 0
                    model.vm.selectTab(tab: .openHome)
                }
                .accessibilityIdentifier("tab_open_home")
                calendarToggleSegment("Others", openSub == 1, c, fill: true) {
                    openSub = 1
                    model.vm.selectTab(tab: .openOther)
                }
                .accessibilityIdentifier("tab_open_other")
            }
            .padding(4)
            .background(c.surfaceVar)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 16).padding(.vertical, 8)
            .accessibilityIdentifier("open_shifts_subtabs")

            if openSub == 0 { homeOpen } else { otherHouses }
        }
    }

    // MARK: Tab 2 — Open in My House

    private var homeOpen: some View {
        let c = ShiftColors.resolve(scheme)
        // Split the shown-week feed: upcoming in the live section, already-started ones in
        // the collapsed-by-default "Earlier this week" card.
        let weeklySplit = model.vm.pastUpcoming(openShifts: model.state.homeOpen.weekly)
        return VStack(alignment: .leading, spacing: 22) {
            ShiftSection(
                title: "Weekly open shifts",
                isEmpty: weeklySplit.upcoming.isEmpty,
                count: weeklySplit.upcoming.count,
                emptyText: "No open shifts in your house this week.",
                prominent: true,
                icon: ShiftIcons.calendar,
                accent: c.pickupDot
            ) {
                VStack(spacing: 10) {
                    ForEach(weeklySplit.upcoming, id: \.feedKey) { openFeedCard($0) }
                }
            }
            .accessibilityIdentifier("home_weekly_feed")

            if !weeklySplit.past.isEmpty {
                pastOpenShiftsSection(weeklySplit.past, c)
            }

            ShiftSection(
                title: "Permanent openings",
                isEmpty: model.state.homeOpen.permanentOpenings.isEmpty,
                count: model.state.homeOpen.permanentOpenings.count,
                emptyText: "No permanent openings right now.",
                prominent: true,
                icon: ShiftIcons.refresh,
                accent: ShiftColors.resolve(scheme).permanent.accent
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.homeOpen.permanentOpenings, id: \.feedKey) { openFeedCard($0) }
                }
            }
            .accessibilityIdentifier("home_permanent_feed")
        }
        .padding(16)
    }

    /// One open-shift feed card, driven by the shared `OpenShift.toRow(claimable:)`:
    /// OPEN → Claim, PERMANENT → Pick up, UNPICKABLE → no action + "Locked" meta
    /// (§5.4 keeps the gap visible past T-2h, withholding only the action). Shared by
    /// the My-House and Other-Houses feeds; cross-house cards claim too (design).
    private func openFeedCard(_ shift: OpenShift) -> some View {
        let claimable = model.vm.claimable(shift: shift)
        let row = shift.toRow(claimable: claimable, zone: ShiftsKt.NEW_YORK)
        return ShiftCard(
            state: openKitState(row.state),
            houseInitial: row.houseInitial,
            timeLabel: row.timeLabel,
            eyebrow: row.dayLabel,
            houseName: row.houseName,
            durationLabel: row.durationLabel,
            meta: row.meta,
            countLabel: row.countLabel,
            trailing: row.actionLabel.map { label in
                AnyView(
                    ShiftButton(
                        title: label,
                        action: { claimTarget = shift },
                        variant: isPermanentOpen(row.state) ? .tonal : .filled,
                        size: .sm
                    )
                    .accessibilityIdentifier("claim_button")
                )
            }
        )
        .accessibilityIdentifier("open_shift_card")
    }

    // MARK: Tab 3 — Open in Other Houses

    private var otherHouses: some View {
        let c = ShiftColors.resolve(scheme)
        // Split the shown-week cross-house feed: upcoming ones group/sort, the
        // already-started ones go into the collapsed "Earlier this week" card.
        let split = model.vm.pastUpcoming(openShifts: model.state.otherHouses.openShifts)
        let upcoming = OtherHousesTab(openShifts: split.upcoming)
        return VStack(alignment: .leading, spacing: 16) {
            if model.state.otherHouses.isEmpty {
                // §5.6 / decision #6 — no eligible cross-house feed (e.g. winter break).
                EmptyState(
                    title: "No eligible shifts elsewhere",
                    systemIcon: ShiftIcons.building,
                    bodyText: "No open shifts at houses you can pick up at right now. Common during winter break."
                )
            } else {
                otherHousesSortPicker(c)
                ForEach(upcoming.grouped(sort: openSort, zone: ShiftsKt.NEW_YORK), id: \.key) { group in
                    collapsibleGroup(group, c)
                }
                if !split.past.isEmpty {
                    pastOpenShiftsSection(split.past, c)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("other_houses_tab")
    }

    /// The collapsed-by-default "Earlier this week" card: open shifts in the shown week
    /// that have ALREADY started (greyed). Kept claimable for the worker who just worked
    /// an open shift and wants it on the books, but tucked away so it doesn't clutter the
    /// live feed. Defaults CLOSED; the body renders at reduced opacity. Shared by both feeds.
    private func pastOpenShiftsSection(_ past: [OpenShift], _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                pastOpenExpanded.toggle()
            } label: {
                SectionHeader(
                    title: "Earlier this week",
                    count: Int(past.count),
                    trailing: AnyView(
                        Image(systemName: pastOpenExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(c.ter)
                    ),
                    prominent: true,
                    icon: ShiftIcons.clock,
                    accent: c.ter
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("past_open_section")

            if pastOpenExpanded {
                VStack(spacing: 10) {
                    ForEach(past, id: \.feedKey) { openFeedCard($0) }
                }
                .opacity(0.55)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: pastOpenExpanded)
    }

    /// By-house / by-day segmented toggle for the cross-house feed.
    private func otherHousesSortPicker(_ c: ShiftColors) -> some View {
        HStack(spacing: 3) {
            calendarToggleSegment("By house", openSort == .byHouse, c, fill: true) {
                openSort = .byHouse
                collapsedGroups = []
            }
            .accessibilityIdentifier("other_houses_sort_house")
            calendarToggleSegment("By day", openSort == .byDay, c, fill: true) {
                openSort = .byDay
                collapsedGroups = []
            }
            .accessibilityIdentifier("other_houses_sort_day")
        }
        .padding(4)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("other_houses_sort")
    }

    /// A cross-house [group] as a collapsible card: a tappable prominent header (icon +
    /// title + count + a chevron) over its open-shift cards. The header toggles the group's
    /// collapsed state; [openSort] only picks the header icon/accent (house vs day).
    private func collapsibleGroup(_ group: OpenShiftGroup, _ c: ShiftColors) -> some View {
        let collapsed = collapsedGroups.contains(group.key)
        let accent = openSort == .byHouse ? c.pickupDot : c.permanent.accent
        let icon = openSort == .byHouse ? ShiftIcons.building : ShiftIcons.calendar
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                if collapsed { collapsedGroups.remove(group.key) } else { collapsedGroups.insert(group.key) }
            } label: {
                SectionHeader(
                    title: group.title,
                    count: Int(group.count),
                    trailing: AnyView(
                        Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(c.ter)
                    ),
                    prominent: true,
                    icon: icon,
                    accent: accent
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("group_header")

            if !collapsed {
                VStack(spacing: 10) {
                    ForEach(group.shifts, id: \.feedKey) { openFeedCard($0) }
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: collapsed)
    }

    // MARK: Updates — §10.1 notifications feed + the §7 pending-float entry

    private var updates: some View {
        let feed = updatesModel.feed
        return VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "Updates")
            if feed.isEmpty {
                EmptyState(
                    title: "You're all caught up",
                    systemIcon: ShiftIcons.bell,
                    bodyText: "No new notifications. Float assignments and reminders show up here."
                )
                .padding(.top, 40)
            } else {
                VStack(alignment: .leading, spacing: 22) {
                    if updatesModel.hasUnread { markAllReadHeader }
                    if !feed.today.isEmpty { notificationGroup("Today", feed.today) }
                    if !feed.earlier.isEmpty { notificationGroup("Earlier", feed.earlier) }
                }
                .padding(16)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The Updates header trailing affordance — "Mark all read" (worker-app.html AppHeader trailing check).
    private var markAllReadHeader: some View {
        let c = ShiftColors.resolve(scheme)
        return HStack {
            Spacer(minLength: 0)
            Button {
                // Optimistic local clear (returns the previously-unread ids); the live host
                // (liveUserId != nil) persists them via the `mark_notification_read` RPC.
                let ids = updatesModel.markAllRead()
                if let uid = liveUserId, !ids.isEmpty {
                    let repo = WorkerBackend.shared.shiftsRepository
                    Task { _ = try? await repo.markAllRead(userId: uid, unreadIds: ids, now: DemoFactory.shared.now()) }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: ShiftIcons.checkCircle).font(.system(size: 15))
                    Text("Mark all read").font(ShiftFont.sans(13.5, .medium))
                }
                .foregroundColor(c.blue)
                .padding(.horizontal, 10).padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("mark_all_read")
        }
    }

    private func notificationGroup(_ title: String, _ rows: [NotificationRow]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title)
            ForEach(rows, id: \.id) { notificationCard($0) }
        }
    }

    /// One Updates row (worker-app.html `UpdateRow`); the urgent float row opens the ack hero.
    @ViewBuilder
    private func notificationCard(_ row: NotificationRow) -> some View {
        if row.opensAck {
            Button(action: { showAck = true }) { notificationCardBody(row) }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pending_float_notification")
        } else if row.opensSwaps {
            // DESIGN §6 — an incoming-swap row is a MIRROR: tapping it deep-links to the
            // Swaps tab, where Accept / Decline live.
            Button(action: { navigateTo(.swaps) }) { notificationCardBody(row) }
                .buttonStyle(.plain)
        } else {
            notificationCardBody(row)
        }
    }

    private func notificationCardBody(_ row: NotificationRow) -> some View {
        let c = ShiftColors.resolve(scheme)
        let (icon, accent) = notificationVisual(row.category, c)
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(accent.opacity(0.10)).frame(width: 38, height: 38)
                Image(systemName: icon).font(.system(size: 19)).foregroundColor(accent)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 7) {
                    Text(row.title).font(ShiftFont.sans(14.5, .semibold)).foregroundColor(c.ink)
                    if row.unread { Circle().fill(c.pickupDot).frame(width: 7, height: 7) }
                    Spacer(minLength: 0)
                }
                if row.urgent { actionNeededTag(c) }
                Text(row.body).font(ShiftFont.sans(13)).foregroundColor(c.sec).fixedSize(horizontal: false, vertical: true)
                if let countdown = row.ackCountdownLabel {
                    // D7 — the §7 T-10m ack deadline, live at feed-load time.
                    Text(countdown).font(ShiftFont.sans(12, .semibold)).foregroundColor(c.pending)
                        .accessibilityIdentifier("float_ack_countdown")
                }
                if row.opensSwaps {
                    // DESIGN §6 — the mirror points to the Swaps tab; actions live there.
                    Text("Tap to review in Swaps →")
                        .font(ShiftFont.sans(12.5, .semibold))
                        .foregroundColor(c.blue)
                        .padding(.top, 2)
                }
                if row.opensAlliedPage, let blockId = row.alliedPageBlockId {
                    // Off-hours ladder ack (staggered-rollout pilot): confirm the desk was
                    // called so the ladder stops escalating (responsible worker -> SM -> desk).
                    Button(action: { acknowledgeAlliedPage(blockId) }) {
                        Text("I have called the desk")
                            .font(ShiftFont.sans(13, .semibold))
                            .foregroundColor(c.surface)
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .background(c.floatOut.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                    .accessibilityIdentifier("allied_page_ack")
                }
            }
            Text(row.timeLabel).font(ShiftType.monoId).monospacedDigit().foregroundColor(c.ter)
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(row.urgent ? c.floatSoft : c.surface)
        .overlay(alignment: .leading) { if row.urgent { Rectangle().fill(c.floatOut.accent).frame(width: 4) } }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(row.urgent ? Color.clear : c.divider, lineWidth: 1))
        .accessibilityIdentifier(row.swapId != nil ? "swap_request_notification" : "")
    }

    /// Acknowledge an off-hours Allied-page ladder alert ("I've called the desk",
    /// staggered-rollout pilot): optimistic local resolve (the row leaves the feed), then
    /// (live) best-effort POST `acknowledge-allied-page`. The server resolves the ladder so
    /// no further rung fires; if the POST fails, the next snapshot re-surfaces the alert.
    private func acknowledgeAlliedPage(_ blockId: String) {
        updatesModel.acknowledgeAlliedPage(blockId)
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        Task { _ = try? await repo.acknowledgeAlliedPage(blockId: blockId) }
    }

    /// Cancel (void) an own outgoing swap leg from the Swaps tab: optimistic resolve +
    /// `void-swap` POST. Independent — cancelling one leg never touches its siblings. On
    /// failure toast + revert (re-read the lists → the leg returns).
    private func voidSwap(_ swapId: String) {
        swapsModel.cancelOutgoing(swapId)
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        liveWrite(.cancelSwap, revert: false, onFailure: revertSwaps) {
            try? await repo.voidSwap(swapId: swapId)
        }
    }

    /// Accept / Decline an incoming swap from the Swaps tab: optimistic resolve (and clear
    /// the Updates mirror), then (live) POST the real `accept-swap` / `reject-swap` — the
    /// server stays authoritative. On failure toast + revert (re-read the lists).
    private func actOnSwap(_ swapId: String, accept: Bool) {
        swapsModel.resolveIncoming(swapId)
        updatesModel.resolveSwap(swapId)
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        if accept {
            // accept-swap returns 200 even on a logical no-op ({accepted:false,reason}); confirm
            // the body actually applied, else classify the reason.
            Task { @MainActor in
                let result = (try? await repo.acceptSwap(swapId: swapId)) ?? EdgeResult(ok: false, status: 0, body: "")
                if !(result.ok && WriteFeedbackKt.swapAccepted(body: result.body)) {
                    writeError = WriteFeedbackKt.edgeErrorMessage(op: .acceptSwap, result: result)
                    await revertSwaps()
                } else if let uid = liveUserId {
                    // Audit F9. An accepted swap moves seats BETWEEN two workers, so the
                    // giver's rows leave their RLS scope and Realtime reports nothing to
                    // them. Pull both sides of the display back to server truth.
                    await model.revertToServer(repo: repo, userId: uid)
                    await calendarModel.refreshFromServer(repo: repo, userId: uid)
                }
            }
        } else {
            liveWrite(.declineSwap, revert: false, reconcile: false, onFailure: revertSwaps) {
                try? await repo.rejectSwap(swapId: swapId)
            }
        }
    }

    /// Revert a failed swap accept/reject/void by re-reading the Swaps tab + Updates feed.
    private func revertSwaps() async {
        guard let uid = liveUserId else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        await swapsModel.refreshFromServer(repo: repo, userId: uid)
        await updatesModel.refreshFromServer(repo: repo, userId: uid)
    }

    private func notificationVisual(_ category: NotificationCategory, _ c: ShiftColors) -> (String, Color) {
        switch category {
        case .float: return (ShiftIcons.floatOut, c.floatOut.accent)
        case .reminder: return (ShiftIcons.warning, c.pending)
        case .shiftRemoved: return (ShiftIcons.dropped, c.sec)
        case .permanent: return (ShiftIcons.refresh, c.permanent.accent)
        case .preferences: return (ShiftIcons.checkCircle, c.success.accent)
        case .swap: return (ShiftIcons.refresh, c.floatIn.accent)
        case .info: return (ShiftIcons.bell, c.pickupDot)
        case .alliedPage: return (ShiftIcons.warning, c.floatOut.accent)
        default: return (ShiftIcons.bell, c.pickupDot)
        }
    }

    private func actionNeededTag(_ c: ShiftColors) -> some View {
        HStack(spacing: 4) {
            Image(systemName: ShiftIcons.warning).font(.system(size: 11, weight: .semibold))
            Text("Action needed").font(ShiftFont.sans(12, .semibold))
        }
        .padding(EdgeInsets(top: 3, leading: 6, bottom: 3, trailing: 8))
        .foregroundColor(c.floatOut.deep)
        .background(c.floatOut.badge)
        .clipShape(Capsule())
    }

    // MARK: Swaps — DESIGN §6 dedicated Incoming / Outgoing review surface

    private var swapsTab: some View {
        let c = ShiftColors.resolve(scheme)
        let st = swapsModel.state
        return VStack(spacing: 0) {
            PageTitle(title: "Swaps")
            HStack(spacing: 3) {
                calendarToggleSegment("All (\(st.allCount))", st.selectedTab == .all, c) {
                    swapsModel.selectTab(.all)
                }
                .accessibilityIdentifier("swaps_subtab_all")
                calendarToggleSegment("Incoming (\(st.incomingCount))", st.selectedTab == .incoming, c) {
                    swapsModel.selectTab(.incoming)
                }
                .accessibilityIdentifier("swaps_subtab_incoming")
                calendarToggleSegment("Outgoing (\(st.outgoingCount))", st.selectedTab == .outgoing, c) {
                    swapsModel.selectTab(.outgoing)
                }
                .accessibilityIdentifier("swaps_subtab_outgoing")
            }
            .padding(3)
            .background(c.surfaceVar)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 16).padding(.vertical, 8)
            .accessibilityIdentifier("swaps_subtabs")

            if st.selectedTab == .all {
                allSwaps(st.feed.all, c)
            } else if st.selectedTab == .incoming {
                incomingSwaps(st.feed.incoming, c)
            } else {
                outgoingSwaps(st.feed.outgoing, c)
            }
        }
        .accessibilityIdentifier("swaps_screen")
    }

    /// The "All" list — incoming + outgoing merged, soonest-deadline first. Each row keeps
    /// its direction's actions (incoming → Accept/Decline, outgoing → Cancel).
    @ViewBuilder
    private func allSwaps(_ rows: [SwapRow], _ c: ShiftColors) -> some View {
        if rows.isEmpty {
            EmptyState(
                title: "No swaps yet",
                systemIcon: ShiftIcons.refresh,
                bodyText: "Swaps you receive or propose show up here, soonest first."
            )
            .padding(.top, 40)
        } else {
            VStack(spacing: 10) {
                ForEach(Array(rows.enumerated()), id: \.element.swapId) { idx, row in
                    if let gid = row.groupId, gid != (idx > 0 ? rows[idx - 1].groupId : nil) {
                        Text("Proposed together · \(row.groupSize) people")
                            .font(ShiftFont.sans(12.5, .semibold))
                            .foregroundColor(c.sec)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("swaps_group_header")
                    }
                    if row.incoming { incomingSwapCard(row, c) } else { outgoingSwapCard(row, c) }
                }
            }
            .padding(16)
            .accessibilityIdentifier("swaps_all_list")
        }
    }

    @ViewBuilder
    private func incomingSwaps(_ rows: [SwapRow], _ c: ShiftColors) -> some View {
        if rows.isEmpty {
            EmptyState(
                title: "No incoming swaps",
                systemIcon: ShiftIcons.refresh,
                bodyText: "When a housemate proposes a swap with you, it shows up here to accept or decline."
            )
            .padding(.top, 40)
        } else {
            VStack(spacing: 10) {
                ForEach(rows, id: \.swapId) { row in incomingSwapCard(row, c) }
            }
            .padding(16)
            .accessibilityIdentifier("swaps_incoming_list")
        }
    }

    @ViewBuilder
    private func outgoingSwaps(_ rows: [SwapRow], _ c: ShiftColors) -> some View {
        if rows.isEmpty {
            EmptyState(
                title: "No outgoing swaps",
                systemIcon: ShiftIcons.refresh,
                bodyText: "Swaps you propose (from a shift on My Shifts) wait here until your housemate responds."
            )
            .padding(.top, 40)
        } else {
            VStack(spacing: 10) {
                ForEach(Array(rows.enumerated()), id: \.element.swapId) { idx, row in
                    // Co-created legs (decision 2026-06-15) get one "Proposed together" header.
                    if let gid = row.groupId, gid != (idx > 0 ? rows[idx - 1].groupId : nil) {
                        Text("Proposed together · \(row.groupSize) people")
                            .font(ShiftFont.sans(12.5, .semibold))
                            .foregroundColor(c.sec)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("swaps_group_header")
                    }
                    outgoingSwapCard(row, c)
                }
            }
            .padding(16)
            .accessibilityIdentifier("swaps_outgoing_list")
        }
    }

    private func incomingSwapCard(_ row: SwapRow, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            swapCardHeader(row, c)
            swapExchangeRow(row, c)
            swapDeadlineRow(row, c)
            HStack(spacing: 10) {
                ShiftButton(title: "Accept", action: { actOnSwap(row.swapId, accept: true) }, fullWidth: true)
                    .accessibilityIdentifier("swap_accept_button")
                ShiftButton(title: "Decline", action: { actOnSwap(row.swapId, accept: false) }, variant: .outlined, fullWidth: true)
                    .accessibilityIdentifier("swap_reject_button")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        // Incoming cards carry a left accent stripe so they pop out in the merged All list.
        .overlay(alignment: .leading) { Rectangle().fill(c.blue).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("swap_request_row")
    }

    private func outgoingSwapCard(_ row: SwapRow, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            swapCardHeader(row, c)
            swapExchangeRow(row, c)
            HStack {
                swapDeadlineRow(row, c)
                Spacer(minLength: 0)
                Button(action: { voidSwap(row.swapId) }) {
                    Text("Cancel").font(ShiftFont.sans(13, .medium)).foregroundColor(c.danger.accent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("swap_void_button")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("swap_request_row")
    }

    /// Counterparty avatar + name + who-acts-next label ("Needs your response" / "Waiting
    /// on Ben") + a small type chip. The label is accented for incoming, muted for outgoing.
    private func swapCardHeader(_ row: SwapRow, _ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            HouseBadge(initial: String(row.counterpartyName.prefix(1)), bg: c.surfaceVar, fg: c.ink)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.counterpartyName).font(ShiftFont.sans(15, .medium)).foregroundColor(c.ink)
                Text(row.directionLabel).font(ShiftFont.sans(11.5, .medium)).foregroundColor(row.incoming ? c.blue : c.sec)
            }
            Spacer(minLength: 0)
            Text(row.typeLabel).font(ShiftFont.sans(11, .medium)).foregroundColor(c.sec)
                .padding(.horizontal, 9).padding(.vertical, 3)
                .background(c.surfaceVar).clipShape(Capsule())
        }
    }

    /// The give ⇄ get block — the time SLOTS side by side (the decision is about when). A
    /// one-directional transfer isn't a swap, so it collapses to a single full-width panel
    /// ("someone wants to give you these hours" / "you're offering …") instead.
    @ViewBuilder
    private func swapExchangeRow(_ row: SwapRow, _ c: ShiftColors) -> some View {
        if row.isOneWayTransfer {
            swapTransferPanel(row, c)
        } else {
            HStack(spacing: 8) {
                swapSideBox("You give", row.give, bg: c.surfaceVar, accent: c.sec, c)
                Image(systemName: "arrow.left.arrow.right").font(.system(size: 15)).foregroundColor(c.sec)
                swapSideBox("You get", row.get, bg: c.blue.opacity(0.08), accent: c.blue, c)
            }
        }
    }

    /// The one-directional transfer panel — a single full-width blue block leading with the
    /// receive/offer headline (never "give nothing / get this"), then the shift's hero time +
    /// day + house. Replaces the two-box exchange when nothing is given in return.
    private func swapTransferPanel(_ row: SwapRow, _ c: ShiftColors) -> some View {
        let side = row.transferSide
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(row.transferHeadline).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.blue)
                Spacer(minLength: 0)
                if let s = side {
                    Text(s.hours).font(ShiftFont.sans(12.5, .medium)).foregroundColor(c.blue)
                }
            }
            // The time slot is the hero; fall back to the hours when the time isn't resolved yet.
            Text(side?.timeRange ?? side?.hours ?? "-").font(ShiftFont.sans(18, .semibold)).foregroundColor(c.ink)
            if let day = side?.dayLabel {
                Text(day).font(ShiftFont.sans(13, .medium)).foregroundColor(c.ink)
            }
            if let house = side?.houseName {
                swapHouseLine(house, c.blue)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13).padding(.vertical, 11)
        .background(c.blue.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityIdentifier("swap_transfer_panel")
    }

    /// One side of the exchange — the TIME RANGE as the hero, the day beneath, hours a tiny chip.
    private func swapSideBox(_ label: String, _ side: SwapSide?, bg: Color, accent: Color, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                Text(label.uppercased()).font(ShiftFont.sans(10.5, .medium)).tracking(0.4).foregroundColor(accent)
                if let s = side, s.timeRange != nil {
                    Text(" · \(s.hours)").font(ShiftFont.sans(10.5, .medium)).foregroundColor(c.ter)
                }
            }
            // The time slot is the hero; fall back to hours when the time isn't known yet.
            Text(side?.timeRange ?? side?.hours ?? "-").font(ShiftFont.sans(17, .medium)).foregroundColor(c.ink)
            // The date is decision-critical too — render it prominently, not squint-small.
            Text(side?.dayLabel ?? (side == nil ? "Nothing back" : "")).font(ShiftFont.sans(13, .medium)).foregroundColor(c.ink)
            // The house this side is actually worked at (the float destination, if floated) — the
            // acceptor must see it before saying yes; an absent name (older row) omits the line.
            if let house = side?.houseName {
                swapHouseLine(house, accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11).padding(.vertical, 9)
        .background(bg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// The desk a swap side is worked at — a building glyph + the house name, in the side's
    /// accent colour. Decision-critical: the float destination, not the home house.
    private func swapHouseLine(_ houseName: String, _ accent: Color) -> some View {
        HStack(spacing: 4) {
            Image(systemName: ShiftIcons.building).font(.system(size: 12)).foregroundColor(accent)
            Text(houseName).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(accent)
        }
    }

    /// Clock + humanized countdown to expiry — tinted orange when the deadline is near.
    private func swapDeadlineRow(_ row: SwapRow, _ c: ShiftColors) -> some View {
        HStack(spacing: 6) {
            Image(systemName: ShiftIcons.clock).font(.system(size: 14)).foregroundColor(row.deadlineUrgent ? c.pending : c.sec)
            Text(row.deadline).font(ShiftFont.sans(13, row.deadlineUrgent ? .medium : .regular)).foregroundColor(row.deadlineUrgent ? c.pending : c.sec)
        }
    }

    // MARK: House — §11.4 home-house schedule (Excel-style week grid) + contact lookup (T3b)

    @State private var contactTarget: HouseGridBlock?
    // Manager (sm/hm/bm/rsm on the home house) open-seat actions. `houseActionTarget` is the
    // vacant block tapped → the action chooser; picking an action routes to the assign sheet
    // (`assignTarget`) or the "get coverage now" confirm (`coverageTarget`).
    @State private var houseActionTarget: HouseGridBlock?
    @State private var assignTarget: HouseGridBlock?
    @State private var coverageTarget: HouseGridBlock?
    @State private var showHouseWeekPicker = false
    @State private var showHousePicker = false
    /// The day columns' horizontal scroll offset (≤ 0), mirrored to the frozen header row.
    @State private var houseHOffset: CGFloat = 0

    // Grid metrics (design `HouseScheduleScreen`).
    private static let houseRailW: CGFloat = 42
    private static let houseHeaderH: CGFloat = 46
    private static let housePxPerHour: CGFloat = 46
    private static let houseLaneW: CGFloat = 92
    private static let houseLaneGap: CGFloat = 4
    private static let houseColPad: CGFloat = 6
    private static let houseColGap: CGFloat = 6
    /// How far OTHER workers' seats recede so mine is findable at a glance. Mirrors
    /// Android's `HOUSE_OTHER_OPACITY`; keep the two in step.
    private static let houseOtherOpacity: Double = 0.5

    /// The home-house schedule as a week grid: a fixed left time rail + Mon–Sun day
    /// columns that scroll sideways (the rail stays put), concurrent desks side-by-side.
    /// The week navigator (last week … +4) pages the grid; tapping a staffed block opens
    /// the contact sheet — the "who do I swap with" affordance.
    private var houseTab: some View {
        let c = ShiftColors.resolve(scheme)
        let st = houseModel.state
        return VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "House") {
                HouseGridTourHelpButton { houseGridTourModel.replay() }
            }
            houseHeaderCard(st, c)
            houseLegend(c)
            houseGrid(st.grid, st, c)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            houseWeekNavBar(st, c)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityIdentifier("house_screen")
        .task { await houseModel.loadHouses() }
        // Reload whenever the shown house OR week changes (switching re-centres on today).
        .task(id: "\(st.selectedHouseId ?? "")#\(st.weekOffset)") { await houseModel.loadWeek() }
        .sheet(isPresented: $showHouseWeekPicker) { houseWeekPickerSheet(st, c) }
        .sheet(isPresented: $showHousePicker) { housePickerSheet(st, c) }
        .sheet(item: $contactTarget) { block in
            ContactSheetView(
                block: block,
                deskPhone: houseModel.state.deskPhone,
                deskHouseName: houseModel.state.houseName
            )
        }
        // Manager tap on an OPEN seat (canManage) → choose an action.
        .confirmationDialog(
            "Open seat",
            isPresented: Binding(get: { houseActionTarget != nil }, set: { if !$0 { houseActionTarget = nil } }),
            titleVisibility: .visible,
            presenting: houseActionTarget
        ) { block in
            Button("Assign a worker") { assignTarget = block }
            Button("Get coverage now") { coverageTarget = block }
            Button("Cancel", role: .cancel) { }
        } message: { block in
            Text("\(st.houseName) · \(block.timeLabel)")
        }
        // "Assign a worker" — roster picker; the sheet owns the assign call + soft-advisory
        // confirm and reports the terminal result back here for the toast + grid refetch.
        .sheet(item: $assignTarget) { block in
            AssignWorkerSheet(
                houseName: st.houseName,
                houseId: st.selectedHouseId ?? st.homeHouseId ?? "",
                block: block,
                onAssigned: { count in
                    assignTarget = nil
                    claimSuccessMessage = count == 1 ? "Worker assigned" : "Worker assigned to \(count) blocks"
                    Task { await houseModel.loadWeek() }
                },
                onRejected: { message in assignTarget = nil; writeError = message },
                onFailed: { assignTarget = nil; writeError = "That could not be done. Try again." }
            )
        }
        // "Get coverage now" — force-trigger a float lookup for the vacant run.
        .confirmationDialog(
            "Get coverage now",
            isPresented: Binding(get: { coverageTarget != nil }, set: { if !$0 { coverageTarget = nil } }),
            titleVisibility: .visible,
            presenting: coverageTarget
        ) { block in
            Button("Run float lookup") { triggerCoverage(block) }
            Button("Cancel", role: .cancel) { }
        } message: { _ in
            Text("Run a float lookup to cover this seat now?")
        }
    }

    /// Force-trigger a float lookup for the tapped vacant run (BSpec §6.6). Best-effort:
    /// on success show the confirmation toast + refetch the grid; a server rejection or a
    /// network failure surfaces the error toast. Own-house is enforced server-side.
    private func triggerCoverage(_ block: HouseGridBlock) {
        let houseId = houseModel.state.selectedHouseId ?? houseModel.state.homeHouseId ?? ""
        let ids = block.assignmentIds
        Task { @MainActor in
            do {
                let outcome = try await WorkerBackend.shared.managerRepository.forceTrigger(houseId: houseId, assignmentIds: ids)
                switch onEnum(of: outcome) {
                case .triggered:
                    claimSuccessMessage = "Coverage requested"
                    await houseModel.loadWeek()
                case .rejected(let r):
                    writeError = r.message
                case .failed:
                    writeError = "That could not be done. Try again."
                }
            } catch {
                writeError = "That could not be done. Try again."
            }
        }
    }

    /// The house header — a DROPDOWN (2026-06-23 cross-house ruling): tapping the card opens
    /// the switcher, EXCEPT the desk-phone line, which dials the desk (the device dialer
    /// opens with the number prefilled; it does not auto-call).
    private func houseHeaderCard(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 12) {
            HouseBadge(initial: String(st.houseName.prefix(1)), bg: c.blueContainer, fg: c.blue)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(st.houseName).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                    if st.isHomeHouse {
                        Text("Your house")
                            .font(ShiftFont.sans(10.5, .semibold)).foregroundColor(c.blue)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(c.blueContainer)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                }
                if let desk = st.deskPhone {
                    Button(action: { dial(desk) }) {
                        HStack(spacing: 5) {
                            Image(systemName: ShiftIcons.phone).font(.system(size: 12)).foregroundColor(c.blue)
                            Text("Desk · \(desk)").font(ShiftFont.sans(13, .medium)).foregroundColor(c.blue)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("house_call_desk")
                } else {
                    Text("House schedule").font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }
            }
            Spacer(minLength: 0)
            if st.canSwitchHouse {
                Image(systemName: "chevron.down").font(.system(size: 14, weight: .semibold)).foregroundColor(c.ter)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { if st.canSwitchHouse { showHousePicker = true } }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .accessibilityIdentifier("house_picker_open")
    }

    /// The house switcher (cross-house view): pick any house to read its schedule.
    private func housePickerSheet(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        ShiftSheet(title: "View a house", onClose: { showHousePicker = false }) {
            VStack(spacing: 8) {
                ForEach(st.houses, id: \.id) { house in
                    let selected = house.id == st.selectedHouseId
                    Button(action: {
                        houseModel.selectHouse(house.id)
                        showHousePicker = false
                    }) {
                        HStack(spacing: 10) {
                            HouseBadge(initial: String(house.name.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(house.name).font(ShiftFont.sans(14.5, .semibold)).foregroundColor(c.ink)
                                    if house.id == st.homeHouseId {
                                        Text("Your house").font(ShiftFont.sans(10, .semibold)).foregroundColor(c.blue)
                                    }
                                }
                                Text(house.deskPhone.map { "Desk · \($0)" } ?? "No desk phone")
                                    .font(ShiftFont.sans(12)).foregroundColor(c.sec)
                            }
                            Spacer(minLength: 0)
                            if selected {
                                Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundColor(c.blue)
                            }
                        }
                        .padding(.horizontal, 13).padding(.vertical, 12)
                        .background(selected ? c.blueContainer.opacity(0.45) : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? c.blue : c.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("house_picker_option")
                }
            }
            .accessibilityIdentifier("house_picker_sheet")
        }
    }

    /// Legend strip (design): You / Float-in / Open + the swipe-sideways hint.
    private func houseLegend(_ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            houseLegendSwatch(c.blueContainer, c.blue, "You", dashed: false, c)
            houseLegendSwatch(c.floatIn.tint, c.floatIn.accent, "Float-in", dashed: false, c)
            houseLegendSwatch(c.surface, c.outline, "Open", dashed: true, c)
            Spacer(minLength: 0)
            Text("Swipe").font(ShiftFont.sans(11)).foregroundColor(c.ter)
            Image(systemName: ShiftIcons.chevronRight).font(.system(size: 11, weight: .semibold)).foregroundColor(c.ter)
        }
        .padding(.horizontal, 16).padding(.vertical, 4)
    }

    private func houseLegendSwatch(_ fill: Color, _ accent: Color, _ label: String, dashed: Bool, _ c: ShiftColors) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(fill)
                .frame(width: 10, height: 10)
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(accent, style: StrokeStyle(lineWidth: dashed ? 1.5 : 1, dash: dashed ? [3, 2] : []))
                )
            Text(label).font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
        }
    }

    /// The grid: a frozen left time rail + horizontally-scrolling day columns, with a
    /// frozen day-header row above. The body's horizontal offset is mirrored to the header
    /// (`houseHOffset`) so the headers track the columns; the rail sits outside the
    /// horizontal scroll, so it stays put when the days scroll sideways — the requirement.
    private func houseGrid(_ grid: HouseGridWeek, _ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        let lanes = max(Int(grid.laneCount), 1)
        let colW = CGFloat(lanes) * Self.houseLaneW + CGFloat(lanes - 1) * Self.houseLaneGap + Self.houseColPad * 2
        let startMin = Int(grid.startMin)
        let endMin = Int(grid.endMin)
        let gridHeight = Self.housePxPerHour * CGFloat(endMin - startMin) / 60
        let focusDayIndex = Int(st.todayIndex)
        let nowMin = Int(st.nowMinOfDay)
        // Re-centre the scroll on open / house-switch / week-change (and when seats land and
        // expand the bounds): the today column scrolls into view + the body drops to "now".
        let scrollTrigger = "\(st.selectedHouseId ?? "")#\(st.weekOffset)#\(startMin)#\(lanes)"
        return ScrollViewReader { proxy in
            VStack(spacing: 0) {
                // Frozen day-header row — horizontally synced to the body via houseHOffset.
                HStack(spacing: 0) {
                    Color.clear.frame(width: Self.houseRailW, height: Self.houseHeaderH)
                    GeometryReader { _ in
                        HStack(spacing: Self.houseColGap) {
                            ForEach(grid.days, id: \.index) { day in houseDayHeader(day, colW, c) }
                        }
                        .offset(x: houseHOffset)
                    }
                    .frame(height: Self.houseHeaderH, alignment: .leading)
                    .clipped()
                }
                .padding(.leading, 12)
                // Body: rail (frozen horizontally) + horizontally-scrolling columns.
                ScrollView(.vertical, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 0) {
                        houseTimeRail(startMin, endMin, gridHeight, nowMin, c)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Self.houseColGap) {
                                ForEach(grid.days, id: \.index) { day in
                                    houseDayColumn(day, colW, gridHeight, startMin, endMin, c)
                                        .id("house-day-\(day.index)")
                                }
                            }
                            .padding(.trailing, 8)
                            .background(
                                GeometryReader { g in
                                    Color.clear.preference(key: HouseHScrollKey.self, value: g.frame(in: .named("houseHBody")).minX)
                                }
                            )
                        }
                        .coordinateSpace(name: "houseHBody")
                        // Mirror the body's live horizontal offset to the frozen header row so the
                        // dates track the columns. `onScrollGeometryChange` (iOS 18+) reads the
                        // scroll's `contentOffset` continuously during the gesture — reliable where
                        // the preference-frame read below silently fails to update mid-scroll. The
                        // preference path stays as the pre-iOS-18 fallback.
                        .onPreferenceChange(HouseHScrollKey.self) { houseHOffset = $0 }
                        .houseTrackHScroll { houseHOffset = $0 }
                    }
                    .padding(.leading, 12).padding(.top, 2).padding(.bottom, 8)
                }
            }
            .onChange(of: scrollTrigger) { _ in scrollToToday(proxy, focusDayIndex) }
            .onAppear { scrollToToday(proxy, focusDayIndex) }
        }
    }

    /// Scroll the grid so today's column is visible (it may sit at the end of the week) and
    /// the body drops to the current hour. No-op when the shown week has no "today".
    private func scrollToToday(_ proxy: ScrollViewProxy, _ focusDayIndex: Int) {
        guard focusDayIndex >= 0 else { return }
        DispatchQueue.main.async {
            withAnimation(.easeInOut(duration: 0.25)) {
                proxy.scrollTo("house-day-\(focusDayIndex)", anchor: .leading)
                proxy.scrollTo("house-now", anchor: .center)
            }
        }
    }

    /// The 2-hour clock marks (e.g. 06:00, 08:00, …) strictly between `startMin` and `endMin`
    /// — shared by the rail's labels and each day column's gridlines.
    private func houseHourMarks(_ startMin: Int, _ endMin: Int) -> [Int] {
        var marks: [Int] = []
        var h = (startMin / 120 + 1) * 120
        while h < endMin {
            marks.append(h)
            h += 120
        }
        return marks
    }

    private func fmtHm(_ min: Int) -> String { String(format: "%02d:%02d", min / 60, min % 60) }

    /// The fixed left time rail — frozen during sideways scroll. The top label is the EXACT
    /// grid origin (e.g. "05:30" when that's the week's earliest actual shift start, not
    /// rounded to an hour), then a label at every 2-hour clock mark, and a final label at the
    /// bottom bound. Carries a hidden "house-now" anchor at the current time so the body can
    /// scroll to it.
    private func houseTimeRail(_ startMin: Int, _ endMin: Int, _ gridHeight: CGFloat, _ nowMin: Int, _ c: ShiftColors) -> some View {
        let labels = Array(Set([startMin, endMin] + houseHourMarks(startMin, endMin))).sorted()
        return ZStack(alignment: .topTrailing) {
            Color.clear.frame(width: Self.houseRailW, height: gridHeight)
            Color.clear.frame(width: Self.houseRailW, height: 1)
                .offset(y: max(Self.housePxPerHour * CGFloat(nowMin - startMin) / 60, 0))
                .id("house-now")
            ForEach(labels, id: \.self) { m in
                Text(fmtHm(m))
                    .font(ShiftFont.mono(10)).monospacedDigit().foregroundColor(c.ter)
                    .offset(y: max(Self.housePxPerHour * CGFloat(m - startMin) / 60 - 5, 0))
                    .padding(.trailing, 6)
            }
        }
        .frame(width: Self.houseRailW, height: gridHeight, alignment: .topTrailing)
        .accessibilityIdentifier("house_time_rail")
    }

    /// One Mon–Sun header cell (day + date), highlighted when it is today.
    private func houseDayHeader(_ day: HouseGridDay, _ colW: CGFloat, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            Text(day.dayLabel).font(ShiftFont.sans(11, .semibold)).foregroundColor(day.isToday ? c.blue : c.ter)
            Text(day.dateLabel).font(ShiftFont.mono(13)).monospacedDigit().fontWeight(.semibold)
                .foregroundColor(day.isToday ? c.blue : c.ink)
        }
        .frame(width: colW, height: Self.houseHeaderH)
        .background(day.isToday ? c.blue.opacity(0.10) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// One day column: the surface card + 2-hour gridlines + the lane-placed blocks.
    private func houseDayColumn(
        _ day: HouseGridDay, _ colW: CGFloat, _ gridHeight: CGFloat, _ startMin: Int, _ endMin: Int, _ c: ShiftColors
    ) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(c.surface)
                .frame(width: colW, height: gridHeight)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
            ForEach(houseHourMarks(startMin, endMin), id: \.self) { h in
                Rectangle().fill(c.divider.opacity(0.6))
                    .frame(width: colW, height: 1)
                    .offset(y: Self.housePxPerHour * CGFloat(h - startMin) / 60)
            }
            ForEach(day.blocks, id: \.id) { b in houseBlockView(b, colW, startMin, day.isToday, c) }
        }
        .frame(width: colW, height: gridHeight, alignment: .topLeading)
        .accessibilityIdentifier("house_day_column")
    }

    /// One positioned desk block, coloured by its state (design `HouseBlock`).
    ///
    /// Two colour systems, in this order:
    ///
    /// 1. **Per-worker colour** (docs/design/worker-colors.md) — a plain SCHEDULED seat
    ///    wears its occupant's own colour, a pure hash of their `user_id`, so the same
    ///    person reads the same here and on the web calendars. Fill is that colour at
    ///    90%, the leading rail and border full strength, the name its contrast foreground.
    /// 2. **State colour** — float-in, pending and vacant seats KEEP their state colours,
    ///    because those carry meaning (a float must still read as a float).
    ///
    /// The "mine" emphasis rides on top of either: my shift TODAY keeps its solid brand
    /// ring so it's still the one block that pops.
    ///
    /// 3. **Find-mine dimming** — a grid where every seat wears a saturated colour is
    ///    pretty but useless for the one question a worker actually asks ("where am I?").
    ///    So every seat that is NOT mine renders at `houseOtherOpacity`; mine stays at
    ///    full strength in its own colour. Vacant seats are not anyone's card and are not
    ///    dimmed (they're the actionable open-seat affordance for a manager).
    private func houseBlockView(_ b: HouseGridBlock, _ colW: CGFloat, _ startMin: Int, _ isToday: Bool, _ c: ShiftColors) -> some View {
        let top = Self.housePxPerHour * CGFloat(Int(b.startMin) - startMin) / 60
        let h = max(Self.housePxPerHour * CGFloat(Int(b.endMin) - Int(b.startMin)) / 60 - 3, 18)
        // A desk that's never concurrent with another during this run (segmentLanes == 1)
        // collapses to one full-width column instead of a narrow lane next to empty space.
        let collapsed = Int(b.segmentLanes) <= 1
        let width = collapsed ? colW - Self.houseColPad * 2 : Self.houseLaneW
        let x = collapsed ? Self.houseColPad : Self.houseColPad + (Self.houseLaneW + Self.houseLaneGap) * CGFloat(Int(b.lane))
        let bg: Color
        let accent: Color
        let fg: Color
        // mine + today → solid blue ring (the one block that should pop).
        var emphatic = false
        let wc = WorkerTint.forBlock(b)
        if b.vacant {
            bg = c.surface; accent = c.outline; fg = c.ter
        } else if let wc {
            bg = wc.color.opacity(0.90); accent = wc.color; fg = wc.onColor
            emphatic = b.mine && isToday
        } else if b.mine && b.floatIn {
            bg = c.floatIn.tint; accent = c.floatIn.accent; fg = c.floatIn.deep
        } else if b.mine && isToday {
            bg = c.today; accent = c.blue; fg = c.onBlueContainer; emphatic = true
        } else if b.mine {
            bg = c.blueContainer.opacity(0.5); accent = c.blue.opacity(0.5); fg = c.onBlueContainer
        } else if b.pending {
            bg = c.surfaceVar; accent = c.pending; fg = c.ink
        } else if b.floatIn {
            bg = c.floatIn.tint; accent = c.floatIn.accent; fg = c.floatIn.deep
        } else {
            bg = c.surfaceVar; accent = c.outline; fg = c.ink
        }
        // The time label keeps a hint of the worker's hue without losing contrast (web:
        // `color-mix(in srgb, F 75%, C 25%)`); on a state-coloured block it's just `fg`.
        let timeFg = wc.map { $0.labelColor(0.25) } ?? fg
        // Everyone else's seats recede so mine is findable at a glance (see doc comment #3).
        // The dimming applies only to the background/border fill, never to the text, which
        // must always render at full opacity.
        let blockAlpha = (b.mine || b.vacant) ? 1.0 : Self.houseOtherOpacity
        let recededBg = bg.opacity(blockAlpha)
        let recededAccent = accent.opacity(blockAlpha)
        return VStack(alignment: .leading, spacing: 1) {
            Text(b.timeLabel).font(ShiftFont.mono(10.5)).monospacedDigit().foregroundColor(timeFg).lineLimit(1)
            Text(b.workerLabel + (b.mine && b.floatIn ? " ·float" : ""))
                .font(ShiftFont.sans(12, .semibold)).foregroundColor(fg).lineLimit(1)
            if b.pending {
                Text("Pending").font(ShiftFont.sans(10, .semibold)).foregroundColor(c.pending).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 7).padding(.trailing, 5).padding(.top, 4).padding(.bottom, 3)
        .frame(width: width, height: h, alignment: .topLeading)
        .background(recededBg)
        .overlay(alignment: .leading) { Rectangle().fill(recededAccent).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(
                    b.vacant ? recededAccent : (emphatic ? c.blue.opacity(blockAlpha) : (wc != nil ? recededAccent : accent.opacity(0.45 * blockAlpha))),
                    style: StrokeStyle(lineWidth: b.vacant ? 1.5 : (emphatic ? 1.5 : 1), dash: b.vacant ? [6, 4] : [])
                )
        )
        // Hit region and gesture MUST be attached BEFORE `.offset`, never after.
        // `.offset` is a render-only transform: it moves the drawn result but leaves the
        // view's LAYOUT bounds at the ZStack's top-leading origin. A `.contentShape`
        // applied after it therefore builds the tap target from those un-offset bounds,
        // so every block in a column stacks its hit rect at (0,0) while drawing at
        // (x, top) — taps then resolve by z-order to some OTHER block (wrong contact
        // card), or to a vacant one whose handler no-ops (nothing opens at all).
        // Declared here, the shape is the block's own bounds and `.offset` transforms
        // the rendering and the hit region together.
        .contentShape(Rectangle())
        // `.highPriorityGesture`, not `.onTapGesture`: the block sits inside nested
        // vertical + horizontal `ScrollView`s (the House grid body), whose pan gesture
        // recognizers otherwise win the race for a stationary tap. High-priority still
        // lets a genuine drag pass through once it exceeds the tap gesture's slop.
        .highPriorityGesture(
            TapGesture().onEnded {
                if b.vacant {
                    // A manager on the home house gets the open-seat actions; everyone else
                    // sees an open seat as passive (view-only).
                    if houseModel.state.canManage { houseActionTarget = b }
                } else {
                    contactTarget = b
                }
            }
        )
        .offset(x: x, y: top)
        .accessibilityIdentifier("house_grid_block")
    }

    /// The week navigator (last week … +4) — the same slim bottom bar as My Shifts.
    private func houseWeekNavBar(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 0) {
                if st.canPreviousWeek {
                    Button(action: { houseModel.prevWeek() }) {
                        Image(systemName: "chevron.left").font(.system(size: 18, weight: .semibold))
                            .foregroundColor(c.sec).frame(width: 40, height: 40)
                    }.buttonStyle(.plain).accessibilityIdentifier("house_prev_week")
                } else {
                    Spacer().frame(width: 40)
                }
                Button(action: { showHouseWeekPicker = true }) {
                    HStack(spacing: 7) {
                        Image(systemName: ShiftIcons.calendar).font(.system(size: 18)).foregroundColor(c.blue)
                        Text(st.weekRelative).font(ShiftFont.sans(15.5, .semibold)).foregroundColor(c.ink)
                        Text("·  \(st.weekRange)").font(ShiftFont.sans(14)).foregroundColor(c.sec)
                    }
                    .frame(maxWidth: .infinity).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("house_week_picker_open")
                if st.canNextWeek {
                    Button(action: { houseModel.nextWeek() }) {
                        Image(systemName: "chevron.right").font(.system(size: 18, weight: .semibold))
                            .foregroundColor(c.sec).frame(width: 40, height: 40)
                    }.buttonStyle(.plain).accessibilityIdentifier("house_next_week")
                } else {
                    Spacer().frame(width: 40)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9).background(c.surface)
        }
    }

    /// The week-picker sheet (last week … +4) — mirrors the calendar's picker.
    private func houseWeekPickerSheet(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        ShiftSheet(title: "Pick a week", onClose: { showHouseWeekPicker = false }) {
            VStack(spacing: 8) {
                ForEach(st.weekOptions, id: \.offset) { option in
                    Button(action: {
                        houseModel.selectWeek(Int(option.offset))
                        showHouseWeekPicker = false
                    }) {
                        HStack {
                            Text(option.label).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                            Spacer(minLength: 0)
                            Text(option.rangeLabel).font(ShiftFont.mono(12.5)).monospacedDigit().foregroundColor(c.sec)
                        }
                        .padding(.horizontal, 13).padding(.vertical, 11)
                        .background(Int(st.weekOffset) == Int(option.offset) ? c.today : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(option.offset == 0 ? c.blue : c.divider, lineWidth: option.offset == 0 ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("house_week_picker_option")
                }
            }
            .accessibilityIdentifier("house_week_picker_sheet")
        }
    }

    private func dial(_ phone: String) {
        let digits = phone.filter { !$0.isWhitespace }
        if let url = URL(string: "tel://\(digits)") {
            UIApplication.shared.open(url)
        }
    }

    // MARK: Calendar — agenda-first Personal Calendar (current week only)

    /// The My-Shifts header "?" that replays the interactive shift tour (with a one-time
    /// post-tour "ping" so the worker learns the re-entry point).
    private var myShiftsHelpButton: some View {
        ShiftTourHelpButton { shiftTourModel.replay() }
    }

    private var calendarTab: some View {
        let c = ShiftColors.resolve(scheme)
        let st = calendarModel.state
        return Group {
            if st.mode == .template {
                // D5 — the derived recurring typical week (honestly labelled).
                VStack(alignment: .leading, spacing: 10) {
                    PageTitle(title: "My Shifts") { myShiftsHelpButton }
                    ShiftBanner(
                        title: "Viewing the recurring template",
                        bodyText: "Derived from your scheduled weeks. Permanent drops and swaps change every future week.",
                        tone: .info
                    )
                    .padding(.horizontal, 16)
                    .accessibilityIdentifier("template_banner")
                    if st.template.isEmpty {
                        EmptyState(title: "No recurring slots", systemIcon: ShiftIcons.calendar, bodyText: "Nothing in your SM-built schedule yet.")
                    } else {
                        VStack(spacing: 8) {
                            ForEach(Array(st.template.enumerated()), id: \.offset) { _, slot in
                                templateSlotRow(slot, c)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("calendar_template")
            } else {
                calendarWeekBody(st, c)
            }
        }
        .sheet(isPresented: $showWeekPicker) {
            weekPickerSheet(c)
        }
    }

    private func calendarWeekBody(_ st: CalendarUiState, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "My Shifts") { myShiftsHelpButton }
            // The "This week — Xh of cap" total, carried over from the old My-Shifts tab
            // and placed directly under the title (the hours follow the shown week).
            WeekTotalChip(currentWeeklyHours: st.weekHours, weekOffset: Int(st.weekOffset))
                .padding(.horizontal, 16).padding(.vertical, 4)
                .accessibilityIdentifier("week_total_chip")
            // §7.1 — the float-request carousel sits directly under the hours chip, above
            // the week/day content, so it shows in BOTH modes and an outstanding float can't
            // be missed. Renders nothing when there are no pending floats.
            FloatCarouselView(
                cards: floatCarouselModel.state.cards,
                recentRows: floatCarouselModel.state.recentRows,
                onAccept: { id in
                    // Accept = POST `acknowledge-float` (host, best-effort) AND advance the stack.
                    acceptFloat(id)
                    floatCarouselModel.acknowledge(id)
                },
                onDecline: { id in
                    declineFloat(id)
                    floatCarouselModel.decline(id)
                },
                onOpenDetail: { id in
                    if let float = floatCarouselModel.float(id) { floatDetail = IdentifiedFloatDetail(float: float) }
                }
            )
            .padding(.top, 4).padding(.bottom, 6)
            // The whole-week overview is the default; the Day segment drills into a single day.
            calendarViewToggle(st.mode, c)
            if st.mode == .day {
                // The Mon–Sun day picker only makes sense in Day mode (Week mode already
                // shows every day in the overview), so it expands in / out with the mode.
                weekStrip(st.week, Int(st.selectedDayIndex), c)
                    .transition(.move(edge: .top).combined(with: .opacity))
                dayHeaderRow(st.agenda.header, c)
                if st.agenda.isEmpty {
                    if st.agenda.header.closed {
                        // §3.4/§11.3 (T2-12c): the home house is closed this date.
                        EmptyState(
                            title: "House closed",
                            systemIcon: ShiftIcons.building,
                            bodyText: "Your house is closed this day, so no desk shifts are scheduled."
                        )
                        .padding(.top, 8)
                    } else {
                        EmptyState(
                            title: "No shifts this day",
                            systemIcon: ShiftIcons.calendar,
                            bodyText: "Enjoy the day off, or browse Open Shifts to pick one up."
                        )
                        .padding(.top, 8)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(st.agenda.items.enumerated()), id: \.offset) { _, item in
                            agendaItemView(item, c)
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 4)
                }
            } else {
                calendarWeekOverview(st.weekOverview, c)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Animate the day-strip expand/collapse (and the day↔week content swap) on mode change.
        .animation(.easeInOut(duration: 0.25), value: st.mode)
        // See the matching comment on `shifts_screen` above — a non-wrapping marker, not the
        // container itself, so this identifier doesn't leak onto every descendant (the "?"
        // help button, the week toggle, etc.) in the XCUITest tree.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("calendar_screen")
        }
    }

    /// Renders one agenda row: the NOW divider or a shift card (shared by Day + Week
    /// views). Tapping a shift card opens the drop sheet (§5.2; pivots to swap, §8).
    @ViewBuilder
    private func agendaItemView(_ item: CalendarAgendaItem, _ c: ShiftColors) -> some View {
        if let nowLabel = item.nowLabel {
            nowLine(nowLabel, c)
        } else if let shift = item.shift {
            if let mark = item.swap {
                swapAgendaCard(shift, mark: mark, past: item.past, c)
                    .opacity(item.past ? 0.55 : 1)
            } else {
                ShiftCard(
                    state: kitState(shift.state),
                    houseInitial: shift.houseInitial,
                    timeLabel: shift.timeLabel,
                    houseName: shift.houseName,
                    destination: shift.destination,
                    durationLabel: shift.durationLabel,
                    active: item.active,
                    onTap: { if let s = calendarModel.vm.shiftForCard(cardId: shift.id) { dropTarget = s } }
                )
                .accessibilityIdentifier("calendar_shift_card")
                // A fully-passed shift renders slightly inactive (greyed); future + in-progress stay full.
                .opacity(item.past ? 0.55 : 1)
            }
        }
    }

    /// A shift with a pending swap: a distinct tinted card — orange for an INCOMING request
    /// (tap → accept/decline popup), brand-blue for an OUTGOING one you proposed (marker only).
    private func swapAgendaCard(_ shift: MyShiftRow, mark: AgendaSwapMark, past: Bool, _ c: ShiftColors) -> some View {
        let incoming = mark.incoming
        let accent = incoming ? c.pending : c.blue
        let tint = incoming ? c.warnSoft : c.blue.opacity(0.10)
        return Button(action: {
            // Incoming → accept/decline popup; outgoing → the "swap pending" notice (the
            // shift is tied up, so the drop sheet would just fail server-side).
            if incoming {
                decisionTarget = calendarModel.decisionFor(mark.swapId).map { IdentifiedSwapDecision(decision: $0) }
            } else {
                pendingNotice = calendarModel.vm.pendingSwapNoticeFor(swapId: mark.swapId).map { IdentifiedPendingSwapNotice(notice: $0) }
            }
        }) {
            HStack(spacing: 12) {
                HouseBadge(initial: shift.houseInitial, bg: c.surface, fg: c.ink)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(shift.timeLabel).font(ShiftFont.mono(15, .medium)).foregroundColor(c.ink)
                        DurationChip(label: shift.durationLabel)
                    }
                    if let house = shift.houseName {
                        Text(house).font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                    }
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Image(systemName: incoming ? ShiftIcons.bell : ShiftIcons.refresh).font(.system(size: 12)).foregroundColor(accent)
                    Text(incoming ? "Swap request" : "Swap pending").font(ShiftFont.sans(11, .medium)).foregroundColor(accent)
                }
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(c.surface).clipShape(Capsule())
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(tint)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(accent.opacity(0.55), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("calendar_shift_card_swap")
    }

    /// Week / Day segmented toggle in the calendar header.
    private func calendarViewToggle(_ mode: CalendarMode, _ c: ShiftColors) -> some View {
        HStack {
            HStack(spacing: 3) {
                calendarToggleSegment("Week", mode == .week, c) { calendarModel.vm.showWeek() }
                    .accessibilityIdentifier("calendar_view_week")
                calendarToggleSegment("Day", mode == .day, c) {
                    calendarModel.vm.selectDay(index: calendarModel.state.selectedDayIndex)
                }
                .accessibilityIdentifier("calendar_view_day")
            }
            .padding(3)
            .background(c.surfaceVar)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityIdentifier("calendar_view_toggle")
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 4)
    }

    private func calendarToggleSegment(
        _ label: String,
        _ active: Bool,
        _ c: ShiftColors,
        fill: Bool = false,
        _ action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(ShiftFont.sans(fill ? 14 : 13, active ? .semibold : .medium))
                .foregroundColor(active ? c.ink : c.sec)
                .frame(maxWidth: fill ? .infinity : nil)
                .padding(.horizontal, fill ? 8 : 18).padding(.vertical, fill ? 9 : 6)
                .background(active ? c.surface : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                // Make the WHOLE segment (text + padding + full width when filled) the tap
                // target, not just the glyphs — tapping anywhere on the segment switches.
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The whole-week overview (default calendar view): every Mon–Sun day as a section —
    /// its header + agenda rows, empty days shown compactly. The NOW line appears only in
    /// today's section (the shared builder gates it).
    ///
    /// On the ongoing week the shared builder folds days that already happened into
    /// `overview.collapsedPastDays`; they render as one expandable card pinned at the top
    /// (`pastDaysCard`) so today is the first day in view. Navigated and whole-past weeks
    /// fold nothing, so `overview.activeDays` is the full Mon–Sun list.
    private func calendarWeekOverview(_ overview: CalendarWeekOverview?, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let overview, overview.hasCollapsedPast {
                pastDaysCard(overview.collapsedPastDays, Int(overview.collapsedShiftCount), c)
                    .padding(.horizontal, 16)
            }
            ForEach(overview?.activeDays ?? [], id: \.dayIndex) { section in
                calendarDaySection(section, c)
            }
        }
        .padding(.top, 10)
        .padding(.bottom, 24)
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping VStack leaks onto every descendant element in the XCUITest tree, shadowing
        // each shift row's own calendar_shift_card identifier.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("calendar_week_overview")
        }
    }

    /// One Mon–Sun day in the week overview: header + agenda rows, or the empty-day treatment.
    @ViewBuilder
    private func calendarDaySection(_ section: CalendarDaySection, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            dayHeaderRow(section.header, c)
            if section.isEmpty {
                Text(section.header.closed ? "House closed" : "No shifts")
                    .font(ShiftFont.sans(13)).foregroundColor(c.ter)
                    .padding(.leading, 18).padding(.bottom, 4)
                // An empty TODAY still gets the NOW line (the shared builder always
                // inserts one for today), so the live time is visible even on a day
                // off rather than only appearing once a shift exists.
                if let nowLabel = section.items.first(where: { $0.nowLabel != nil })?.nowLabel {
                    nowLine(nowLabel, c).padding(.horizontal, 16)
                }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
                        agendaItemView(item, c)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping container leaks onto every descendant element in the XCUITest tree,
        // shadowing each row's own calendar_shift_card identifier.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("calendar_day_section")
        }
    }

    /// The ongoing week's already-passed days, folded into one expandable card pinned at the
    /// top of the overview (collapsed by default, so today leads the list). Expanding reveals
    /// a compact per-day mini row for each folded day — weekday + date + its held-hours
    /// summary (or "No shifts") — with the day's shift(s) shown inline and read-only. Past
    /// shifts are not actionable, so the cards carry no tap target.
    @ViewBuilder
    private func pastDaysCard(_ days: [CalendarDaySection], _ shiftCount: Int, _ c: ShiftColors) -> some View {
        let subtitle: String = {
            var s = "\(days.count) \(days.count == 1 ? "day" : "days")"
            if shiftCount > 0 { s += " · \(shiftCount) \(shiftCount == 1 ? "shift" : "shifts")" }
            return s
        }()
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { pastDaysExpanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(c.sec)
                        .rotationEffect(.degrees(pastDaysExpanded ? 90 : 0))
                    Text(pastDaysExpanded ? "Earlier this week" : "Show earlier this week")
                        .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Spacer(minLength: 8)
                    Text(subtitle).font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("calendar_past_days_toggle")

            if pastDaysExpanded {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(days, id: \.dayIndex) { section in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .bottom, spacing: 6) {
                                Text(section.header.title).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                                Text("· \(section.header.dateLabel)").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                                Spacer(minLength: 8)
                                if let summary = section.header.summary {
                                    Text(summary).font(ShiftFont.mono(12.5)).monospacedDigit().foregroundColor(c.sec)
                                } else {
                                    Text("No shifts").font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                                }
                            }
                            ForEach(Array(section.items.filter { $0.shift != nil }.enumerated()), id: \.offset) { _, item in
                                if let shift = item.shift {
                                    ShiftCard(
                                        state: kitState(shift.state),
                                        houseInitial: shift.houseInitial,
                                        timeLabel: shift.timeLabel,
                                        houseName: shift.houseName,
                                        destination: shift.destination,
                                        durationLabel: shift.durationLabel,
                                        active: false,
                                        onTap: {}
                                    )
                                    .opacity(0.55)
                                    .accessibilityIdentifier("calendar_shift_card")
                                }
                            }
                        }
                        .accessibilityIdentifier("calendar_past_day_row")
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 10)
            }
        }
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityIdentifier("calendar_past_days_card")
    }

    /// "This week" / "Next week" / … for a week [offset] (0 = current).
    private func weekOffsetTitle(_ offset: Int) -> String {
        switch offset {
        case 0: return "This week"
        case 1: return "Next week"
        case -1: return "Last week"
        case let o where o > 1: return "In \(o) weeks"
        default: return "\(-offset) weeks ago"
        }
    }

    /// The week navigator — a slim bar pinned at the BOTTOM of My Shifts (above the tab
    /// bar): ‹ {title} · {range} › with the centre tappable to open the week picker.
    /// prev/next step weeks (hidden in template mode). Selectors carry over so Maestro
    /// flow 09 is unchanged.
    private var weekNavBar: some View {
        let c = ShiftColors.resolve(scheme)
        let st = calendarModel.state
        let template = st.mode == .template
        let title = template ? "Recurring template" : weekOffsetTitle(Int(st.weekOffset))
        let range = template ? "Derived from your scheduled weeks" : st.week.rangeLabel
        return VStack(spacing: 0) {
            Divider()
            HStack(spacing: 0) {
                if template {
                    Spacer().frame(width: 40)
                } else {
                    Button(action: { calendarModel.vm.previousWeek() }) {
                        Image(systemName: "chevron.left").font(.system(size: 18, weight: .semibold))
                            .foregroundColor(c.sec).frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("calendar_prev_week")
                }
                Button(action: { showWeekPicker = true }) {
                    HStack(spacing: 7) {
                        Image(systemName: ShiftIcons.calendar).font(.system(size: 18)).foregroundColor(c.blue)
                        Text(title).font(ShiftFont.sans(15.5, .semibold)).foregroundColor(c.ink)
                        Text("·  \(range)").font(ShiftFont.sans(14)).foregroundColor(c.sec)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("calendar_week_picker_open")
                if template {
                    Spacer().frame(width: 40)
                } else {
                    Button(action: { calendarModel.vm.nextWeek() }) {
                        Image(systemName: "chevron.right").font(.system(size: 18, weight: .semibold))
                            .foregroundColor(c.sec).frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("calendar_next_week")
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .background(c.surface)
        }
    }

    /// D5 — one quick-week row + the template entry.
    private func weekPickerSheet(_ c: ShiftColors) -> some View {
        ShiftSheet(title: "Pick a week", onClose: { showWeekPicker = false }) {
            VStack(spacing: 8) {
                ForEach(calendarModel.vm.weekOptions(), id: \.offset) { option in
                    Button(action: {
                        calendarModel.vm.selectWeekOffset(offset: option.offset)
                        showWeekPicker = false
                    }) {
                        HStack {
                            Text(option.label).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                            Spacer(minLength: 0)
                            Text(option.rangeLabel).font(ShiftFont.mono(12.5)).monospacedDigit().foregroundColor(c.sec)
                        }
                        .padding(.horizontal, 13).padding(.vertical, 11)
                        .background(Int(calendarModel.state.weekOffset) == Int(option.offset) ? c.today : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(option.offset == 0 ? c.blue : c.divider, lineWidth: option.offset == 0 ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("week_picker_option")
                }
                Button(action: {
                    calendarModel.vm.showTemplate()
                    showWeekPicker = false
                }) {
                    HStack {
                        Text("Recurring template").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.sec)
                        Spacer(minLength: 0)
                        Text("derived").font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                    }
                    .padding(.horizontal, 13).padding(.vertical, 11)
                    .background(c.surfaceVar)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("week_picker_template")
            }
            .accessibilityIdentifier("week_picker_sheet")
        }
    }

    /// The Open-Shifts week navigator — same slim bottom bar as My Shifts, but driven by
    /// the INDEPENDENT open-week offset (last week … +4 weeks) and scoping BOTH sub-tabs.
    private var openWeekNavBar: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(spacing: 0) {
            Divider()
            HStack(spacing: 0) {
                Button(action: { model.vm.previousOpenWeek() }) {
                    Image(systemName: "chevron.left").font(.system(size: 18, weight: .semibold))
                        .foregroundColor(c.sec).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("open_prev_week")
                Button(action: { showOpenWeekPicker = true }) {
                    HStack(spacing: 7) {
                        Image(systemName: ShiftIcons.calendar).font(.system(size: 18)).foregroundColor(c.blue)
                        Text(weekOffsetTitle(Int(st.openWeekOffset))).font(ShiftFont.sans(15.5, .semibold)).foregroundColor(c.ink)
                        Text("·  \(st.openWeekRangeLabel)").font(ShiftFont.sans(14)).foregroundColor(c.sec)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("open_week_picker_open")
                Button(action: { model.vm.nextOpenWeek() }) {
                    Image(systemName: "chevron.right").font(.system(size: 18, weight: .semibold))
                        .foregroundColor(c.sec).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("open_next_week")
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .background(c.surface)
        }
        .sheet(isPresented: $showOpenWeekPicker) { openWeekPickerSheet(c) }
    }

    /// The Open-Shifts quick-week picker (last week … in 4 weeks). No template entry.
    private func openWeekPickerSheet(_ c: ShiftColors) -> some View {
        ShiftSheet(title: "Pick a week", onClose: { showOpenWeekPicker = false }) {
            VStack(spacing: 8) {
                ForEach(model.vm.openWeekOptions(), id: \.offset) { option in
                    Button(action: {
                        model.vm.selectOpenWeekOffset(offset: option.offset)
                        showOpenWeekPicker = false
                    }) {
                        HStack {
                            Text(option.label).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                            Spacer(minLength: 0)
                            Text(option.rangeLabel).font(ShiftFont.mono(12.5)).monospacedDigit().foregroundColor(c.sec)
                        }
                        .padding(.horizontal, 13).padding(.vertical, 11)
                        .background(Int(model.state.openWeekOffset) == Int(option.offset) ? c.today : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(option.offset == 0 ? c.blue : c.divider, lineWidth: option.offset == 0 ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("open_week_picker_option")
                }
            }
            .accessibilityIdentifier("open_week_picker_sheet")
        }
    }

    /// One derived recurring slot row.
    private func templateSlotRow(_ slot: TemplateSlot, _ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            Text(slot.dayLabel).font(ShiftFont.sans(13.5, .bold)).foregroundColor(c.ink)
            VStack(alignment: .leading, spacing: 1) {
                Text(slot.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                Text("\(slot.houseName) · \(slot.durationLabel)").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            Text(slot.weeksSeen > 1 ? "seen \(slot.weeksSeen) weeks" : "seen once")
                .font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("template_slot_row")
    }

    private func weekStrip(_ week: CalendarWeek, _ selected: Int, _ c: ShiftColors) -> some View {
        HStack(spacing: 2) {
            ForEach(week.days, id: \.index) { day in
                weekDayCell(day, Int(day.index) == selected, c)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 2)
        .accessibilityIdentifier("calendar_week_strip")
    }

    private func weekDayCell(_ day: WeekDayCell, _ selected: Bool, _ c: ShiftColors) -> some View {
        Button(action: { calendarModel.vm.selectDay(index: day.index) }) {
            VStack(spacing: 4) {
                Text(day.dayLetter).font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ter)
                ZStack {
                    // §3.4 closed-day cell (T2-12c) — muted fill behind the date.
                    Circle()
                        .fill(selected ? c.blue : (day.closed ? c.surfaceVar : Color.clear))
                        .frame(width: 34, height: 34)
                    if day.isToday && !selected {
                        Circle().strokeBorder(c.blue, lineWidth: 1.5).frame(width: 34, height: 34)
                    }
                    Text(day.dateLabel)
                        .font(ShiftFont.sans(14, day.isToday ? .bold : .medium))
                        .foregroundColor(selected ? .white : (day.closed ? c.ter : c.ink))
                }
                .accessibilityIdentifier(day.closed ? "calendar_closed_day" : "")
                Circle().fill(day.hasShifts ? c.blue : Color.clear).frame(width: 5, height: 5)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("calendar_day_cell")
    }

    private func dayHeaderRow(_ header: CalendarDayHeader, _ c: ShiftColors) -> some View {
        HStack(alignment: .bottom) {
            HStack(alignment: .bottom, spacing: 6) {
                Text(header.title).font(ShiftFont.sans(17, .bold)).foregroundColor(c.ink)
                Text("· \(header.dateLabel)").font(ShiftFont.sans(15, .medium)).foregroundColor(c.ter)
                if header.closed {
                    // §3.4/§11.3 — the home house is closed this date.
                    Text("Closed")
                        .font(ShiftFont.sans(11.5, .semibold))
                        .foregroundColor(c.sec)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(c.surfaceVar)
                        .clipShape(Capsule())
                        .accessibilityIdentifier("calendar_closed_chip")
                }
            }
            Spacer()
            if let summary = header.summary {
                Text(summary).font(ShiftFont.mono(13)).monospacedDigit().foregroundColor(c.sec)
            }
        }
        .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 10)
    }

    private func nowLine(_ label: String, _ c: ShiftColors) -> some View {
        HStack(spacing: 9) {
            Circle().fill(c.danger.accent).frame(width: 9, height: 9)
            Text(label).font(ShiftFont.mono(12, .semibold)).monospacedDigit().foregroundColor(c.danger.accent)
            Rectangle().fill(c.danger.accent.opacity(0.45)).frame(height: 1.5).clipShape(Capsule())
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Open-shift state mapping (shared by the feeds + the claim sheet)

private func openKitState(_ s: OpenShiftCardState) -> ShiftState {
    switch s {
    case .open: return .open
    case .unpickable: return .unpickable
    case .permanent: return .permanent
    default: return .open
    }
}

private func isPermanentOpen(_ s: OpenShiftCardState) -> Bool {
    switch s {
    case .permanent: return true
    default: return false
    }
}

/// A two-thumb range slider over a shift's 30-min blocks — one slider unit per block, so
/// the thumbs snap on 30-minute boundaries. The selected zone `[from, to)` is app blue;
/// the rest of the track is a lighter blue. Mirrors Android's Material `RangeSlider` and
/// drives the same `rangeFrom` / `rangeTo` block indexes the §5.2/§5.3 partial plans use.
// Internal (not private): reused by the interactive onboarding tour (ShiftTourView) so the
// tour teaches the exact two-handle range gesture the worker will use.
struct BlockRangeSlider: View {
    let blockCount: Int
    @Binding var from: Int // 0 ..< to
    @Binding var to: Int // from+1 ... blockCount
    // The free run the handles are clamped to (so they can't cross a locked zone). Defaults
    // to the whole track; the track unit stays block-absolute so the selection aligns to time.
    var lowerBound: Int = 0
    var upperBound: Int = -1 // -1 → blockCount
    @Environment(\.colorScheme) private var scheme

    private let thumb: CGFloat = 24
    private let track: CGFloat = 6
    private let space = "blockRangeSlider"

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        GeometryReader { geo in
            let span = max(geo.size.width - thumb, 1)
            let unit = span / CGFloat(max(blockCount, 1))
            let fromX = thumb / 2 + unit * CGFloat(clamp(from))
            let toX = thumb / 2 + unit * CGFloat(clamp(to))
            let midY = geo.size.height / 2
            ZStack {
                // Not-selected zone — the full track in a lighter blue.
                Capsule()
                    .fill(c.blue.opacity(0.2))
                    .frame(width: geo.size.width, height: track)
                    .position(x: geo.size.width / 2, y: midY)
                // Selected zone [from, to) — app blue.
                Capsule()
                    .fill(c.blue)
                    .frame(width: max(toX - fromX, track), height: track)
                    .position(x: (fromX + toX) / 2, y: midY)
                thumbView(c)
                    .position(x: fromX, y: midY)
                    .gesture(drag(unit: unit, isFrom: true))
                thumbView(c)
                    .position(x: toX, y: midY)
                    .gesture(drag(unit: unit, isFrom: false))
            }
            .coordinateSpace(name: space)
        }
        .frame(height: 32)
        .accessibilityIdentifier("range_slider")
    }

    private func clamp(_ v: Int) -> Int { min(max(v, 0), blockCount) }

    private func thumbView(_ c: ShiftColors) -> some View {
        Circle()
            .fill(.white)
            .frame(width: thumb, height: thumb)
            .overlay(Circle().strokeBorder(c.blue, lineWidth: 2))
            .shadow(color: .black.opacity(0.15), radius: 2, x: 0, y: 1)
    }

    private func drag(unit: CGFloat, isFrom: Bool) -> some Gesture {
        let lo = max(lowerBound, 0)
        let hi = upperBound < 0 ? blockCount : min(upperBound, blockCount)
        return DragGesture(minimumDistance: 0, coordinateSpace: .named(space))
            .onChanged { value in
                let snapped = Int(((value.location.x - thumb / 2) / unit).rounded())
                if isFrom {
                    from = min(max(snapped, lo), to - 1)
                } else {
                    to = max(min(snapped, hi), from + 1)
                }
            }
    }
}

// MARK: - Claim flow (§5.3 / §5.4) — the design `ClaimSheet`

/// The claim / pick-up sheet (worker-app.html `ClaimSheet`): a shift summary, the
/// "this brings your week to Xh of Yh" meter, and the §5.3 cap gating. A soft-cap
/// claim is a two-step confirm (warning → "Claim anyway" → `claim_confirm_button`)
/// so the Maestro `soft_cap_*` contract holds; a break hard-cap disables the
/// confirm. On confirm the sheet dismisses and the screen shows the `claim_success`
/// toast — the picked-up shift is already in My Shifts.
private struct ClaimFlowSheet: View {
    let vm: ShiftsScreenViewModel
    let shift: OpenShift
    let currentWeeklyHours: Double
    /// Live host GETs the `permanent-pickup` dry-run SCOPE; nil on the demo path → plain note.
    var loadPermanentScope: ((OpenShift) async -> PermanentPickupScope?)? = nil
    /// Receives the EFFECTIVE open shift — the §5.3 partial selection (T2-10), or the whole
    /// card — and the success-toast message ("Picked up X of Y weeks" for a permanent pickup,
    /// the claim message otherwise). Partial selection applies to BOTH weekly and permanent
    /// openings.
    let onConfirmed: (OpenShift, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var warningAccepted = false
    @State private var permanentScope: PermanentPickupScope?
    // §5.3 partial range (T2-10) — block indexes on the opening's own grid, [from, to).
    // rangeTo < 0 means "whole opening" (the default; planClaimRange clamps).
    @State private var rangeFrom = 0
    @State private var rangeTo = -1

    private var blockCount: Int { shift.blockIds.count }
    private var effectiveTo: Int { rangeTo < 0 ? blockCount : rangeTo }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let claimable = vm.claimable(shift: shift)
        let row = shift.toRow(claimable: claimable, zone: ShiftsKt.NEW_YORK)
        let permanent = isPermanentOpen(row.state)
        let plan = vm.planClaimRange(shift: shift, fromBlock: Int32(rangeFrom), toBlock: Int32(effectiveTo))
        // The shift the confirm actually claims; the meter + cap gating recompute from
        // this SELECTED span (§5.3) — for BOTH weekly and permanent openings.
        let effective = plan.wholeShift ? shift : subOpenShiftFor(shift: shift, plan: plan)
        let meter = claimMeter(
            currentWeeklyHours: currentWeeklyHours,
            addedHours: hoursBetween(start: effective.start, end: effective.end),
            breakProfile: false
        )
        let overHard = meter.verdict.isBlocked
        let overSoft = meter.verdict.needsWarning

        ShiftSheet(title: permanent ? "Pick up permanently" : "Claim shift", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 16) {
                // Shift summary — badge + mono time + house · duration · day.
                HStack(spacing: 12) {
                    HouseBadge(
                        initial: row.houseInitial,
                        bg: permanent ? c.permanent.tint : c.surfaceVar,
                        fg: permanent ? c.permanent.deep : c.ink
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.timeLabel).font(ShiftFont.mono(20, .semibold)).monospacedDigit().foregroundColor(c.ink)
                        Text("\(row.houseName) · \(row.durationLabel) · \(row.dayLabel)")
                            .font(ShiftFont.sans(13.5)).foregroundColor(c.sec)
                    }
                }

                if permanent {
                    PermanentRecurringNote(row: row, scope: permanentScope)
                        .task {
                            // Dry-run the pickup so the confirm shows "Picking up N of M weeks ·
                            // K skipped" (§8.4.3). Nil until loaded / demo → just the plain note.
                            if let load = loadPermanentScope {
                                permanentScope = await load(shift)
                            }
                        }
                }

                // Shown for BOTH weekly and permanent openings (>1 block), so a permanent
                // pickup can take just a sub-range of the recurring slot (§5.3 / §8.4.3).
                if blockCount > 1 {
                    claimRangeSelector(plan, c)
                }

                ClaimHoursMeter(meter: meter)

                if overSoft {
                    ShiftBanner(
                        title: "Puts you over the 20h soft cap",
                        bodyText: "Allowed this period, but your manager sees the overage.",
                        tone: .warning
                    )
                    .accessibilityIdentifier("soft_cap_warning_modal")
                }
                if overHard {
                    ShiftBanner(
                        title: "Over the 40h limit, can't claim",
                        bodyText: "Break-period hard cap. Drop another shift first.",
                        tone: .error
                    )
                }

                HStack(spacing: 10) {
                    ShiftButton(title: "Cancel", action: { dismiss() }, variant: .outlined, fullWidth: true)
                    if overSoft && !warningAccepted {
                        ShiftButton(title: "Claim anyway", action: { warningAccepted = true }, fullWidth: true)
                            .accessibilityIdentifier("soft_cap_confirm_button")
                    } else {
                        ShiftButton(
                            // The duration ("Claim 1h"), not the range — the half-width
                            // button truncates the full range label; the selected range
                            // is already shown in the selector above.
                            title: permanent
                                ? (plan.wholeShift ? "Confirm pickup" : "Pick up \(plan.durationLabel)")
                                : (plan.wholeShift ? "Claim shift" : "Claim \(plan.durationLabel)"),
                            action: {
                                // Permanent pickup of the WHOLE slot → "Picked up X of Y weeks"
                                // from the dry-run scope; a sub-range pickup or unknown scope →
                                // the generic confirmation; a weekly claim → the claim toast.
                                let message: String
                                if permanent, plan.wholeShift, let scope = permanentScope {
                                    message = permanentPickupToast(
                                        weeksPickedUp: scope.weeksPickedUp,
                                        totalWeeks: scope.totalWeeksInScope,
                                        weeksSkipped: scope.weeksSkipped
                                    )
                                } else if permanent {
                                    message = "Picked up. It's now in My Shifts"
                                } else {
                                    message = "Claimed. It's now in My Shifts"
                                }
                                onConfirmed(effective, message)
                                dismiss()
                            },
                            fullWidth: true
                        )
                        .disabled(overHard)
                        .accessibilityIdentifier("claim_confirm_button")
                    }
                }
            }
        }
    }

    /// The §5.3 "How much can you cover?" block-range selector (T2-10): a two-thumb range
    /// slider over the opening's 30-min block boundaries with a live summary. Defaults to
    /// the whole opening.
    private func claimRangeSelector(_ plan: PartialClaimPlan, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("How much can you cover?").font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
            Text("\(plan.rangeLabel) · \(plan.durationLabel)\(plan.wholeShift ? " · whole shift" : "")")
                .font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
                .accessibilityIdentifier("claim_range_label")
            BlockRangeSlider(
                blockCount: blockCount,
                from: $rangeFrom,
                to: Binding(get: { effectiveTo }, set: { rangeTo = $0 })
            )
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("claim_range_selector")
    }
}

/// The "this brings your week to {after}h of {cap}h" meter + progress bar (§5.3 caps).
private struct ClaimHoursMeter: View {
    let meter: ClaimMeter
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let overHard = meter.verdict.isBlocked
        let overSoft = meter.verdict.needsWarning
        let emphasis = overHard ? c.danger.accent : (overSoft ? c.pending : c.ink)
        let barColor = overHard ? c.danger.accent : (overSoft ? c.pending : c.blue)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("This brings your week to").font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
                Spacer()
                Text("\(meter.afterLabel) of \(meter.capLabel)")
                    .font(ShiftFont.mono(13, .semibold)).monospacedDigit().foregroundColor(emphasis)
            }
            // Track + where-you-are-now (ghost) + where-this-claim-takes-you (colored).
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(c.surfaceVar)
                    Capsule().fill(c.ink.opacity(0.22)).frame(width: geo.size.width * CGFloat(meter.currentFraction))
                    Capsule().fill(barColor).frame(width: geo.size.width * CGFloat(meter.afterFraction))
                }
            }
            .frame(height: 8)
        }
    }
}

/// The recurring-slot note shown when picking up a permanent opening (design `ClaimSheet`).
/// When the `permanent-pickup` dry-run [scope] has resolved, it adds the §8.4.3 "Picking up
/// N of M weeks · K skipped" line so the worker sees how the slot lands against their caps +
/// existing shifts before committing; before that (or on the demo path) only the plain note.
private struct PermanentRecurringNote: View {
    let row: OpenShiftRow
    var scope: PermanentPickupScope?
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return VStack(alignment: .leading, spacing: 3) {
            Text("Recurring · \(row.dayLabel) · \(row.timeLabel)")
                .font(ShiftFont.sans(13, .semibold)).foregroundColor(c.permanent.deep)
            if let meta = row.meta {
                Text("Repeats weekly: \(meta).").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            if let scope {
                let skipped = scope.weeksSkipped > 0 ? " · \(scope.weeksSkipped) skipped" : ""
                Text("Picking up \(scope.weeksPickedUp) of \(scope.totalWeeksInScope) weeks\(skipped)")
                    .font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.permanent.deep)
                    .accessibilityIdentifier("permanent_pickup_scope")
            }
        }
        .padding(.horizontal, 13).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.permanent.tint)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - Root-level tour overlays (extracted `ViewModifier`s)
//
// Each wraps one tour's overlay + pointer-callout + post-finish-pointer `onChange` — the
// same three-step shape as shiftTourModel's inline block in `ShiftsRootView.body`. Pulled
// out to their own `ViewModifier`s (rather than chained inline) purely to keep the Swift
// type-checker's job on `body` tractable; see the `.modifier(...)` call sites in
// `ShiftsRootView.body` for why.

private struct PreferencesTourOverlay: ViewModifier {
    @ObservedObject var model: PreferencesTourObservable
    @Binding var showPointer: Bool

    func body(content: Content) -> some View {
        content
            .overlay {
                if model.state.active {
                    // Tapping away is a quick "not now", not the natural finish the
                    // one-time store gates on below -- always re-point at the header "?"
                    // so the worker still learns where to pick the tour back up.
                    PreferencesTourView(
                        model: model,
                        onDismissOutside: {
                            showPointer = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .overlayPreferenceValue(PreferencesTourHelpAnchorKey.self) { anchor in
                GeometryReader { proxy in
                    if showPointer, let anchor {
                        PreferencesTourPointerCallout(targetRect: proxy[anchor], fullSize: proxy.size)
                            .transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.25), value: showPointer)
            }
            .onChange(of: model.state.active) { active in
                if !active, model.isDone, !PreferencesTourPointerStore.hasShown() {
                    PreferencesTourPointerStore.markShown()
                    showPointer = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                }
            }
    }
}

private struct BreakTourOverlay: ViewModifier {
    @ObservedObject var model: BreakTourObservable
    @Binding var showPointer: Bool

    func body(content: Content) -> some View {
        content
            .overlay {
                if model.state.active {
                    BreakTourView(
                        model: model,
                        onDismissOutside: {
                            showPointer = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .overlayPreferenceValue(BreakTourHelpAnchorKey.self) { anchor in
                GeometryReader { proxy in
                    if showPointer, let anchor {
                        BreakTourPointerCallout(targetRect: proxy[anchor], fullSize: proxy.size)
                            .transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.25), value: showPointer)
            }
            .onChange(of: model.state.active) { active in
                if !active, model.isDone, !BreakTourPointerStore.hasShown() {
                    BreakTourPointerStore.markShown()
                    showPointer = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                }
            }
    }
}

private struct HouseGridTourOverlay: ViewModifier {
    @ObservedObject var model: HouseGridTourObservable
    @Binding var showPointer: Bool

    func body(content: Content) -> some View {
        content
            .overlay {
                if model.state.active {
                    HouseGridTourView(
                        model: model,
                        onDismissOutside: {
                            showPointer = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .overlayPreferenceValue(HouseGridTourHelpAnchorKey.self) { anchor in
                GeometryReader { proxy in
                    if showPointer, let anchor {
                        HouseGridTourPointerCallout(targetRect: proxy[anchor], fullSize: proxy.size)
                            .transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.25), value: showPointer)
            }
            .onChange(of: model.state.active) { active in
                if !active, model.isDone, !HouseGridTourPointerStore.hasShown() {
                    HouseGridTourPointerStore.markShown()
                    showPointer = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                }
            }
    }
}

private struct OpenClaimTourOverlay: ViewModifier {
    @ObservedObject var model: OpenClaimTourObservable
    @Binding var showPointer: Bool

    func body(content: Content) -> some View {
        content
            .overlay {
                if model.state.active {
                    OpenClaimTourView(
                        model: model,
                        onDismissOutside: {
                            showPointer = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                        }
                    )
                    .transition(.opacity)
                }
            }
            .overlayPreferenceValue(OpenClaimTourHelpAnchorKey.self) { anchor in
                GeometryReader { proxy in
                    if showPointer, let anchor {
                        OpenClaimTourPointerCallout(targetRect: proxy[anchor], fullSize: proxy.size)
                            .transition(.opacity)
                    }
                }
                .animation(.easeOut(duration: 0.25), value: showPointer)
            }
            .onChange(of: model.state.active) { active in
                if !active, model.isDone, !OpenClaimTourPointerStore.hasShown() {
                    OpenClaimTourPointerStore.markShown()
                    showPointer = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { showPointer = false }
                }
            }
    }
}

// MARK: - Drop flow (§5.2)

private enum ManagePageKind { case manage, swap }

/// The manage-shift sheet (§5.2 / §8) — ONE sheet with two in-place pages: the Drop/Swap
/// chooser (Option C) and, when the worker proceeds to swap, the week-paged give/take picker.
/// "Choose who to swap with" PUSHES the swap page within the SAME sheet (a back chevron
/// returns) rather than dismissing and presenting a new sheet; the selected range + scope
/// carry into the give.
private struct ManageShiftSheet: View {
    let vm: ShiftsScreenViewModel
    let shift: MyShift
    var onDrop: ((MyShift, Bool) -> Void)? = nil
    var swapKinds: [SwapKind] = []
    let meUserId: String?
    let repo: WorkerShiftsRepository?
    let demoSeats: [HouseSeat]
    var pendingGiveAssignmentIds: Set<String> = []
    let onSubmitSwap: ([SwapProposal]) -> Void
    // The swap-composer tour. Auto-opens the FIRST time the worker reaches the swap page
    // (not the manage page — Drop-vs-Swap is ShiftTour's job, not this tour's). See
    // SwapTourView.swift.
    @ObservedObject var swapTourModel: SwapTourObservable
    @Environment(\.dismiss) private var dismiss
    @State private var page: ManagePageKind = .manage
    @State private var swapGive: MyShift?
    @State private var swapPermanent = false
    // One-shot pointer callout on the swap page's help "?" after the tour first finishes.
    @State private var showSwapTourPointer = false

    var body: some View {
        ShiftSheet(
            title: page == .swap ? "Propose a swap" : "Manage shift",
            onBack: page == .swap ? { withAnimation(.easeInOut(duration: 0.25)) { page = .manage } } : nil,
            onClose: { dismiss() }
        ) {
            ZStack {
                if page == .manage {
                    ManagePageContent(
                        vm: vm, shift: shift, onDrop: onDrop, swapKinds: swapKinds,
                        onProposeSwap: { sub, permanent in
                            swapGive = sub
                            swapPermanent = permanent
                            withAnimation(.easeInOut(duration: 0.25)) { page = .swap }
                        }
                    )
                    .transition(.move(edge: .leading).combined(with: .opacity))
                } else if let give = swapGive {
                    SwapCalendarPage(
                        giveShift: give, meUserId: meUserId, repo: repo, demoSeats: demoSeats,
                        initialPermanent: swapPermanent, pendingGiveAssignmentIds: pendingGiveAssignmentIds,
                        onSubmit: onSubmitSwap
                    )
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            // The composer's own help "?", floating top-trailing since ShiftSheet's header
            // has no trailing accessory slot (its close ✕ already owns that spot).
            .overlay(alignment: .topTrailing) {
                if page == .swap {
                    SwapTourHelpButton { swapTourModel.replay() }
                        .padding(.top, 2).padding(.trailing, 2)
                }
            }
        }
        // The tour overlay sits ABOVE the sheet's own content (inside the sheet, since a
        // root-level overlay would render BEHIND this modal `.sheet` presentation). Gated on
        // `page == .swap` too: a Settings "Replay swap tour" flips `active` true immediately
        // (before the sheet may even be open), and it must stay invisible until the worker
        // actually reaches the swap page, not show over the Drop/Swap manage page.
        .overlay {
            if swapTourModel.state.active, page == .swap {
                SwapTourView(
                    model: swapTourModel,
                    onDismissOutside: {
                        showSwapTourPointer = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                            showSwapTourPointer = false
                        }
                    }
                )
                .transition(.opacity)
            }
        }
        .overlayPreferenceValue(SwapTourHelpAnchorKey.self) { anchor in
            GeometryReader { proxy in
                if showSwapTourPointer, let anchor {
                    SwapTourPointerCallout(targetRect: proxy[anchor], fullSize: proxy.size)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.25), value: showSwapTourPointer)
        }
        .onChange(of: page) { newPage in
            if newPage == .swap { swapTourModel.autoStart() }
        }
        .onChange(of: swapTourModel.state.active) { active in
            if !active, swapTourModel.isDone, !SwapTourPointerStore.hasShown() {
                SwapTourPointerStore.markShown()
                showSwapTourPointer = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
                    showSwapTourPointer = false
                }
            }
        }
    }
}

private struct ManagePageContent: View {
    let vm: ShiftsScreenViewModel
    let shift: MyShift
    /// Live host POSTs to `drop-shift` / `permanent-drop` on confirm (best-effort);
    /// nil in the demo path. The Bool is the permanent-vs-occurrence scope.
    var onDrop: ((MyShift, Bool) -> Void)? = nil
    /// §8 — the swap kinds this card supports (empty ⇒ the "Swap it" intent is disabled).
    var swapKinds: [SwapKind] = []
    /// §8 pivot — navigate to the swap PAGE (same sheet) carrying the SELECTED sub-shift (range
    /// pre-fills the give) + whether the shared scope is Permanent (drives a permanent swap).
    var onProposeSwap: (MyShift, Bool) -> Void = { _, _ in }
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    // Drop ⇄ Swap are equal-weight intents (Option C); the scope + range below are SHARED.
    @State private var swapIntent = false
    @State private var permanentScope = false
    // §5.2 partial range (T2-11) — block indexes on the shift's own grid, [from, to).
    // rangeTo < 0 means "whole shift" (the default; planDropRange clamps).
    @State private var rangeFrom = 0
    @State private var rangeTo = -1

    private var blockCount: Int { shift.blockIds.count }
    private var effectiveTo: Int { rangeTo < 0 ? blockCount : rangeTo }
    private var canSwap: Bool { !swapKinds.isEmpty }
    private var canSwapPermanently: Bool { swapKinds.contains { $0 == .permanent } }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let row = shift.toRow(zone: ShiftsKt.NEW_YORK)
        let options = vm.dropOptions(shift: shift, breakProfile: false)
        let plan = vm.planDropRange(shift: shift, fromBlock: Int32(rangeFrom), toBlock: Int32(effectiveTo))
        // Permanent is valid for the CURRENT intent: drop → recurring slot; swap → permanent swap.
        let permanentAllowed = swapIntent ? canSwapPermanently : options.canDropPermanently
        let scopeRowVisible = options.canDropPermanently || canSwapPermanently
        // Short-notice gates the DROP confirm only — a swap proposal isn't a short-notice drop.
        let shortNotice = !swapIntent && plan.shortNotice
        VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    HouseBadge(initial: row.houseInitial, bg: c.surfaceVar, fg: c.ink)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                        Text("\(row.houseName ?? row.destination ?? "") · \(row.durationLabel)")
                            .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                    }
                }

                // Equal-weight intent choice — Drop vs Swap (§5.2 / §8).
                HStack(spacing: 10) {
                    intentCard(selected: !swapIntent, title: "Drop the shift", detail: "Opens for others to claim.",
                               icon: ShiftIcons.calendar, enabled: true, id: "intent_drop", c) {
                        swapIntent = false
                        if !options.canDropPermanently { permanentScope = false }
                    }
                    intentCard(selected: swapIntent, title: "Swap it", detail: "Trade with a housemate.",
                               icon: ShiftIcons.refresh, enabled: canSwap, id: "intent_swap", c) {
                        if canSwap {
                            swapIntent = true
                            if !canSwapPermanently { permanentScope = false }
                        }
                    }
                }

                // Shared scope — drives BOTH the drop and the swap (this-week vs permanent).
                if scopeRowVisible {
                    scopeControl(permanent: permanentScope, permanentEnabled: permanentAllowed, c,
                                 onThisWeek: { permanentScope = false },
                                 onPermanent: { if permanentAllowed { permanentScope = true } })
                }

                // §5.2 partial range — SHARED: sizes the drop AND pre-fills the swap give.
                if blockCount > 1 {
                    dropRangeSelector(plan, c, showFromNow: !permanentScope)
                }

                // Short-notice is a non-blocking heads-up, NOT a gate: a red-outlined
                // caution that sits directly above the (red) Drop button so the
                // consequence reads as part of that action. The drop stays one tap away.
                if shortNotice {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: ShiftIcons.warning)
                            .font(.system(size: 16, weight: .semibold)).foregroundColor(c.danger.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Starts within 20 minutes")
                                .font(ShiftFont.sans(13.5, .semibold)).foregroundColor(c.ink)
                            Text("Short-notice drop. Your manager is notified immediately to arrange cover.")
                                .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 13).padding(.vertical, 11)
                    .background(c.danger.tint)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.danger.accent, lineWidth: 1))
                    .accessibilityIdentifier("drop_short_notice_warning")
                }

                if swapIntent {
                    // §8 pivot — navigate to the swap page carrying the SELECTED sub-shift + scope.
                    ShiftButton(title: "Choose who to swap with", action: {
                        onProposeSwap(subShiftFor(shift: shift, plan: plan), permanentScope)
                    }, fullWidth: true)
                    .accessibilityIdentifier("swap_continue_button")
                } else {
                    ShiftButton(
                        title: permanentScope
                            ? "Drop permanently"
                            : (plan.wholeShift ? "Drop this week" : "Drop \(plan.rangeLabel)"),
                        action: {
                            // onDrop owns the whole move (the optimistic two-VM shuffle + the
                            // live POST). BOTH scopes drop the SELECTED sub-shift — its blockIds
                            // are the contiguous run the EF posts; the rest re-coalesce.
                            onDrop?(subShiftFor(shift: shift, plan: plan), permanentScope)
                            dismiss()
                        },
                        variant: .destructiveFilled, fullWidth: true
                    )
                    .accessibilityIdentifier("drop_confirm_button")
                }
            }
            // A non-wrapping marker, not the container itself — an identifier set directly on
            // a wrapping VStack leaks onto every descendant element in the XCUITest tree,
            // shadowing intent_drop/intent_swap/swap_continue_button/drop_confirm_button.
            .overlay(alignment: .topLeading) {
                Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("manage_shift_sheet")
            }
    }

    /// One equal-weight intent card (Option C) — "Drop the shift" / "Swap it". A disabled card
    /// (no swap available) dims and ignores taps.
    private func intentCard(selected: Bool, title: String, detail: String, icon: String, enabled: Bool, id: String, _ c: ShiftColors, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 5) {
                Image(systemName: icon).font(.system(size: 18, weight: .medium)).foregroundColor(selected ? c.blue : c.sec)
                Text(title).font(ShiftFont.sans(13.5, .semibold)).foregroundColor(c.ink)
                Text(detail).font(ShiftFont.sans(11.5)).foregroundColor(c.sec).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(selected ? c.blue.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? c.blue : c.divider, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(id)
    }

    /// The shared this-week / permanent scope selector. "Permanent" dims + ignores taps when
    /// the current intent can't go permanent (a pickup or float card).
    private func scopeControl(permanent: Bool, permanentEnabled: Bool, _ c: ShiftColors, onThisWeek: @escaping () -> Void, onPermanent: @escaping () -> Void) -> some View {
        HStack(spacing: 3) {
            scopeSegment("This week only", selected: !permanent, enabled: true, id: "scope_this_week", c, onTap: onThisWeek)
            scopeSegment("Permanent", selected: permanent, enabled: permanentEnabled, id: "scope_permanent", c, onTap: onPermanent)
        }
        .padding(3)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityIdentifier("scope_segmented")
    }

    private func scopeSegment(_ label: String, selected: Bool, enabled: Bool, id: String, _ c: ShiftColors, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            Text(label)
                .font(ShiftFont.sans(13, selected ? .semibold : .medium))
                .foregroundColor(selected ? c.ink : c.sec)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(selected ? c.surface : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(id)
    }

    /// The §5.2 "How much" block-range selector (T2-11): a two-thumb range slider over the
    /// card's 30-min block boundaries with a live "17:30 – 19:00 · 1h 30m" summary, plus the
    /// mid-shift "From now" quick action. Shared by drop + swap. Defaults to the whole shift.
    private func dropRangeSelector(_ plan: PartialDropPlan, _ c: ShiftColors, showFromNow: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("How much").font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
                Spacer(minLength: 0)
                if showFromNow, let idx = vm.dropFromNowIndex(shift: shift) {
                    Button("From now") {
                        rangeFrom = Int(truncating: idx)
                        rangeTo = blockCount
                    }
                    .font(ShiftFont.sans(13, .semibold))
                    .foregroundColor(c.blue)
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("drop_from_now")
                }
            }
            Text("\(plan.rangeLabel) · \(plan.durationLabel)\(plan.wholeShift ? " · whole shift" : "")")
                .font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
                .accessibilityIdentifier("drop_range_label")
            BlockRangeSlider(
                blockCount: blockCount,
                from: $rangeFrom,
                to: Binding(get: { effectiveTo }, set: { rangeTo = $0 })
            )
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("drop_range_selector")
    }
}

/// A committed leg in the iOS compose flow (resolved to a `SwapLeg` at submit).
private struct PendingSwapLegUI: Identifiable {
    let id = UUID()
    let candidate: SwapCandidate
    let giveFrom: Int
    let giveTo: Int
    let giveLabel: String
    let takeBlockIds: [String]
    let takeLabel: String
}

/// The swap-proposal sheet (§8.1–§8.4 + DESIGN §6): pick the kind, the counterparty, and
/// — for temporary swaps — which contiguous hours to give/take (§8.1 partial). "Add another
/// person" builds INDEPENDENT legs (decision 2026-06-15). The server (`create-swap`) stays
/// authoritative; each leg is fired as its own proposal.
private struct SwapSheetView: View {
    let shift: MyShift
    let kinds: [SwapKind]
    let candidates: [SwapCandidate]
    let onSubmit: ([SwapProposal]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var kindIndex = 0
    @State private var committed: [PendingSwapLegUI] = []
    @State private var picked: SwapCandidate?
    @State private var giveFrom = 0
    @State private var giveTo = 0
    @State private var takeFrom = 0
    @State private var takeTo = 0

    private var kind: SwapKind { kinds[min(kindIndex, kinds.count - 1)] }
    private var isTemp: Bool { kind != .permanent }
    private var options: [SwapCandidate] {
        kind == .permanent ? swapPeople(candidates: candidates) : candidates
    }
    private var blockCount: Int { shift.blockIds.count }
    private var allocated: Set<Int> { Set(committed.flatMap { Array($0.giveFrom..<$0.giveTo) }) }
    private var allAllocated: Bool { allocated.count >= blockCount }
    private var giveOverlaps: Bool {
        guard giveTo > giveFrom else { return false }
        return (giveFrom..<giveTo).contains { allocated.contains($0) }
    }
    private var legCount: Int { committed.count + (currentLeg() != nil ? 1 : 0) }
    private var canPropose: Bool { kind == .permanent ? picked != nil : (!committed.isEmpty || currentLeg() != nil) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let row = shift.toRow(zone: ShiftsKt.NEW_YORK)
        ShiftSheet(title: "Propose a swap", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    HouseBadge(initial: row.houseInitial, bg: c.surfaceVar, fg: c.ink)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                        Text("\(row.houseName ?? row.destination ?? "") · \(row.durationLabel) · \(row.dayLabel)")
                            .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                    }
                }

                if kinds.count > 1 {
                    HStack(spacing: 8) {
                        kindButton("This week", 0, c)
                        kindButton("Permanently", 1, c)
                    }
                } else if kind == .float {
                    Text("Float swap: a housemate takes your float assignment.")
                        .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }

                if !committed.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeader(title: "Swapping with \(legCount)")
                        ForEach(committed) { leg in legChip(leg, c) }
                    }
                    .accessibilityIdentifier("swap_legs")
                }

                SectionHeader(
                    title: kind == .permanent
                        ? "Who takes the slot?"
                        : (committed.isEmpty ? "Whose shift do you want?" : "Add another person")
                )
                if options.isEmpty {
                    Text("No housemates with shifts this week to swap with.")
                        .font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else {
                    VStack(spacing: 8) {
                        ForEach(options.prefix(8), id: \.seatIds) { candidate in
                            candidateRow(candidate, c)
                        }
                    }
                    .accessibilityIdentifier("swap_candidate_list")
                }

                // §8.1 partial pickers — temporary swaps with a picked counterparty.
                if isTemp, let cand = picked {
                    if blockCount > 1 {
                        swapRangeSelector("Your hours to give", givePlan(), count: blockCount, from: $giveFrom, to: $giveTo, c, "swap_give_range")
                    }
                    if cand.seatIds.count > 1 {
                        swapRangeSelector("Hours you want from \(cand.workerName)", takePlan(cand), count: cand.seatIds.count, from: $takeFrom, to: $takeTo, c, "swap_take_range")
                    }
                    if giveOverlaps {
                        Text("Those hours overlap another swap, so pick different hours.")
                            .font(ShiftFont.sans(12.5)).foregroundColor(c.floatOut.deep)
                            .accessibilityIdentifier("swap_overlap_warning")
                    }
                    if !allAllocated {
                        ShiftButton(title: "Add another person", action: { addLeg() }, variant: .tonal, fullWidth: true)
                            .disabled(currentLeg() == nil)
                            .accessibilityIdentifier("swap_add_leg_button")
                    }
                }

                ShiftButton(
                    title: (kind == .permanent || legCount <= 1) ? "Propose swap" : "Propose \(legCount) swaps",
                    action: { proposeAll() },
                    fullWidth: true
                )
                .disabled(!canPropose)
                .accessibilityIdentifier("swap_submit_button")
            }
            .accessibilityIdentifier("swap_sheet")
        }
    }

    private func kindButton(_ title: String, _ index: Int, _ c: ShiftColors) -> some View {
        Button(action: { kindIndex = index; picked = nil; committed = []; giveTo = 0; takeTo = 0 }) {
            Text(title)
                .font(ShiftFont.sans(13.5, kindIndex == index ? .semibold : .regular))
                .foregroundColor(kindIndex == index ? .white : c.ink)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(kindIndex == index ? c.blue : c.surfaceVar)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(index == 0 ? "swap_kind_shift" : "swap_kind_permanent")
    }

    private func candidateRow(_ candidate: SwapCandidate, _ c: ShiftColors) -> some View {
        let selected = picked?.userId == candidate.userId && picked?.seatIds == candidate.seatIds
        return Button(action: { select(candidate) }) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(candidate.workerName.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                VStack(alignment: .leading, spacing: 1) {
                    Text(candidate.workerName).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    if kind != .permanent {
                        Text("\(candidate.dayLabel) · \(candidate.timeLabel) · \(candidate.durationLabel)")
                            .font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                    }
                }
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(selected ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(selected ? c.blue : c.divider, lineWidth: selected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("swap_candidate_row")
    }

    private func legChip(_ leg: PendingSwapLegUI, _ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(leg.candidate.workerName).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                Text("Give \(leg.giveLabel) · take \(leg.takeLabel)").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            Button(action: { committed.removeAll { $0.id == leg.id } }) {
                Image(systemName: ShiftIcons.close).font(.system(size: 13, weight: .semibold)).foregroundColor(c.sec)
                    .frame(width: 26, height: 26).background(c.surface).clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("swap_leg_remove")
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("swap_leg_row")
    }

    private func swapRangeSelector(_ title: String, _ plan: SwapSpanSelection, count: Int, from: Binding<Int>, to: Binding<Int>, _ c: ShiftColors, _ id: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
            Text(plan.dayLabel).font(ShiftFont.sans(12.5, .medium)).foregroundColor(c.sec)
            Text("\(plan.rangeLabel) · \(plan.durationLabel)\(plan.wholeSpan ? " · whole shift" : "")")
                .font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
            BlockRangeSlider(blockCount: count, from: from, to: to)
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier(id)
    }

    // MARK: compose helpers

    private func select(_ cand: SwapCandidate) {
        if kind == .permanent { picked = cand; return }
        picked = cand
        takeFrom = 0
        takeTo = cand.seatIds.count
        if giveTo <= giveFrom || giveOverlaps {
            let free = firstFree()
            giveFrom = free.0
            giveTo = free.1
        }
    }

    private func firstFree() -> (Int, Int) {
        var s = 0
        while s < blockCount && allocated.contains(s) { s += 1 }
        if s >= blockCount { return (0, blockCount) }
        var e = s
        while e < blockCount && !allocated.contains(e) { e += 1 }
        return (s, e)
    }

    private func givePlan() -> SwapSpanSelection {
        planSwapSpanFor(blockIds: shift.blockIds, spanStart: shift.start, spanEnd: shift.end, fromBlock: Int32(giveFrom), toBlock: Int32(max(giveTo, giveFrom + 1)))
    }

    private func takePlan(_ cand: SwapCandidate) -> SwapSpanSelection {
        let tTo = takeTo > takeFrom ? takeTo : cand.seatIds.count
        return planSwapSpanFor(blockIds: cand.seatIds, spanStart: cand.start, spanEnd: cand.end, fromBlock: Int32(takeFrom), toBlock: Int32(max(tTo, takeFrom + 1)))
    }

    private func currentLeg() -> SwapLeg? {
        guard let cand = picked, giveTo > giveFrom, !giveOverlaps else { return nil }
        let giveIds = Array(shift.blockIds[giveFrom..<giveTo])
        let tTo = takeTo > takeFrom ? takeTo : cand.seatIds.count
        let takeIds = Array(cand.seatIds[takeFrom..<tTo])
        return SwapLeg(candidate: cand, initiatorBlockIds: giveIds, counterpartyBlockIds: takeIds)
    }

    private func addLeg() {
        guard let cand = picked, giveTo > giveFrom, !giveOverlaps else { return }
        let gp = givePlan()
        let tp = takePlan(cand)
        committed.append(PendingSwapLegUI(
            candidate: cand, giveFrom: giveFrom, giveTo: giveTo, giveLabel: gp.rangeLabel,
            takeBlockIds: tp.blockIds, takeLabel: tp.rangeLabel
        ))
        picked = nil
        takeTo = 0
        let free = firstFree()
        giveFrom = free.0
        giveTo = free.1
    }

    private func proposeAll() {
        if kind == .permanent {
            guard let cand = picked else { return }
            let p = buildSwapProposal(kind: .permanent, initiatorShift: shift, candidate: cand, initiatorBlockIds: shift.blockIds, counterpartyBlockIds: cand.seatIds)
            onSubmit([p])
            dismiss()
            return
        }
        var legs = committed.map { leg in
            SwapLeg(candidate: leg.candidate, initiatorBlockIds: Array(shift.blockIds[leg.giveFrom..<leg.giveTo]), counterpartyBlockIds: leg.takeBlockIds)
        }
        if let cur = currentLeg() { legs.append(cur) }
        guard !legs.isEmpty else { return }
        onSubmit(buildSwapProposals(kind: kind, initiatorShift: shift, legs: legs))
        dismiss()
    }
}

// MARK: - Calendar swap (CALENDAR_REDESIGN.md) — week-paged give/take picker

/// Holds the `SwapCalendarViewModel`; created with the tapped shift as the pinned "give".
/// On the live path it fetches each navigated week's house grid (`fetchHouseScheduleForWeek`)
/// and feeds it to the VM (`setWeekSeats`); the demo path feeds the current week's seats once.
@MainActor
final class SwapCalendarObservable: ObservableObject {
    let vm: SwapCalendarViewModel
    @Published var state: SwapCalendarUiState
    private var task: Task<Void, Never>?
    private let repo: WorkerShiftsRepository?
    private let userId: String?

    init(giveShift: MyShift, meUserId: String?, repo: WorkerShiftsRepository?, demoSeats: [HouseSeat], pendingGiveAssignmentIds: Set<String> = [], initialPermanent: Bool = false) {
        let model = DemoFactory.shared.swapCalendarViewModel(giveShift: giveShift, meUserId: meUserId ?? "demo", breakProfile: false, pendingGiveAssignmentIds: pendingGiveAssignmentIds, initialPermanent: initialPermanent)
        self.vm = model
        self.state = model.uiState.value
        self.repo = repo
        self.userId = meUserId
        subscribe()
        if repo != nil, meUserId != nil {
            Task { await loadWeek() }
            Task { await loadDirectory() }
        } else {
            model.setWeekSeats(forOffset: model.uiState.value.weekOffset, seats: demoSeats)
            model.setWorkerDirectory(workers: DemoFactory.shared.workerDirectory())
        }
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    func loadWeek() async {
        guard let repo, let uid = userId else { return }
        let off = vm.uiState.value.weekOffset
        let anchor = vm.uiState.value.anchor
        let snap = try? await repo.fetchHouseScheduleForWeek(userId: uid, anchor: anchor)
        vm.setWeekSeats(forOffset: off, seats: snap?.seats ?? [])
    }

    /// The §8.5 hand-off recipient directory (cross-house) — fetched once; a people
    /// roster, independent of which week the give shift sits in.
    func loadDirectory() async {
        guard let repo else { return }
        let dir = (try? await repo.fetchWorkerDirectory()) ?? []
        vm.setWorkerDirectory(workers: dir)
    }

    func prevWeek() { vm.previousWeek(); Task { await loadWeek() } }
    func nextWeek() { vm.nextWeek(); Task { await loadWeek() } }
    func selectDay(_ i: Int) { vm.selectDay(index: Int32(i)) }
    func pickTake(_ c: SwapDayCard) { vm.pickTake(card: c) }
    func togglePermanent() { vm.togglePermanent() }
    func setHandoff(_ on: Bool) { vm.setHandoff(on: on) }
    func setHandoffQuery(_ q: String) { vm.setHandoffQuery(query: q) }
    func pickRecipient(_ w: HandoffWorker) { vm.pickRecipient(worker: w) }
    func setGiveRange(_ from: Int, _ to: Int) { vm.setGiveRange(from: Int32(from), to: Int32(to)) }
    func setTakeRange(_ from: Int, _ to: Int) { vm.setTakeRange(from: Int32(from), to: Int32(to)) }
    func focusGiveRun(_ index: Int) { vm.focusGiveRun(index: Int32(index)) }
    func focusTakeRun(_ index: Int) { vm.focusTakeRun(index: Int32(index)) }
    func acceptSuggestion() { vm.acceptSuggestion() }
    func addLeg() { vm.addLeg() }
    func removeLeg(_ index: Int) { vm.removeLeg(index: Int32(index)) }
    func proposals() -> [SwapProposal] { vm.proposals() }

    deinit { task?.cancel() }
}

/// `.sheet(item:)` needs Identifiable; the Kotlin `SwapDecision` isn't, so wrap it.
private struct IdentifiedSwapDecision: Identifiable {
    let id = UUID()
    let decision: SwapDecision
}

/// `.sheet(item:)` needs Identifiable; the Kotlin `PendingSwapNotice` isn't, so wrap it.
private struct IdentifiedPendingSwapNotice: Identifiable {
    let id = UUID()
    let notice: PendingSwapNotice
}

/// `.sheet(item:)` needs Identifiable; the Kotlin `PendingFloat` isn't. `id` is the
/// floatId so re-tapping the same card doesn't churn the sheet.
private struct IdentifiedFloatDetail: Identifiable {
    var id: String { float.floatId }
    let float: PendingFloat
}

/// The accept/decline popup for an INCOMING swap, opened by tapping a flagged My-Shifts
/// card. Shows what you give ⇄ what you get (a one-sided hand-off shows only its real half),
/// plus the type and deadline.
private struct SwapDecisionSheetView: View {
    let decision: SwapDecision
    let onAccept: () -> Void
    let onDecline: () -> Void
    let onClose: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        ShiftSheet(title: decision.title, onClose: onClose) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 8) {
                    Text(decision.intro).font(ShiftFont.sans(14)).foregroundColor(c.ink)
                    Spacer(minLength: 0)
                    Text(decision.typeLabel).font(ShiftFont.sans(11, .medium)).foregroundColor(c.blue)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(c.blue.opacity(0.12)).clipShape(Capsule())
                }
                Text(decision.respondBy).font(ShiftFont.sans(12.5)).foregroundColor(c.sec)

                VStack(spacing: 0) {
                    if let give = decision.giveLabel {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("YOU GIVE").font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.sec)
                            Text(give).font(ShiftFont.sans(14, .medium)).foregroundColor(c.ink)
                            swapDecisionHouse(decision.giveHouse, c.sec, c)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(c.surfaceVar)
                    }
                    if let get = decision.getLabel {
                        if decision.giveLabel != nil { Rectangle().fill(c.divider).frame(height: 1) }
                        VStack(alignment: .leading, spacing: 3) {
                            Text("YOU GET").font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.sec)
                            Text(get).font(ShiftFont.sans(14, .medium)).foregroundColor(c.ink)
                            // Where you'd actually work if you accept — the float destination, when floated.
                            swapDecisionHouse(decision.getHouse, c.blue, c)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))

                if let note = decision.note {
                    Text(note).font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                }

                HStack(spacing: 10) {
                    ShiftButton(title: "Accept", action: onAccept, fullWidth: true)
                        .accessibilityIdentifier("swap_decision_accept")
                    ShiftButton(title: "Decline", action: onDecline, variant: .outlined, fullWidth: true)
                        .accessibilityIdentifier("swap_decision_decline")
                }
            }
            .accessibilityIdentifier("swap_decision_sheet")
        }
    }

    /// The desk a side is worked at (the float destination, if floated) — a building glyph +
    /// the house name in the side's accent. Empty when the house is unknown (older row).
    @ViewBuilder
    private func swapDecisionHouse(_ houseName: String?, _ accent: Color, _ c: ShiftColors) -> some View {
        if let houseName {
            HStack(spacing: 4) {
                Image(systemName: ShiftIcons.building).font(.system(size: 12)).foregroundColor(accent)
                Text(houseName).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(accent)
            }
        }
    }
}

/// The "swap pending" notice for an OUTGOING swap, opened by tapping a flagged My-Shifts
/// card. The shift is tied up in a swap the worker proposed, so it can't be dropped or
/// swapped again — instead of the drop sheet (which the server would reject with a generic
/// error) this shows the shift clearly (day · date, start–end, duration), explains the wait,
/// and offers Cancel (void the swap) or Keep waiting. The corner ✕ and "Keep waiting" both
/// just minimise the card.
private struct PendingSwapNoticeSheetView: View {
    let notice: PendingSwapNotice
    let onCancel: () -> Void
    let onClose: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        ShiftSheet(title: notice.title, onClose: onClose) {
            VStack(alignment: .leading, spacing: 12) {
                // The shift itself — day · date, the start–end time, the duration.
                VStack(alignment: .leading, spacing: 4) {
                    Text(notice.dayLabel).font(ShiftFont.sans(13.5, .semibold)).foregroundColor(c.ink)
                    HStack(spacing: 8) {
                        Text(notice.timeLabel).font(ShiftFont.mono(15, .medium)).foregroundColor(c.ink)
                        DurationChip(label: notice.durationLabel)
                    }
                    if let house = notice.houseName {
                        HStack(spacing: 4) {
                            Image(systemName: ShiftIcons.building).font(.system(size: 12)).foregroundColor(c.blue)
                            Text(house).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.blue)
                        }
                    }
                    HStack(spacing: 4) {
                        Image(systemName: ShiftIcons.refresh).font(.system(size: 11)).foregroundColor(c.blue)
                        Text(notice.typeLabel).font(ShiftFont.sans(11, .medium)).foregroundColor(c.blue)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(c.blue.opacity(0.14)).clipShape(Capsule())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(c.blue.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.blue.opacity(0.30), lineWidth: 1))

                Text(notice.body).font(ShiftFont.sans(14)).foregroundColor(c.ink)
                Text(notice.waitingOn).font(ShiftFont.sans(12.5)).foregroundColor(c.sec)

                ShiftButton(title: notice.keepWaitingLabel, action: onClose, fullWidth: true)
                    .accessibilityIdentifier("pending_swap_keep_waiting")
                ShiftButton(title: notice.cancelLabel, action: onCancel, variant: .outlined, fullWidth: true)
                    .accessibilityIdentifier("pending_swap_cancel")
            }
            .accessibilityIdentifier("pending_swap_notice_sheet")
        }
    }
}

/// The calendar swap sheet: a pinned "give" (the tapped shift), a week navigator + Mon–Sun
/// strip, and the selected day's housemate cards to "take". Cross-week + retroactive fall
/// out of week paging; the give persists across weeks. Whole-run swaps in v1.
private struct SwapCalendarPage: View {
    @StateObject private var obs: SwapCalendarObservable
    let onSubmit: ([SwapProposal]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var handoffTab = 0 // 0 = My House, 1 = Others (hand-off recipient directory)

    init(giveShift: MyShift, meUserId: String?, repo: WorkerShiftsRepository?, demoSeats: [HouseSeat], initialPermanent: Bool = false, pendingGiveAssignmentIds: Set<String> = [], onSubmit: @escaping ([SwapProposal]) -> Void) {
        _obs = StateObject(wrappedValue: SwapCalendarObservable(giveShift: giveShift, meUserId: meUserId, repo: repo, demoSeats: demoSeats, pendingGiveAssignmentIds: pendingGiveAssignmentIds, initialPermanent: initialPermanent))
        self.onSubmit = onSubmit
    }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let s = obs.state
        let legCount = s.legs.count + (s.take != nil ? 1 : 0)
        VStack(alignment: .leading, spacing: 14) {
                if !s.legs.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(Array(s.legs.enumerated()), id: \.offset) { i, leg in
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(leg.workerName).font(ShiftFont.sans(13, .semibold)).foregroundColor(c.ink)
                                    Text(leg.summary).font(ShiftFont.sans(12)).foregroundColor(c.sec)
                                }
                                Spacer(minLength: 0)
                                Button(action: { obs.removeLeg(i) }) {
                                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundColor(c.sec)
                                        .frame(width: 24, height: 24).background(c.surface).clipShape(Circle())
                                }.buttonStyle(.plain)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(c.surfaceVar).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }.accessibilityIdentifier("swap_legs")
                }

                // After banking a leg, the one-tap "give the next part to the same person too"
                // shortcut (the chosen same-person flow): two non-contiguous parts of one shift
                // to one person stay independent legs, but feel like one intent.
                if let sug = s.suggestion {
                    suggestionChip(sug, c)
                }

                if let deal = s.deal {
                    dealCard(deal, s, c)
                }

                HStack(spacing: 8) {
                    modeButton("Swap", handoff: false, c, s)
                    modeButton("Hand off", handoff: true, c, s)
                }

                // Hand-off (§8.5) is NOT a calendar exchange — you just pick who covers
                // the shift, so the whole calendar is replaced by the recipient directory.
                if s.handoff {
                    handoffPicker(s, c)
                } else {
                // ── "Your shift" controls — PROMINENT, above the calendar. Partial swaps are
                // uncommon but heavily used; the old hidden "adjust hours" link was
                // undiscoverable. Shown whenever your shift is splittable — for a plain swap
                // AND a permanent swap (§8.1/§8.3 partial).
                if s.giveSplittable, let g = s.give {
                    // Once a part is banked the shift fragments — show the segmented timeline
                    // (locked zones + tap-to-focus) above the slider; the slider then only
                    // adjusts "how much" within the focused free run.
                    if s.giveSegments.contains(where: { $0.locked }) {
                        swapTimeline(s.giveSegments, activeVerb: "Giving", c, "swap_give_timeline") { obs.focusGiveRun($0) }
                    }
                    giveRangeCard(s.permanent ? "How much of your slot to give?" : "How much of your shift to give?",
                                  card: g, count: Int(s.giveBlockCount), from: Int(s.giveFrom), to: Int(s.giveTo),
                                  runFrom: Int(s.giveRunFrom), runTo: Int(s.giveRunTo),
                                  set: { f, t in obs.setGiveRange(f, t) }, c, "swap_give_range")
                }
                if s.permanentToggleVisible {
                    permanentToggleCard(s, c)
                }

                HStack {
                    Button(action: { obs.prevWeek() }) { Image(systemName: "chevron.left").font(.system(size: 16)).foregroundColor(c.ink) }
                        .accessibilityIdentifier("swap_week_prev")
                    Spacer()
                    VStack(spacing: 1) {
                        Text(s.weekRange).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                        Text(s.weekRelative).font(ShiftFont.sans(12)).foregroundColor(c.ter)
                    }
                    Spacer()
                    Button(action: { obs.nextWeek() }) { Image(systemName: "chevron.right").font(.system(size: 16)).foregroundColor(c.ink) }
                        .accessibilityIdentifier("swap_week_next")
                }

                HStack(spacing: 4) {
                    ForEach(s.days, id: \.index) { d in
                        let sel = Int(d.index) == Int(s.selectedDayIndex)
                        Button(action: { obs.selectDay(Int(d.index)) }) {
                            VStack(spacing: 4) {
                                Text(d.dayLetter).font(ShiftFont.sans(11)).foregroundColor(c.sec)
                                Text(d.dateLabel).font(ShiftFont.sans(13, sel ? .semibold : .regular))
                                    .foregroundColor(sel ? .white : c.ink)
                                    .frame(width: 28, height: 28)
                                    .background(sel ? c.blue : Color.clear).clipShape(Circle())
                                Circle().fill(d.hasShifts ? c.blue : Color.clear).frame(width: 4, height: 4)
                            }.frame(maxWidth: .infinity)
                        }.buttonStyle(.plain)
                    }
                }.accessibilityIdentifier("swap_day_strip")

                SectionHeader(title: s.permanent ? "Swap your slot with whom?" : "Whose shift do you want?")
                if s.loadingWeek {
                    Text("Loading housemates…").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else if s.day.others.isEmpty {
                    Text("No housemates on this day. Try another day or week.").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else {
                    VStack(spacing: 8) {
                        ForEach(s.day.others, id: \.seatIds) { card in takeCard(card, s, c) }
                    }.accessibilityIdentifier("swap_take_list")
                }

                // Take hours — contextual to the picked person (1:1 swaps only; permanent is
                // person-level, so this is hidden when permanent is on).
                if s.takeSplittable, let t = s.take {
                    // Re-taking a counterparty shift you already took part of: the taken blocks
                    // render locked (two-budget rule, keyed per counterparty shift).
                    if s.takeSegments.contains(where: { $0.locked }) {
                        swapTimeline(s.takeSegments, activeVerb: "Taking", c, "swap_take_timeline") { obs.focusTakeRun($0) }
                    }
                    giveRangeCard("Hours you want from \(t.workerName)",
                                  card: t, count: Int(s.takeBlockCount), from: Int(s.takeFrom), to: Int(s.takeTo),
                                  runFrom: Int(s.takeRunFrom), runTo: Int(s.takeRunTo),
                                  set: { f, t in obs.setTakeRange(f, t) }, c, "swap_take_range")
                }

                if s.canAddLeg {
                    ShiftButton(title: "+ Add another person", action: { obs.addLeg() }, variant: .tonal, fullWidth: true)
                        .accessibilityIdentifier("swap_add_leg")
                }
                } // end !handoff calendar block

                ShiftButton(title: s.handoff ? "Hand off shift" : (legCount > 1 ? "Propose \(legCount) swaps" : "Propose swap"),
                            action: { onSubmit(obs.proposals()); dismiss() }, fullWidth: true)
                    .disabled(!s.canPropose)
                    .accessibilityIdentifier("swap_submit_button")
        }
        .accessibilityIdentifier("swap_calendar_sheet")
    }

    /// The give ⇄ take "deal" card at the top of the sheet — the always-visible review of
    /// the forming proposal. The give side is pinned from the tapped shift; the take side
    /// fills in as the worker picks (or stays a muted placeholder). Connector is ⇄ for a
    /// swap, → for a hand-off; a "Permanent" tag rides the card when the swap is permanent.
    private func dealCard(_ deal: SwapDeal, _ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("YOU GIVE").font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.sec)
                    Spacer(minLength: 0)
                    if s.permanent {
                        Text("Permanent").font(ShiftFont.sans(11, .semibold)).foregroundColor(c.blue)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(c.blue.opacity(0.12)).clipShape(Capsule())
                    }
                }
                Text(deal.giveTitle).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                Text(deal.giveDetail).font(ShiftFont.sans(13)).foregroundColor(c.sec)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.surfaceVar)

            HStack(spacing: 10) {
                Rectangle().fill(c.divider).frame(height: 1)
                Image(systemName: s.handoff ? "arrow.right" : "arrow.left.arrow.right")
                    .font(.system(size: 13, weight: .medium)).foregroundColor(c.blue)
                    .frame(width: 28, height: 28).background(c.blue.opacity(0.12)).clipShape(Circle())
                Rectangle().fill(c.divider).frame(height: 1)
            }
            .padding(.horizontal, 14)

            VStack(alignment: .leading, spacing: 2) {
                Text(deal.takeEyebrow.uppercased()).font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.sec)
                if let title = deal.takeTitle {
                    HStack(spacing: 10) {
                        HouseBadge(initial: deal.takeInitial ?? "?", bg: c.surfaceVar, fg: c.ink)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(title).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                            if let detail = deal.takeDetail { Text(detail).font(ShiftFont.sans(13)).foregroundColor(c.sec) }
                        }
                        Spacer(minLength: 0)
                    }.padding(.top, 4)
                } else {
                    Text(deal.takePlaceholder).font(ShiftFont.sans(14)).foregroundColor(c.ter).padding(.top, 2)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("swap_deal_card")
    }

    /// A labelled 30-min range slider that reads its position from VM state and writes back
    /// through [set] (computed bindings — the VM stays the single source of truth).
    /// A prominent give/take duration control: the picked span's live "10:00–12:00 · 2h"
    /// label over a stepped 30-min range slider. Used for the give-shift trim (above the
    /// calendar) and the take-hours trim (under the picked person).
    private func giveRangeCard(_ title: String, card: SwapDayCard, count: Int, from: Int, to: Int,
                               runFrom: Int = 0, runTo: Int = -1,
                               set: @escaping (Int, Int) -> Void, _ c: ShiftColors, _ id: String) -> some View {
        let plan = planSwapSpanFor(blockIds: card.seatIds, spanStart: card.start, spanEnd: card.end,
                                   fromBlock: Int32(from), toBlock: Int32(max(to, from + 1)))
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
            Text("\(plan.rangeLabel) · \(plan.durationLabel)\(plan.wholeSpan ? " · whole shift" : "")")
                .font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
            BlockRangeSlider(
                blockCount: count,
                from: Binding(get: { from }, set: { set($0, to) }),
                to: Binding(get: { to }, set: { set(from, $0) }),
                lowerBound: runFrom,
                upperBound: runTo
            )
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier(id)
    }

    /// The segmented give/take timeline — one track per shift, locked zones greyed (with the
    /// receiver's name / "Taken"), the active selection accented, free runs tap-to-focus.
    /// Shown only once a part is reserved, so the common single-leg case stays a plain slider.
    private func swapTimeline(_ segments: [SwapSegment], activeVerb: String, _ c: ShiftColors, _ id: String,
                              focus: @escaping (Int) -> Void) -> some View {
        let total = max(segments.reduce(0) { $0 + (Int($1.to) - Int($1.from)) }, 1)
        return GeometryReader { geo in
            let gap: CGFloat = 4
            let avail = geo.size.width - gap * CGFloat(max(segments.count - 1, 0))
            HStack(spacing: gap) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                    let blocks = Int(seg.to) - Int(seg.from)
                    segmentCell(seg, activeVerb: activeVerb, c, focus)
                        .frame(width: max(avail * CGFloat(blocks) / CGFloat(total), 0))
                }
            }
        }
        .frame(height: 46)
        .accessibilityIdentifier(id)
    }

    private func segmentCell(_ seg: SwapSegment, activeVerb: String, _ c: ShiftColors,
                             _ focus: @escaping (Int) -> Void) -> some View {
        let locked = seg.locked
        let active = seg.active
        let bg = locked ? c.surfaceVar : (active ? c.blue.opacity(0.10) : c.surface)
        let border = active ? c.blue : (locked ? c.divider : c.outline)
        let sub = locked ? (seg.note ?? "Given") : (active ? activeVerb : "Tap")
        return VStack(spacing: 2) {
            Text(seg.rangeLabel).font(ShiftFont.sans(10.5)).foregroundColor(locked ? c.ter : c.ink)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(sub).font(ShiftFont.sans(10, active ? .medium : .regular)).foregroundColor(active ? c.blue : c.ter).lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 4)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(border, lineWidth: active ? 1.5 : 1))
        .contentShape(Rectangle())
        .accessibilityIdentifier(locked ? "swap_seg_locked" : (active ? "swap_seg_active" : "swap_seg_free"))
        .onTapGesture { if !locked && !active { focus(Int(seg.from)) } }
    }

    /// The same-person "give the next part to X too" chip (accent, one tap → [acceptSuggestion]).
    private func suggestionChip(_ sug: SwapLegSuggestion, _ c: ShiftColors) -> some View {
        Button(action: { obs.acceptSuggestion() }) {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundColor(c.blue)
                Text(sug.label).font(ShiftFont.sans(13, .medium)).foregroundColor(c.blue)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundColor(c.blue)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.blue.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.blue.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("swap_suggestion")
    }

    /// The permanent-swap toggle as a prominent card (§8.3) — promoted from the old tiny
    /// checkbox, shown up front and partial-aware (the give control above still applies).
    private func permanentToggleCard(_ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        Button(action: { obs.togglePermanent() }) {
            HStack(spacing: 12) {
                Image(systemName: s.permanent ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20)).foregroundColor(s.permanent ? c.blue : c.outline)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Make it permanent").font(ShiftFont.sans(14, .medium)).foregroundColor(c.ink)
                    Text("Swap this slot every week for the rest of the period").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(s.permanent ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(s.permanent ? c.blue : c.divider, lineWidth: s.permanent ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("swap_permanent_toggle")
    }

    private func modeButton(_ title: String, handoff: Bool, _ c: ShiftColors, _ s: SwapCalendarUiState) -> some View {
        let on = s.handoff == handoff
        return Button(action: { obs.setHandoff(handoff) }) {
            Text(title)
                .font(ShiftFont.sans(13.5, on ? .semibold : .regular))
                .foregroundColor(on ? .white : c.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(on ? c.blue : c.surfaceVar)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(handoff ? "swap_mode_handoff" : "swap_mode_swap")
    }

    private func takeCard(_ card: SwapDayCard, _ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        let sel = s.take?.userId == card.userId && s.take?.seatIds == card.seatIds
        return Button(action: { obs.pickTake(card) }) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(card.workerName.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.workerName).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Text("\(card.timeLabel) · \(card.durationLabel)").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
                if sel { Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(sel ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(sel ? c.blue : c.divider, lineWidth: sel ? 1.5 : 1))
        }.buttonStyle(.plain).accessibilityIdentifier("swap_take_row")
    }

    // MARK: hand-off recipient directory (§8.5)

    /// The hand-off recipient directory — "My House" (own roster, flat) + "Others" (every
    /// other house, grouped + searchable, since 10+ houses × ~8 workers is too long to
    /// scan). Eligible recipients only (the VM pre-filters); the server stays authoritative.
    private func handoffPicker(_ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        let dir = s.handoffDirectory
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                handoffTabButton("My House", tab: 0, c)
                handoffTabButton("Others", tab: 1, c)
            }
            if handoffTab == 0 {
                if dir.myHouse.isEmpty {
                    Text("No eligible workers in your house.").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else {
                    VStack(spacing: 8) {
                        ForEach(dir.myHouse, id: \.userId) { w in handoffWorkerRow(w, s, c) }
                    }.accessibilityIdentifier("handoff_my_house_list")
                }
            } else {
                handoffSearchField(s, c)
                if dir.others.isEmpty {
                    Text(s.handoffQuery.isEmpty ? "No eligible workers in other houses." : "No matches for \"\(s.handoffQuery)\".")
                        .font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(dir.others, id: \.houseId) { group in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(group.houseName.uppercased()).font(ShiftFont.sans(11, .medium)).tracking(0.5).foregroundColor(c.sec)
                                ForEach(group.workers, id: \.userId) { w in handoffWorkerRow(w, s, c) }
                            }
                        }
                    }.accessibilityIdentifier("handoff_others_list")
                }
            }
        }.accessibilityIdentifier("handoff_picker")
    }

    private func handoffTabButton(_ title: String, tab: Int, _ c: ShiftColors) -> some View {
        let on = handoffTab == tab
        return Button(action: { handoffTab = tab }) {
            Text(title)
                .font(ShiftFont.sans(13.5, on ? .semibold : .regular))
                .foregroundColor(on ? .white : c.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(on ? c.blue : c.surfaceVar)
                .clipShape(Capsule())
        }.buttonStyle(.plain)
        .accessibilityIdentifier(tab == 0 ? "handoff_tab_my_house" : "handoff_tab_others")
    }

    private func handoffWorkerRow(_ w: HandoffWorker, _ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        let sel = s.recipient?.userId == w.userId
        return Button(action: { obs.pickRecipient(w) }) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(w.name.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                Text(w.name).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                Spacer(minLength: 0)
                if sel { Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(sel ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(sel ? c.blue : c.divider, lineWidth: sel ? 1.5 : 1))
        }.buttonStyle(.plain).accessibilityIdentifier("handoff_worker_row")
    }

    private func handoffSearchField(_ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundColor(c.ter)
            TextField("Search workers or houses", text: Binding(get: { s.handoffQuery }, set: { obs.setHandoffQuery($0) }))
                .font(ShiftFont.sans(14)).foregroundColor(c.ink)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("handoff_search_field")
            if !s.handoffQuery.isEmpty {
                Button(action: { obs.setHandoffQuery("") }) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(c.sec)
                }.buttonStyle(.plain).accessibilityIdentifier("handoff_search_clear")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 11)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("handoff_search")
    }
}

/// The "This week — 14h of 20h soft cap" summary chip (design My-Shifts header).
private struct WeekTotalChip: View {
    let currentWeeklyHours: Double
    var breakProfile: Bool = false
    /// The shown week (0 = this week) — the label follows it so the hours never read
    /// as "this week" when the worker has navigated forward/back.
    var weekOffset: Int = 0
    @Environment(\.colorScheme) private var scheme

    private var label: String {
        switch weekOffset {
        case 0: return "This week"
        case 1: return "Next week"
        case -1: return "Last week"
        case let o where o > 1: return "In \(o) weeks"
        default: return "\(-weekOffset) weeks ago"
        }
    }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let summary = weeklyHoursSummary(currentWeeklyHours: currentWeeklyHours, breakProfile: breakProfile)
        HStack(spacing: 8) {
            Image(systemName: ShiftIcons.clock).font(.system(size: 17, weight: .regular)).foregroundColor(c.blue)
            Text(label).font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
            Spacer()
            Text(summary.current).font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
            Text(summary.capLabel).font(ShiftFont.mono(13.5)).monospacedDigit().foregroundColor(c.ter)
        }
        .padding(.horizontal, 13).padding(.vertical, 9)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }
}

/// A radio-style drop-scope option (design `ScopeOption`).
private struct DropScopeOption: View {
    let selected: Bool
    let title: String
    let detail: String
    let systemIcon: String
    let accent: Color
    var enabled: Bool = true
    let id: String
    let onTap: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        Button(action: { if enabled { onTap() } }) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().strokeBorder(selected ? accent : c.outline, lineWidth: 2).frame(width: 20, height: 20)
                    if selected { Circle().fill(accent).frame(width: 10, height: 10) }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                    Text(detail).font(ShiftFont.sans(13)).foregroundColor(c.sec).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: systemIcon).font(.system(size: 18)).foregroundColor(selected ? accent : c.ter)
            }
            .padding(12)
            .background(selected ? accent.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(selected ? accent : c.divider, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.5)
        .accessibilityIdentifier(id)
    }
}

/// The §11.4 contact sheet (T3b): who covers the run + call affordances — the
/// worker's phone (full-directory ruling) and the house desk phone.
/// Tapping someone's shift on the House grid opens THIS: the slot (time + length) plus a
/// card for the person on it — name, house, phone, email — and the two intents that make
/// the card actionable, `tel:` (the dialer opens prefilled; it does not auto-call) and
/// `mailto:` (the mail app opens composing, nothing is sent). The card's avatar wears the
/// worker's own colour, the same one their blocks carry in the grid.
private struct ContactSheetView: View {
    let block: HouseGridBlock
    private var row: HouseGridBlock { block }
    let deskPhone: String?
    let deskHouseName: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    private var name: String { row.workerName ?? "This shift" }

    /// The float-in case: the person's own house is not the desk they're standing at, and
    /// that is exactly what someone tapping the block needs to know.
    private var houseLine: String? {
        guard let home = row.workerHouseName else { return deskHouseName }
        if let desk = deskHouseName, desk.caseInsensitiveCompare(home) != .orderedSame {
            return "\(home) (at \(desk))"
        }
        return home
    }

    /// "4h" / "30m" / "1h 30m" — the tapped slot's length, off the grid's own minutes.
    private var durationLabel: String {
        let mins = Int(row.endMin) - Int(row.startMin)
        let (h, m) = (mins / 60, mins % 60)
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return "\(h)h \(m)m"
    }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let tint = WorkerTint.forBlock(row)
        ShiftSheet(title: "Shift details", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 14) {
                // The shift itself: what slot was tapped.
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                        .accessibilityIdentifier("contact_time")
                    Text(durationLabel).font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }

                // The person on it, as a card.
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        HouseBadge(
                            initial: String(name.prefix(1)),
                            bg: tint?.color ?? c.surfaceVar,
                            fg: tint?.onColor ?? c.ink
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(ShiftFont.sans(17, .semibold)).foregroundColor(c.ink).lineLimit(1)
                                .accessibilityIdentifier("contact_name")
                            if let houseLine {
                                Text(houseLine).font(ShiftFont.sans(13.5)).foregroundColor(c.sec).lineLimit(1)
                                    .accessibilityIdentifier("contact_house")
                            }
                        }
                    }
                    contactDetail("phone.fill", row.workerPhone, "No phone on file", "contact_phone", c)
                    contactDetail("envelope.fill", row.workerEmail, "No email on file", "contact_email", c)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(c.surfaceVar)
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityIdentifier("contact_person_card")

                if let phone = row.workerPhone {
                    ShiftButton(title: "Call \(name)", action: { dial(phone) }, systemIcon: "phone.fill", fullWidth: true)
                        .accessibilityIdentifier("contact_call_button")
                }
                if let email = row.workerEmail {
                    ShiftButton(
                        title: "Email \(name)",
                        action: { mail(email) },
                        variant: .outlined,
                        systemIcon: "envelope.fill",
                        fullWidth: true
                    )
                    .accessibilityIdentifier("contact_email_button")
                }
                if let desk = deskPhone {
                    ShiftButton(title: "Call the desk · \(desk)", action: { dial(desk) }, variant: .outlined, fullWidth: true)
                        .accessibilityIdentifier("contact_call_desk")
                }
            }
            .accessibilityIdentifier("contact_sheet")
        }
    }

    private func contactDetail(
        _ icon: String, _ value: String?, _ placeholder: String, _ id: String, _ c: ShiftColors
    ) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 13))
                .foregroundColor(value == nil ? c.ter : c.sec).frame(width: 16)
            Text(value ?? placeholder)
                .font(ShiftFont.sans(14)).foregroundColor(value == nil ? c.ter : c.ink).lineLimit(1)
                .accessibilityIdentifier(id)
        }
    }

    /// Opens the dialer with the number prefilled. `tel:` never places the call itself.
    private func dial(_ phone: String) {
        let digits = phone.filter { !$0.isWhitespace && $0 != "(" && $0 != ")" && $0 != "-" }
        if let url = URL(string: "tel://\(digits)") {
            UIApplication.shared.open(url)
        }
    }

    /// Opens the mail app composing to this worker, with the tapped shift as the subject
    /// so the recipient has context. Nothing is sent from here.
    private func mail(_ email: String) {
        var comps = URLComponents()
        comps.scheme = "mailto"
        comps.path = email
        comps.queryItems = [URLQueryItem(name: "subject", value: "Shift on \(row.timeLabel)")]
        if let url = comps.url {
            UIApplication.shared.open(url)
        }
    }
}

/// SM/HM/BM/RSM "assign a worker" to an open seat (BSpec §2.2 / §4.4) — the mobile
/// analogue of the web builder's override card. Fetches the house roster, filters it by
/// name, and on a tap POSTs `admin-assign-worker` via `ManagerRepository`. A soft-advisory
/// result (over-target / soft-cap / cannot / opted-out) surfaces a confirm dialog that
/// re-submits with `override = true`; terminal results flow back to the host for the toast
/// and the grid refetch. The server is authoritative for authorization + the hard cap.
private struct AssignWorkerSheet: View {
    let houseName: String
    let houseId: String
    let block: HouseGridBlock
    let onAssigned: (Int) -> Void
    let onRejected: (String) -> Void
    let onFailed: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var roster: [RosterWorker] = []
    @State private var query = ""
    @State private var loading = true
    @State private var busy = false
    // Non-nil when the last attempt tripped soft advisories: the worker to re-submit with
    // override + the advisory lines to show in the confirm dialog.
    @State private var confirmWorker: RosterWorker?
    @State private var advisoryLines: [String] = []

    private var filtered: [RosterWorker] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? roster : roster.filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        ShiftSheet(title: "Assign worker", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                Text("\(houseName) · \(block.timeLabel)")
                    .font(ShiftFont.sans(13.5)).foregroundColor(c.sec)
                searchField(c)
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                } else if filtered.isEmpty {
                    Text(query.isEmpty ? "No workers in this house." : "No matches.")
                        .font(ShiftFont.sans(14)).foregroundColor(c.ter)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
                } else {
                    ForEach(filtered, id: \.userId) { w in workerRow(w, c) }
                }
            }
            .accessibilityIdentifier("assign_worker_sheet")
        }
        .task { await load() }
        .confirmationDialog(
            "Assign anyway?",
            isPresented: Binding(get: { confirmWorker != nil }, set: { if !$0 { confirmWorker = nil } }),
            titleVisibility: .visible,
            presenting: confirmWorker
        ) { w in
            Button("Assign anyway") { assign(w, override: true) }
            Button("Cancel", role: .cancel) { }
        } message: { _ in
            Text(advisoryLines.joined(separator: "\n"))
        }
    }

    private func searchField(_ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundColor(c.ter)
            TextField("Search this house", text: $query)
                .font(ShiftFont.sans(14)).foregroundColor(c.ink)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("assign_search_field")
            if !query.isEmpty {
                Button(action: { query = "" }) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(c.sec)
                }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 11)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }

    private func workerRow(_ w: RosterWorker, _ c: ShiftColors) -> some View {
        Button(action: { assign(w, override: false) }) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(w.name.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                Text(w.name).font(ShiftFont.sans(14.5, .semibold)).foregroundColor(c.ink)
                Spacer(minLength: 0)
                Image(systemName: ShiftIcons.plus).font(.system(size: 13, weight: .semibold)).foregroundColor(c.blue)
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier("assign_worker_row")
    }

    private func load() async {
        roster = (try? await WorkerBackend.shared.managerRepository.fetchHouseRoster(houseId: houseId)) ?? []
        loading = false
    }

    private func assign(_ w: RosterWorker, override: Bool) {
        guard !busy else { return }
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                let outcome = try await WorkerBackend.shared.managerRepository.assignWorker(
                    assignmentIds: block.assignmentIds, userId: w.userId, scope: "this_week", override: override)
                switch onEnum(of: outcome) {
                case .assigned(let a):
                    onAssigned(Int(a.count))
                case .needsConfirm(let n):
                    advisoryLines = n.advisories.map { $0.message }
                    confirmWorker = w
                case .rejected(let r):
                    onRejected(r.message)
                case .failed:
                    onFailed()
                }
            } catch {
                onFailed()
            }
        }
    }
}

// MARK: - Per-worker colours (docs/design/worker-colors.md)

/// A worker's full-strength colour plus the legible foreground that sits on it.
///
/// The palette and the hash live in the shared KMP module (`WorkerColorsKt`), which is
/// the Kotlin mirror of `apps/web/lib/workerColor.ts` — so a worker's colour is identical
/// on the web calendars, Android and here. This type only converts the packed 0xRRGGBB
/// ints into SwiftUI colours and does the label blend; it must never re-derive the hash.
struct WorkerTint {
    let rgb: UInt32
    let onRgb: UInt32

    var color: Color { Color(hex: rgb) }
    var onColor: Color { Color(hex: onRgb) }

    /// The occupant's tint, or nil when the block must keep its STATE colour (vacant /
    /// float-in / pending) or carries no worker.
    static func forBlock(_ b: HouseGridBlock) -> WorkerTint? {
        guard let uid = b.userId, b.wearsWorkerColor() else { return nil }
        return WorkerTint(
            rgb: UInt32(bitPattern: WorkerColorsKt.workerColor(userId: uid)),
            onRgb: UInt32(bitPattern: WorkerColorsKt.workerContrastText(userId: uid))
        )
    }

    /// `onColor` with a slice of `color` mixed in, so the time label keeps a coloured
    /// identity without losing contrast. Hand-rolled rather than `Color.mix` (iOS 18+)
    /// because the app's deployment target is lower.
    func labelColor(_ amount: Double) -> Color {
        func ch(_ v: UInt32, _ shift: UInt32) -> Double { Double((v >> shift) & 0xFF) }
        let r = ch(onRgb, 16) * (1 - amount) + ch(rgb, 16) * amount
        let g = ch(onRgb, 8) * (1 - amount) + ch(rgb, 8) * amount
        let b = ch(onRgb, 0) * (1 - amount) + ch(rgb, 0) * amount
        return Color(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: 1)
    }
}

// `sheet(item:)` needs Identifiable; the model ids are stable.
extension MyShift: Identifiable {}
extension OpenShift: Identifiable {}
extension HouseGridBlock: Identifiable {}

/// Reports the House grid's horizontal day-column scroll offset (≤ 0) so the frozen
/// day-header row can track it. Last value wins (one scroll view feeds it).
private struct HouseHScrollKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private extension View {
    /// Continuously mirror a horizontal `ScrollView`'s content offset to `onOffset` (≤ 0,
    /// matching the preference convention) so the House grid's frozen day-header row tracks
    /// the columns as they scroll sideways. `onScrollGeometryChange` (iOS 18+) updates on
    /// every offset change during the drag; on older systems this is a no-op and the
    /// `HouseHScrollKey` preference path remains the (best-effort) fallback.
    @ViewBuilder
    func houseTrackHScroll(_ onOffset: @escaping (CGFloat) -> Void) -> some View {
        if #available(iOS 18.0, *) {
            self.onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x } action: { _, x in
                onOffset(-x)
            }
        } else {
            self
        }
    }
}

#Preview {
    ShiftsRootView()
}
