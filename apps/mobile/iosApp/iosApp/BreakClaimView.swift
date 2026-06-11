import SwiftUI
import Shared

/// Break claim picker (Phase 11) in SwiftUI, over the shared `BreakClaimViewModel`
/// (observed — claim/drop mutate the claimed set). Rebuilds worker-app.html
/// `BreakClaimScreen`: the break-profile eyebrow, the golden FCFS info card, the 40h
/// hard-cap meter, and the list of golden break cards (Claim / Drop). Selector
/// `accessibilityIdentifier`s match the Maestro contract.

@MainActor
final class BreakClaimObservable: ObservableObject {
    let vm: BreakClaimViewModel
    @Published var state: BreakClaimUiState
    private var task: Task<Void, Never>?

    init(vm: BreakClaimViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    deinit { task?.cancel() }
}

struct BreakClaimScreen: View {
    @ObservedObject var model: BreakClaimObservable
    /// Live host POSTs to `break-claim` / `drop-shift` (best-effort) while the picker
    /// does the optimistic local move; demo passes `nil` (local-only). The argument is
    /// the break shift's pool-row id (= its block assignment_id).
    var onClaim: ((String) -> Void)? = nil
    var onDrop: ((String) -> Void)? = nil
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

            if st.list.isEmpty {
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
                ShiftButton(title: row.actionLabel, action: { claim(row.id) }, variant: .filled, size: .sm)
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
