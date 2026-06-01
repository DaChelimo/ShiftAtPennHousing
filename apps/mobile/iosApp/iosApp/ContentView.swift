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

    private var myShifts: some View {
        VStack(alignment: .leading, spacing: 12) {
            section("Picked-up", "section_picked_up", model.state.myShifts.pickedUp) { shift in
                shiftCard(shift, "picked_up_shift_card")
            }
            section("Dropped", "section_dropped", model.state.myShifts.dropped) { shift in
                HStack {
                    shiftCard(shift, "dropped_shift_card")
                    Button("Reclaim") { model.vm.reclaim(shiftId: shift.id) }
                }
            }
            section("Their shifts", "section_scheduled", model.state.myShifts.scheduled) { shift in
                shiftCard(shift, "scheduled_shift_card")
                    .onTapGesture { dropTarget = shift }
            }
        }
        .padding()
    }

    private func section<Row: View>(
        _ title: String,
        _ id: String,
        _ shifts: [MyShift],
        @ViewBuilder row: @escaping (MyShift) -> Row
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            if shifts.isEmpty {
                Text("None this week").font(.caption).foregroundColor(.secondary)
            } else {
                ForEach(shifts, id: \.id) { row($0) }
            }
            Divider()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier(id)
    }

    private func shiftCard(_ shift: MyShift, _ id: String) -> some View {
        VStack(alignment: .leading) {
            Text(shift.house.name + (shift.crossHouse ? "  (cross-house)" : "") + (shift.pending ? "  (Pending)" : ""))
                .fontWeight(.semibold)
            Text("\(String(describing: shift.start)) – \(String(describing: shift.end))").font(.caption)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
        .accessibilityIdentifier(id)
    }

    // MARK: Tab 2 — Open in My House

    private var homeOpen: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("This week").font(.headline)
                ForEach(model.state.homeOpen.weekly, id: \.id) { openCard($0, claimable: true) }
            }
            .accessibilityIdentifier("home_weekly_feed")

            VStack(alignment: .leading, spacing: 6) {
                Text("Permanent openings").font(.headline)
                ForEach(model.state.homeOpen.permanentOpenings, id: \.id) { openCard($0, claimable: true) }
            }
            .accessibilityIdentifier("home_permanent_feed")
        }
        .padding()
    }

    private func openCard(_ shift: OpenShift, claimable: Bool) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(shift.house.name).fontWeight(.semibold)
                Text("\(String(describing: shift.start)) – \(String(describing: shift.end))").font(.caption)
                if let weeks = shift.weeksRemaining {
                    Text("\(weeks) weeks remaining").font(.caption)
                }
            }
            Spacer()
            if model.vm.claimable(shift: shift) {
                Button("Claim") { claimTarget = shift }
                    .accessibilityIdentifier("claim_button")
            } else {
                Text("Unpickable").font(.caption)
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
                        ForEach(group.weekly, id: \.id) { openCard($0, claimable: false) }
                        ForEach(group.permanentOpenings, id: \.id) { openCard($0, claimable: false) }
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
    @State private var occurrenceChosen = false
    @State private var shortNoticeAccepted = false

    var body: some View {
        let options = vm.dropOptions(shift: shift, breakProfile: false)
        let plan = vm.planDrop(shift: shift, dropFromNow: false)
        VStack(spacing: 16) {
            if !occurrenceChosen {
                VStack(spacing: 8) {
                    Text("Drop this shift").font(.title2)
                    Button("Drop this occurrence") { occurrenceChosen = true }
                        .accessibilityIdentifier("drop_occurrence_option")
                    Button("Drop permanently") { /* §8.4 flow, out of scope here */ }
                        .disabled(!options.canDropPermanently)
                        .accessibilityIdentifier("drop_permanent_option")
                }
                .accessibilityIdentifier("drop_options_sheet")
            } else if plan.shortNotice && !shortNoticeAccepted {
                VStack(spacing: 8) {
                    Text("This shift starts within 20 minutes. Dropping it is short notice (§5.2).")
                    Button("Continue anyway") { shortNoticeAccepted = true }
                        .accessibilityIdentifier("drop_short_notice_continue")
                }
                .accessibilityIdentifier("drop_short_notice_warning")
            } else {
                Button("Confirm drop") {
                    vm.drop(shiftId: shift.id)
                    dismiss()
                }
                .accessibilityIdentifier("drop_confirm_button")
            }
        }
        .padding()
    }
}

// `sheet(item:)` needs Identifiable; the model ids are stable.
extension MyShift: Identifiable {}
extension OpenShift: Identifiable {}

#Preview {
    ShiftsRootView()
}
