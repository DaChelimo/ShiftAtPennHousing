import SwiftUI
import Shared

/// Phase 13a — the worker Shifts screen in SwiftUI (BEHAVIORAL_SPECIFICATION.md §5.6).
///
/// Native UI over the shared `ShiftsScreenViewModel` (the Fruitties split). The
/// three spec tabs plus an Updates tab where a pending float surfaces. Selector
/// `accessibilityIdentifier`s match `apps/mobile/maestro/README.md` so the same
/// Maestro flows run on the iOS simulator.

/// Observes a Kotlin `StateFlow<ShiftsUiState>` (exposed by SKIE) as `@Published`.
@MainActor
final class ShiftsObservable: ObservableObject {
    let vm: ShiftsScreenViewModel
    @Published var state: ShiftsUiState
    private var task: Task<Void, Never>?

    init(vm: ShiftsScreenViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState {
                self.state = s
            }
        }
    }

    deinit { task?.cancel() }
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
    func activateLive(repo: WorkerShiftsRepository, userId: String) async {
        guard !live else { return }
        live = true
        guard let closed = try? await repo.fetchCalendarClosedDays(userId: userId), !closed.isEmpty else { return }
        vm = DemoFactory.shared.calendarViewModel(closedDayIndexes: closed)
        subscribe()
    }

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
        let outgoing = (try? await repo.fetchOutgoingSwaps(userId: userId)) ?? []
        vm = DemoFactory.shared.updatesViewModel(notifications: items, float: float ?? nil, swaps: swaps, outgoing: outgoing)
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

    /// Optimistic resolution of an incoming swap entry (T3a): the actionable row leaves
    /// the feed immediately; the live host POSTs `accept-swap` / `reject-swap` best-effort.
    func resolveSwap(_ swapId: String) {
        vm.resolveSwap(swapId: swapId)
        feed = vm.uiState.value.feed
    }
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
        guard let float = try? await repo.fetchPendingFloat(userId: userId), let float else { return }
        vm = DemoFactory.shared.ackViewModel(float: float)
    }
}

private enum Tab: Int { case mine, home, other, calendar, house, updates, preferences, breakShifts, settings }

/// Observes the §11.4 house-schedule `StateFlow` (T3b). Demo by default; the live
/// host calls `activateLive` to swap in the worker's real `house_schedule_grid`
/// snapshot (home-house scoped via RLS; contacts via the full-directory ruling).
@MainActor
final class HouseObservable: ObservableObject {
    private(set) var vm: HouseScheduleViewModel
    @Published var state: HouseScheduleUiState
    private var task: Task<Void, Never>?
    private var live = false

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

    func activateLive(repo: WorkerShiftsRepository, userId: String) async {
        guard !live else { return }
        live = true
        guard let snapshot = try? await repo.fetchHouseSchedule(userId: userId), let snapshot else { return }
        vm = DemoFactory.shared.houseScheduleViewModel(snapshot: snapshot)
        subscribe()
    }

    deinit { task?.cancel() }
}

struct ShiftsRootView: View {
    /// Optional sign-out hook from the live host (demo passes nil → no-op).
    var onSignOut: () -> Void = {}
    /// The authenticated worker's id on the backend-configured path (nil in demo).
    /// When set, the Preferences tab loads the worker's real period and submits live.
    var liveUserId: String? = nil

    @StateObject private var model = ShiftsObservable(vm: DemoFactory.shared.shiftsViewModel())
    @StateObject private var calendarModel = CalendarObservable(vm: DemoFactory.shared.calendarViewModel())
    @StateObject private var houseModel = HouseObservable(vm: DemoFactory.shared.houseScheduleViewModel())
    @StateObject private var prefsModel = PreferencesObservable(vm: DemoFactory.shared.preferencesViewModel())
    @StateObject private var breakModel = BreakClaimObservable(vm: DemoFactory.shared.breakClaimViewModel())
    @StateObject private var settingsModel = SettingsObservable(vm: DemoFactory.shared.settingsViewModel())
    @StateObject private var ackModel = AckHostObservable()
    @StateObject private var updatesModel = UpdatesObservable(vm: DemoFactory.shared.updatesViewModel())
    @Environment(\.colorScheme) private var scheme

    @State private var tab: Tab = .mine
    @State private var dropTarget: MyShift?
    @State private var claimTarget: OpenShift?
    @State private var showAck = false
    @State private var claimSucceeded = false
    // D2/D3 — swap proposal target (opened from the drop sheet's pivot).
    @State private var swapTarget: MyShift?
    @State private var swapProposed = false
    // D5 — week-picker sheet.
    @State private var showWeekPicker = false
    // T2-13 — push/deep-link routed full-screen ack (AppDelegate / onOpenURL set it).
    @ObservedObject private var deepLink = DeepLinkRouter.shared

