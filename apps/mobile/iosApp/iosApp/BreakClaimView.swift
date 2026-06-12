import SwiftUI
import Shared

/// Break claim picker (Phase 11) in SwiftUI, over the shared `BreakClaimViewModel`
/// (observed — claim/drop mutate the claimed set). Rebuilds worker-app.html
/// `BreakClaimScreen`: the break-profile eyebrow, the golden FCFS info card, the 40h
/// hard-cap meter, and the list of golden break cards (Claim / Drop). Selector
/// `accessibilityIdentifier`s match the Maestro contract.

@MainActor
final class BreakClaimObservable: ObservableObject {
    private(set) var vm: BreakClaimViewModel
    @Published var state: BreakClaimUiState
    private var task: Task<Void, Never>?
    private var activated = false

    init(vm: BreakClaimViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        observe()
    }

    deinit { task?.cancel() }

    private func observe() {
        task?.cancel()
        let vm = self.vm
        task = Task { [weak self] in
            for await s in vm.uiState { self?.state = s }
        }
    }

    /// Live host: load the active break (id + descriptive context) from the worker-readable
    /// `break_periods` (migration 20260611000002) plus the worker's current §4.4 opt-out
    /// state (own `break_optouts` row), overlay both onto the (still demo-backed) pool
    /// snapshot, and swap the VM. Falls back to the demo copy (no swap) when there is no
    /// current/upcoming break.
    func activateLive(repo: BreakRepository, shiftsRepo: WorkerShiftsRepository, userId: String) async {
        guard !activated else { return }
        activated = true
        guard let active = try? await repo.fetchActiveBreak(), let active else { return }
        // `fetchBreakOptOut` is a suspend fun returning Kotlin Boolean → SKIE boxes it as
        // `KotlinBoolean`; unwrap to a Swift Bool (default false on any read failure).
        let optedOut = (try? await repo.fetchBreakOptOut(userId: userId, breakId: active.breakId))?.boolValue ?? false
        var snapshot = DemoFactory.shared.breakClaimSnapshot()
            .doWithContext(context: active.context)
        // D6 — the pool itself is LIVE: vacant break-window runs from the worker's
        // open feed + already-claimed runs from worker_my_shifts.
        if let week = try? await shiftsRepo.fetchWorkerWeek(userId: userId) {
            snapshot = snapshot.doWithLivePoolNy(
                openShifts: week.openShifts,
                myShifts: week.myShifts,
                startDate: active.startDate,
                endDate: active.endDate
            )
        }
        snapshot = snapshot.doWithOptOut(breakId: active.breakId, optedOut: optedOut)
        vm = BreakClaimViewModel(snapshot: snapshot)
        state = vm.uiState.value
        observe()
    }
}

