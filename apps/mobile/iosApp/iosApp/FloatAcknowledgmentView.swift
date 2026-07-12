import SwiftUI
import Shared

/// Phase 13a — the Float Acknowledgment hero in SwiftUI (BEHAVIORAL_SPECIFICATION.md
/// §7.1/§7.2, deliverable #4). Mirrors the Compose `FloatAcknowledgmentModal`: the
/// design's "launched from Updates" sheet (worker-app.html `FloatAckSheet`/`FloatBody`)
/// — a centred float-out hero, the Desk/When/Starts-in card, the "your weekly hours
/// don't change" reassurance (invariant #4), and a phase-driven countdown / status +
/// actions. Copy + formatting come from the shared, tested `floatAckHero`; the action
/// instant is the wall clock at tap time, re-checked against the T-10m deadline.

@MainActor
final class AckObservable: ObservableObject {
    let vm: AckDeclineViewModel
    @Published var state: AckDeclineUiState
    private var task: Task<Void, Never>?

    init(vm: AckDeclineViewModel) {
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

struct FloatAcknowledgmentView: View {
    @StateObject private var model: AckObservable
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    /// The screen's load instant — drives the static "starts in" + countdown.
    private let now: KotlinInstant
    /// Live host POSTs to `acknowledge-float` / `decline-float` (best-effort) when the
    /// optimistic local transition succeeds; demo passes nil → no live write. The
    /// argument is the float id the modal is showing.
    private let onAcknowledge: ((String) -> Void)?
    private let onDecline: ((String) -> Void)?

    init(
        vm: AckDeclineViewModel,
        onAcknowledge: ((String) -> Void)? = nil,
        onDecline: ((String) -> Void)? = nil
    ) {
        _model = StateObject(wrappedValue: AckObservable(vm: vm))
        now = DemoFactory.shared.now()
        self.onAcknowledge = onAcknowledge
        self.onDecline = onDecline
    }

    var body: some View {
        let state = model.state
        let c = ShiftColors.resolve(scheme)
        let hero = floatAckHero(
            phase: state.phase,
            destinationName: state.destinationHouse.name,
            floatStart: state.floatStart,
            deadline: state.deadline,
            now: now,
            zone: ShiftsKt.NEW_YORK
        )
        ShiftSheet(onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 14) {
                heroHeader(state.phase, hero, c)
                detailCard(state, hero, c)
                hoursBanner(c)
                statusOrCountdown(state.phase, hero, c)
                actionButtons(state)
            }
            .accessibilityIdentifier("ack_modal")
        }
    }

    // MARK: hero header

    private func heroHeader(_ phase: AckPhase, _ hero: FloatAckHero, _ c: ShiftColors) -> some View {
        let acked = phase.isAcknowledged
        let circleBg: Color = acked ? c.success.tint : (phase.isPending ? c.floatOut.tint : c.surfaceVar)
        let icon: String = acked
            ? ShiftIcons.check
            : (phase.isDeclined ? ShiftIcons.close : (phase.isDeadlinePassed ? ShiftIcons.clock : ShiftIcons.floatOut))
        let iconColor: Color = acked
            ? c.success.accent
            : (phase.isDeclined ? c.sec : (phase.isDeadlinePassed ? c.ter : c.floatOut.accent))
        let eyebrowColor: Color = acked ? c.success.accent : c.floatOut.accent
        return VStack(spacing: 6) {
            ZStack {
                Circle().fill(circleBg).frame(width: 60, height: 60)
                Image(systemName: icon).font(.system(size: 26, weight: .semibold)).foregroundColor(iconColor)
            }
            Text(hero.eyebrow.uppercased())
                .font(ShiftFont.sans(13, .bold)).tracking(0.8).foregroundColor(eyebrowColor)
            Text(hero.headline)
                .font(ShiftFont.sans(26, .bold, relativeTo: .title)).tracking(-0.5)
                .foregroundColor(c.ink).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }

    // MARK: detail card

    private func detailCard(_ state: AckDeclineUiState, _ hero: FloatAckHero, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            KeyValueRow(label: "Desk", last: false, trailing: AnyView(
                HStack(spacing: 6) {
                    Text(String(state.destinationHouse.name.prefix(1)).uppercased())
                        .font(ShiftFont.sans(12, .semibold)).foregroundColor(c.floatOut.deep)
                        .frame(width: 26, height: 26).background(c.floatOut.badge)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text(state.destinationHouse.name).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                }
            ))
            KeyValueRow(label: "When", last: false, trailing: AnyView(
                Text(hero.whenLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
            ))
            KeyValueRow(label: "Starts in", last: true, trailing: AnyView(
                Text(hero.startsInLabel).font(ShiftType.monoTime).monospacedDigit().foregroundColor(c.ink)
            ))
        }
        .padding(.horizontal, 16)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }

    // MARK: reassurance banner (invariant #4)

    private func hoursBanner(_ c: ShiftColors) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: ShiftIcons.info).font(.system(size: 18)).foregroundColor(c.floatOut.accent)
            (
                Text("Your weekly hours don't change.").font(ShiftFont.sans(13, .bold))
                    + Text(" A float moves an already-scheduled shift; it never adds hours.").font(ShiftFont.sans(13))
            )
            .foregroundColor(c.floatOut.deep).lineSpacing(3)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.floatOut.tint)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: status / countdown

    @ViewBuilder
    private func statusOrCountdown(_ phase: AckPhase, _ hero: FloatAckHero, _ c: ShiftColors) -> some View {
        if phase.isPending {
            HStack {
                Spacer()
                CountdownChip(label: hero.countdownLabel ?? "", tone: hero.countdownUrgent ? .urgent : .normal)
                Spacer()
            }
        } else if phase.isAcknowledged {
            statusLine(hero.statusLine ?? "", c.success.accent).accessibilityIdentifier("ack_success")
        } else if phase.isDeclined {
            statusLine(hero.statusLine ?? "", c.sec)
        } else {
            statusLine(hero.statusLine ?? "", c.ter).accessibilityIdentifier("ack_deadline_passed")
        }
    }

    private func statusLine(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(ShiftFont.sans(13.5, .medium)).foregroundColor(color)
            .frame(maxWidth: .infinity).multilineTextAlignment(.center)
    }

    // MARK: actions

    @ViewBuilder
    private func actionButtons(_ state: AckDeclineUiState) -> some View {
        if state.phase.isPending {
            VStack(spacing: 10) {
                ShiftButton(
                    title: "Acknowledge",
                    // Fire the live RPC only when the optimistic local transition actually
                    // succeeds (the VM returns true iff it moved PENDING → terminal before
                    // the T-10m deadline) — a no-op tap past the deadline must not POST.
                    action: {
                        if model.vm.acknowledge(now: DemoFactory.shared.now()) {
                            onAcknowledge?(state.floatId)
                        }
                    },
                    variant: .filled, size: .lg, systemIcon: ShiftIcons.check, fullWidth: true
                )
                .disabled(!state.canRespond)
                .accessibilityIdentifier("ack_button")

                ShiftButton(
                    title: "Decline",
                    action: {
                        if model.vm.decline(now: DemoFactory.shared.now()) {
                            onDecline?(state.floatId)
                        }
                    },
                    variant: .outlined, size: .lg, fullWidth: true
                )
                .disabled(!state.canRespond)
                .accessibilityIdentifier("decline_button")
            }
        } else {
            ShiftButton(title: "Close", action: { dismiss() }, variant: .tonal, size: .lg, fullWidth: true)
        }
    }
}
