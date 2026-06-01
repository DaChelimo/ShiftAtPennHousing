import SwiftUI
import Shared

/// Phase 13a — the float ack/decline modal in SwiftUI (BEHAVIORAL_SPECIFICATION.md
/// §7.1/§7.2, deliverable #4). Mirrors the Compose `FloatAcknowledgmentModal`:
/// float details, the T-10m deadline, and Acknowledge / Decline buttons that
/// disable once the deadline passes. The action instant is the wall clock at tap
/// time; the shared ViewModel re-checks it against the deadline.

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

    init(vm: AckDeclineViewModel) {
        _model = StateObject(wrappedValue: AckObservable(vm: vm))
    }

    var body: some View {
        let state = model.state
        VStack(alignment: .leading, spacing: 12) {
            Text("Float assignment").font(.title2).fontWeight(.bold)
            Text("Destination: \(state.destinationHouse.name)")
            Text("Float starts: \(String(describing: state.floatStart))")
            Text("Acknowledge by: \(String(describing: state.deadline))")

            if state.phase.isAcknowledged {
                Text("Acknowledged ✓").accessibilityIdentifier("ack_success")
            } else if state.phase.isDeclined {
                Text("Declined — the float was voided.")
            } else if state.phase.isDeadlinePassed {
                Text("Deadline passed").accessibilityIdentifier("ack_deadline_passed")
            } else {
                HStack(spacing: 12) {
                    Button("Acknowledge") {
                        _ = model.vm.acknowledge(now: DemoFactory.shared.now())
                    }
                    .disabled(!state.canRespond)
                    .accessibilityIdentifier("ack_button")

                    Button("Decline") {
                        _ = model.vm.decline(now: DemoFactory.shared.now())
                    }
                    .disabled(!state.canRespond)
                    .accessibilityIdentifier("decline_button")
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("ack_modal")
    }
}
