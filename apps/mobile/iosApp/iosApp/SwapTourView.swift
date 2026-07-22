import SwiftUI
import Shared

/// SwapTourView (iOS) — the interactive swap-composer onboarding tour. It opens ONLY once
/// a worker is already inside the swap composer (the real `SwapCalendarPage`), having
/// already chosen "Swap it" over "Drop the shift" on the prior Manage-shift screen. That
/// Drop-vs-Swap decision is `ShiftTour`'s job (its step 1); this tour teaches what's
/// INSIDE the composer once you're in it: the Swap-vs-Hand-off sub-mode (step 1), picking
/// a housemate and an amount with the REAL two-handle range slider (step 2), and the
/// segmented give/take timeline for splitting a shift between two people (step 3).
///
/// The step copy + the step-2 give/take summary math live in shared
/// `onboarding/SwapTour`; the `SwapTourViewModel` sequences the three steps and owns the
/// done-flag. This file is rendering + motion + the persisted observable, mirroring
/// `ShiftTourView.swift`'s shape exactly so the two tours read as one product.

// MARK: - Persisted, observable wrapper

final class SwapTourObservable: ObservableObject {
    let vm: SwapTourViewModel
    @Published var state: SwapTourUiState
    private var task: Task<Void, Never>?
    // Its OWN seen-key store, separate from ShiftTour's and every other tour's, so
    // persisting one never clobbers another's state.
    private static let storageKey = "swap_tour_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = SwapTourViewModel(initialSeen: seen)
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
    var isDone: Bool { !SwapTour.shared.shouldAutoShow(seen: state.seen) }

    /// Auto-open the first time the worker lands in the swap composer (a no-op once seen).
    func autoStart() { vm.autoStart() }
    /// Re-open from the composer's help button or the Settings row.
    func replay() { vm.replay() }
}

// MARK: - The tour overlay

