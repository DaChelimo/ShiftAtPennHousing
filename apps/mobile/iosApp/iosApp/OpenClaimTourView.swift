import SwiftUI
import Shared

/// OpenClaimTourView (iOS) — the interactive "Claim what's open" onboarding tour for the
/// Open Shifts tab. Its single most important job: workers do not realize an open shift
/// can be claimed PERMANENTLY (a standing weekly pickup), not just once for the week
/// shown. The tour plays out on a sample open-shift card so the worker SEES the claim
/// affordance and the My House / Others sub-tabs (step 1), DOES the part-or-all range pick
/// (mirroring the real two-handle range slider, step 2), and DOES the weekly-vs-permanent
/// scope flip and watches the real screen's own wording change underneath it (step 3).
///
/// The step copy + the summary math live in shared `onboarding/OpenClaimTour`; the
/// `OpenClaimTourViewModel` sequences the three steps and owns the done-flag. This file is
/// rendering + motion + the persisted observable, mirroring `ShiftTourView.swift` almost
/// exactly (same shape, different content) per the interactive-onboarding-pattern spec.

// MARK: - Persisted, observable wrapper

final class OpenClaimTourObservable: ObservableObject {
    let vm: OpenClaimTourViewModel
    @Published var state: OpenClaimTourUiState
    private var task: Task<Void, Never>?
    // Its OWN seen-key store, separate from the welcome tour / tips / the "Manage a shift"
    // tour, so persisting one never clobbers another (they observe + write independently).
    private static let storageKey = "openclaim_tour_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = OpenClaimTourViewModel(initialSeen: seen)
        self.vm = vm
        self.state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState {
                // Mutate @Published on the main actor so SwiftUI reliably re-renders.
                await MainActor.run {
                    self.state = s
                    UserDefaults.standard.set(Array(s.seen), forKey: Self.storageKey)
                }
            }
        }
    }

    /// Whether the tour has been finished/skipped (drives the header-button "ping" gate).
    var isDone: Bool { !OpenClaimTour.shared.shouldAutoShow(seen: state.seen) }

    /// Auto-open on the first Open-Shifts landing (a no-op once seen).
    func autoStart() { vm.autoStart() }
    /// Re-open from the header help button or the Settings row.
    func replay() { vm.replay() }
}

// MARK: - The tour overlay

