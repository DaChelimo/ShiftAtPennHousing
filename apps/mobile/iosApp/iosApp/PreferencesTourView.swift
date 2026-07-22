import SwiftUI
import Shared
import UIKit

/// PreferencesTourView (iOS) — the interactive Preferences (availability paint) onboarding
/// tour, the richer successor to a plain contextual tip. It plays out on a sample day timeline
/// so the worker PICKS a brush (step 1, the real live brush selector), DOES the press-and-drag
/// paint themselves (step 2, a faithful re-creation of the real split-gesture paint canvas), and
/// SETS a sample target (step 3, the real live target-hours stepper + no-hours toggle).
///
/// The step copy + the step-2/step-3 formatting math live in shared `onboarding/PreferencesTour`;
/// the `PreferencesTourViewModel` sequences the three steps and owns the done-flag. This file is
/// rendering + motion + the persisted observable, mirroring `ShiftTourView.swift` exactly in
/// shape (see docs/design/interactive-onboarding-pattern.md).

// MARK: - Persisted, observable wrapper

final class PreferencesTourObservable: ObservableObject {
    let vm: PreferencesTourViewModel
    @Published var state: PreferencesTourUiState
    private var task: Task<Void, Never>?
    // Its OWN seen-key store, separate from `ShiftTourObservable` and every other tour's set,
    // so persisting one never clobbers another (they observe + write independently).
    private static let storageKey = "preferences_tour_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = PreferencesTourViewModel(initialSeen: seen)
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
    var isDone: Bool { !PreferencesTour.shared.shouldAutoShow(seen: state.seen) }

    /// Auto-open on the first Preferences landing (a no-op once seen).
    func autoStart() { vm.autoStart() }
    /// Re-open from the header help button or the Settings row.
    func replay() { vm.replay() }
}

// MARK: - The tour overlay