struct SwapTourView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: SwapTourObservable

    // Step-1 sub-mode choice (reset every time the tour opens, since this view is only
    // mounted while active). Defaults to Swap, matching the composer's own default.
    @State private var mode: SwapTourMode = .swap

    // Step-2 interactive state. Block indices on the sample give-shift grid, [from, to).
    // Defaults mirror SwapTour.DEFAULT_FROM_BLOCK / DEFAULT_TO_BLOCK (18:00 to 20:00).
    @State private var from = 4
    @State private var to = 8

    // Step-3 interactive state: which free segment is currently focused (tap-to-focus).
    @State private var focusedSegmentId = 1

    // One-shot motion triggers.
    @State private var cardsIn = false
    @State private var tabBounce = false

    // Step-2 drag discoverability: a small hand badge wiggles on the left handle until the
    // worker actually drags something (from/to changing is the real signal a drag
    // happened, not just "step 2 opened"). Hidden for good the moment that happens, so it
    // never lingers on someone who already found it. Wiggles HORIZONTALLY, matching the
    // slider's own left-right drag axis (same math as ShiftTourView's step-2 hint).
    @State private var showDragHint = false
    @State private var dragHintOffset: CGFloat = 0
    @State private var hasInteractedWithSlider = false

    // The sample give shift is 16:00 to 20:00 = 8 thirty-minute blocks
    // (SwapTour.SAMPLE_BLOCK_COUNT).
    private let blockCount = 8

    private var idx: Int { Int(model.state.stepIndex) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Scrim swallows stray taps: the worker advances via the card's own controls,
            // and step 2/3's controls stay usable without an accidental dismiss.
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
        .accessibilityIdentifier("swap_tour")
        .onAppear { syncMotion(to: idx, animate: false) }
        .onChange(of: idx) { newIdx in syncMotion(to: newIdx, animate: true) }
    }

    // MARK: Stage (mode cards / amount controls / split timeline + mock nav)

    @ViewBuilder
    private func stage(_ c: ShiftColors) -> some View {
        VStack(spacing: 16) {
            if idx == 1 {
                VStack(alignment: .leading, spacing: 10) {
                    breadcrumb(c)
                    modeCards(c)
                }
                .frame(maxWidth: .infinity)
            }

            if idx == 2 {
                amountControls(c)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            if idx == 3 {
                splitStage(c)
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

    /// A small breadcrumb above step 1's cards, so it reads as nested inside a flow (the
    /// worker already chose "Swap" on the prior Manage-shift screen) rather than a
    /// standalone top-level choice.
    private func breadcrumb(_ c: ShiftColors) -> some View {
        HStack(spacing: 4) {
            Text("From Manage shift").font(ShiftFont.sans(11.5, .medium)).foregroundColor(c.ter)
            Image(systemName: ShiftIcons.chevronRight).font(.system(size: 8, weight: .semibold)).foregroundColor(c.ter)
            Text("Swap").font(ShiftFont.sans(11.5, .medium)).foregroundColor(c.sec)
        }
        .accessibilityIdentifier("swap_tour_breadcrumb")
    }

    /// Step 1: two equal-weight cards, Swap vs Hand off, styled like the step-2 candidate
    /// row for visual consistency across the tour's own stages. This mirrors the real
    /// `SwapCalendarPage.modeButton`s' meaning (the two sub-modes inside the composer), not
    /// the Drop-vs-Swap decision from the prior screen (never shown here).
    private func modeCards(_ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            modeCard("Swap", icon: "arrow.left.arrow.right", selected: mode == .swap, id: "swap_tour_mode_swap", c) {
                mode = .swap
            }
            modeCard("Hand off", icon: "arrow.right", selected: mode == .handOff, id: "swap_tour_mode_handoff", c) {
                mode = .handOff
            }
        }
        .opacity(cardsIn ? 1 : 0)
        .scaleEffect(cardsIn ? 1 : 0.96)
        .animation(.easeOut(duration: 0.35), value: cardsIn)
    }

    private func modeCard(_ title: String, icon: String, selected: Bool, id: String, _ c: ShiftColors, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(selected ? c.blue : c.sec)
                        .frame(width: 32, height: 32).background(c.surfaceVar).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue)
                    }
                }
                Text(title).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? c.blue : c.divider, lineWidth: selected ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    /// Step 2 controls: a real candidate/take row (a housemate + their fixed take-side
    /// span), the REAL two-handle range slider sizing the GIVE side, and the live summary
    /// line (recomputed by shared `SwapTour.summaryLine`, branching on the step-1 mode).
    private func amountControls(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            candidateRow(c)
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    BlockRangeSlider(blockCount: blockCount, from: $from, to: $to)
                        .accessibilityIdentifier("swap_tour_range")
                    if showDragHint {
                        dragHintBadge(trackWidth: geo.size.width, c)
                    }
                }
            }
            .frame(height: 32)
            .onChange(of: from) { _ in registerSliderInteraction() }
            .onChange(of: to) { _ in registerSliderInteraction() }
            Text(summaryText())
                .font(ShiftFont.sans(14, .semibold))
                .foregroundColor(c.blue)
                .accessibilityIdentifier("swap_tour_summary")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The pure, mode-aware live summary: "You give Xh · you get Yh" for Swap, or
    /// "Giving Jordan Xh · nothing comes back" for Hand off.
    private func summaryText() -> String {
        SwapTour.shared.summaryLine(
            mode: mode,
            giveFromBlock: Int32(from),
            giveToBlock: Int32(to),
            candidateName: SwapTour.shared.SAMPLE_CANDIDATE_NAME,
            candidateBlocks: SwapTour.shared.SAMPLE_CANDIDATE_BLOCK_COUNT
        )
    }

    /// The sample housemate offered in step 2, styled like the real `takeCard` /
    /// `candidateRow` (selected state, checkmark). Their own take-side span is fixed
    /// (09:00 to 11:00 = 2h) — only the GIVE side is driven by the slider, mirroring the
    /// real composer where the take amount comes from the picked person's own shift.
    private func candidateRow(_ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            HouseBadge(initial: "J", bg: c.surfaceVar, fg: c.ink)
            VStack(alignment: .leading, spacing: 1) {
                Text("Jordan").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                Text("09:00 to 11:00 · 2h").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(c.blue.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.blue, lineWidth: 1.5))
        .accessibilityIdentifier("swap_tour_candidate_row")
    }

    /// A small blue "drag me" badge riding the left handle, wiggling left/right on a loop.
    /// Its x tracks the same thumb math `BlockRangeSlider` uses internally (thumb=24pt), so
    /// it sits right on the real handle rather than an approximate position. Identical
    /// pattern to `ShiftTourView.dragHintBadge`.
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

    // MARK: Step 3 — segmented give/take timeline

    /// A local, tour-only sample of the real `SwapSegment` shape (locked / active / free),
    /// styled to match `segmentCell` in `SwapCalendarPage` exactly. This stays local
    /// (not the shared `SwapSegment` model) because the tour's sample data is fixed prose,
    /// the same way `ShiftTourView`'s sample card is hardcoded rather than sourced from a
    /// real `MyShift`.
    private struct TourSegment: Identifiable {
        let id: Int
        let rangeLabel: String
        let blocks: Int
        let locked: Bool
        let note: String?
    }

    private let tourSegments: [TourSegment] = [
        TourSegment(id: 0, rangeLabel: "16:00 to 17:00", blocks: 2, locked: true, note: "Given"),
        TourSegment(id: 1, rangeLabel: "17:00 to 18:00", blocks: 2, locked: false, note: nil),
        TourSegment(id: 2, rangeLabel: "18:00 to 20:00", blocks: 4, locked: false, note: nil),
    ]

    /// The segmented give/take timeline — one locked zone (already given), one focused
    /// free zone (the active reservation), and a further free zone a worker can tap to
    /// hand the rest to someone else, live-focusing it on tap (mirroring the real
    /// `swapTimeline` / `segmentCell` tap-to-focus interaction exactly).
    private func splitStage(_ c: ShiftColors) -> some View {
        let total = max(tourSegments.reduce(0) { $0 + $1.blocks }, 1)
        return GeometryReader { geo in
            let gap: CGFloat = 4
            let avail = geo.size.width - gap * CGFloat(max(tourSegments.count - 1, 0))
            HStack(spacing: gap) {
                ForEach(tourSegments) { seg in
                    segmentCell(seg, c)
                        .frame(width: max(avail * CGFloat(seg.blocks) / CGFloat(total), 0))
                }
            }
        }
        .frame(height: 46)
        .accessibilityIdentifier("swap_tour_split_timeline")
    }

    /// Zone treatment matches the real `segmentCell` 1:1: locked = surfaceVar bg + divider
    /// border + muted text + note ("Given"); active = blue-tinted bg + blue border + blue
    /// text ("Giving"); free = surface bg + dashed-weight outline border + muted "Tap".
    /// Accessibility identifiers deliberately match the real screen's own convention
    /// (`swap_seg_locked` / `swap_seg_active` / `swap_seg_free`).
    private func segmentCell(_ seg: TourSegment, _ c: ShiftColors) -> some View {
        let active = seg.id == focusedSegmentId
        let locked = seg.locked
        let bg = locked ? c.surfaceVar : (active ? c.blue.opacity(0.10) : c.surface)
        let border = active ? c.blue : (locked ? c.divider : c.outline)
        let sub = locked ? (seg.note ?? "Given") : (active ? "Giving" : "Tap")
        return VStack(spacing: 2) {
            Text(seg.rangeLabel).font(ShiftFont.sans(10.5)).foregroundColor(locked ? c.ter : c.ink)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(sub).font(ShiftFont.sans(10, active ? .medium : .regular)).foregroundColor(active ? c.blue : c.ter).lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 4)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(border, lineWidth: active ? 1.5 : 1))
        .contentShape(Rectangle())
        .accessibilityIdentifier(locked ? "swap_seg_locked" : (active ? "swap_seg_active" : "swap_seg_free"))
        .onTapGesture {
            guard !locked, !active else { return }
            withAnimation(Motion.press) { focusedSegmentId = seg.id }
        }
    }

    // MARK: Mock bottom nav

    /// A representative bottom-nav strip. The Swaps item bounces (success green) in step 3
    /// to show where a swap proposal lands, mirroring `ShiftTourView`'s amber Open bounce
    /// for a dropped shift.
    private func mockNav(_ c: ShiftColors) -> some View {
        HStack(spacing: 0) {
            navItem("My Shifts", ShiftIcons.list, tint: c.ter, bounce: false, c)
            navItem("Open", ShiftIcons.plus, tint: c.ter, bounce: false, c)
            navItem("House", ShiftIcons.building, tint: c.ter, bounce: false, c)
            navItem("Swaps", "arrow.left.arrow.right", tint: idx >= 3 ? c.success.accent : c.ter, bounce: idx >= 3, c)
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

    /// Step 3 gets colored emphasis on the word "Swaps" (success green, the tab it bounces
    /// to); other steps render the shared body verbatim. The words match `SwapTour.STEPS`.
    @ViewBuilder
    private func bodyText(_ step: SwapTourStep, _ c: ShiftColors) -> some View {
        if step.id == .split {
            (
                Text("Reserve part for one person, then tap a free segment to hand the rest to someone else. Swaps go to the ").foregroundColor(c.sec)
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
                .accessibilityIdentifier("swap_tour_skip")
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
                        .accessibilityIdentifier("swap_tour_back")
                }
                Button(model.state.isLastStep ? "Done" : "Next") { model.vm.next() }
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(c.blue).clipShape(Capsule())
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("swap_tour_next")
            }
        }
    }

    // MARK: Motion

    /// Recompute the one-shot motion triggers for the given step. `animate: false` on first
    /// appear so the initial state doesn't visibly jump.
    private func syncMotion(to step: Int, animate: Bool) {
        // Mode cards pop in on step 1.
        cardsIn = step == 1
        // The Swaps tab bounces once when the split lesson lands (step 3). Toggling the
        // value drives the spring; leaving it true is fine (the scaleEffect only applies
        // while idx>=3).
        if step >= 3 {
            tabBounce = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { tabBounce = true }
            // Reset the tap-to-focus lesson to its starting state each time step 3 is
            // (re)entered, so replays always start from the same demo.
            focusedSegmentId = 1
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

/// Collects the on-screen frame of the swap composer's help button, the same
/// anchor-preference idiom as `ShiftTourHelpAnchorKey`, so the one-time pointer callout
/// below can find it without either view needing to know the other's layout.
struct SwapTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the swap composer's header that replays the tour.
struct SwapTourHelpButton: View {
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
        .anchorPreference(key: SwapTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("swap_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the swap composer's help
/// button, shown once right after the tour first finishes so the worker learns where it
/// went without another card to read and dismiss. Non-blocking
/// (`allowsHitTesting(false)`) and auto-fades on a timer driven by the host — the real UI
/// underneath stays fully interactive the moment the tour closes. Mirrors
/// `ShiftTourPointerCallout` exactly.
struct SwapTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `SwapTourHelpAnchorKey`).
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
        .accessibilityIdentifier("swap_tour_pointer")
    }
}

/// Per-device flag: whether the header "?" has already shown its one-time post-tour pointer.
enum SwapTourPointerStore {
    private static let key = "swap_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
