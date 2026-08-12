import SwiftUI
import Shared

/// The Coverage tab (BSpec §5.4a; docs/manager-app/SPEC.md §6.1) — the manager surface this
/// app exists for. When the escalation chain runs out of internal options, a desk goes empty
/// unless a human procures Allied, and this is where that human acts.
///
/// This file renders only. Every decision (which requests appear, in what order, what state
/// each is in, whether a note is required, whether the banner shows) is made by the pure
/// `manager/coverage/Coverage.kt` and `viewmodel/CoverageViewModel.kt` in `:shared`, already
/// tested there and already driving the Android build. This is a straight port: the same
/// ViewModel, the same rules, a SwiftUI rendering of the same screen (`CoverageScreen.kt`).

// MARK: - StateFlow bridge

/// Bridges `CoverageViewModel.uiState` into SwiftUI, in the exact shape as `SwapsObservable`
/// (`ContentView.swift`, near line 344): seed synchronously from `vm.uiState.value`, then a
/// cancellable `Task` doing `for await`.
@MainActor
final class CoverageObservable: ObservableObject {
    private(set) var vm: CoverageViewModel
    @Published var state: CoverageUiState
    private var stateTask: Task<Void, Never>?
    private var streamTask: Task<Void, Never>?

    init(vm: CoverageViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        subscribe()
    }

    private func subscribe() {
        stateTask?.cancel()
        state = vm.uiState.value
        stateTask = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    /// Wire the live Allied coverage stream. Idempotent — safe to call again if the manager's
    /// capabilities are re-derived after a slow role read; only the FIRST call actually starts
    /// anything, matching Android's `remember(capabilities.hasCoverage, ladderCadence)` (a
    /// fresh `CoverageViewModel` per cadence, but the cadence itself is fetched once).
    func activateLive(repo: CoverageRepository, now: KotlinInstant) {
        guard streamTask == nil else { return }
        streamTask = Task { [weak self] in
            guard let self else { return }
            let cadence = try? await repo.fetchLadderCadence()
            let timeoutMinutes = cadence?.rungTimeoutMinutes ?? Int32(60)
            self.vm = CoverageViewModel(requests: [], now: now, rungTimeoutMinutes: timeoutMinutes)
            self.subscribe()
            do {
                for try await requests in repo.coverageStream() {
                    self.vm.refresh(next: requests)
                }
            } catch {
                // The stream ended (backgrounded, transport error). Nothing to do — the next
                // launch's `activateLive` starts a fresh one. Never silently retry-loop here.
            }
        }
    }

    /// "I am handling this" — fired the moment the Respond sheet OPENS, not on a button.
    /// Stops the ladder and the reminders. NEVER queued offline: a failed write must revert
    /// so the banner returns and the alert keeps going.
    func respond(requestId: String, repo: CoverageRepository) {
        guard let toAck = vm.openRespond(requestId: requestId) else { return }
        Task { [weak self] in
            let result = try? await repo.acknowledge(requestId: toAck)
            if result == nil || result == .failed {
                self?.vm.revertAcknowledge(requestId: toAck)
            }
        }
    }

    /// Record the outcome and close. Reverts the optimistic close on a failed write.
    func submitClose(repo: CoverageRepository) {
        guard let intent = vm.submitClose() else { return }
        Task { [weak self] in
            let result = try? await repo.close(
                requestId: intent.requestId, outcome: intent.outcome, note: intent.note, assignSelf: intent.assignSelf
            )
            if result == nil || result == .failed {
                self?.vm.revertClose(intent: intent)
            }
        }
    }

    deinit {
        stateTask?.cancel()
        streamTask?.cancel()
    }
}

// MARK: - Banner

/// The app-wide banner, shown on EVERY screen while a covered house has an unacknowledged
/// request (SPEC §6.1). Not dismissable, by design: an open request never clears itself. It
/// downgrades to the tab badge alone once acknowledged — `CoverageFeed.showsBanner` counts
/// only action-required requests, so a manager already on the phone to Allied is not nagged.
///
/// Mirrors the existing `BreakOpenBanner` pattern (`ContentView.swift`'s `content`, near line
/// 998): `if coverageModel.state.showsBanner && tab != .coverage { CoverageBannerView(...) }`.
struct CoverageBannerView: View {
    let count: Int32
    let onOpen: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 10) {
                Image(systemName: ShiftIcons.warning).font(.system(size: 17)).foregroundColor(c.danger.accent)
                Text(count == 1 ? "A desk needs Allied coverage" : "\(count) desks need Allied coverage")
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.danger.deep)
                Spacer(minLength: 0)
                Text("Respond").font(ShiftFont.sans(13.5, .bold)).foregroundColor(c.danger.accent)
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(c.danger.tint)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("coverage_banner")
    }
}

