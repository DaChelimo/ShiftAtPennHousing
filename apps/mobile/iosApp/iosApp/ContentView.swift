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

private enum Tab: Int { case mine, home, other, updates }

struct ShiftsRootView: View {
    @StateObject private var model = ShiftsObservable(vm: DemoFactory.shared.shiftsViewModel())
    private let ackVm = DemoFactory.shared.ackViewModel()

    @State private var tab: Tab = .mine
    @State private var dropTarget: MyShift?
    @State private var claimTarget: OpenShift?
    @State private var showAck = false
    @State private var claimSucceeded = false

    var body: some View {
        VStack(spacing: 0) {
            if claimSucceeded {
                Text("Shift claimed ✓")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(8)
                    .accessibilityIdentifier("claim_success")
            }

            tabBar

            Divider()

            ScrollView {
                switch tab {
                case .mine: myShifts
                case .home: homeOpen
                case .other: otherHouses
                case .updates: updates
                }
            }
        }
        .accessibilityIdentifier("shifts_screen")
        .sheet(item: $dropTarget) { shift in DropFlowSheet(vm: model.vm, shift: shift) }
        .sheet(item: $claimTarget) { shift in
            ClaimFlowSheet(vm: model.vm, shift: shift) {
                model.vm.claim(shift: shift)
                claimSucceeded = true
            }
        }
        .sheet(isPresented: $showAck) { FloatAcknowledgmentView(vm: ackVm) }
    }

    // MARK: tabs

    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton("My Shifts", "tab_my_shifts", .mine)
            tabButton("Open Shifts in My House", "tab_open_home", .home)
            tabButton("Open Shifts in Other Houses", "tab_open_other", .other)
            tabButton("Updates", "tab_updates", .updates)
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
            case .updates: break
            }
        }) {
            Text(title)
                .font(.caption)
                .fontWeight(tab == which ? .bold : .regular)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
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
                        myShiftCard(s, "dropped_shift_card", reclaim: { model.vm.reclaim(shiftId: s.id) })
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
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("This week").font(.headline)
                ForEach(model.state.homeOpen.weekly, id: \.id) { openCard($0, allowsClaim: true) }
            }
            .accessibilityIdentifier("home_weekly_feed")

            VStack(alignment: .leading, spacing: 6) {
                Text("Permanent openings").font(.headline)
                ForEach(model.state.homeOpen.permanentOpenings, id: \.id) { openCard($0, allowsClaim: true) }
            }
            .accessibilityIdentifier("home_permanent_feed")
        }
        .padding()
    }

    private func openCard(_ shift: OpenShift, allowsClaim: Bool) -> some View {
        let claimable = model.vm.claimable(shift: shift)
        return HStack {
            VStack(alignment: .leading) {
                Text(shift.house.name).fontWeight(.semibold)
                Text("\(String(describing: shift.start)) – \(String(describing: shift.end))").font(.caption)
                if let weeks = shift.weeksRemaining {
                    Text("\(weeks) weeks remaining").font(.caption)
                }
                // §5.4: the shift stays VISIBLE past T-2h; only the claim action is gated.
                if allowsClaim && !claimable {
                    Text("Unpickable (past T-2h)").font(.caption)
                }
            }
            Spacer()
            // Tab 2 (home) shows the Claim affordance, DISABLED past T-2h — never
            // hidden (§5.4 / §5.6). Tab 3 (cross-house) is browse-only this phase,
            // matching the Compose `CrossHouseCard`, so it shows no claim button.
            if allowsClaim {
                Button("Claim") { claimTarget = shift }
                    .disabled(!claimable)
                    .accessibilityIdentifier("claim_button")
            }
        }
        .padding(10)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
        .accessibilityIdentifier("open_shift_card")
    }

    // MARK: Tab 3 — Open in Other Houses

    private var otherHouses: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.state.otherHouses.isEmpty {
                Text("No cross-house shifts available (e.g. during winter break).")
            } else {
                ForEach(model.state.otherHouses.groups, id: \.house.id) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.house.name).font(.headline)
                        ForEach(group.weekly, id: \.id) { openCard($0, allowsClaim: false) }
                        ForEach(group.permanentOpenings, id: \.id) { openCard($0, allowsClaim: false) }
                        Divider()
                    }
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("other_houses_tab")
    }

    // MARK: Updates — pending floats

    private var updates: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: { showAck = true }) {
                VStack(alignment: .leading) {
                    Text("Float assigned — action needed").fontWeight(.semibold)
                    Text("You have been floated to \(ackVm.uiState.value.destinationHouse.name). Tap to acknowledge or decline.")
                        .font(.caption)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pending_float_notification")
        }
        .padding()
    }
}

// MARK: - Claim flow (§5.3)

private struct ClaimFlowSheet: View {
    let vm: ShiftsScreenViewModel
    let shift: OpenShift
    let onConfirmed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var warningAccepted = false

    var body: some View {
        let verdict = vm.claimCap(shift: shift, currentWeeklyHours: DemoFactory.shared.demoWeeklyHours, breakProfile: false)
        VStack(spacing: 16) {
            Text("Claim \(shift.house.name) shift").font(.title2)
            Text("\(String(describing: shift.start)) – \(String(describing: shift.end))")

            if verdict.isBlocked {
                Text("This claim is over the 40-hour break cap and is blocked (§5.3).")
                Button("Close") { dismiss() }
            } else if verdict.needsWarning && !warningAccepted {
                VStack(spacing: 8) {
                    Text("This claim puts you over the 20-hour cap. It is allowed (§5.3).")
                    Button("Claim anyway") { warningAccepted = true }
                        .accessibilityIdentifier("soft_cap_confirm_button")
                }
                .accessibilityIdentifier("soft_cap_warning_modal")
            } else {
                Button("Confirm claim") {
                    onConfirmed()
                    dismiss()
                }
                .accessibilityIdentifier("claim_confirm_button")
            }
        }
        .padding()
    }
}

// MARK: - Drop flow (§5.2)

private struct DropFlowSheet: View {
    let vm: ShiftsScreenViewModel
    let shift: MyShift
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var permanentScope = false
    @State private var acknowledged = false

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let row = shift.toRow()
        let options = vm.dropOptions(shift: shift, breakProfile: false)
        let plan = vm.planDrop(shift: shift, dropFromNow: false)
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

                if plan.shortNotice && !acknowledged {
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
                    title: permanentScope ? "Drop permanently" : "Drop this week",
                    action: { vm.drop(shiftId: shift.id); dismiss() },
                    variant: .destructiveFilled, fullWidth: true
                )
                .disabled(plan.shortNotice && !acknowledged)
                .accessibilityIdentifier("drop_confirm_button")
            }
            .accessibilityIdentifier("drop_options_sheet")
        }
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

// `sheet(item:)` needs Identifiable; the model ids are stable.
extension MyShift: Identifiable {}
extension OpenShift: Identifiable {}

#Preview {
    ShiftsRootView()
}