struct PreferencesTourView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: PreferencesTourObservable
    /// Fired when the scrim is tapped away on a dismissible step (see `body`'s tap gesture).
    var onDismissOutside: () -> Void = {}

    // Step 1's live brush pick, carried into step 2's sample paint (mirrors
    // PreferencesTour.DEFAULT_BRUSH -> .preferred).
    @State private var selectedBrush: TourBrush = .preferred

    // Step 2's sample paint state: block index -> the brush painted there. An unpainted block
    // reads as "available" (no fill), matching the real screen's default.
    @State private var paintedBlocks: [Int: TourBrush] = [:]
    @State private var liveDragSpan: ClosedRange<Int>?

    // Step 3's sample target-hours state.
    @State private var targetHours = Int(PreferencesTour.shared.SAMPLE_TARGET_HOURS)
    @State private var optedOut = false

    // Step-2 drag discoverability: a small hand badge wiggles VERTICALLY (the real gesture is a
    // vertical drag down the timeline, not a horizontal one) until the worker actually drags
    // something (a painted block appearing is the real signal a drag happened, not just "step 2
    // opened"). Hidden for good the moment that happens, so it never lingers on someone who
    // already found it.
    @State private var showDragHint = false
    @State private var dragHintOffset: CGFloat = 0
    @State private var hasInteractedWithPaint = false

    private let blockCount = 8
    private let blockHeight: CGFloat = 30
    private let gutterWidth: CGFloat = 54

    private var idx: Int { Int(model.state.stepIndex) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Tapping the scrim dismisses the tour, except on step 2 (the press-and-drag
            // paint canvas), where a stray tap mid-drag must not lose the worker's place.
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
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("preferences_tour")
        }
        .onAppear { syncMotion(to: idx) }
        .onChange(of: idx) { newIdx in syncMotion(to: newIdx) }
    }

    // MARK: Stage (sample controls per step)

    @ViewBuilder
    private func stage(_ c: ShiftColors) -> some View {
        VStack(spacing: 16) {
            if idx == 1 {
                brushStage(c)
            } else if idx == 2 {
                paintStage(c)
            } else if idx == 3 {
                targetStage(c)
            }
        }
        .padding(18)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
        .frame(maxWidth: .infinity)
        .animation(.easeInOut(duration: 0.3), value: idx)
    }

    // MARK: Step 1 — the real brush selector, live and tappable

    /// Tapping a brush is standard tap interaction (principle 4: no discoverability hint
    /// needed for a control that already reads as tappable, same as the real screen's chips).
    private func brushStage(_ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            ForEach(TourBrush.allCases, id: \.self) { brush in
                let style = tourBrushStyle(brush, c)
                let on = selectedBrush == brush
                Button(action: { selectedBrush = brush }) {
                    VStack(spacing: 4) {
                        Image(systemName: style.icon).font(.system(size: 19, weight: .semibold)).foregroundColor(on ? style.fg : c.ter)
                        Text(brush.label).font(ShiftFont.sans(13.5, .semibold)).foregroundColor(on ? style.fg : c.sec)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9).padding(.horizontal, 4)
                    .background(on ? style.bg : c.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(on ? style.accent : c.divider, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(brush.tag)
            }
        }
    }

    // MARK: Step 2 — the real press-and-drag paint canvas, sample-scale

    private func paintStage(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 0) {
                paintGutter(c)
                GeometryReader { geo in
                    ZStack(alignment: .topLeading) {
                        paintTimeline(c)
                        if showDragHint {
                            dragHintBadge(trackHeight: geo.size.height, c)
                        }
                    }
                }
                .frame(height: blockHeight * CGFloat(blockCount))
            }
            Text(PreferencesTour.shared.paintSummaryLine(
                paintedCount: Int32(paintedBlocks.count),
                fromBlock: Int32(liveOrLastFrom()),
                toBlock: Int32(liveOrLastTo())
            ))
            .font(ShiftFont.sans(14, .semibold))
            .foregroundColor(c.blue)
            .accessibilityIdentifier("preferences_tour_paint_summary")
        }
    }

    /// The left time gutter, matching the real screen: the scroll handle, never a paint target.
    /// Hour boundaries land at even block indices (blocks are 30 minutes; the sample starts on
    /// the hour), so a label shows every 2 blocks.
    private func paintGutter(_ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            ForEach(0...blockCount, id: \.self) { boundary in
                if boundary % 2 == 0 {
                    Text(PreferencesTour.shared.timeLabel(blockIndex: Int32(boundary)))
                        .font(ShiftFont.mono(10.5, .semibold))
                        .monospacedDigit()
                        .foregroundColor(c.sec)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if boundary < blockCount {
                    Spacer(minLength: 0).frame(height: blockHeight - 12)
                }
            }
        }
        .frame(width: gutterWidth, height: blockHeight * CGFloat(blockCount), alignment: .top)
        .padding(.trailing, 8)
    }

    /// The pure paint canvas: bare colored 30-min segments, a live drag-span outline, and the
    /// real touchesBegan/Moved/Ended handling (never a SwiftUI gesture, so it can't be pre-empted
    /// the way a DragGesture nested in a ScrollView can be) so pressing and dragging paints
    /// immediately, mirroring `PaintSurface` in `PreferencesView.swift`.
    private func paintTimeline(_ c: ShiftColors) -> some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(0..<blockCount, id: \.self) { i in
                    let brush = paintedBlocks[i]
                    let style = brush.map { tourBrushStyle($0, c) }
                    Rectangle()
                        .fill(style?.bg ?? Color.clear)
                        .frame(height: blockHeight)
                        .overlay(alignment: .top) { Rectangle().fill(c.divider.opacity(i % 2 == 0 ? 1 : 0.4)).frame(height: 1) }
                        .overlay(alignment: .leading) { Rectangle().fill(c.divider).frame(width: 1) }
                        .accessibilityIdentifier("preferences_tour_paint_cell")
                }
            }
            if let span = liveDragSpan {
                let erasing = paintedBlocks[span.lowerBound] == selectedBrush
                let hl = erasing ? c.danger.accent : tourBrushStyle(selectedBrush, c).accent
                RoundedRectangle(cornerRadius: 5)
                    .fill(hl.opacity(0.16))
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(hl, lineWidth: 2))
                    .frame(maxWidth: .infinity)
                    .frame(height: blockHeight * CGFloat(span.count))
                    .offset(y: blockHeight * CGFloat(span.lowerBound))
            }
        }
        .frame(maxWidth: .infinity, minHeight: blockHeight * CGFloat(blockCount), maxHeight: blockHeight * CGFloat(blockCount), alignment: .topLeading)
        .contentShape(Rectangle())
        // `.ignore` makes this ZStack itself ONE queryable/draggable AX element instead of a
        // plain layout container whose identifier leaks onto (and becomes ambiguous with) its
        // per-block child cells — confirmed empirically (XCUITest found 8 elements all
        // reporting this identifier, one per block, instead of one for the grid).
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("preferences_tour_paint_grid")
        .overlay(
            PreferencesTourPaintSurface(
                blockCount: blockCount,
                blockHeight: blockHeight,
                onBegin: { i in beginPaint(at: i) },
                onChange: { start, cur in updatePaint(from: start, to: cur) },
                onEnd: { endPaint() }
            )
        )
    }

    private func beginPaint(at index: Int) {
        let erase = paintedBlocks[index] == selectedBrush
        liveDragSpan = index...index
        applyPaint(span: index...index, erase: erase)
    }

    private func updatePaint(from start: Int, to current: Int) {
        let span = min(start, current)...max(start, current)
        let erase = paintedBlocks[start] == selectedBrush
        liveDragSpan = span
        applyPaint(span: span, erase: erase)
    }

    private func endPaint() {
        liveDragSpan = nil
    }

    /// Paints (or, when [erase] and the block already carries the selected brush, clears) every
    /// block in [span]. Registers the first real interaction so the drag hint retires for good.
    private func applyPaint(span: ClosedRange<Int>, erase: Bool) {
        for i in span where i >= 0 && i < blockCount {
            if erase {
                paintedBlocks.removeValue(forKey: i)
            } else {
                paintedBlocks[i] = selectedBrush
            }
        }
        registerPaintInteraction()
    }

    /// The real signal a drag happened (not just that step 2 opened): only the worker's own
    /// touch ever calls this. Hides the hint permanently, so it never lingers once found.
    private func registerPaintInteraction() {
        guard !hasInteractedWithPaint else { return }
        hasInteractedWithPaint = true
        showDragHint = false
    }

    /// The live span while dragging, or the most recent painted span once released (so the
    /// summary line does not flash back to "No hours painted yet" between drags).
    private func liveOrLastFrom() -> Int {
        if let span = liveDragSpan { return span.lowerBound }
        return paintedBlocks.keys.min() ?? 0
    }

    private func liveOrLastTo() -> Int {
        if let span = liveDragSpan { return span.upperBound + 1 }
        guard let maxKey = paintedBlocks.keys.max() else { return 0 }
        return maxKey + 1
    }

    /// A small badge riding the left edge of the timeline, wiggling UP/DOWN on a loop (the real
    /// gesture is a vertical drag down the timeline, never a horizontal one).
    private func dragHintBadge(trackHeight: CGFloat, _ c: ShiftColors) -> some View {
        Image(systemName: "hand.draw.fill")
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.white)
            .padding(7)
            .background(c.blue)
            .clipShape(Circle())
            .shadow(color: .black.opacity(0.25), radius: 4, x: 0, y: 2)
            .position(x: 24, y: trackHeight / 2 + dragHintOffset)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: Step 3 — the real target-hours stepper + no-hours toggle, live and tappable

    private func targetStage(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Target weekly hours").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Text("Soft cap \(Int(PreferencesTour.shared.SAMPLE_CAP_HOURS))h this period").font(ShiftFont.sans(12)).foregroundColor(c.ter)
                }
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    targetStepButton(ShiftIcons.minus, enabled: !optedOut, c) {
                        targetHours = Int(PreferencesTour.shared.clampTarget(
                            value: Int32(targetHours - Int(PreferencesTour.shared.TARGET_STEP)),
                            capHours: PreferencesTour.shared.SAMPLE_CAP_HOURS
                        ))
                    }
                    Text(PreferencesTour.shared.targetLabel(hours: Int32(optedOut ? 0 : targetHours)))
                        .font(ShiftType.monoTimeHero).monospacedDigit().foregroundColor(c.ink)
                        .frame(width: 52)
                        .accessibilityIdentifier("preferences_tour_target_value")
                    targetStepButton(ShiftIcons.plus, enabled: !optedOut, c) {
                        targetHours = Int(PreferencesTour.shared.clampTarget(
                            value: Int32(targetHours + Int(PreferencesTour.shared.TARGET_STEP)),
                            capHours: PreferencesTour.shared.SAMPLE_CAP_HOURS
                        ))
                    }
                }
                .opacity(optedOut ? 0.35 : 1)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(c.surfaceVar)
                    Capsule().fill(c.blue).frame(
                        width: geo.size.width * CGFloat(
                            PreferencesTour.shared.targetFraction(
                                hours: Int32(optedOut ? 0 : targetHours),
                                capHours: PreferencesTour.shared.SAMPLE_CAP_HOURS
                            )
                        )
                    )
                }
            }
            .frame(height: 6)
            Button(action: { optedOut.toggle() }) {
                HStack(spacing: 9) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(optedOut ? c.blue : Color.clear)
                            .frame(width: 22, height: 22)
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .strokeBorder(optedOut ? c.blue : c.outline, lineWidth: 1.5)
                            .frame(width: 22, height: 22)
                        if optedOut {
                            Image(systemName: ShiftIcons.check).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                        }
                    }
                    Text("I have no hours this week").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("preferences_tour_no_hours_toggle")
        }
    }

    private func targetStepButton(_ icon: String, enabled: Bool, _ c: ShiftColors, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundColor(c.ink)
                .frame(width: 36, height: 36)
                .background(c.surface)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(c.divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(icon == ShiftIcons.plus ? "preferences_tour_target_increment" : "preferences_tour_target_decrement")
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
                .accessibilityIdentifier("preferences_tour_skip")
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
                        .accessibilityIdentifier("preferences_tour_back")
                }
                Button(model.state.isLastStep ? "Done" : "Next") { model.vm.next() }
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(c.blue).clipShape(Capsule())
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("preferences_tour_next")
            }
        }
    }

    // MARK: Motion

    /// The drag hint only ever shows on step 2, and only until the worker has actually dragged
    /// once (`hasInteractedWithPaint`). Stepping away always stops the loop cleanly (no
    /// animation) so it never wiggles off-step.
    private func syncMotion(to step: Int) {
        if step == 2, !hasInteractedWithPaint {
            showDragHint = true
            dragHintOffset = 0
            withAnimation(Animation.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dragHintOffset = 22
            }
        } else {
            showDragHint = false
            dragHintOffset = 0
        }
    }
}