    var body: some View {
        VStack(spacing: 0) {
            if claimSucceeded {
                // The sheet dismisses on confirm (so the tab bar stays reachable for
                // the Maestro flow); this top toast carries the `claim_success` selector.
                ShiftToast(message: "Claimed — it's now in My Shifts", tone: .success, systemIcon: ShiftIcons.check)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .accessibilityIdentifier("claim_success")
            }
            if swapProposed {
                // D2 — the server stays authoritative; the request shows under Updates once created.
                ShiftToast(message: "Swap proposed — your housemate has been asked", tone: .success, systemIcon: ShiftIcons.check)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .accessibilityIdentifier("swap_proposed_toast")
            }

            tabBar

            Divider()

            ScrollView {
                switch tab {
                case .mine: myShifts
                case .home: homeOpen
                case .other: otherHouses
                case .calendar: calendarTab
                case .house: houseTab
                case .updates: updates
                case .preferences: PreferencesScreen(model: prefsModel)
                case .breakShifts: BreakClaimScreen(
                    model: breakModel,
                    // Live host POSTs `break-claim` / `drop-shift` (best-effort) while the
                    // picker does the optimistic local move; demo (liveUserId == nil) =
                    // local-only. The break pool stays demo-backed until `break_periods` is
                    // worker-readable (T2-2); the server enforces the 40h hard cap + Harnwell.
                    onClaim: liveUserId == nil ? nil : { assignmentId in
                        let repo = WorkerBackend.shared.shiftsRepository
                        Task { _ = try? await repo.claimBreak(assignmentId: assignmentId) }
                    },
                    onDrop: liveUserId == nil ? nil : { assignmentId in
                        let repo = WorkerBackend.shared.shiftsRepository
                        Task { _ = try? await repo.dropShift(assignmentId: assignmentId) }
                    },
                    // Live host writes the §4.4 "no break hours" opt-out (own `break_optouts`
                    // row, insert/delete) DIRECTLY via Postgrest while the picker flips its
                    // optimistic state; demo (liveUserId == nil) = local-only. Targets the
                    // active break id surfaced by `activateLive` (no-op when none loaded).
                    onToggleOptOut: liveUserId == nil ? nil : { optedOut in
                        guard let uid = liveUserId, let bid = breakModel.vm.breakId else { return }
                        let repo = WorkerBackend.shared.breakRepository
                        Task { _ = try? await repo.setBreakOptOut(userId: uid, breakId: bid, optedOut: optedOut) }
                    }
                )
                case .settings: SettingsScreen(
                    model: settingsModel,
                    onSignOut: onSignOut,
                    // Live host PATCHes `users-broadcast-subscription` (best-effort) while the
                    // settings VM does the optimistic local toggle; demo (liveUserId == nil) =
                    // local-only. The EF 403s an HM/BM subscribe; the next profile read reconciles.
                    onToggleBroadcast: liveUserId == nil ? nil : { subscribed in
                        guard let uid = liveUserId else { return }
                        let repo = WorkerBackend.shared.profileRepository
                        Task { _ = try? await repo.setBroadcastSubscription(userId: uid, subscribed: subscribed) }
                    }
                )
                }
            }
        }
        .accessibilityIdentifier("shifts_screen")
        .sheet(item: $dropTarget) { shift in
            // Live host POSTs the real drop on confirm (best-effort); demo keeps the
            // local-only optimistic move. Mirrors the preferences-submit live wiring.
            DropFlowSheet(vm: model.vm, shift: shift, onDrop: liveUserId == nil ? nil : { droppedShift, permanent in
                let repo = WorkerBackend.shared.shiftsRepository
                Task {
                    if permanent {
                        _ = try? await repo.permanentDrop(shift: droppedShift)
                    } else {
                        _ = try? await repo.dropShift(shift: droppedShift)
                    }
                }
            }, onProposeSwap: swapKindsFor(shift: shift, breakProfile: false).isEmpty ? nil : {
                // D2 — pivot from dropping to proposing a swap for the same card.
                dropTarget = nil
                swapTarget = shift
            })
        }
        .sheet(item: $swapTarget) { shift in
            SwapSheetView(
                shift: shift,
                kinds: swapKindsFor(shift: shift, breakProfile: false),
                candidates: swapCandidatesFor(seats: houseModel.state.seats, excludeUserId: liveUserId),
                onSubmit: { proposal in
                    // Live host POSTs the real proposal → `create-swap` (best-effort);
                    // the server is authoritative for §8 eligibility/conflicts.
                    if liveUserId != nil {
                        let repo = WorkerBackend.shared.shiftsRepository
                        Task { _ = try? await repo.createSwap(proposal: proposal) }
                    }
                    swapProposed = true
                }
            )
        }
        .sheet(item: $claimTarget) { shift in
            ClaimFlowSheet(
                vm: model.vm,
                shift: shift,
                currentWeeklyHours: DemoFactory.shared.demoWeeklyHours,
                // Live host GETs the `permanent-pickup` dry-run SCOPE for the "Picking up N of
                // M weeks · K skipped" confirmation; demo (no live user) → nil = plain note.
                loadPermanentScope: liveUserId == nil ? nil : { s in
                    let repo = WorkerBackend.shared.shiftsRepository
                    return try? await repo.permanentPickupScope(shift: s)
                },
                onConfirmed: { effective in
                    // Live host POSTs the real pickup (best-effort) while the ViewModel does the
                    // optimistic local pickup. A WEEKLY opening → `claim-shift` (per selected
                    // block — `effective` is the §5.3 partial selection, T2-10); a PERMANENT
                    // opening → the `permanent-pickup` EF (the real path — `claim-shift`'s
                    // permanent branch 501s). Server stays authoritative for cap/T-2h/FCFS and
                    // the multi-week §8.4.3 scope; the next Realtime snapshot reconciles. Demo =
                    // local-only.
                    if liveUserId != nil {
                        let repo = WorkerBackend.shared.shiftsRepository
                        if effective.feed == .permanentOpening {
                            Task { _ = try? await repo.permanentPickup(shift: effective) }
                        } else {
                            Task { _ = try? await repo.claimShift(shift: effective) }
                        }
                    }
                    model.vm.claim(shift: effective)
                    claimSucceeded = true
                }
            )
        }
        .sheet(isPresented: $showAck) {
            ackSurface
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
        .task {
            // Backend-configured path: load the worker's real active period + wire the
            // live submit. Demo (liveUserId == nil) keeps the DemoFactory period.
            if let uid = liveUserId {
                await prefsModel.activateLive(repo: WorkerBackend.shared.preferencesRepository, userId: uid)
                await updatesModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                await ackModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                await settingsModel.activateLive(repo: WorkerBackend.shared.profileRepository, userId: uid)
                // Closed-house days for the calendar strip (§3.4/§11.3, T2-12c).
                await calendarModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                // The home-house grid + contacts (§11.4, T3b).
                await houseModel.activateLive(repo: WorkerBackend.shared.shiftsRepository, userId: uid)
                // Live break context (name + window + "only Harnwell open") + the §4.4
                // opt-out state from the worker-readable `break_periods` / `break_optouts`;
                // the pool stays demo-backed (T2-2a/T2-2b).
                await breakModel.activateLive(repo: WorkerBackend.shared.breakRepository, userId: uid)
            }
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
                Task { _ = try? await repo.acknowledgeFloat(floatId: floatId) }
            },
            onDecline: liveUserId == nil ? nil : { floatId in
                let repo = WorkerBackend.shared.shiftsRepository
                Task { _ = try? await repo.declineFloat(floatId: floatId) }
            }
        )
    }

