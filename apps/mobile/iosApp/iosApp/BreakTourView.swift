import SwiftUI
import Shared

/// BreakTourView (iOS) — the interactive "Break calendar" onboarding tour, teaching the
/// claim-based break-shift picker (`BreakCalendarView`). It plays out on a sample two-desk
/// grid so the worker SEES the multi-lane layout and a couple of seats already taken
/// (step 1), DOES a real press-and-drag claim across a desk (step 2, mirroring the real
/// screen's `LongPressGesture(0.16).sequenced(before: DragGesture)`), and DOES a real
/// press-and-drag drop over the worker's own hours with a live-updating action bar
/// (step 3).
///
/// The step copy + the sample grid + the summary math live in shared `onboarding/BreakTour`;
/// `BreakTourViewModel` sequences the three steps and owns the done-flag. This file is
/// rendering + gesture + motion + the persisted observable, mirroring `ShiftTourView.swift`
/// structurally (same shape, break-calendar content).

// MARK: - Persisted, observable wrapper

final class BreakTourObservable: ObservableObject {
    let vm: BreakTourViewModel
    @Published var state: BreakTourUiState
    private var task: Task<Void, Never>?
    // Its OWN seen-key store, separate from the shift tour / welcome tour / tips sets, so
    // persisting one never clobbers another (they observe + write independently).
    private static let storageKey = "break_tour_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = BreakTourViewModel(initialSeen: seen)
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
    var isDone: Bool { !BreakTour.shared.shouldAutoShow(seen: state.seen) }

    /// Auto-open on the first Break-calendar landing (a no-op once seen).
    func autoStart() { vm.autoStart() }
    /// Re-open from the header help button or the Settings row.
    func replay() { vm.replay() }
}

// MARK: - The tour overlay

