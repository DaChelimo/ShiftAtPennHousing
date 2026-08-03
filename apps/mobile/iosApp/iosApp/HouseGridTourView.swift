import SwiftUI
import Shared

/// HouseGridTourView (iOS) — the interactive "House grid" onboarding tour, the richer
/// successor to the plain `tip.house_grid` contextual card ("Call the desk. Tap any name
/// in the grid to call that person or the desk. Use the house name at the top to view
/// another house."). It plays out on a faithful mini version of the real House grid
/// (`ContentView.swift` `houseTab` / `houseGrid`) so the worker SEES the frozen-rail /
/// scrolling-columns layout, the tap-a-name affordance, the house + week switchers, and
/// what a blank block means.
///
/// The step copy lives in shared `onboarding/HouseGridTour`; `HouseGridTourViewModel`
/// sequences the three steps and owns the done-flag. This file is rendering + motion +
/// the persisted observable, mirroring `ShiftTourView.swift`'s shape exactly.

// MARK: - Persisted, observable wrapper

final class HouseGridTourObservable: ObservableObject {
    let vm: HouseGridTourViewModel
    @Published var state: HouseGridTourUiState
    private var task: Task<Void, Never>?
    // Its OWN seen-key store, separate from every other tour's set, so
    // persisting one never clobbers another (they observe + write independently).
    private static let storageKey = "housegrid_tour_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = HouseGridTourViewModel(initialSeen: seen)
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
    var isDone: Bool { !HouseGridTour.shared.shouldAutoShow(seen: state.seen) }

    /// Auto-open on the first House-tab landing (a no-op once seen).
    func autoStart() { vm.autoStart() }
    /// Re-open from the header help button or the Settings row.
    func replay() { vm.replay() }
}

// MARK: - The tour overlay