struct BreakClaimScreen: View {
    @ObservedObject var model: BreakClaimObservable
    /// Live host POSTs to `break-claim` / `drop-shift` (best-effort) while the picker
    /// does the optimistic local move; demo passes `nil` (local-only). The argument is
    /// the break shift's pool-row id (= its block assignment_id).
    var onClaim: ((String) -> Void)? = nil
    var onDrop: ((String) -> Void)? = nil
    /// Live host writes the §4.4 "no break hours" opt-out (own `break_optouts` row,
    /// insert/delete) DIRECTLY via Postgrest while the picker flips its optimistic
    /// opted-out state; demo passes `nil` (local-only). Argument = the NEW opted-out state.
    var onToggleOptOut: ((Bool) -> Void)? = nil
    @Environment(\.colorScheme) private var scheme
    @State private var showToast = false

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(alignment: .leading, spacing: 0) {
            Text(st.profileContext)
                .font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.breakShift.deep)
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 6)

            if showToast {
                ShiftToast(message: "Break shift claimed", tone: .success, systemIcon: ShiftIcons.coffee)
                    .padding(.horizontal, 16).padding(.bottom, 4)
                    .accessibilityIdentifier("break_claim_success")
            }

            infoCard(st.infoTitle, st.infoBody, c)
            hoursMeter(st.list.meter, c)
            optOutToggle(st.optedOut, c)

            if st.optedOut {
                EmptyState(
                    title: "No break hours",
                    systemIcon: ShiftIcons.ban,
                    bodyText: "You won't be scheduled this break. Untick \"no break hours\" to claim shifts."
                )
            } else if st.list.isEmpty {
                EmptyState(
                    title: "No break shifts open",
                    systemIcon: ShiftIcons.coffee,
                    bodyText: "Everything's claimed for now. Check back — shifts return to the pool when others drop them."
                )
            } else {
                let house = st.list.rows.first?.houseName
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: house != nil ? "Claimable · \(house!)" : "Claimable break shifts", count: Int32(st.list.rows.count))
                    ForEach(st.list.rows, id: \.id) { row in
                        breakCard(row)
                    }
                }
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.bg)
        .accessibilityIdentifier("break_claim_screen")
    }

    private func infoCard(_ title: String, _ body: String, _ c: ShiftColors) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: ShiftIcons.coffee).font(.system(size: 20)).foregroundColor(c.breakShift.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.breakShift.deep)
                Text(body).font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 13)
        .background(c.surface)
        .overlay(alignment: .leading) { Rectangle().fill(c.breakShift.accent).frame(width: 4) }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 2)
    }

    private func hoursMeter(_ meter: BreakHoursMeter, _ c: ShiftColors) -> some View {
        let barColor = meter.atCap ? c.danger.accent : c.breakShift.accent
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("This week").font(ShiftFont.sans(13, .semibold)).foregroundColor(c.sec)
                Spacer()
                HStack(spacing: 0) {
                    Text(meter.currentLabel).font(ShiftFont.mono(13, .semibold)).monospacedDigit()
                        .foregroundColor(meter.atCap ? c.danger.accent : c.ink)
                    Text(" / \(meter.capLabel)").font(ShiftFont.mono(13)).monospacedDigit().foregroundColor(c.ter)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(c.surfaceVar)
                    Capsule().fill(barColor).frame(width: geo.size.width * CGFloat(meter.fraction))
                }
            }
            .frame(height: 6)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .accessibilityIdentifier("break_hours_meter")
    }

    /// The §4.4 "no break hours" opt-out tick — the break analogue of the preferences
    /// no-hours control (same checkbox affordance, golden break accent). Flips the VM's
    /// optimistic opted-out state, then the live host persists the own `break_optouts` row.
    private func optOutToggle(_ optedOut: Bool, _ c: ShiftColors) -> some View {
        Button(action: {
            let now = model.vm.toggleOptedOut()
            onToggleOptOut?(now)
        }) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(optedOut ? c.breakShift.accent : Color.clear)
                        .frame(width: 22, height: 22)
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(optedOut ? c.breakShift.accent : c.outline, lineWidth: 1.5)
                        .frame(width: 22, height: 22)
                    if optedOut {
                        Image(systemName: ShiftIcons.check).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                    }
                }
                Text("I have no hours this break").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16).padding(.vertical, 6)
        .accessibilityIdentifier("break_no_hours_toggle")
    }

    private func breakCard(_ row: BreakShiftRow) -> some View {
        ShiftCard(
            state: .breakShift,
            houseInitial: row.houseInitial,
            timeLabel: row.timeLabel,
            houseName: row.houseName,
            durationLabel: row.durationLabel,
            meta: row.meta,
            trailing: AnyView(actionButton(row))
        )
        .accessibilityIdentifier("break_shift_card")
    }

    private func actionButton(_ row: BreakShiftRow) -> some View {
        Group {
            if row.claimedByMe {
                ShiftButton(title: row.actionLabel, action: {
                    model.vm.drop(id: row.id)
                    onDrop?(row.id)
                }, variant: .destructive, size: .sm)
                    .accessibilityIdentifier("break_drop_button")
            } else {
                // At the 40h HARD cap → Claim disabled with the at-cap label (server is
                // still authoritative — `break-claim` returns `hard_cap_exceeded`).
                ShiftButton(title: row.actionLabel, action: { claim(row.id) }, variant: .filled, size: .sm)
                    .disabled(row.claimBlocked)
                    .opacity(row.claimBlocked ? 0.4 : 1)
                    .accessibilityIdentifier("break_claim_button")
            }
        }
    }

    private func claim(_ id: String) {
        model.vm.claim(id: id)
        onClaim?(id)
        showToast = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { showToast = false }
    }
}