struct BreakTourView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: BreakTourObservable
    /// Fired when the scrim is tapped away on a dismissible step (see `body`'s tap gesture).
    var onDismissOutside: () -> Void = {}

    // Shared drag-selection state for the sample grid (steps 2 and 3 both drive it via the
    // same gesture; step 1 attaches no gesture at all, per "no interaction required").
    // Block indices on the sample grid, [from, to). -1 = no selection.
    @State private var selFrom = -1
    @State private var selTo = -1
    @State private var selLane = 0
    @State private var laneAreaWidth: CGFloat = 0

    // One-shot motion triggers.
    @State private var takenIn = false
    @State private var tabBounce = false

    // Step-2 drag discoverability: a small hand badge wiggles VERTICALLY (the primary
    // gesture is a downward drag through time blocks, not sideways) until the worker's own
    // drag actually registers a claim (from/to actually changing is the real signal a drag
    // happened, not just "step 2 opened"). Hidden for good the moment that happens.
    @State private var showDragHint = false
    @State private var dragHintOffset: CGFloat = 0
    @State private var hasInteractedWithGrid = false

    // Step 3: whether a drop has been "confirmed" (Drop tapped), driving the Open-tab bounce.
    @State private var dropConfirmed = false

    private let blockH: CGFloat = 30
    private let rowPitch: CGFloat = 32
    private let blockCount = Int(BreakTour.shared.SAMPLE_BLOCK_COUNT)
    private let laneCount = Int(BreakTour.shared.LANE_COUNT)

    private var idx: Int { Int(model.state.stepIndex) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Tapping the scrim dismisses the tour only on step 1 (view-only) -- steps 2
            // and 3 both carry a real press-and-drag gesture, and a stray tap mid-drag must
            // not lose the worker's place.
            Color.black.opacity(scheme == .dark ? 0.82 : 0.62)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    guard idx == 1 else { return }
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
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("break_tour")
        }
        .onAppear { syncMotion(to: idx, animate: false) }
        .onChange(of: idx) { newIdx in
            selFrom = -1; selTo = -1; selLane = 0
            syncMotion(to: newIdx, animate: true)
        }
    }

    // MARK: Stage (sample grid + live action bar + mock nav)

    @ViewBuilder
    private func stage(_ c: ShiftColors) -> some View {
        VStack(spacing: 14) {
            deskHeader(c)
            sampleGrid(c)

            if idx == 2 {
                claimSummaryLine(c)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
            if idx == 3 {
                dropActionBar(c)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            mockNav(c)
                .padding(.top, 2)
        }
        .padding(18)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
        .animation(.easeInOut(duration: 0.3), value: idx)
    }

    private func deskHeader(_ c: ShiftColors) -> some View {
        HStack(spacing: 3) {
            ForEach(0 ..< laneCount, id: \.self) { i in
                Text(BreakTour.shared.LANE_LABELS[i])
                    .font(ShiftFont.sans(10.5, .medium)).foregroundColor(c.ter)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }
        }
    }

    /// The sample break grid: two lanes ("Desk 1" / "Desk 2"), six thirty-minute blocks
    /// (08:00 to 11:00), same visual vocabulary (colors, cell shape) as the real
    /// `BreakCalendarView.dayGrid` / `.blockRow` so the lesson transfers directly.
    private func sampleGrid(_ c: ShiftColors) -> some View {
        let lo = selFrom < 0 ? -1 : min(selFrom, selTo)
        let hi = selFrom < 0 ? -1 : max(selFrom, selTo)
        func idxFor(_ y: CGFloat) -> Int { max(0, min(blockCount - 1, Int(y / rowPitch))) }
        func laneFor(_ x: CGFloat) -> Int {
            guard laneAreaWidth > 0 else { return 0 }
            return max(0, min(laneCount - 1, Int(x / (laneAreaWidth / CGFloat(laneCount)))))
        }

        return ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(0 ..< blockCount, id: \.self) { block in
                    let selected = lo >= 0 && block >= lo && block <= hi
                    gridRow(block, selected: selected, selLane: selLane, c)
                }
            }
            .background(GeometryReader { geo in
                Color.clear
                    .onAppear { laneAreaWidth = geo.size.width }
                    .onChange(of: geo.size.width) { laneAreaWidth = $0 }
            })
            .contentShape(Rectangle())
            // A tap selects one 30-min chunk under the finger's desk column, exactly like the
            // real screen. Step 1 is a static orientation shot ("no interaction required"),
            // so both gestures no-op there, mirroring the real screen's readOnly guard.
            .simultaneousGesture(
                SpatialTapGesture()
                    .onEnded { v in
                        guard idx == 2 || idx == 3 else { return }
                        let i = idxFor(v.location.y)
                        selFrom = i
                        selTo = i
                        selLane = laneFor(v.location.x)
                        registerGridInteraction()
                    },
            )
            .gesture(
                LongPressGesture(minimumDuration: 0.16)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        guard idx == 2 || idx == 3 else { return }
                        if case .second(true, let drag?) = value {
                            selFrom = idxFor(drag.startLocation.y)
                            selTo = idxFor(drag.location.y)
                            selLane = laneFor(drag.location.x)
                            registerGridInteraction()
                        }
                    },
            )

            if showDragHint {
                dragHintBadge(c)
            }
        }
        // `.ignore` makes this ZStack itself ONE queryable/draggable AX element instead of a
        // plain layout container whose identifier leaks onto (or becomes ambiguous with) its
        // per-block child cells.
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("break_tour_grid")
    }

    /// A small blue "drag me" badge riding over Desk 1's first block, wiggling UP/DOWN on a
    /// loop (the primary gesture here is a downward drag through time blocks, unlike the
    /// shift tour's horizontal range-slider hint). Hidden for good the moment the worker's
    /// own drag registers (`registerGridInteraction`).
    private func dragHintBadge(_ c: ShiftColors) -> some View {
        // Positioned over Desk 1's block 2 (08:00+2 blocks) — open in step 2's sample, since
        // the "mine" cells at the same coordinates only render on step 3.
        let laneWidth = max(laneAreaWidth, 1) / CGFloat(laneCount)
        return Image(systemName: "hand.draw.fill")
            .font(.system(size: 13, weight: .medium))
            .foregroundColor(.white)
            .padding(7)
            .background(c.blue)
            .clipShape(Circle())
            .shadow(color: .black.opacity(0.25), radius: 4, x: 0, y: 2)
            .position(x: laneWidth * 0.5, y: rowPitch * 2.5 + dragHintOffset)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func gridRow(_ block: Int, selected: Bool, selLane: Int, _ c: ShiftColors) -> some View {
        HStack(spacing: 3) {
            ForEach(0 ..< laneCount, id: \.self) { lane in
                cell(block: block, lane: lane, selected: selected && lane == selLane, c)
            }
        }
        .frame(height: blockH)
        .padding(.vertical, 1)
    }

    @ViewBuilder
    private func cell(block: Int, lane: Int, selected: Bool, _ c: ShiftColors) -> some View {
        let taken = BreakTour.shared.TAKEN_SEATS.first { Int($0.blockIndex) == block && Int($0.lane) == lane }
        // "Mine" (already-claimed-by-you) cells only appear in step 3's demo: steps 1/2 show
        // those same cells as OPEN so the claim gesture has real open seats to drag across.
        let isMine = idx == 3 && lane == Int(BreakTour.shared.MINE_LANE) && BreakTour.shared.MINE_BLOCKS.contains(where: { Int(truncating: $0) == block })
        // Step 3 only: a selected "mine" cell flips to the danger "about to drop" treatment,
        // matching the real action bar recoloring its message text to danger on a pending drop.
        let aboutToDrop = idx == 3 && isMine && selected

        let bg: Color = {
            if aboutToDrop { return c.danger.accent }
            if isMine { return c.breakShift.accent }
            if let _ = taken { return c.surface }
            if selected { return c.breakShift.accent.opacity(0.35) }
            return c.surfaceVar
        }()
        let borderColor: Color = {
            if aboutToDrop { return c.danger.accent }
            if let _ = taken { return c.divider }
            if selected && !isMine { return c.breakShift.accent }
            return Color.clear
        }()
        let label: String? = {
            if aboutToDrop { return "Dropping" }
            if isMine { return "You" }
            if let t = taken { return t.workerName }
            return nil
        }()
        let labelColor: Color = (aboutToDrop || isMine) ? .white : c.sec

        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(bg)
            RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(borderColor, lineWidth: 1)
            if let label {
                Text(label)
                    .font(ShiftFont.sans(11.5, (aboutToDrop || isMine) ? .semibold : .medium))
                    .foregroundColor(labelColor)
                    .padding(.horizontal, 8)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .opacity(takenIn || taken == nil ? 1 : 0)
        .animation(.easeOut(duration: 0.3), value: takenIn)
    }

    /// The real signal a drag happened (not just that step 2 opened): `selFrom`/`selTo` only
    /// ever change via the grid's own gesture, so this is exactly "the worker found it".
    private func registerGridInteraction() {
        guard !hasInteractedWithGrid else { return }
        hasInteractedWithGrid = true
        showDragHint = false
    }

    /// Step-2's live claim summary caption, recomputed by the shared `BreakTour.claimSummary`
    /// as the worker drags (mirrors the real screen's pinned claim bar, kept lightweight here
    /// since step 2's teaching point is the gesture, not the confirm action).
    private func claimSummaryLine(_ c: ShiftColors) -> some View {
        let hasSelection = selFrom >= 0
        let text = hasSelection
            ? BreakTour.shared.claimSummary(fromBlock: Int32(min(selFrom, selTo)), toBlock: Int32(max(selFrom, selTo) + 1), lane: Int32(selLane))
            : "Press and drag down a desk"
        return Text(text)
            .font(ShiftFont.sans(14, .semibold))
            .foregroundColor(c.blue)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("break_tour_claim_summary")
    }

    /// Step-3's pinned action bar: message + Drop button, both driven LIVE off the actual
    /// drag overlap with the worker's claimed blocks (`BreakTour.overlappingMineBlocks`).
    /// Starts neutral with Drop disabled; never a hardcoded always-enabled message.
    private func dropActionBar(_ c: ShiftColors) -> some View {
        let overlap: [Int] = selFrom >= 0
            ? BreakTour.shared.overlappingMineBlocks(
                fromBlock: Int32(min(selFrom, selTo)),
                toBlock: Int32(max(selFrom, selTo) + 1),
                lane: Int32(selLane),
              ).map { Int(truncating: $0) }
            : []
        let hasDrop = !overlap.isEmpty
        let message = hasDrop
            ? BreakTour.shared.dropSummary(fromBlock: Int32(overlap.min()!), toBlock: Int32(overlap.max()! + 1))
            : BreakTour.shared.dropSummary(fromBlock: -1, toBlock: -1)

        return HStack(spacing: 10) {
            Text(message)
                .font(ShiftFont.sans(13, hasDrop ? .medium : .regular))
                .foregroundColor(hasDrop ? c.danger.accent : c.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("break_tour_drop_message")
            ShiftButton(title: "Drop", action: {
                dropConfirmed = true
                withAnimation(.spring(response: 0.45, dampingFraction: 0.5)) { tabBounce = true }
                selFrom = -1; selTo = -1
            }, variant: .destructive, size: .sm)
                .disabled(!hasDrop)
                .opacity(hasDrop ? 1 : 0.4)
                .accessibilityIdentifier("break_tour_drop_button")
        }
        .padding(12)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        // A non-wrapping marker, not the container itself: break_tour_drop_message and
        // break_tour_drop_button must stay individually queryable.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("break_tour_action_bar")
        }
    }

    /// A representative bottom-nav strip. The Open item bounces (amber) once a step-3 drop
    /// is confirmed, showing where unclaimed hours land ("motion as consequence").
    private func mockNav(_ c: ShiftColors) -> some View {
        HStack(spacing: 0) {
            navItem("My Shifts", ShiftIcons.list, tint: c.ter, bounce: false, c)
            navItem("Open", ShiftIcons.plus, tint: dropConfirmed ? c.pending : c.ter, bounce: dropConfirmed, c)
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

    /// Step 3 gets colored emphasis on "Open" (pending/amber); other steps render the shared
    /// body verbatim. The words match `BreakTour.STEPS`.
    @ViewBuilder
    private func bodyText(_ step: BreakTourStep, _ c: ShiftColors) -> some View {
        if step.id == .drop {
            (
                Text("Drag over hours you claimed to drop them. Anything left unclaimed moves to ").foregroundColor(c.sec)
                    + Text("Open").foregroundColor(c.pending).fontWeight(.bold)
                    + Text(" shifts.").foregroundColor(c.sec)
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
                .accessibilityIdentifier("break_tour_skip")
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
                        .accessibilityIdentifier("break_tour_back")
                }
                Button(model.state.isLastStep ? "Done" : "Next") { model.vm.next() }
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(c.blue).clipShape(Capsule())
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("break_tour_next")
            }
        }
    }

    // MARK: Motion

    /// Recompute the one-shot motion triggers for the given step. `animate: false` on first
    /// appear so the initial state doesn't visibly jump.
    private func syncMotion(to step: Int, animate: Bool) {
        // The taken seats fade in on step 1.
        takenIn = step >= 1
        dropConfirmed = false
        tabBounce = false
        // The drag hint only ever shows on step 2, and only until the worker has actually
        // dragged once (hasInteractedWithGrid, set by registerGridInteraction). Stepping away
        // always stops the loop cleanly (no animation) so it never wiggles off-step.
        if step == 2, !hasInteractedWithGrid {
            showDragHint = true
            dragHintOffset = 0
            withAnimation(Animation.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dragHintOffset = 10
            }
        } else {
            showDragHint = false
            dragHintOffset = 0
        }
    }
}

// MARK: - Header help button (re-entry)

/// Collects the on-screen frame of the Break-calendar help button, the same anchor-preference
/// idiom as `ShiftTourHelpAnchorKey`, so the one-time pointer callout below can find it
/// without either view needing to know the other's layout.
struct BreakTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the Break-calendar header that replays the tour.
struct BreakTourHelpButton: View {
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
        .anchorPreference(key: BreakTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("break_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the Break-calendar help
/// button, shown once right after the tour first finishes so the worker learns where it went
/// without another card to read and dismiss. Non-blocking (`allowsHitTesting(false)`) and
/// auto-fades on a timer driven by the host, mirroring `ShiftTourPointerCallout`.
struct BreakTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `BreakTourHelpAnchorKey`).
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
        .accessibilityIdentifier("break_tour_pointer")
    }
}

/// Per-device flag: whether the header "?" has already shown its one-time post-tour pointer.
enum BreakTourPointerStore {
    private static let key = "break_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