struct HouseGridTourView: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: HouseGridTourObservable
    /// Fired when the scrim is tapped away (see `body`'s tap gesture).
    var onDismissOutside: () -> Void = {}

    // Step 2 sample controls (reset every time the tour opens, since this view is only
    // mounted while active): the sample house switcher + week nav, both live-tappable
    // (standard controls, so no discoverability hint per principle 4).
    private static let stageHouses = ["Harnwell", "Gutmann"]
    private static let stageWeeks = ["Last week", "This week", "Next week"]
    @State private var stageHouseIndex = 0
    @State private var stageWeekIndex = 1

    // One-shot motion triggers.
    @State private var railPulse = false
    @State private var namePulse = false
    @State private var tabBounce = false
    @State private var emptyCellPulse = false

    private var idx: Int { Int(model.state.stepIndex) }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // None of this tour's three steps carry a drag gesture, so the scrim can
            // always dismiss the tour.
            Color.black.opacity(scheme == .dark ? 0.82 : 0.62)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
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
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("housegrid_tour")
        }
        .onAppear { syncMotion(to: idx, animate: false) }
        .onChange(of: idx) { newIdx in syncMotion(to: newIdx, animate: true) }
    }

    // MARK: Stage (sample House grid + house/week switchers + mock nav)

    @ViewBuilder
    private func stage(_ c: ShiftColors) -> some View {
        VStack(spacing: 14) {
            if idx == 2 {
                stageHouseHeader(c)
            }
            sampleGrid(c)
            if idx == 2 {
                stageWeekNav(c)
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

    /// The sample house-switcher header card (step 2 only): the house name, tappable, with
    /// a chevron, mirroring `houseHeaderCard`'s dropdown affordance. Tapping cycles the
    /// sample house so the worker sees it respond, same as the real switcher sheet would.
    private func stageHouseHeader(_ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            Text(String(Self.stageHouses[stageHouseIndex].prefix(1)))
                .font(ShiftFont.sans(15, .bold)).foregroundColor(c.blue)
                .frame(width: 32, height: 32)
                .background(c.blueContainer)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            Text(Self.stageHouses[stageHouseIndex])
                .font(ShiftFont.sans(14.5, .semibold)).foregroundColor(c.ink)
            Spacer(minLength: 0)
            Image(systemName: ShiftIcons.chevronRight)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(c.ter)
                .rotationEffect(.degrees(90))
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(c.bg)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.2)) {
                stageHouseIndex = (stageHouseIndex + 1) % Self.stageHouses.count
            }
        }
        // `.ignore` makes this HStack itself ONE queryable/tappable AX element instead of a
        // plain layout container whose identifier leaks onto its child Text/Image.
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("housegrid_tour_stage_house_switcher")
    }

    /// The sample bottom week-nav bar (step 2 only): prev / next chevrons + a week label,
    /// mirroring the real `houseWeekNavBar`. Both chevrons are live-tappable in the sample.
    private func stageWeekNav(_ c: ShiftColors) -> some View {
        HStack(spacing: 0) {
            Button(action: {
                withAnimation(.easeInOut(duration: 0.2)) {
                    stageWeekIndex = max(stageWeekIndex - 1, 0)
                }
            }) {
                Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold))
                    .foregroundColor(c.sec).frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("housegrid_tour_stage_prev_week")

            HStack(spacing: 6) {
                Image(systemName: ShiftIcons.calendar).font(.system(size: 15)).foregroundColor(c.blue)
                Text(Self.stageWeeks[stageWeekIndex]).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
            }
            .frame(maxWidth: .infinity)

            Button(action: {
                withAnimation(.easeInOut(duration: 0.2)) {
                    stageWeekIndex = min(stageWeekIndex + 1, Self.stageWeeks.count - 1)
                }
            }) {
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .semibold))
                    .foregroundColor(c.sec).frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("housegrid_tour_stage_next_week")
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }

    /// A faithful mini House grid: a frozen time rail on the left, a frozen day-header row,
    /// and 3 day columns of desk cells, some occupied (a name) and one blank (vacant). The
    /// step-1 pulses draw the eye to the rail staying anchored and to the tap-a-name verb;
    /// the step-3 pulse marks the empty seat.
    private func sampleGrid(_ c: ShiftColors) -> some View {
        let dayLabels = HouseGridTour.shared.SAMPLE_DAYS
        return VStack(alignment: .leading, spacing: 8) {
            Text(HouseGridTour.shared.SAMPLE_HOUSE)
                .font(ShiftFont.sans(12, .semibold)).foregroundColor(c.ter)
            HStack(alignment: .top, spacing: 0) {
                stageTimeRail(c)
                HStack(spacing: 6) {
                    stageDayColumn(dayLabels[0], hasWorker: true, c)
                    stageDayColumn(dayLabels[1], hasWorker: false, c)
                    stageDayColumn(dayLabels[2], hasWorker: true, c)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func stageTimeRail(_ c: ShiftColors) -> some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text("Time").font(ShiftFont.mono(9)).foregroundColor(.clear)
            ForEach(["12:00", "14:00", "16:00"], id: \.self) { label in
                Text(label)
                    .font(ShiftFont.mono(10)).monospacedDigit().foregroundColor(c.ter)
                    .frame(height: 30, alignment: .top)
            }
        }
        .frame(width: 38)
        .padding(.trailing, 6)
        .padding(4)
        .background(railPulse ? c.blueContainer.opacity(0.6) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .animation(.easeInOut(duration: 0.5), value: railPulse)
        // `.ignore` makes this VStack itself ONE queryable AX element instead of a plain
        // layout container whose identifier leaks onto its child time labels.
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("housegrid_tour_stage_rail")
    }

    private func stageDayColumn(_ dayLabel: String, hasWorker: Bool, _ c: ShiftColors) -> some View {
        VStack(spacing: 4) {
            Text(dayLabel).font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ter)
            VStack(spacing: 4) {
                if hasWorker {
                    stageNameCell(c)
                    stageBlankCell(c, pulse: false)
                } else {
                    stageBlankCell(c, pulse: idx == 3)
                    stageNameCellShort(c)
                }
            }
        }
        .frame(width: 74)
    }

    /// A staffed desk cell showing the sample worker's name (step 1's pulsed cell).
    private func stageNameCell(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("12:00").font(ShiftFont.mono(9)).monospacedDigit().foregroundColor(c.sec)
            Text(HouseGridTour.shared.SAMPLE_WORKER_NAME)
                .font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ink).lineLimit(1)
        }
        .padding(6)
        .frame(width: 74, height: 38, alignment: .topLeading)
        .background(c.blueContainer.opacity(0.5))
        .overlay(alignment: .leading) { Rectangle().fill(c.blue).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            Circle()
                .stroke(c.blue.opacity(0.9), lineWidth: 2)
                .scaleEffect(namePulse ? 1.6 : 0.6)
                .opacity(namePulse ? 0 : 0.9)
        )
        // `.ignore` makes this VStack itself ONE queryable AX element instead of a plain
        // layout container whose identifier leaks onto its child time/name labels.
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("housegrid_tour_stage_name_cell")
    }

    private func stageNameCellShort(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("14:00").font(ShiftFont.mono(9)).monospacedDigit().foregroundColor(c.sec)
            Text("Marcus T.").font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ink).lineLimit(1)
        }
        .padding(6)
        .frame(width: 74, height: 38, alignment: .topLeading)
        .background(c.surfaceVar)
        .overlay(alignment: .leading) { Rectangle().fill(c.outline).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    /// A vacant desk cell: dashed outline, no name, matching the real grid's vacant style.
    /// Pulses in step 3 to draw the eye to "this is what an empty seat looks like".
    private func stageBlankCell(_ c: ShiftColors, pulse: Bool) -> some View {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
            .strokeBorder(pulse ? c.pending : c.outline, style: StrokeStyle(lineWidth: pulse ? 2 : 1.5, dash: [6, 4]))
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(c.surface))
            .frame(width: 74, height: 38)
            .scaleEffect(pulse && emptyCellPulse ? 1.05 : 1.0)
            .animation(.easeInOut(duration: 0.6).repeatCount(2, autoreverses: true), value: emptyCellPulse)
            .accessibilityIdentifier("housegrid_tour_stage_blank_cell")
    }

    /// A representative bottom-nav strip matching the real tab bar (My Shifts / Open /
    /// House / Swaps / More). House stays visually current (this is the House tab's tour);
    /// the Open item bounces (amber) in step 3 to show where a vacant seat gets claimed.
    private func mockNav(_ c: ShiftColors) -> some View {
        HStack(spacing: 0) {
            navItem("My Shifts", ShiftIcons.calendar, tint: c.ter, bounce: false, c)
            navItem("Open", ShiftIcons.plus, tint: idx == 3 ? c.pending : c.ter, bounce: idx == 3, c)
            navItem("House", ShiftIcons.building, tint: c.blue, bounce: false, c)
            navItem("Swaps", ShiftIcons.refresh, tint: c.ter, bounce: false, c)
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

    /// Step 3 gets colored emphasis on "Open" (pending/amber); other steps render the
    /// shared body verbatim. The words match `HouseGridTour.STEPS`.
    @ViewBuilder
    private func bodyText(_ step: HouseGridTourStep, _ c: ShiftColors) -> some View {
        if step.id == .emptySeat {
            (
                Text("A blank block means nobody is covering it yet. Check ").foregroundColor(c.sec)
                    + Text("Open").foregroundColor(c.pending).fontWeight(.bold)
                    + Text(" shifts to pick it up.").foregroundColor(c.sec)
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
                .accessibilityIdentifier("housegrid_tour_skip")
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
                        .accessibilityIdentifier("housegrid_tour_back")
                }
                Button(model.state.isLastStep ? "Done" : "Next") { model.vm.next() }
                    .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(c.blue).clipShape(Capsule())
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("housegrid_tour_next")
            }
        }
    }

    // MARK: Motion

    /// Recompute the one-shot motion triggers for the given step. `animate: false` on first
    /// appear so the initial state doesn't visibly jump.
    private func syncMotion(to step: Int, animate: Bool) {
        // Step 1: a brief one-shot pulse on the frozen rail (it stays anchored while the
        // columns scroll), plus a one-shot pulse ring on the sample name cell (the tap
        // verb). Neither is a persistent nag; both fire once and settle.
        if step == 1 {
            railPulse = false
            namePulse = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                railPulse = true
                namePulse = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) {
                railPulse = false
            }
        } else {
            railPulse = false
            namePulse = false
        }

        // Step 3: the vacant cell gets a brief scale pulse, and the Open tab bounces once
        // to show where the worker would go to claim it.
        if step == 3 {
            tabBounce = false
            emptyCellPulse = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                tabBounce = true
                emptyCellPulse = true
            }
        } else {
            tabBounce = false
            emptyCellPulse = false
        }
    }
}

// MARK: - Header help button (re-entry)

/// Collects the on-screen frame of the House-tab help button, the same anchor-preference
/// idiom as `ShiftTourHelpAnchorKey`, so the one-time pointer callout below can find it
/// without either view needing to know the other's layout.
struct HouseGridTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the House-tab header that replays the tour.
struct HouseGridTourHelpButton: View {
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
        .anchorPreference(key: HouseGridTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("housegrid_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the House-tab help button,
/// shown once right after the tour first finishes so the worker learns where it went
/// without another card to read and dismiss. Non-blocking (`allowsHitTesting(false)`) and
/// auto-fades on a timer driven by the host, mirroring `ShiftTourPointerCallout`.
struct HouseGridTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `HouseGridTourHelpAnchorKey`).
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
        .accessibilityIdentifier("housegrid_tour_pointer")
    }
}

/// Per-device flag: whether the House-tab header "?" has already shown its one-time
/// post-tour pointer.
enum HouseGridTourPointerStore {
    private static let key = "housegrid_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
