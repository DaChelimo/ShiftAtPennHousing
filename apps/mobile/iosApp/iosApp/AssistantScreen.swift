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
                self.vm.onError(message: "Couldn't reach Snoopy. Try again.")
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
    /// The Assistant has no bottom-bar item of its own — it opens from the My-Shifts FAB or
    /// the More sheet, from whichever tab the worker was on — so closing it needs somewhere
    /// to return to that isn't hardcoded to My Shifts.
    let onBack: () -> Void
    @State private var input: String = ""
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button(action: onBack) {
                    Image(systemName: ShiftIcons.chevronLeft)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(c.sec)
                        .frame(width: 30, height: 30)
                        .background(c.surfaceVar)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("assistant_back")
                Text("Ask Snoopy")
                    .font(ShiftFont.sans(26, .bold, relativeTo: .largeTitle))
                    .foregroundColor(c.ink)
                Spacer(minLength: 0)
            }
            .padding(.leading, 10).padding(.trailing, 16).padding(.top, 10).padding(.bottom, 8)
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
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping container leaks onto every descendant element in the XCUITest tree,
        // shadowing that container's own more-specific descendant identifiers (confirmed
        // empirically; see ContentView.swift's `shifts_screen` fix for the full explanation).
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("assistant_screen")
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let target = model.state.messages.last?.id else { return }
        withAnimation { proxy.scrollTo(target, anchor: .bottom) }
    }

    private var emptyState: some View {
        ScrollView {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
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
            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
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

/// One line of a parsed answer. Spans are concatenated into a single `Text` so the line still
/// wraps and hyphenates as one paragraph rather than breaking at every style change.
private struct MarkdownLineView: View {
    let line: MarkdownLine
    let isUser: Bool
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        let body = line.spans.reduce(Text("")) { acc, span in acc + styled(span) }
        if line.bullet {
            HStack(alignment: .top, spacing: 6) {
                Text("•").font(ShiftFont.sans(14.5)).foregroundColor(isUser ? .white : c.sec)
                body
            }
        } else {
            body.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func styled(_ span: MarkdownSpan) -> Text {
        var t = Text(span.text)
        if span.code {
            t = t.font(ShiftFont.mono(13.5))
        } else {
            t = t.font(ShiftFont.sans(14.5, span.bold ? .semibold : .regular))
        }
        if span.italic { t = t.italic() }
        return t.foregroundColor(isUser ? .white : c.ink)
    }
}

/// Where an answer came from, kept out of the way (BSpec §17.3).
///
/// Collapsed it is a single quiet row ("2 sources"); tapping reveals the document names, each
/// clipped to one line. The names are long binder titles, so showing them inline pushed the
/// answer off screen and clipped mid-word. The answer is what the worker needs in the moment;
/// provenance is there to be checked, not read.
private struct SourcesBar: View {
    let citations: [Citation]
    @State private var expanded = false
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: ShiftIcons.chevronRight)
                        .font(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Text(citations.count == 1 ? "1 source" : "\(citations.count) sources")
                        .font(ShiftFont.sans(11.5))
                }
                .foregroundColor(c.ter)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("assistant_sources_toggle")

            if expanded {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(citations.enumerated()), id: \.offset) { _, citation in
                        Text(citation.sourceRef)
                            .font(ShiftFont.sans(11))
                            .foregroundColor(c.ter)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                .accessibilityIdentifier("assistant_sources_list")
            }
        }
        .padding(.top, 2)
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
                        // Rendered, not raw: the model writes Markdown regardless of the prompt,
                        // and this bubble used to print `**10:00 pm**` verbatim.
                        VStack(alignment: .leading, spacing: 3) {
                            ForEach(
                                Array(AssistantMarkdownKt.parseAssistantMarkdown(raw: message.content).enumerated()),
                                id: \.offset
                            ) { _, line in
                                MarkdownLineView(line: line, isUser: isUser)
                            }
                        }
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
                    SourcesBar(citations: message.citations)
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
