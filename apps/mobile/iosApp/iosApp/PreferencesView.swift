import SwiftUI
import Shared

/// Preference submission (the tri-state paint grid + target weekly hours) in SwiftUI,
/// over the shared `PreferencesViewModel` (observed — its brush/grid/target mutate).
/// Rebuilds worker-app.html `PreferenceScreen` with the kit: context eyebrow, deadline
/// banner, Mon–Sun strip, target stepper card, the Available/Preferred/Cannot brush
/// selector, the 2-column block grid (tap to paint), and the submit button. Read-only
/// once submitted. Selector `accessibilityIdentifier`s match the Maestro contract.

/// Observes the preference `StateFlow` (selectDay/paint/setBrush/… mutate state).
///
/// Demo by default. The backend-configured host calls `activateLive` (mirroring the
/// Android `MainActivity` live wiring): it loads the worker's real active period and
/// swaps the demo VM for it, and `submit` then POSTs to the `submit-preferences`
/// Edge Function before the optimistic local flip.
@MainActor
final class PreferencesObservable: ObservableObject {
    private(set) var vm: PreferencesViewModel
    @Published var state: PreferencesUiState
    private var task: Task<Void, Never>?
    private var live: (repo: PreferencesRepository, userId: String)?

    init(vm: PreferencesViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        observe()
    }

    deinit { task?.cancel() }

    private func observe() {
        task?.cancel()
        let vm = self.vm
        task = Task { [weak self] in
            for await s in vm.uiState { self?.state = s }
        }
    }

    /// Live host: remember the repo+user, load the real active period, swap the VM.
    /// Falls back to the demo period (no swap) when nothing is open.
    func activateLive(repo: PreferencesRepository, userId: String) async {
        guard live == nil else { return }
        live = (repo, userId)
        guard let period = try? await repo.fetchActivePreferencePeriod(userId: userId) else { return }
        vm = PreferencesViewModel(period: period)
        state = vm.uiState.value
        observe()
    }

    /// Live → POST the current edits, then the optimistic local flip; demo → flip only
    /// (mirrors the Shifts screen's claim/drop). A failed POST simply lands no row.
    func submit() {
        if let live {
            let payload = vm.submitPayload()
            Task { _ = try? await live.repo.submitPreferences(payload: payload) }
        }
        vm.submit()
    }
}