// MARK: - Tour-local brush (styling only; teaching concept mirrors shared `PreferencesTourBrush`)

/// A Swift-side mirror of the shared `PreferencesTourBrush` used purely for styling/tagging on
/// this stage; kept 1:1 with the Kotlin enum's order and cases.
enum TourBrush: CaseIterable {
    case available
    case preferred
    case cannot

    var label: String {
        switch self {
        case .available: return "Available"
        case .preferred: return "Preferred"
        case .cannot: return "Cannot"
        }
    }

    var tag: String {
        switch self {
        case .available: return "preferences_tour_brush_available"
        case .preferred: return "preferences_tour_brush_preferred"
        case .cannot: return "preferences_tour_brush_cannot"
        }
    }
}

/// Brush styling, matching `brushStyle` in `PreferencesView.swift` exactly (color + icon + text,
/// never color alone) so the tour never lies about the real screen's information architecture.
private func tourBrushStyle(_ brush: TourBrush, _ c: ShiftColors) -> (bg: Color, fg: Color, accent: Color, icon: String) {
    switch brush {
    case .available: return (c.surfaceVar, c.sec, c.sec, ShiftIcons.check)
    case .preferred: return (c.blueContainer, c.onBlueContainer, c.pickupDot, ShiftIcons.heart)
    case .cannot: return (c.danger.tint, c.danger.accent, c.danger.accent, ShiftIcons.ban)
    }
}