    // MARK: tabs

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                tabButton("My Shifts", "tab_my_shifts", .mine)
                tabButton("Open · My House", "tab_open_home", .home)
                tabButton("Open · Other", "tab_open_other", .other)
                tabButton("Calendar", "tab_calendar", .calendar)
                tabButton("House", "tab_house", .house)
                tabButton("Updates", "tab_updates", .updates)
                tabButton("Preferences", "tab_preferences", .preferences)
                tabButton("Break shifts", "tab_break", .breakShifts)
                tabButton("Settings", "tab_settings", .settings)
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 6)
    }

    private func tabButton(_ title: String, _ id: String, _ which: Tab) -> some View {
        Button(action: {
            tab = which
            switch which {
            case .mine: model.vm.selectTab(tab: .myShifts)
            case .home: model.vm.selectTab(tab: .openHome)
            case .other: model.vm.selectTab(tab: .openOther)
            case .calendar, .house, .updates, .preferences, .breakShifts, .settings: break
            }
        }) {
            Text(title)
                .font(.subheadline)
                .fontWeight(tab == which ? .bold : .regular)
                .foregroundColor(tab == which ? ShiftColors.resolve(scheme).blue : ShiftColors.resolve(scheme).sec)
                .padding(.horizontal, 10).padding(.vertical, 4)
        }
        .accessibilityIdentifier(id)
    }

    // MARK: Tab 1 — My Shifts

    // §5.6 Tab 1 order (top→bottom): picked-up, dropped, scheduled — spec + Maestro
    // contract (the design's visual order is scheduled-first; spec pins this order).
    private var myShifts: some View {
        VStack(alignment: .leading, spacing: 22) {
            WeekTotalChip(currentWeeklyHours: DemoFactory.shared.demoWeeklyHours)

            ShiftSection(
                title: "Picked up",
                isEmpty: model.state.myShifts.pickedUp.isEmpty,
                count: model.state.myShifts.pickedUp.count,
                emptyText: "Nothing picked up. Browse Open Shifts to claim."
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.myShifts.pickedUp, id: \.id) { s in
                        myShiftCard(s, "picked_up_shift_card", onTap: { dropTarget = s })
                    }
                }
            }
            .accessibilityIdentifier("section_picked_up")

            ShiftSection(
                title: "Dropped — still open",
                isEmpty: model.state.myShifts.dropped.isEmpty,
                count: model.state.myShifts.dropped.count,
                emptyText: "Nothing dropped. 👍"
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.myShifts.dropped, id: \.id) { s in
                        myShiftCard(s, "dropped_shift_card", reclaim: {
                            // Live host POSTs the SAME `claim-shift` to retake the
                            // still-vacant slot (best-effort); demo = local-only.
                            if liveUserId != nil {
                                let repo = WorkerBackend.shared.shiftsRepository
                                Task { _ = try? await repo.reclaimShift(shift: s) }
                            }
                            model.vm.reclaim(shiftId: s.id)
                        })
                    }
                }
            }
            .accessibilityIdentifier("section_dropped")

            ShiftSection(
                title: "Scheduled",
                isEmpty: model.state.myShifts.scheduled.isEmpty,
                count: model.state.myShifts.scheduled.count,
                emptyText: "No scheduled shifts."
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.myShifts.scheduled, id: \.id) { s in
                        myShiftCard(s, "scheduled_shift_card", onTap: { dropTarget = s })
                    }
                }
            }
            .accessibilityIdentifier("section_scheduled")
        }
        .padding(16)
    }

    /// One My-Shifts card, driven by the shared `MyShift.toRow()` presentation model.
    private func myShiftCard(_ shift: MyShift, _ id: String, onTap: (() -> Void)? = nil, reclaim: (() -> Void)? = nil) -> some View {
        let row = shift.toRow()
        return ShiftCard(
            state: kitState(row.state),
            houseInitial: row.houseInitial,
            timeLabel: row.timeLabel,
            houseName: row.houseName,
            destination: row.destination,
            durationLabel: row.durationLabel,
            meta: row.dayLabel,
            onTap: onTap,
            trailing: reclaim.map { AnyView(ShiftButton(title: "Reclaim", action: $0, variant: .tonal, size: .sm)) }
        )
        .accessibilityIdentifier(id)
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

    // MARK: Tab 2 — Open in My House

    private var homeOpen: some View {
        VStack(alignment: .leading, spacing: 22) {
            ShiftSection(
                title: "Weekly open shifts",
                isEmpty: model.state.homeOpen.weekly.isEmpty,
                count: model.state.homeOpen.weekly.count,
                emptyText: "No open shifts in your house this week."
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.homeOpen.weekly, id: \.id) { openFeedCard($0) }
                }
            }
            .accessibilityIdentifier("home_weekly_feed")

            ShiftSection(
                title: "Permanent openings",
                isEmpty: model.state.homeOpen.permanentOpenings.isEmpty,
                count: model.state.homeOpen.permanentOpenings.count,
                emptyText: "No permanent openings right now."
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.homeOpen.permanentOpenings, id: \.id) { openFeedCard($0) }
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
        let row = shift.toRow(claimable: claimable)
        return ShiftCard(
            state: openKitState(row.state),
            houseInitial: row.houseInitial,
            timeLabel: row.timeLabel,
            eyebrow: row.dayLabel,
            houseName: row.houseName,
            durationLabel: row.durationLabel,
            meta: row.meta,
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
        VStack(alignment: .leading, spacing: 22) {
            if model.state.otherHouses.isEmpty {
                // §5.6 / decision #6 — no eligible cross-house feed (e.g. winter break).
                EmptyState(
                    title: "No eligible shifts elsewhere",
                    systemIcon: ShiftIcons.building,
                    bodyText: "No open shifts at houses you can pick up at right now. Common during winter break."
                )
            } else {
                ForEach(model.state.otherHouses.groups, id: \.house.id) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeader(title: group.house.name, count: group.weekly.count + group.permanentOpenings.count)
                        VStack(spacing: 10) {
                            ForEach(group.weekly, id: \.id) { openFeedCard($0) }
                            ForEach(group.permanentOpenings, id: \.id) { openFeedCard($0) }
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("other_houses_tab")
    }

    // MARK: Updates — §10.1 notifications feed + the §7 pending-float entry

    private var updates: some View {
        let feed = updatesModel.feed
        return Group {
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
                    Task { _ = try? await repo.markAllRead(userId: uid, unreadIds: ids) }
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
                if let swapId = row.swapId {
                    // T3a — the counterparty action on an incoming swap (Accept only for
                    // temporary swaps; permanent acceptance needs the desk/web — §8.4).
                    // D4 — an OUTGOING pending swap offers Cancel (void) instead.
                    HStack(spacing: 8) {
                        if row.swapOutgoing {
                            ShiftButton(title: "Cancel request", action: { voidSwap(swapId) }, variant: .outlined, size: .sm)
                                .accessibilityIdentifier("swap_void_button")
                        } else {
                            if row.swapAcceptable {
                                ShiftButton(title: "Accept", action: { actOnSwap(swapId, accept: true) }, size: .sm)
                                    .accessibilityIdentifier("swap_accept_button")
                            }
                            ShiftButton(title: "Decline", action: { actOnSwap(swapId, accept: false) }, variant: .outlined, size: .sm)
                                .accessibilityIdentifier("swap_reject_button")
                        }
                    }
                    .padding(.top, 6)
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

    /// D4 — cancel an own outgoing pending swap: optimistic resolve + `void-swap` POST.
    private func voidSwap(_ swapId: String) {
        updatesModel.resolveSwap(swapId)
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        Task { _ = try? await repo.voidSwap(swapId: swapId) }
    }

    /// Resolve an incoming swap entry optimistically, then (live) POST the real
    /// `accept-swap` / `reject-swap` best-effort — the server stays authoritative.
    private func actOnSwap(_ swapId: String, accept: Bool) {
        updatesModel.resolveSwap(swapId)
        guard liveUserId != nil else { return }
        let repo = WorkerBackend.shared.shiftsRepository
        Task {
            if accept {
                _ = try? await repo.acceptSwap(swapId: swapId)
            } else {
                _ = try? await repo.rejectSwap(swapId: swapId)
            }
        }
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

    // MARK: House — §11.4 home-house schedule + contact lookup (T3b)

    @State private var contactTarget: HouseRosterRow?

    private var houseTab: some View {
        let c = ShiftColors.resolve(scheme)
        let st = houseModel.state
        return VStack(alignment: .leading, spacing: 0) {
            houseHeaderCard(st, c)
            houseWeekStrip(st.week, Int(st.selectedDayIndex), c)
            if st.day.isEmpty {
                EmptyState(
                    title: "No desk shifts this day",
                    systemIcon: ShiftIcons.building,
                    bodyText: "Nothing scheduled at \(st.houseName) on this day."
                )
                .padding(.top, 8)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(st.day.rows, id: \.id) { row in
                        houseRosterRow(row, c)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("house_screen")
        .sheet(item: $contactTarget) { row in
            ContactSheetView(row: row, deskPhone: houseModel.state.deskPhone)
        }
    }

    private func houseHeaderCard(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 12) {
            HouseBadge(initial: String(st.houseName.prefix(1)), bg: c.blueContainer, fg: c.blue)
            VStack(alignment: .leading, spacing: 1) {
                Text(st.houseName).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                Text(st.deskPhone.map { "Desk · \($0)" } ?? "House schedule")
                    .font(ShiftFont.sans(13)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            if let desk = st.deskPhone {
                ShiftButton(title: "Call desk", action: { dial(desk) }, variant: .tonal, size: .sm)
                    .accessibilityIdentifier("house_call_desk")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    /// The same Mon–Sun strip as the calendar, driving the house VM's selectDay.
    private func houseWeekStrip(_ week: CalendarWeek, _ selected: Int, _ c: ShiftColors) -> some View {
        HStack(spacing: 2) {
            ForEach(week.days, id: \.index) { day in
                Button(action: { houseModel.vm.selectDay(index: day.index) }) {
                    VStack(spacing: 4) {
                        Text(day.dayLetter).font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ter)
                        ZStack {
                            Circle().fill(Int(day.index) == selected ? c.blue : Color.clear).frame(width: 34, height: 34)
                            if day.isToday && Int(day.index) != selected {
                                Circle().strokeBorder(c.blue, lineWidth: 1.5).frame(width: 34, height: 34)
                            }
                            Text(day.dateLabel)
                                .font(ShiftFont.sans(14, day.isToday ? .bold : .medium))
                                .foregroundColor(Int(day.index) == selected ? .white : c.ink)
                        }
                        Circle().fill(day.hasShifts ? c.blue : Color.clear).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("house_day_cell")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 2)
        .accessibilityIdentifier("house_week_strip")
    }

    private func houseRosterRow(_ row: HouseRosterRow, _ c: ShiftColors) -> some View {
        Button(action: { if !row.vacant { contactTarget = row } }) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                    HStack(spacing: 6) {
                        Text(row.workerName ?? "Open shift")
                            .font(ShiftFont.sans(13.5, row.vacant ? .regular : .medium))
                            .foregroundColor(row.vacant ? c.ter : c.sec)
                        if row.pending {
                            Text("Pending float").font(ShiftFont.sans(11.5, .semibold)).foregroundColor(c.pending)
                        } else if row.floatIn {
                            Text("Float in").font(ShiftFont.sans(11.5, .semibold)).foregroundColor(c.floatIn.accent)
                        }
                    }
                }
                Spacer(minLength: 0)
                Text(row.durationLabel).font(ShiftType.monoId).monospacedDigit().foregroundColor(c.ter)
                if !row.vacant && row.workerPhone != nil {
                    Image(systemName: ShiftIcons.phone).font(.system(size: 14)).foregroundColor(c.blue)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(row.vacant ? c.surfaceVar : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(row.active ? c.blue : c.divider, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("house_roster_row")
    }

    private func dial(_ phone: String) {
        let digits = phone.filter { !$0.isWhitespace }
        if let url = URL(string: "tel://\(digits)") {
            UIApplication.shared.open(url)
        }
    }

    // MARK: Calendar — agenda-first Personal Calendar (current week only)

    private var calendarTab: some View {
        let c = ShiftColors.resolve(scheme)
        let st = calendarModel.state
        return Group {
            if st.mode == .template {
                // D5 — the derived recurring typical week (honestly labelled).
                VStack(alignment: .leading, spacing: 10) {
                    weekHeaderCard("Derived from your scheduled weeks", titleOverride: "Recurring template", c)
                    ShiftBanner(
                        title: "Viewing the recurring template",
                        bodyText: "Derived from your scheduled weeks — permanent drops and swaps change every future week.",
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
            weekHeaderCard(st.week.rangeLabel, Int(st.weekOffset), c)
            weekStrip(st.week, Int(st.selectedDayIndex), c)
            dayHeaderRow(st.agenda.header, c)
            if st.agenda.isEmpty {
                if st.agenda.header.closed {
                    // §3.4/§11.3 (T2-12c): the home house is closed this date.
                    EmptyState(
                        title: "House closed",
                        systemIcon: ShiftIcons.building,
                        bodyText: "Your house is closed this day — no desk shifts are scheduled."
                    )
                    .padding(.top, 8)
                } else {
                    EmptyState(
                        title: "No shifts this day",
                        systemIcon: ShiftIcons.calendar,
                        bodyText: "Enjoy the day off — or browse Open Shifts to pick one up."
                    )
                    .padding(.top, 8)
                }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(st.agenda.items.enumerated()), id: \.offset) { _, item in
                        if let nowLabel = item.nowLabel {
                            nowLine(nowLabel, c)
                        } else if let shift = item.shift {
                            ShiftCard(
                                state: kitState(shift.state),
                                houseInitial: shift.houseInitial,
                                timeLabel: shift.timeLabel,
                                houseName: shift.houseName,
                                destination: shift.destination,
                                durationLabel: shift.durationLabel,
                                active: item.active
                            )
                            .accessibilityIdentifier("calendar_shift_card")
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("calendar_screen")
    }

    /// D5 — title-overridden header (template mode); tap opens the picker.
    private func weekHeaderCard(_ range: String, titleOverride: String, _ c: ShiftColors) -> some View {
        Button(action: { showWeekPicker = true }) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(c.blueContainer).frame(width: 38, height: 38)
                    Image(systemName: ShiftIcons.calendar).font(.system(size: 19)).foregroundColor(c.blue)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(titleOverride).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                    Text(range).font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("calendar_week_picker_open")
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
                        .background(Int(calendarModel.state.weekOffset) == Int(option.offset) ? c.blue.opacity(0.08) : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("week_picker_option")
                }
                Button(action: {
                    calendarModel.vm.showTemplate()
                    showWeekPicker = false
                }) {
                    HStack {
                        Text("Recurring template").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.permanent.deep)
                        Spacer(minLength: 0)
                        Text("derived").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                    }
                    .padding(.horizontal, 13).padding(.vertical, 11)
                    .background(c.permanent.tint)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("week_picker_template")
            }
            .accessibilityIdentifier("week_picker_sheet")
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

    /// The week-picker header (T3b-4): the shown week's range + prev/next chevrons.
    private func weekHeaderCard(_ range: String, _ weekOffset: Int, _ c: ShiftColors) -> some View {
        let title: String
        switch weekOffset {
        case 0: title = "This week"
        case 1: title = "Next week"
        case -1: title = "Last week"
        case let o where o > 1: title = "In \(o) weeks"
        default: title = "\(-weekOffset) weeks ago"
        }
        return HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(c.blueContainer).frame(width: 38, height: 38)
                Image(systemName: ShiftIcons.calendar).font(.system(size: 19)).foregroundColor(c.blue)
            }
            Button(action: { showWeekPicker = true }) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                    Text(range).font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("calendar_week_picker_open")
            Spacer(minLength: 0)
            Button(action: { calendarModel.vm.previousWeek() }) {
                Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold)).foregroundColor(c.sec)
                    .padding(6)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("calendar_prev_week")
            Button(action: { calendarModel.vm.nextWeek() }) {
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold)).foregroundColor(c.sec)
                    .padding(6)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("calendar_next_week")
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 8)
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
    /// Receives the EFFECTIVE open shift — the §5.3 partial selection for a weekly
    /// opening (T2-10), or the whole card (permanent pickups always take the slot).
    let onConfirmed: (OpenShift) -> Void
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
        let row = shift.toRow(claimable: claimable)
        let permanent = isPermanentOpen(row.state)
        let plan = vm.planClaimRange(shift: shift, fromBlock: Int32(rangeFrom), toBlock: Int32(effectiveTo))
        // The shift the confirm actually claims; the meter + cap gating recompute
        // from this SELECTED span (§5.3).
        let effective = (permanent || plan.wholeShift) ? shift : subOpenShiftFor(shift: shift, plan: plan)
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

                if !permanent && blockCount > 1 {
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
                        title: "Over the 40h limit — can't claim",
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
                                ? "Confirm pickup"
                                : (plan.wholeShift ? "Claim shift" : "Claim \(plan.durationLabel)"),
                            action: {
                                onConfirmed(effective)
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

    /// The §5.3 "How much can you cover?" block-range selector (T2-10): From/Until
    /// steppers over the opening's 30-min block boundaries with a live summary.
    /// Defaults to the whole opening.
    private func claimRangeSelector(_ plan: PartialClaimPlan, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("How much can you cover?").font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
            Text("\(plan.rangeLabel) · \(plan.durationLabel)\(plan.wholeShift ? " · whole shift" : "")")
                .font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
                .accessibilityIdentifier("claim_range_label")
            Stepper("From \(plan.claimStartLabel)", value: $rangeFrom, in: 0...(effectiveTo - 1))
                .font(ShiftFont.sans(13)).foregroundColor(c.sec)
            Stepper(
                "Until \(plan.claimEndLabel)",
                value: Binding(get: { effectiveTo }, set: { rangeTo = $0 }),
                in: (rangeFrom + 1)...blockCount
            )
            .font(ShiftFont.sans(13)).foregroundColor(c.sec)
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
                Text("Repeats weekly — \(meta).").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
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

// MARK: - Drop flow (§5.2)

private struct DropFlowSheet: View {
    let vm: ShiftsScreenViewModel
    let shift: MyShift
    /// Live host POSTs to `drop-shift` / `permanent-drop` on confirm (best-effort);
    /// nil in the demo path. The Bool is the permanent-vs-occurrence scope.
    var onDrop: ((MyShift, Bool) -> Void)? = nil
    /// D2 — non-nil when this card can propose a swap (§8); pivots to the SwapSheet.
    var onProposeSwap: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var permanentScope = false
    @State private var acknowledged = false
    // §5.2 partial range (T2-11) — block indexes on the shift's own grid, [from, to).
    // rangeTo < 0 means "whole shift" (the default; planDropRange clamps).
    @State private var rangeFrom = 0
    @State private var rangeTo = -1

    private var blockCount: Int { shift.blockIds.count }
    private var effectiveTo: Int { rangeTo < 0 ? blockCount : rangeTo }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let row = shift.toRow()
        let options = vm.dropOptions(shift: shift, breakProfile: false)
        let plan = vm.planDropRange(shift: shift, fromBlock: Int32(rangeFrom), toBlock: Int32(effectiveTo))
        // Permanent scope always releases the WHOLE recurring slot (short-notice anchors
        // to the shift start); the occurrence path anchors to the SELECTED gap start (§5.2).
        let shortNotice = permanentScope ? vm.planDrop(shift: shift, dropFromNow: false).shortNotice : plan.shortNotice
        ShiftSheet(title: "Drop shift", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    HouseBadge(initial: row.houseInitial, bg: c.surfaceVar, fg: c.ink)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                        Text("\(row.houseName ?? row.destination ?? "") · \(row.durationLabel)")
                            .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                    }
                }

                DropScopeOption(
                    selected: !permanentScope, title: "Drop this occurrence",
                    detail: "Drops just this occurrence. The slot opens for others to claim.",
                    systemIcon: ShiftIcons.calendar, accent: c.blue, id: "drop_occurrence_option"
                ) { permanentScope = false }

                DropScopeOption(
                    selected: permanentScope, title: "Drop permanently",
                    detail: "Releases this recurring slot. It becomes a permanent opening.",
                    systemIcon: ShiftIcons.refresh, accent: c.permanent.accent, enabled: options.canDropPermanently,
                    id: "drop_permanent_option"
                ) { if options.canDropPermanently { permanentScope = true } }

                if !permanentScope && blockCount > 1 {
                    dropRangeSelector(plan, c)
                }

                if let propose = onProposeSwap {
                    // D2 — keep the shift, trade it with a housemate instead (§8).
                    ShiftButton(title: "Propose a swap instead", action: { dismiss(); propose() }, variant: .tonal, fullWidth: true)
                        .accessibilityIdentifier("swap_propose_option")
                }

                if shortNotice && !acknowledged {
                    VStack(alignment: .leading, spacing: 8) {
                        ShiftBanner(
                            title: "Starts within 20 minutes",
                            bodyText: "Short-notice drop — your manager is notified immediately to arrange cover.",
                            tone: .warning
                        )
                        ShiftButton(title: "Continue anyway", action: { acknowledged = true }, variant: .outlined, size: .sm)
                            .accessibilityIdentifier("drop_short_notice_continue")
                    }
                    .accessibilityIdentifier("drop_short_notice_warning")
                }

                ShiftButton(
                    title: permanentScope
                        ? "Drop permanently"
                        : (plan.wholeShift ? "Drop this week" : "Drop \(plan.rangeLabel)"),
                    action: {
                        // The occurrence path drops the SELECTED sub-shift: its blockIds are
                        // the contiguous run `drop-shift` posts, and only those blocks flip
                        // locally — the rest re-coalesce into their own card(s).
                        if permanentScope {
                            onDrop?(shift, true)
                            vm.drop(shiftId: shift.id)
                        } else {
                            onDrop?(subShiftFor(shift: shift, plan: plan), false)
                            vm.dropBlocks(blockIds: plan.blockIds)
                        }
                        dismiss()
                    },
                    variant: .destructiveFilled, fullWidth: true
                )
                .disabled(shortNotice && !acknowledged)
                .accessibilityIdentifier("drop_confirm_button")
            }
            .accessibilityIdentifier("drop_options_sheet")
        }
    }

    /// The §5.2 "How much to drop" block-range selector (T2-11): From/Until steppers
    /// over the card's 30-min block boundaries with a live "17:30 – 19:00 · 1h 30m"
    /// summary, plus the mid-shift "From now" quick action. Defaults to the whole shift.
    private func dropRangeSelector(_ plan: PartialDropPlan, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("How much to drop").font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
                Spacer(minLength: 0)
                if let idx = vm.dropFromNowIndex(shift: shift) {
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
            Stepper("From \(plan.gapStartLabel)", value: $rangeFrom, in: 0...(effectiveTo - 1))
                .font(ShiftFont.sans(13)).foregroundColor(c.sec)
            Stepper(
                "Until \(plan.gapEndLabel)",
                value: Binding(get: { effectiveTo }, set: { rangeTo = $0 }),
                in: (rangeFrom + 1)...blockCount
            )
            .font(ShiftFont.sans(13)).foregroundColor(c.sec)
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("drop_range_selector")
    }
}

/// The swap-proposal sheet (§8.1–§8.4, D2/D3): pick the kind the card supports,
/// then the counterparty — a housemate's run (temporary) or a person (permanent)
/// from the §11.4 house grid. The server (`create-swap`) stays authoritative.
private struct SwapSheetView: View {
    let shift: MyShift
    let kinds: [SwapKind]
    let candidates: [SwapCandidate]
    let onSubmit: (SwapProposal) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var kindIndex = 0
    @State private var picked: SwapCandidate?

    private var kind: SwapKind { kinds[min(kindIndex, kinds.count - 1)] }
    private var options: [SwapCandidate] {
        kind == .permanent ? swapPeople(candidates: candidates) : candidates
    }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let row = shift.toRow()
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
                    Text("Float swap — a housemate takes your float assignment.")
                        .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }

                SectionHeader(title: kind == .permanent ? "Who takes the slot?" : "Whose shift do you want?")
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

                ShiftButton(
                    title: "Propose swap",
                    action: {
                        if let candidate = picked {
                            onSubmit(buildSwapProposal(kind: kind, initiatorShift: shift, candidate: candidate))
                            dismiss()
                        }
                    },
                    fullWidth: true
                )
                .disabled(picked == nil)
                .accessibilityIdentifier("swap_submit_button")
            }
            .accessibilityIdentifier("swap_sheet")
        }
    }

    private func kindButton(_ title: String, _ index: Int, _ c: ShiftColors) -> some View {
        Button(action: { kindIndex = index; picked = nil }) {
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
        return Button(action: { picked = candidate }) {
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
}

/// The "This week — 14h of 20h soft cap" summary chip (design My-Shifts header).
private struct WeekTotalChip: View {
    let currentWeeklyHours: Double
    var breakProfile: Bool = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let summary = weeklyHoursSummary(currentWeeklyHours: currentWeeklyHours, breakProfile: breakProfile)
        HStack(spacing: 8) {
            Image(systemName: ShiftIcons.clock).font(.system(size: 17, weight: .regular)).foregroundColor(c.blue)
            Text("This week").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
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
private struct ContactSheetView: View {
    let row: HouseRosterRow
    let deskPhone: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        ShiftSheet(title: row.workerName ?? "Shift", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    HouseBadge(initial: String((row.workerName ?? "?").prefix(1)), bg: c.surfaceVar, fg: c.ink)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.timeLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
                        Text(row.workerPhone ?? "No phone on file")
                            .font(ShiftFont.sans(13.5)).foregroundColor(c.sec)
                            .accessibilityIdentifier("contact_phone")
                    }
                }
                if let phone = row.workerPhone {
                    ShiftButton(title: "Call \(row.workerName ?? "worker")", action: { dial(phone) }, fullWidth: true)
                        .accessibilityIdentifier("contact_call_button")
                }
                if let desk = deskPhone {
                    ShiftButton(title: "Call the desk · \(desk)", action: { dial(desk) }, variant: .outlined, fullWidth: true)
                        .accessibilityIdentifier("contact_call_desk")
                }
            }
            .accessibilityIdentifier("contact_sheet")
        }
    }

    private func dial(_ phone: String) {
        let digits = phone.filter { !$0.isWhitespace }
        if let url = URL(string: "tel://\(digits)") {
            UIApplication.shared.open(url)
        }
    }
}

// `sheet(item:)` needs Identifiable; the model ids are stable.
extension MyShift: Identifiable {}
extension OpenShift: Identifiable {}
extension HouseRosterRow: Identifiable {}

#Preview {
    ShiftsRootView()
}