// MARK: - Screen

struct CoverageView: View {
    @ObservedObject var model: CoverageObservable
    let onCallAllied: (String?) -> Void
    let repo: CoverageRepository
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(spacing: 0) {
            PageTitle(title: "Coverage")

            if model.state.feed.isEmpty {
                EmptyState(
                    title: "All clear. No coverage needed.",
                    systemIcon: ShiftIcons.checkCircle,
                    bodyText: "You will be alerted here, and on your phone, the moment a desk needs Allied."
                )
                .accessibilityIdentifier("coverage_empty")
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(model.state.feed.cards, id: \.requestId) { card in
                            CoverageRequestCard(card: card) {
                                model.respond(requestId: card.requestId, repo: repo)
                            }
                        }
                    }
                    .padding(16)
                }
                .accessibilityIdentifier("coverage_list")
            }

            if let message = model.state.alreadyHandledMessage {
                Button(action: { model.vm.clearAlreadyHandled() }) {
                    HStack(spacing: 8) {
                        Image(systemName: ShiftIcons.info).font(.system(size: 15)).foregroundColor(c.sec)
                        Text(message).font(ShiftFont.sans(13.5)).foregroundColor(c.sec)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(c.surfaceVar)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .accessibilityIdentifier("coverage_already_handled")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .sheet(isPresented: Binding(get: { model.state.sheet != nil }, set: { if !$0 { model.vm.dismissSheet() } })) {
            if let sheet = model.state.sheet {
                RespondSheetView(
                    sheet: sheet,
                    onSelectOutcome: { model.vm.selectOutcome(outcome: $0) },
                    onCoverPersonally: { model.vm.coverPersonally() },
                    onNoteChange: { model.vm.updateNote(note: $0) },
                    onSubmit: { model.submitClose(repo: repo) },
                    onDismiss: { model.vm.dismissSheet() },
                    onCallAllied: { onCallAllied(sheet.card.deskPhone) }
                )
            }
        }
        .accessibilityIdentifier("coverage_screen")
    }
}

private struct CoverageRequestCard: View {
    let card: CoverageCard
    let onTap: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    private var overdue: Bool { card.state == .overdue }
    private var acknowledged: Bool { card.state == .acknowledged }
    private var accent: Color { overdue ? c.danger.accent : (acknowledged ? c.success.accent : c.allied.accent) }
    private var fill: Color { overdue ? c.danger.tint : (acknowledged ? c.surface : c.warnSoft) }
    private var statusLabel: String {
        switch card.state {
        case .overdue: return "Overdue"
        case .acknowledged: return "You have this"
        case .awaitingAck: return "Needs Allied"
        default: return card.outcomeLabel ?? "Closed"
        }
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 8) {
                    Text(card.houseName).font(ShiftFont.sans(16.5, .bold)).foregroundColor(c.ink)
                    Spacer(minLength: 0)
                    Text(statusLabel).font(ShiftFont.sans(11.5, .bold)).foregroundColor(accent)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(accent.opacity(0.16)).clipShape(Capsule())
                    if card.isMissedCoverageIncident {
                        Image(systemName: ShiftIcons.warning).font(.system(size: 13)).foregroundColor(c.danger.accent)
                    }
                }
                Text("\(card.windowLabel)  ·  \(card.hoursLabel)").font(ShiftFont.sans(14, .medium)).foregroundColor(c.ink)
                Text(card.reasonLabel).font(ShiftFont.sans(13)).foregroundColor(c.sec)
                HStack(spacing: 6) {
                    Image(systemName: ShiftIcons.person).font(.system(size: 13)).foregroundColor(c.ter)
                    Text(card.rungLabel).font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                    if let countdown = card.countdownLabel {
                        Text("·").font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                        Text(countdown).font(ShiftFont.sans(12.5, .semibold))
                            .foregroundColor(card.isTerminalRung ? c.ter : accent)
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill)
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(accent.opacity(0.45), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("coverage_card")
    }
}

/// The Respond sheet — ONE job, presented as one job.
///
/// Opening this sheet already acknowledged the request (see `CoverageObservable.respond`).
/// The manager never sees the words "acknowledge" or "close out": call Allied, then say how
/// it went. "Not yet" leaves without an outcome; the request stays acknowledged and open.
private struct RespondSheetView: View {
    let sheet: RespondSheetState
    let onSelectOutcome: (CoverageOutcome) -> Void
    let onCoverPersonally: () -> Void
    let onNoteChange: (String) -> Void
    let onSubmit: () -> Void
    let onDismiss: () -> Void
    let onCallAllied: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    /// The four outcomes, in the order a manager is likely to need them. `.coveredInternally`
    /// here is "covered another way" — recorded, but with no self-assignment, unlike the
    /// dedicated "I can cover it" action above (`CoverageViewModel.coverPersonally`), which
    /// sets the SAME wire outcome but also puts the acting manager on the schedule.
    private static let otherOutcomes: [CoverageOutcome] =
        [.alliedSecured, .coveredInternally, .deskUnstaffed, .noLongerNeeded]

    var body: some View {
        ShiftSheet(onClose: onDismiss) {
            VStack(alignment: .leading, spacing: 12) {
                Text(sheet.card.houseName).font(ShiftFont.sans(21, .bold)).foregroundColor(c.ink)
                Text("\(sheet.card.windowLabel)  ·  \(sheet.card.hoursLabel)")
                    .font(ShiftFont.sans(14.5, .medium)).foregroundColor(c.ink)
                Text(sheet.card.reasonLabel).font(ShiftFont.sans(13)).foregroundColor(c.sec)

                // 1. Get coverage. Roughly 80% of the time an RSM covers it themselves and
                // 20% it goes to Allied, so the two actions sit at EQUAL weight — neither is
                // the fallback for the other. Both record their outcome immediately: there
                // is nothing left to confirm once the manager has committed to one.
                SectionHeader(title: "Get coverage")
                HStack(spacing: 10) {
                    ShiftButton(
                        title: "I can cover it",
                        action: { onCoverPersonally(); onSubmit() },
                        variant: .success, size: .lg, systemIcon: ShiftIcons.person, fullWidth: true
                    )
                    .accessibilityIdentifier("coverage_cover_it")

                    ShiftButton(
                        title: sheet.card.deskPhone.map { "Call Allied (\($0))" } ?? "Call Allied",
                        action: onCallAllied, size: .lg, systemIcon: ShiftIcons.phone, fullWidth: true
                    )
                    .accessibilityIdentifier("coverage_call_allied")
                }

                // 2. What happened. One flat, organized list of the remaining outcomes — no
                // separate confirm button plus a buried "something else" list to parse.
                SectionHeader(title: "What happened")
                    .accessibilityIdentifier("coverage_other_outcomes")

                ForEach(Self.otherOutcomes, id: \.wire) { outcome in
                    OutcomeRow(outcome: outcome, selected: sheet.selectedOutcome == outcome, onTap: { onSelectOutcome(outcome) })
                }

                if sheet.noteRequired {
                    TextField("What happened?", text: Binding(get: { sheet.note }, set: onNoteChange), axis: .vertical)
                        .lineLimit(2...4)
                        .padding(10)
                        .background(c.surfaceVar)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityIdentifier("coverage_note")
                }

                if sheet.selectedOutcome != nil {
                    ShiftButton(title: "Record and close", action: onSubmit, fullWidth: true, loading: sheet.submitting)
                        .disabled(!sheet.canSubmit)
                        .accessibilityIdentifier("coverage_submit")
                }

                ShiftButton(title: "Not yet", action: onDismiss, variant: .text, fullWidth: true)
                    .accessibilityIdentifier("coverage_not_yet")
            }
        }
    }
}

private struct OutcomeRow: View {
    let outcome: CoverageOutcome
    let selected: Bool
    let onTap: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        Button(action: onTap) {
            HStack {
                Text(CoverageKt.outcomeLabel(outcome: outcome))
                    .font(ShiftFont.sans(14, selected ? .semibold : .regular)).foregroundColor(c.ink)
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: ShiftIcons.check).font(.system(size: 17)).foregroundColor(c.success.accent)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(selected ? c.surfaceVar : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(selected ? c.outline : c.divider, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("coverage_outcome_\(outcome.wire)")
    }
}