// MARK: - Sample paint canvas (raw UIKit touches, mirrors the real `PaintSurface`)

/// A transparent overlay that turns the sample timeline into a pure paint canvas: pressing then
/// dragging paints a contiguous range immediately, and a plain touch toggles one block. This is
/// a scaled-down, self-contained mirror of `PaintSurface`/`PaintView` in `PreferencesView.swift`
/// (driven by touchesBegan/Moved/Ended, not a gesture recognizer, so it behaves identically to
/// the real screen's canvas even though the tour has no enclosing ScrollView to fight with).
private struct PreferencesTourPaintSurface: UIViewRepresentable {
    let blockCount: Int
    let blockHeight: CGFloat
    let onBegin: (Int) -> Void
    let onChange: (Int, Int) -> Void
    let onEnd: () -> Void

    func makeUIView(context: Context) -> PaintView {
        let v = PaintView()
        v.backgroundColor = .clear
        v.apply(self)
        return v
    }

    func updateUIView(_ uiView: PaintView, context: Context) {
        uiView.apply(self)
    }

    final class PaintView: UIView {
        private var blockCount = 0
        private var blockHeight: CGFloat = 1
        private var onBegin: ((Int) -> Void)?
        private var onChange: ((Int, Int) -> Void)?
        private var onEnd: (() -> Void)?
        private var startIdx = 0

