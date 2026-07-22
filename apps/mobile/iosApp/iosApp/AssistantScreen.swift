import SwiftUI
import Shared

/// Observes the shared `AssistantViewModel`'s `StateFlow` (mirrors `HouseObservable`) and
/// owns the (untested, data/UI-layer) `da-ask` network call via `WorkerBackend.shared
/// .assistantRepository`, mirroring how the other Observables keep writes outside the pure
/// ViewModel.
@MainActor
final class AssistantObservable: ObservableObject {
    private let vm: AssistantViewModel
    @Published private(set) var state: AssistantUiState
    private var task: Task<Void, Never>?

    init(vm: AssistantViewModel = AssistantViewModel()) {
        self.vm = vm
        self.state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    /// Enters the loading state immediately (optimistic, mirrors the Android host), then
    /// streams `da-ask`'s SSE response and feeds each event to the ViewModel as it
    /// arrives. Ignores blank input and re-entrancy while a request is in flight (the
    /// ViewModel itself guards this too).
    func ask(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !state.loading else { return }
        vm.onUserSubmitted(text: trimmed)
        vm.onStreamStart()
        Task {
            do {
                for try await event in WorkerBackend.shared.assistantRepository.askStream(question: trimmed) {
                    switch event {
                    case let meta as AssistantStreamEvent.Meta:
                        self.vm.onStreamMeta(
                            citations: meta.citations, deferred: meta.deferred, route: meta.route,
                            lifeSafety: meta.lifeSafety)
                    case let delta as AssistantStreamEvent.Delta:
                        self.vm.onStreamDelta(text: delta.text)
                    case let retract as AssistantStreamEvent.Retract:
                        self.vm.onStreamRetract(content: retract.content)
                    case is AssistantStreamEvent.Done:
                        self.vm.onStreamDone()
                    case let failed as AssistantStreamEvent.Failed:
                        self.vm.onError(message: failed.message)
                    default:
                        break
                    }
                }
            } catch {
                self.vm.onError(message: "Couldn't reach the assistant. Try again.")
            }
        }
    }

    deinit { task?.cancel() }
}

/// Desk Assistant chat (V1_SCOPE §4). An empty thread shows a short intro + starter-prompt
/// chips (`AssistantPrompts.shared.starters`, shared with Android); a live thread renders
/// left/right bubbles with citation chips, a life-safety banner, and an escalation tag when
/// the answer routed to a duty contact.
struct AssistantTabView: View {
    @ObservedObject var model: AssistantObservable
    @State private var input: String = ""
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(spacing: 0) {
            PageTitle(title: "Assistant")
            if model.state.messages.isEmpty {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(model.state.messages, id: \.id) { message in
                                let isStreamingPlaceholder =
                                    model.state.loading && message.content.isEmpty
                                        && message.id == model.state.messages.last?.id
                                AssistantBubbleView(message: message, showShimmer: isStreamingPlaceholder)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal, Spacing.screen)
                        .padding(.vertical, Spacing.l)
                    }
                    .onChange(of: model.state.messages.count) { _ in scrollToBottom(proxy) }
                    .onChange(of: model.state.loading) { _ in scrollToBottom(proxy) }
                    .onChange(of: model.state.messages.last?.content) { _ in scrollToBottom(proxy) }
                }
            }
            if let error = model.state.error {
                Text(error)
                    .font(ShiftFont.sans(12.5))
                    .foregroundColor(c.danger.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Spacing.screen)
                    .padding(.top, 4)
            }
            inputBar
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(c.bg)
        .accessibilityIdentifier("assistant_screen")
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let target = model.state.messages.last?.id else { return }
        withAnimation { proxy.scrollTo(target, anchor: .bottom) }
    }

    private var emptyState: some View {
        VStack(spacing: 0) {
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(c.today)
                    .frame(width: 48, height: 48)
                Image(systemName: ShiftIcons.sparkles).font(.system(size: 22)).foregroundColor(c.blue)
            }
            Text("Ask a desk question")
                .font(ShiftFont.sans(19, .semibold)).foregroundColor(c.ink)
                .padding(.top, 16)
            Text("Answers are grounded in the official documentation and current duty schedule.")
                .font(ShiftFont.sans(14)).foregroundColor(c.sec)
                .multilineTextAlignment(.center)
                .padding(.top, 4).padding(.horizontal, 24)
            VStack(spacing: 8) {
                ForEach(AssistantPrompts.shared.starters, id: \.self) { prompt in
                    Button(action: { model.ask(prompt) }) {
                        Text(prompt)
                            .font(ShiftFont.sans(13.5)).foregroundColor(c.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(c.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 20).padding(.horizontal, 24)
            Spacer()
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Ask a desk question...", text: $input)
                .font(ShiftFont.sans(14.5))
                .foregroundColor(c.ink)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(c.surfaceVar)
                .clipShape(RoundedRectangle(cornerRadius: Radii.pill, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radii.pill, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
                .accessibilityIdentifier("assistant_input")

            let canSend = !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.state.loading
            Button(action: send) {
                Image(systemName: ShiftIcons.send)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(canSend ? .white : c.ter)
                    .frame(width: 44, height: 44)
                    .background(canSend ? c.blue : c.surfaceVar)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityIdentifier("assistant_send")
        }
        .padding(.horizontal, Spacing.screen)
        .padding(.vertical, Spacing.l)
    }

    private func send() {
        let text = input
        input = ""
        model.ask(text)
    }
}

private struct AssistantBubbleView: View {
    let message: AssistantMessage
    var showShimmer: Bool = false
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        let isUser = message.role == .user
        HStack {
            if isUser { Spacer(minLength: 40) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
                if !isUser && message.showSafetyBanner {
                    HStack(spacing: 8) {
                        Image(systemName: ShiftIcons.warning).font(.system(size: 14)).foregroundColor(c.danger.accent)
                        Text(message.lifeSafety ?? "")
                            .font(ShiftFont.sans(12.5, .semibold)).foregroundColor(c.danger.deep)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(c.danger.tint)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                Group {
                    if showShimmer {
                        VStack(alignment: .leading, spacing: 6) {
                            ShimmerBar().frame(width: 160, height: 12)
                            ShimmerBar().frame(width: 110, height: 12)
                        }
                    } else {
                        Text(message.content)
                            .font(ShiftFont.sans(14.5))
                            .foregroundColor(isUser ? .white : c.ink)
                    }
                }
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(isUser ? c.blue : c.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay {
                        if !isUser {
                            RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(c.divider, lineWidth: 1)
                        }
                    }
                if !isUser && !message.citations.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(message.citations, id: \.sourceRef) { citation in
                            Text(citation.sourceRef)
                                .font(ShiftFont.sans(11.5)).foregroundColor(c.sec)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(c.surfaceVar)
                                .clipShape(Capsule())
                        }
                    }
                }
                if let route = message.route {
                    Text("Routed to: \(route.tierLabel ?? route.resolvedTier)")
                        .font(ShiftFont.sans(12, .medium)).foregroundColor(c.sec)
                }
            }
            .frame(maxWidth: 300, alignment: isUser ? .trailing : .leading)
            if !isUser { Spacer(minLength: 40) }
        }
    }
}
