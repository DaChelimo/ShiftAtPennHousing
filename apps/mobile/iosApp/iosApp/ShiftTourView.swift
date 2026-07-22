import SwiftUI
import Shared

/// ShiftTourView (iOS) — the interactive "Manage a shift" onboarding tour, the richer
/// successor to the plain `tip.my_shifts` contextual card. It plays out on a sample
/// My-Shifts card so the worker SEES the three outcomes (drop / swap / hand off), DOES the
/// part-or-all range pick (mirroring the real two-handle range slider), and WATCHES where
/// the shift lands (drop -> Open, swap -> Swaps).
///
/// The step copy + the step-2 summary math live in shared `onboarding/ShiftTour`; the
/// `ShiftTourViewModel` sequences the three steps and owns the done-flag. This file is
/// rendering + motion + the persisted observable, mirroring `Onboarding.swift`.

// MARK: - Persisted, observable wrapper

final class ShiftTourObservable: ObservableObject {
    let vm: ShiftTourViewModel
    @Published var state: ShiftTourUiState
    private var task: Task<Void, Never>?
    // Its OWN seen-key store, separate from the welcome-tour / tips set, so persisting one
    // never clobbers the other (they observe + write independently).
    private static let storageKey = "shift_tour_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = ShiftTourViewModel(initialSeen: seen)
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
    var isDone: Bool { !ShiftTour.shared.shouldAutoShow(seen: state.seen) }

    /// Auto-open on the first My-Shifts landing (a no-op once seen).
    func autoStart() { vm.autoStart() }
    /// Re-open from the header help button or the Settings row.
    func replay() { vm.replay() }
}

// MARK: - The tour overlay