struct OpenClaimTourView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: OpenClaimTourObservable
    /// Fired when the scrim is tapped away on a dismissible step (see `body`'s tap gesture).
    var onDismissOutside: () -> Void = {}

    // Step 1: which sub-tab the sample stage highlights as selected.
    @State private var subTab = 0

    // Step-2 interactive state (reset every time the tour opens, since this view is only
    // mounted while active). Block indices on the sample grid, [from, to). Defaults mirror
    // OpenClaimTour.DEFAULT_FROM_BLOCK / DEFAULT_TO_BLOCK (18:00 to 20:00).
    @State private var from = 4
    @State private var to = 8

    // Step 3: the weekly-vs-permanent scope toggle. Defaults to OpenClaimTour.DEFAULT_PERMANENT.
    @State private var permanent = false

    // One-shot motion triggers.
    @State private var tapPulse = false

    // Step-2 drag discoverability: a small hand badge wiggles on the left handle until the
    // worker actually drags something (from/to changing is the real signal a drag happened,
    // not just "step 2 opened"). Hidden for good the moment that happens, so it never lingers
    // on someone who already found it.
    @State private var showDragHint = false
    @State private var dragHintOffset: CGFloat = 0
    @State private var hasInteractedWithSlider = false

    // The sample shift is 16:00 to 20:00 = 8 thirty-minute blocks (OpenClaimTour.SAMPLE_BLOCK_COUNT).
    private let blockCount = 8

    private var idx: Int { Int(model.state.stepIndex) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Tapping the scrim dismisses the tour, except on step 2 (the range slider),
            // where a stray tap while dragging must not lose the worker's place.
            Color.black.opacity(scheme == .dark ? 0.82 : 0.62)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    guard idx != 2 else { return }
                    model.vm.skip()
                    onDismissOutside()
                }

            VStack(spacing: 18) {
                Spacer(minLength: 8)
                stage(c)
                coachCard(c)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 20)
        }
        // A non-wrapping marker, not the container itself — see ContentView.swift's
        // `shifts_screen` comment for why: an identifier set directly on a wrapping
        // ZStack leaks onto every descendant element in the XCUITest tree.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("openclaim_tour")
        }
        .onAppear { syncMotion(to: idx, animate: false) }
        .onChange(of: idx) { newIdx in syncMotion(to: newIdx, animate: true) }
    }

    // MARK: Stage (sub-tabs + sample card + step controls)

    @ViewBuilder
    private func stage(_ c: ShiftColors) -> some View {
        VStack(spacing: 16) {
            if idx == 1 { subTabsRow(c) }

            ZStack {
                sampleCard(c)
                if idx == 1 { tapIndicator(c) }
            }
            .frame(maxWidth: .infinity)

            if idx == 2 {
                amountControls(c)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            if idx == 3 {
                scopeControls(c)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(18)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
        .animation(.easeInOut(duration: 0.3), value: idx)
    }

    /// The real My House / Others sub-tab control, live and tappable, exactly as it renders
    /// atop the real Open Shifts tab (`ContentView.openShiftsTab`). A standard segmented
    /// control needs no discoverability hint (principle 4).
    private func subTabsRow(_ c: ShiftColors) -> some View {
        HStack(spacing: 3) {
            subTabSegment("My House", selected: subTab == 0, c) { subTab = 0 }
            subTabSegment("Others", selected: subTab == 1, c) { subTab = 1 }
        }
        .padding(4)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        // `.ignore` makes this HStack itself ONE queryable AX element instead of a plain
        // layout container whose identifier leaks onto its two segment buttons.
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("openclaim_tour_subtabs")
    }

    private func subTabSegment(_ label: String, selected: Bool, _ c: ShiftColors, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(ShiftFont.sans(13, .semibold))
                .foregroundColor(selected ? .white : c.sec)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(selected ? c.blue : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    /// The sample open-shift card. Lifts (blue ring + scale) in step 1 to draw the eye to
    /// the tap target and its Claim button.
    private func sampleCard(_ c: ShiftColors) -> some View {
        let lifted = idx == 1
        return HStack(spacing: 12) {
            Text("H")
                .font(ShiftFont.sans(17, .bold))
                .foregroundColor(c.ink)
                .frame(width: 40, height: 40)
                .background(c.surfaceVar)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text("16:00 to 20:00").font(ShiftFont.mono(15, .medium)).foregroundColor(c.ink)
                    Text("4h")
                        .font(ShiftFont.mono(11, .semibold)).monospacedDigit()
                        .foregroundColor(c.sec)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(c.surfaceVar)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                Text("Harnwell").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            Text(permanent && idx == 3 ? "Pick up" : "Claim")
                .font(ShiftFont.sans(13, .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(c.blue)
                .clipShape(Capsule())
                .accessibilityIdentifier("openclaim_tour_claim_button")
        }
        .padding(14)
        .background(c.bg)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(c.blue, lineWidth: lifted ? 2 : 0)
        )
        .scaleEffect(lifted ? 1.03 : 1.0)
        .shadow(color: c.blue.opacity(lifted ? 0.22 : 0), radius: 10, x: 0, y: 4)
        .animation(.spring(response: 0.5, dampingFraction: 0.7), value: idx)
        .accessibilityIdentifier("openclaim_tour_sample_card")
    }

    /// The animated tap indicator that resolves onto the card in step 1.
    private func tapIndicator(_ c: ShiftColors) -> some View {
        Circle()
            .stroke(c.blue.opacity(0.9), lineWidth: 2)
            .frame(width: 34, height: 34)
            .scaleEffect(tapPulse ? 1.8 : 0.6)
            .opacity(tapPulse ? 0 : 0.9)
            .allowsHitTesting(false)
            .animation(.easeOut(duration: 0.9).repeatForever(autoreverses: false), value: tapPulse)
    }

    /// Step 2 controls: the REAL two-handle range slider (the same `BlockRangeSlider` the
    /// live claim-range selector uses) and the live "Covering Xh · start to end" summary
    /// (shared `OpenClaimTour.summaryLine`). A wiggling hand badge sits on the left handle
    /// until the worker actually drags it.
    private func amountControls(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("How much can you cover?").font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    BlockRangeSlider(blockCount: blockCount, from: $from, to: $to)
                        .accessibilityIdentifier("openclaim_tour_range")
                    if showDragHint {
                        dragHintBadge(trackWidth: geo.size.width, c)
                    }
                }
            }
            .frame(height: 32)
            .onChange(of: from) { _ in registerSliderInteraction() }
            .onChange(of: to) { _ in registerSliderInteraction() }
            Text(OpenClaimTour.shared.summaryLine(fromBlock: Int32(from), toBlock: Int32(to)))
                .font(ShiftFont.sans(14, .semibold))
                .foregroundColor(c.blue)
                .accessibilityIdentifier("openclaim_tour_summary")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A small blue "drag me" badge riding the left handle, wiggling left/right on a loop.
    /// Its x tracks the same thumb math `BlockRangeSlider` uses internally (thumb=24pt), so
    /// it sits right on the real handle rather than an approximate position.
    private func dragHintBadge(trackWidth: CGFloat, _ c: ShiftColors) -> some View {
        let thumb: CGFloat = 24
        let unit = max(trackWidth - thumb, 1) / CGFloat(blockCount)
        let thumbX = thumb / 2 + unit * CGFloat(from)
        return Image(systemName: "hand.draw.fill")
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.white)
            .padding(7)
            .background(c.blue)
            .clipShape(Circle())
            .shadow(color: .black.opacity(0.25), radius: 4, x: 0, y: 2)
            .position(x: thumbX + dragHintOffset, y: 16)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    /// The real signal a drag happened (not just that step 2 opened): `from`/`to` only ever
    /// change via the slider's own gesture, so this is exactly "the worker found it".
    private func registerSliderInteraction() {
        guard !hasInteractedWithSlider else { return }
        hasInteractedWithSlider = true
        showDragHint = false
    }

    /// Step 3 controls: a two-state scope toggle using the real claim sheet's own wording
    /// ("Weekly open shift" claims once; "Permanent opening" repeats every week), plus the
    /// live one-line consequence (shared `OpenClaimTour.scopeSummary`) so the flip's effect
    /// is visible immediately (principle 12). A standard segmented control needs no
    /// discoverability hint (principle 4).
    private func scopeControls(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                scopePill("Weekly open shift", selected: !permanent, c) { permanent = false }
                scopePill("Permanent opening", selected: permanent, c) { permanent = true }
            }
            // A non-wrapping marker, not `.accessibilityElement(children: .ignore)`: unlike
            // the pure drag-target grids elsewhere in this file, this toggle's own two pill
            // buttons must stay individually tappable/queryable by their own labels.
            .overlay(alignment: .topLeading) {
                Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("openclaim_tour_scope_toggle")
            }
            Text(OpenClaimTour.shared.scopeSummary(permanent: permanent))
                .font(ShiftFont.sans(14, .semibold))
                .foregroundColor(permanent ? c.permanent.deep : c.blue)
                .accessibilityIdentifier("openclaim_tour_summary")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func scopePill(_ label: String, selected: Bool, _ c: ShiftColors, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(ShiftFont.sans(13, .semibold))
                .foregroundColor(selected ? .white : c.sec)
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .background(selected ? (permanent && selected ? c.permanent.accent : c.blue) : c.surfaceVar)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: Coach card (kicker / title / body / controls)

    private func coachCard(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let step = model.state.step {
                Text(step.kicker)
                    .font(ShiftFont.sans(11, .bold)).foregroundColor(c.blue)
                    .tracking(0.8)
                Text(step.title).font(ShiftFont.sans(19, .semibold)).foregroundColor(c.ink)
                Text(step.body)
                    .font(ShiftFont.sans(15, .regular)).foregroundColor(c.sec)
                    .fixedSize(horizontal: false, vertical: true)
            }
            controls(c).padding(.top, 6)
        }
        .padding(20)
        .frame(maxWidth: 460, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 14, x: 0, y: 6)
    }

    private func controls(_ c: ShiftColors) -> some View {
        HStack {
            Button("Skip") { model.vm.skip() }
                .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.sec)
                .buttonStyle(.plain)
                .accessibilityIdentifier("openclaim_tour_skip")
            Spacer()
            Text("\(idx) of \(Int(model.state.stepCount))")
                .font(ShiftFont.sans(13, .medium)).foregroundColor(c.ter)
            Spacer()
            HStack(spacing: 8) {
                if model.state.canGoBack {
                    Button("Back") { model.vm.back() }
                        .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                        .padding(.horizontal, 16).padding(.vertical, 8)
                        .overlay(Capsule().stroke(c.divider, lineWidth: 1))
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("openclaim_tour_back")
                }
                Button(model.state.isLastStep ? "Done" : "Next") { model.vm.next() }
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(c.blue).clipShape(Capsule())
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("openclaim_tour_next")
            }
        }
    }

    // MARK: Motion

    /// Recompute the one-shot motion triggers for the given step. `animate: false` on first
    /// appear so the initial state doesn't visibly jump.
    private func syncMotion(to step: Int, animate: Bool) {
        // The tap-pulse ring only shows on step 1.
        tapPulse = step == 1
        // The drag hint only ever shows on step 2, and only until the worker has actually
        // dragged once (hasInteractedWithSlider, set by registerSliderInteraction). Stepping
        // away always stops the loop cleanly (no animation) so it never wiggles off-step.
        if step == 2, !hasInteractedWithSlider {
            showDragHint = true
            dragHintOffset = 0
            withAnimation(Animation.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dragHintOffset = -26
            }
        } else {
            showDragHint = false
            dragHintOffset = 0
        }
    }
}

// MARK: - Header help button (re-entry)

/// Collects the on-screen frame of the Open-Shifts help button, the same anchor-preference
/// idiom as `ShiftTourHelpAnchorKey`, so the one-time pointer callout below can find it
/// without either view needing to know the other's layout.
struct OpenClaimTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the Open-Shifts header that replays the tour.
struct OpenClaimTourHelpButton: View {
    @Environment(\.colorScheme) private var scheme
    let action: () -> Void

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: action) {
            Image(systemName: "questionmark")
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(c.blue)
                .frame(width: 34, height: 34)
                .background(c.blueContainer)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .anchorPreference(key: OpenClaimTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("openclaim_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the Open-Shifts help
/// button, shown once right after the tour first finishes so the worker learns where it
/// went without another card to read and dismiss. Non-blocking (`allowsHitTesting(false)`)
/// and auto-fades on a timer driven by the host — the real UI underneath stays fully
/// interactive the moment the tour closes. This is the app-idiom re-entry cue (a
/// directional pointer), not a modal, mirroring `ShiftTourPointerCallout`.
struct OpenClaimTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `OpenClaimTourHelpAnchorKey`).
    let targetRect: CGRect
    /// The overlay's full size, same coordinate space as [targetRect].
    let fullSize: CGSize

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let bubbleWidth: CGFloat = 200
        // The arrow always points at the button's true center; the bubble clamps inside the
        // screen and the arrow nudges toward it independently, so a button near the edge
        // never pushes the bubble off-screen.
        let arrowX = targetRect.midX
        let bubbleCenterX = min(max(arrowX, bubbleWidth / 2 + 16), fullSize.width - bubbleWidth / 2 - 16)
        let arrowY = targetRect.maxY + 10
        return ZStack(alignment: .top) {
            Image(systemName: "arrowtriangle.up.fill")
                .font(.system(size: 13))
                .foregroundColor(c.blue)
                .position(x: arrowX, y: arrowY)
            VStack(alignment: .leading, spacing: 2) {
                Text("Find this again here").font(ShiftFont.sans(13, .semibold)).foregroundColor(.white)
                Text("Tap to replay the tour").font(ShiftFont.sans(12, .regular)).foregroundColor(.white.opacity(0.85))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(width: bubbleWidth, alignment: .leading)
            .background(c.blue)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .position(x: bubbleCenterX, y: arrowY + 30)
        }
        .shadow(color: .black.opacity(0.22), radius: 10, x: 0, y: 4)
        .allowsHitTesting(false)
        .accessibilityIdentifier("openclaim_tour_pointer")
    }
}

/// Per-device flag: whether the header "?" has already shown its one-time post-tour pointer.
enum OpenClaimTourPointerStore {
    private static let key = "openclaim_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