struct PreferencesScreen: View {
    @ObservedObject var model: PreferencesObservable
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "Preferences")
            Text(st.contextLabel)
                .font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.blue)
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 6)

            ShiftBanner(
                title: st.banner.title,
                bodyText: st.banner.body,
                tone: st.banner.tone == .success ? .success : .info
            )
            .padding(.horizontal, 16).padding(.bottom, 8)

            weekStrip(st.weekStrip, c)

            VStack(alignment: .leading, spacing: 12) {
                targetCard(st, c)
                if st.optedOut {
                    EmptyState(
                        title: "No hours marked",
                        systemIcon: ShiftIcons.ban,
                        bodyText: "You won't be scheduled next week. Untick \"no hours\" to set availability."
                    )
                } else {
                    brushSelector(st, c)
                    if !st.readOnly {
                        Text("Long-press and drag to paint a range · tap a block for 30 min")
                            .font(ShiftFont.sans(12)).foregroundColor(c.ter)
                    }
                    Text(st.day.title).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    PrefTimelineView(
                        day: st.day,
                        enabled: !st.readOnly,
                        onPaint: { model.vm.paint(blockId: $0) },
                        onPaintRange: { model.vm.paintRange(fromBlockId: $0, toBlockId: $1) },
                        c: c
                    )
                }
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 16)

            if st.showSubmit || st.showDiscard {
                HStack(spacing: 10) {
                    if st.showDiscard {
                        ShiftButton(title: "Discard", action: { model.vm.revert() }, variant: .outlined, size: .lg)
                            .accessibilityIdentifier("pref_discard_button")
                    }
                    if st.showSubmit {
                        ShiftButton(title: st.submitLabel, action: { model.submit() }, size: .lg, fullWidth: true)
                            .frame(maxWidth: .infinity)
                            .accessibilityIdentifier("submit_preferences_button")
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.bg)
        .accessibilityIdentifier("preferences_screen")
    }

    // MARK: week strip

    private func weekStrip(_ strip: PrefWeekStrip, _ c: ShiftColors) -> some View {
        HStack(spacing: 2) {
            ForEach(strip.cells, id: \.dayIndex) { cell in
                Button(action: { model.vm.selectDay(index: cell.dayIndex) }) {
                    VStack(spacing: 4) {
                        Text(cell.dayLetter).font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ter)
                        ZStack {
                            Circle().fill(cell.selected ? c.blue : Color.clear).frame(width: 34, height: 34)
                            Text(cell.dateLabel)
                                .font(ShiftFont.sans(14, .medium))
                                .foregroundColor(cell.selected ? .white : c.ink)
                        }
                        Circle().fill(cell.painted ? c.blue : Color.clear).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pref_day_cell")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 2)
        .accessibilityIdentifier("pref_week_strip")
    }

    // MARK: target card

    private func targetCard(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Target weekly hours").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Text("Soft cap \(st.targetMeter.capLabel) this period").font(ShiftFont.sans(12)).foregroundColor(c.ter)
                }
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    stepButton(ShiftIcons.minus, enabled: !st.readOnly && !st.optedOut) { model.vm.decrementTarget() }
                    Text(st.targetMeter.label)
                        .font(ShiftType.monoTimeHero).monospacedDigit().foregroundColor(c.ink)
                        .frame(width: 52)
                    stepButton(ShiftIcons.plus, enabled: !st.readOnly && !st.optedOut) { model.vm.incrementTarget() }
                }
                .opacity(st.optedOut ? 0.35 : 1)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(c.surfaceVar)
                    Capsule().fill(c.blue).frame(width: geo.size.width * CGFloat(st.targetMeter.fraction))
                }
            }
            .frame(height: 6)
            Button(action: { model.vm.toggleOptedOut() }) {
                HStack(spacing: 9) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(st.optedOut ? c.blue : Color.clear)
                            .frame(width: 22, height: 22)
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .strokeBorder(st.optedOut ? c.blue : c.outline, lineWidth: 1.5)
                            .frame(width: 22, height: 22)
                        if st.optedOut {
                            Image(systemName: ShiftIcons.check).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                        }
                    }
                    Text("I have no hours this week").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                }
            }
            .buttonStyle(.plain)
            .disabled(st.readOnly)
            .accessibilityIdentifier("pref_no_hours_toggle")
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("pref_target_stepper")
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundColor(ShiftColors.resolve(scheme).ink)
                .frame(width: 36, height: 36)
                .background(ShiftColors.resolve(scheme).surface)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(ShiftColors.resolve(scheme).divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(icon == ShiftIcons.plus ? "pref_target_increment" : "pref_target_decrement")
    }

    // MARK: brush selector

    private func brushSelector(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            ForEach([PrefBrush.available, PrefBrush.preferred, PrefBrush.cannot], id: \.self) { brush in
                let style = brushStyle(brush, c)
                let on = st.brush == brush
                Button(action: { model.vm.setBrush(value: brush) }) {
                    VStack(spacing: 4) {
                        Image(systemName: style.icon).font(.system(size: 17, weight: .semibold)).foregroundColor(on ? style.fg : c.ter)
                        Text(brushLabel(brush)).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(on ? style.fg : c.sec)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9).padding(.horizontal, 4)
                    .background(on ? style.bg : c.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(on ? style.accent : c.divider, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .disabled(st.readOnly)
                .accessibilityIdentifier(brushTag(brush))
            }
        }
    }

}

// MARK: - Day timeline (the drag-paint picker)

private let prefBlockHeight: CGFloat = 26
private let prefGutterWidth: CGFloat = 46

/// The selected day's vertical timeline: hours in a left gutter (on the dividing lines),
/// bare colored 30-min segments (no per-cell text), and ONE label pill per painted run.
/// Long-press then drag to paint a contiguous range with the current brush; a single tap
/// paints one block. The long-press handoff keeps a plain swipe scrolling the page rather
/// than painting. `enabled` is false once the deadline has passed.
struct PrefTimelineView: View {
    let day: PrefDayView
    let enabled: Bool
    let onPaint: (String) -> Void
    let onPaintRange: (String, String) -> Void
    let c: ShiftColors
    @State private var dragStart: String?

    private var cells: [PrefBlockCell] { day.cells }
    private var total: CGFloat { prefBlockHeight * CGFloat(cells.count) }

    private func idxAt(_ y: CGFloat) -> Int {
        let i = Int((y / prefBlockHeight).rounded(.down))
        return min(max(i, 0), cells.count - 1)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            gutter
            timeline
        }
        .frame(height: total)
    }

    private var gutter: some View {
        ZStack(alignment: .topTrailing) {
            Color.clear
            ForEach(day.hourMarks, id: \.boundaryIndex) { mark in
                Text(mark.label)
                    .font(ShiftFont.sans(11, .medium))
                    .foregroundColor(c.ter)
                    .padding(.trailing, 8)
                    .offset(y: max(prefBlockHeight * CGFloat(mark.boundaryIndex) - 7, 0))
            }
        }
        .frame(width: prefGutterWidth, height: total, alignment: .topTrailing)
    }

    private var timeline: some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(cells, id: \.blockId) { segment($0) }
            }
            ForEach(day.runs, id: \.startBlockIndex) { runPill($0) }
        }
        .frame(maxWidth: .infinity, minHeight: total, maxHeight: total, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityIdentifier("pref_block_grid")
        .gesture(paintDrag, including: enabled ? .all : .none)
        .simultaneousGesture(paintTap, including: enabled ? .all : .none)
    }

    private var paintTap: some Gesture {
        SpatialTapGesture().onEnded { value in
            onPaint(cells[idxAt(value.location.y)].blockId)
        }
    }

    private var paintDrag: some Gesture {
        LongPressGesture(minimumDuration: 0.2)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .onChanged { value in
                if case .second(true, let drag?) = value {
                    let id = cells[idxAt(drag.location.y)].blockId
                    if let start = dragStart {
                        onPaintRange(start, id)
                    } else {
                        dragStart = id
                        onPaint(id)
                    }
                }
            }
            .onEnded { _ in dragStart = nil }
    }

    private func segment(_ cell: PrefBlockCell) -> some View {
        let style = brushStyle(cell.brush, c)
        let fill: Color = cell.brush == .available ? Color.clear : style.bg
        return Rectangle()
            .fill(fill)
            .frame(height: prefBlockHeight)
            .overlay(alignment: .top) {
                Rectangle().fill(c.divider.opacity(cell.isHourStart ? 1 : 0.4)).frame(height: 1)
            }
            .overlay(alignment: .leading) {
                Rectangle().fill(c.divider).frame(width: 1)
            }
            .accessibilityIdentifier("pref_block_cell")
            .accessibilityLabel(cell.a11yLabel)
    }

    private func runPill(_ run: PrefBlockRun) -> some View {
        let style = brushStyle(run.brush, c)
        return ZStack {
            HStack(spacing: 5) {
                Image(systemName: style.icon).font(.system(size: 11, weight: .semibold)).foregroundColor(style.accent)
                Text(run.label).font(ShiftFont.sans(11.5, .medium)).foregroundColor(style.fg)
            }
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(c.surface)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(style.accent.opacity(0.45), lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
        .frame(height: prefBlockHeight * CGFloat(run.blockCount))
        .offset(y: prefBlockHeight * CGFloat(run.startBlockIndex))
    }
}

// MARK: - Brush styling (color + icon + text — never color alone)

private func brushStyle(_ brush: PrefBrush, _ c: ShiftColors) -> (bg: Color, fg: Color, accent: Color, icon: String) {
    switch brush {
    case .available: return (c.surfaceVar, c.sec, c.sec, ShiftIcons.check)
    case .preferred: return (c.blueContainer, c.onBlueContainer, c.pickupDot, ShiftIcons.heart)
    case .cannot: return (c.danger.tint, c.danger.accent, c.danger.accent, ShiftIcons.ban)
    }
}

private func brushLabel(_ brush: PrefBrush) -> String {
    switch brush {
    case .available: return "Available"
    case .preferred: return "Preferred"
    case .cannot: return "Cannot"
    }
}

private func brushTag(_ brush: PrefBrush) -> String {
    switch brush {
    case .available: return "pref_brush_available"
    case .preferred: return "pref_brush_preferred"
    case .cannot: return "pref_brush_cannot"
    }
}