        func apply(_ surface: PreferencesTourPaintSurface) {
            blockCount = surface.blockCount
            blockHeight = surface.blockHeight
            onBegin = surface.onBegin
            onChange = surface.onChange
            onEnd = surface.onEnd
        }

        private func index(_ p: CGPoint) -> Int {
            let i = Int((p.y / blockHeight).rounded(.down))
            return min(max(i, 0), max(blockCount - 1, 0))
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard blockCount > 0, let t = touches.first else { return }
            startIdx = index(t.location(in: self))
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onBegin?(startIdx)
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard blockCount > 0, let t = touches.first else { return }
            onChange?(startIdx, index(t.location(in: self)))
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { onEnd?() }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { onEnd?() }
    }
}

// MARK: - Header help button (re-entry)

/// Collects the on-screen frame of the Preferences help button, the same anchor-preference
/// idiom as `ShiftTourHelpAnchorKey`, so the one-time pointer callout below can find it without
/// either view needing to know the other's layout.
struct PreferencesTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the Preferences header that replays the tour.
struct PreferencesTourHelpButton: View {
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
        .anchorPreference(key: PreferencesTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("preferences_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the Preferences help button,
/// shown once right after the tour first finishes so the worker learns where it went without
/// another card to read and dismiss. Non-blocking (`allowsHitTesting(false)`) and auto-fades on
/// a timer driven by the host, mirroring `ShiftTourPointerCallout` exactly.
struct PreferencesTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `PreferencesTourHelpAnchorKey`).
    let targetRect: CGRect
    /// The overlay's full size, same coordinate space as [targetRect].
    let fullSize: CGSize

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let bubbleWidth: CGFloat = 200
        // The arrow always points at the button's true center; the bubble clamps inside the
        // screen and the arrow nudges toward it independently, so a button near the edge never
        // pushes the bubble off-screen.
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
        .accessibilityIdentifier("preferences_tour_pointer")
    }
}

/// Per-device flag: whether the header "?" has already shown its one-time post-tour pointer.
/// Its own UserDefaults key, separate from `ShiftTourPointerStore`.
enum PreferencesTourPointerStore {
    private static let key = "preferences_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