struct ShiftTourView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: ShiftTourObservable

    // Step-2 interactive state (reset every time the tour opens, since this view is only
    // mounted while active). Block indices on the sample grid, [from, to). Defaults mirror
    // ShiftTour.DEFAULT_FROM_BLOCK / DEFAULT_TO_BLOCK (18:00 to 20:00).
    @State private var from = 4
    @State private var to = 8
    @State private var permanent = false

    // One-shot motion triggers.
    @State private var chipsIn = false
    @State private var tapPulse = false
    @State private var tabBounce = false

    // Step-2 drag discoverability: a small hand badge wiggles on the left handle until the
    // worker actually drags something (from/to changing is the real signal a drag happened,
    // not just "step 2 opened"). Hidden for good the moment that happens, so it never lingers
    // on someone who already found it.
    @State private var showDragHint = false
    @State private var dragHintOffset: CGFloat = 0
    @State private var hasInteractedWithSlider = false

    // The sample shift is 16:00 to 20:00 = 8 thirty-minute blocks (ShiftTour.SAMPLE_BLOCK_COUNT).
    private let blockCount = 8

    private var idx: Int { Int(model.state.stepIndex) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Scrim swallows stray taps: the worker advances via the card's own controls,
            // and step 2's slider stays usable without an accidental dismiss.
            Color.black.opacity(scheme == .dark ? 0.82 : 0.62)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {}

            VStack(spacing: 18) {
                Spacer(minLength: 8)
                stage(c)
                coachCard(c)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 20)
        }
        .accessibilityIdentifier("shift_tour")
        .onAppear { syncMotion(to: idx, animate: false) }
        .onChange(of: idx) { newIdx in syncMotion(to: newIdx, animate: true) }
    }

    // MARK: Stage (sample card + step-2 controls + mock nav)

    @ViewBuilder
    private func stage(_ c: ShiftColors) -> some View {
        VStack(spacing: 16) {
            ZStack {
                sampleCard(c)
                if idx == 1 { chipsRow(c) }
                if idx == 1 { tapIndicator(c) }
            }
            .frame(maxWidth: .infinity)

            if idx == 2 {
                amountControls(c)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            mockNav(c)
                .padding(.top, 4)
        }
        .padding(18)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
        .animation(.easeInOut(duration: 0.3), value: idx)
    }

    /// The sample shift card. Lifts (blue ring + scale) in step 1, drops away in step 3.
    private func sampleCard(_ c: ShiftColors) -> some View {
        let lifted = idx == 1
        let dropped = idx >= 3
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
            Image(systemName: ShiftIcons.chevronRight)
                .font(.system(size: 14, weight: .semibold)).foregroundColor(c.outline)
        }
        .padding(14)
        .background(c.bg)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(c.blue, lineWidth: lifted ? 2 : 0)
        )
        .scaleEffect(dropped ? 0.7 : (lifted ? 1.03 : 1.0))
        .offset(y: dropped ? 170 : 0)
        .opacity(dropped ? 0 : 1)
        .shadow(color: c.blue.opacity(lifted ? 0.22 : 0), radius: 10, x: 0, y: 4)
        .animation(.spring(response: 0.5, dampingFraction: 0.7), value: idx)
        .accessibilityIdentifier("shift_tour_sample_card")
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

    /// Step 1 action chips: Drop standalone, then the grouped Swap + Hand off (both open the
    /// swap flow in the real sheet), popping in with a stagger.
    private func chipsRow(_ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            actionChip("Drop", icon: ShiftIcons.dropped, tint: c.pending, order: 0)
            HStack(spacing: 8) {
                actionChip("Swap", icon: "arrow.left.arrow.right", tint: c.success.accent, order: 1)
                actionChip("Hand off", icon: "arrowshape.turn.up.right", tint: c.blue, order: 2)
            }
            .padding(6)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(c.divider, lineWidth: 1)
            )
        }
        .padding(.top, 92)
        .frame(maxWidth: .infinity)
    }

    private func actionChip(_ label: String, icon: String, tint: Color, order: Int) -> some View {
        let c = ShiftColors.resolve(scheme)
        return HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                .frame(width: 22, height: 22).background(tint).clipShape(Circle())
            Text(label).font(ShiftFont.sans(13, .semibold)).foregroundColor(c.ink)
        }
        .padding(.leading, 6).padding(.trailing, 12).padding(.vertical, 6)
        .background(c.surface)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(c.divider, lineWidth: 1))
        .shadow(color: .black.opacity(0.10), radius: 4, x: 0, y: 2)
        .opacity(chipsIn ? 1 : 0)
        .scaleEffect(chipsIn ? 1 : 0.94)
        .offset(y: chipsIn ? 0 : 6)
        .animation(.easeOut(duration: 0.4).delay(Double(order) * 0.1), value: chipsIn)
    }

    /// Step 2 controls: the REAL two-handle range slider, a One time / Permanent segmented
    /// control, and the live summary line (recomputed by the shared `ShiftTour.summaryLine`).
    /// A wiggling hand badge sits on the left handle until the worker actually drags it, so
    /// the slider's interactivity isn't something they have to discover by accident.
    private func amountControls(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    BlockRangeSlider(blockCount: blockCount, from: $from, to: $to)
                        .accessibilityIdentifier("shift_tour_range")
                    if showDragHint {
                        dragHintBadge(trackWidth: geo.size.width, c)
                    }
                }
            }
            .frame(height: 32)
            .onChange(of: from) { _ in registerSliderInteraction() }
            .onChange(of: to) { _ in registerSliderInteraction() }
            HStack(spacing: 8) {
                scopePill("One time", selected: !permanent) { permanent = false }
                scopePill("Permanent", selected: permanent) { permanent = true }
            }
            Text(ShiftTour.shared.summaryLine(fromBlock: Int32(from), toBlock: Int32(to), permanent: permanent))
                .font(ShiftFont.sans(14, .semibold))
                .foregroundColor(c.blue)
                .accessibilityIdentifier("shift_tour_summary")
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

    private func scopePill(_ label: String, selected: Bool, _ action: @escaping () -> Void) -> some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: action) {
            Text(label)
                .font(ShiftFont.sans(14, .semibold))
                .foregroundColor(selected ? .white : c.sec)
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .background(selected ? c.blue : c.surfaceVar)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    /// A representative bottom-nav strip. The Open item bounces (amber) in step 3 to show
    /// where a dropped shift lands.
    private func mockNav(_ c: ShiftColors) -> some View {
        HStack(spacing: 0) {
            navItem("My Shifts", ShiftIcons.list, tint: c.ter, bounce: false, c)
            navItem("Open", ShiftIcons.plus, tint: idx >= 3 ? c.pending : c.ter, bounce: idx >= 3, c)
            navItem("House", ShiftIcons.building, tint: c.ter, bounce: false, c)
            navItem("Swaps", "arrow.left.arrow.right", tint: c.ter, bounce: false, c)
            navItem("More", ShiftIcons.more, tint: c.ter, bounce: false, c)
        }
        .padding(.top, 8)
        .overlay(Divider(), alignment: .top)
    }

    private func navItem(_ label: String, _ icon: String, tint: Color, bounce: Bool, _ c: ShiftColors) -> some View {
        VStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(tint)
            Text(label).font(ShiftFont.sans(10, .medium)).foregroundColor(tint)
        }
        .frame(maxWidth: .infinity)
        .scaleEffect(bounce && tabBounce ? 1.35 : 1.0)
        .animation(.spring(response: 0.45, dampingFraction: 0.5), value: tabBounce)
    }

    // MARK: Coach card (kicker / title / body / controls)

    private func coachCard(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let step = model.state.step {
                Text(step.kicker)
                    .font(ShiftFont.sans(11, .bold)).foregroundColor(c.blue)
                    .tracking(0.8)
                Text(step.title).font(ShiftFont.sans(19, .semibold)).foregroundColor(c.ink)
                bodyText(step, c)
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

    /// Step 3 gets colored emphasis on Open (amber) + Swaps (green); other steps render the
    /// shared body verbatim. The words match `ShiftTour.STEPS`.
    @ViewBuilder
    private func bodyText(_ step: ShiftTourStep, _ c: ShiftColors) -> some View {
        if step.id == .destination {
            (
                Text("Dropped shifts land in ").foregroundColor(c.sec)
                    + Text("Open").foregroundColor(c.pending).fontWeight(.bold)
                    + Text(" for anyone to grab. Swaps go to the ").foregroundColor(c.sec)
                    + Text("Swaps").foregroundColor(c.success.accent).fontWeight(.bold)
                    + Text(" tab for approval.").foregroundColor(c.sec)
            )
            .font(ShiftFont.sans(15, .regular))
        } else {
            Text(step.body).font(ShiftFont.sans(15, .regular)).foregroundColor(c.sec)
        }
    }

    private func controls(_ c: ShiftColors) -> some View {
        HStack {
            Button("Skip") { model.vm.skip() }
                .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.sec)
                .buttonStyle(.plain)
                .accessibilityIdentifier("shift_tour_skip")
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
                        .accessibilityIdentifier("shift_tour_back")
                }
                Button(model.state.isLastStep ? "Done" : "Next") { model.vm.next() }
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(c.blue).clipShape(Capsule())
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("shift_tour_next")
            }
        }
    }

    // MARK: Motion

    /// Recompute the one-shot motion triggers for the given step. `animate: false` on first
    /// appear so the initial state doesn't visibly jump.
    private func syncMotion(to step: Int, animate: Bool) {
        // Chips stagger in on step 1; retrigger the pulse there too.
        chipsIn = step == 1
        tapPulse = step == 1
        // The Open tab bounces once when the card drops (step 3). Toggling the value drives
        // the spring; leaving it true is fine (the scaleEffect only applies while idx>=3).
        if step >= 3 {
            tabBounce = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { tabBounce = true }
        } else {
            tabBounce = false
        }
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

/// Collects the on-screen frame of the My-Shifts help button, the same anchor-preference
/// idiom as `OnboardingAnchorKey`, so the one-time pointer callout below can find it without
/// either view needing to know the other's layout.
struct ShiftTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the My-Shifts header that replays the tour.
struct ShiftTourHelpButton: View {
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
        .anchorPreference(key: ShiftTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("shift_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the My-Shifts help button,
/// shown once right after the tour first finishes so the worker learns where it went without
/// another card to read and dismiss. Non-blocking (`allowsHitTesting(false)`) and auto-fades
/// on a timer driven by the host — the real UI underneath stays fully interactive the moment
/// the tour closes. This is the app-idiom re-entry cue (a directional pointer), not a modal.
struct ShiftTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `ShiftTourHelpAnchorKey`).
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
        .accessibilityIdentifier("shift_tour_pointer")
    }
}

/// Per-device flag: whether the header "?" has already shown its one-time post-tour pointer.
enum ShiftTourPointerStore {
    private static let key = "shift_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
