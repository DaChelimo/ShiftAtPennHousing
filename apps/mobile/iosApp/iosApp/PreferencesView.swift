import SwiftUI
import Shared
import UIKit

/// Preference submission (the tri-state paint grid + target weekly hours) in SwiftUI,
/// over the shared `PreferencesViewModel` (observed — its brush/grid/target mutate).
/// Rebuilds worker-app.html `PreferenceScreen` with the kit: context eyebrow, deadline
/// banner, Mon-Sun strip, target stepper card, the Available/Preferred/Cannot brush
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
    private var live: (repo: PreferencesRepository, userId: String, isManager: Bool)?

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
    /// Falls back to the demo period (no swap) when nothing is open. [isManager] enables
    /// the manager deadline-setter (sm/hm/bm/rsm); a plain worker never sees it.
    func activateLive(repo: PreferencesRepository, userId: String, isManager: Bool) async {
        guard live == nil else { return }
        live = (repo, userId, isManager)
        guard let period = try? await repo.fetchActivePreferencePeriod(userId: userId) else { return }
        vm = PreferencesViewModel(period: period, isManager: isManager)
        state = vm.uiState.value
        observe()
    }

    /// Manager-only (BSpec §4.2): set the active period's submission deadline to
    /// [year]-[month]-[day] (month 1..12). On success, reload the period so the deadline
    /// chip updates. Returns whether the write succeeded (the caller toasts).
    func setDeadline(year: Int, month: Int, day: Int) async -> Bool {
        guard let live else { return false }
        let ok =
            (try? await live.repo.setPreferenceDeadline(
                periodId: state.periodId,
                year: Int32(year),
                month: Int32(month),
                day: Int32(day)
            ))?.boolValue ?? false
        if ok, let period = try? await live.repo.fetchActivePreferencePeriod(userId: live.userId) {
            vm = PreferencesViewModel(period: period, isManager: live.isManager)
            state = vm.uiState.value
            observe()
        }
        return ok
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
    // Replays the interactive Preferences tour (nil in previews / call sites that don't
    // wire it). See PreferencesTourView.swift.
    var onReplayTour: (() -> Void)? = nil
    @Environment(\.colorScheme) private var scheme
    @State private var showDeadlinePicker = false
    @State private var pickedDeadline = Date()
    @State private var deadlineToast: String?

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "Preferences") {
                if let onReplayTour {
                    PreferencesTourHelpButton(action: onReplayTour)
                }
            }

            // Eyebrow is just the period now — the deadline rides in the status card as a chip.
            Text(st.periodLabel)
                .font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.blue)
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 8)

            statusCard(st, c)
                .padding(.horizontal, 16).padding(.bottom, st.canSetDeadline ? 10 : 14)

            if st.canSetDeadline {
                deadlineSetterCard(st, c)
                    .padding(.horizontal, 16).padding(.bottom, 14)
            }

            // Days + brush are grouped right above the timeline they drive, and stay pinned
            // while the timeline scrolls beneath them.
            weekStrip(st.weekStrip, c)
            if !st.optedOut {
                if !st.readOnly {
                    Text("Pick a mode")
                        .font(ShiftFont.sans(12, .semibold)).foregroundColor(c.ter)
                        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 5)
                }
                brushSelector(st, c)
                    .padding(.horizontal, 16)
                if !st.readOnly {
                    paintHelpCard(c)
                        .padding(.horizontal, 16).padding(.top, 10)
                }
                HStack(spacing: 8) {
                    Text(st.day.title).font(ShiftFont.sans(16, .semibold)).foregroundColor(c.ink)
                    Spacer()
                }
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 2)
            }

            // Only the timeline (and the demoted target card) scroll. Inside the timeline a
            // plain swipe scrolls; a ~0.25s hold hands off to paint (see PrefTimelineView).
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if st.optedOut {
                        EmptyState(
                            title: "No hours marked",
                            systemIcon: ShiftIcons.ban,
                            bodyText: "You won't be scheduled next week. Untick \"no hours\" to set availability."
                        )
                    } else {
                        PrefTimelineView(
                            day: st.day,
                            enabled: !st.readOnly,
                            activeBrush: st.brush,
                            onBeginPaint: { model.vm.beginPaintDrag(blockId: $0) },
                            onPaintRange: { model.vm.paintRange(fromBlockId: $0, toBlockId: $1) },
                            onEndPaint: { model.vm.endPaintDrag() },
                            c: c
                        )
                    }
                    // Target is demoted below the timeline (not part of the day-painting group).
                    targetCard(st, c)
                }
                .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 16)
            }
            .frame(maxHeight: .infinity)

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
        .sheet(isPresented: $showDeadlinePicker) { deadlinePickerSheet(st, c) }
        .overlay(alignment: .top) {
            if let msg = deadlineToast {
                Text(msg)
                    .font(ShiftFont.sans(14, .medium)).foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(c.ink).clipShape(Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    // MARK: manager deadline setter (BSpec §4.2)

    /// The latest date the deadline may fall on (the period start), as a Swift `Date`.
    private var deadlineMaxDate: Date? {
        guard let d = model.state.deadlineMaxDate else { return nil }
        return Calendar.current.date(
            from: DateComponents(year: Int(d.year), month: Int(d.monthNumber), day: Int(d.dayOfMonth))
        )
    }

    private func showDeadlineToast(_ message: String) {
        withAnimation { deadlineToast = message }
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            withAnimation { deadlineToast = nil }
        }
    }

    /// Manager-only card: the current deadline plus a button to open the date picker.
    private func deadlineSetterCard(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Submission deadline").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
            Text(st.deadlineChip ?? "No deadline set for this period.")
                .font(ShiftFont.sans(13)).foregroundColor(c.sec)
            ShiftButton(
                title: "Set deadline",
                action: {
                    pickedDeadline = deadlineMaxDate ?? Date()
                    showDeadlinePicker = true
                },
                variant: .outlined,
                size: .md
            )
            .accessibilityIdentifier("pref_set_deadline")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(c.divider, lineWidth: 1))
    }

    private func deadlinePickerSheet(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        VStack(spacing: 16) {
            Text("Set submission deadline").font(ShiftFont.sans(16, .semibold)).foregroundColor(c.ink)
            Group {
                if let maxDate = deadlineMaxDate {
                    DatePicker("", selection: $pickedDeadline, in: ...maxDate, displayedComponents: .date)
                } else {
                    DatePicker("", selection: $pickedDeadline, displayedComponents: .date)
                }
            }
            .datePickerStyle(.graphical)
            .labelsHidden()
            HStack(spacing: 10) {
                ShiftButton(title: "Cancel", action: { showDeadlinePicker = false }, variant: .outlined, size: .md)
                ShiftButton(
                    title: "Save",
                    action: {
                        let comps = Calendar.current.dateComponents([.year, .month, .day], from: pickedDeadline)
                        showDeadlinePicker = false
                        Task {
                            let ok = await model.setDeadline(
                                year: comps.year ?? 0, month: comps.month ?? 0, day: comps.day ?? 0
                            )
                            showDeadlineToast(
                                ok ? "Deadline updated"
                                    : "That deadline could not be set. It must be on or before the period start."
                            )
                        }
                    },
                    size: .md
                )
                .accessibilityIdentifier("pref_deadline_confirm")
            }
        }
        .padding(20)
        .presentationDetents([.medium, .large])
    }

    // MARK: status card

    /// Compact one-line status: an icon + short state, with the deadline as a trailing chip
    /// (never a full sentence). Success (submitted) reads green; everything else reads blue.
    private func statusCard(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        let success = st.banner.tone == .success
        let accent = success ? c.success.accent : c.blue
        let tint = success ? c.success.tint : c.blueContainer
        let icon = success ? ShiftIcons.checkCircle : ShiftIcons.info
        return HStack(spacing: 9) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundColor(accent)
            Text(st.banner.title).font(ShiftFont.sans(13.5, .semibold)).foregroundColor(c.ink).lineLimit(1)
            Spacer(minLength: 8)
            if let chip = st.deadlineChip {
                HStack(spacing: 4) {
                    Image(systemName: ShiftIcons.clock).font(.system(size: 10, weight: .semibold))
                    Text(chip).font(ShiftFont.sans(11, .semibold))
                }
                .foregroundColor(c.sec)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(c.surface)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(c.divider, lineWidth: 1))
                .fixedSize()
                .accessibilityIdentifier("pref_deadline_chip")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(tint)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("pref_status_card")
    }

    // MARK: week strip

    private func weekStrip(_ strip: PrefWeekStrip, _ c: ShiftColors) -> some View {
        HStack(spacing: 5) {
            ForEach(strip.cells, id: \.dayIndex) { cell in
                // Selected = solid blue; a day that has any marked hours = a soft blue fill
                // (distinct from the plain days, quieter than the selected pill); else clear.
                let fill: Color = cell.selected ? c.blue : (cell.painted ? c.blueContainer : Color.clear)
                Button(action: { model.vm.selectDay(index: cell.dayIndex) }) {
                    Text(cell.dayLabel)
                        .font(ShiftFont.sans(14.5, .semibold))
                        .foregroundColor(cell.selected ? .white : (cell.painted ? c.onBlueContainer : c.sec))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(fill))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pref_day_cell")
            }
        }
        .padding(.horizontal, 16)
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

    // MARK: paint help

    /// A compact rounded hint that teaches the split-gesture model: the left time column
    /// scrolls the page, and pressing then dragging across the shifts picks or drops hours.
    private func paintHelpCard(_ c: ShiftColors) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: ShiftIcons.info)
                .font(.system(size: 13, weight: .semibold)).foregroundColor(c.blue)
            Text("Scroll the page using the time column on the left. On the shifts, press and drag to pick or drop hours.")
                .font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(c.blueContainer)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityIdentifier("pref_paint_help")
    }

    // MARK: brush selector

    private func brushSelector(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            ForEach([PrefBrush.available, PrefBrush.preferred, PrefBrush.cannot], id: \.self) { brush in
                let style = brushStyle(brush, c)
                let on = st.brush == brush
                Button(action: { model.vm.setBrush(value: brush) }) {
                    VStack(spacing: 4) {
                        Image(systemName: style.icon).font(.system(size: 19, weight: .semibold)).foregroundColor(on ? style.fg : c.ter)
                        Text(brushLabel(brush)).font(ShiftFont.sans(13.5, .semibold)).foregroundColor(on ? style.fg : c.sec)
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

// 1.5x the original 26 — real thumbs on real phones need a bigger target than the emulator
// suggested; 26pt was too tight to reliably land single 30-min blocks by touch.
private let prefBlockHeight: CGFloat = 44
// Wide enough for an off-hour anchor label like "5:30 AM" (not just a bare hour number).
// This column is ALSO the scroll handle: the shift grid is a pure paint canvas that never
// scrolls, so the page is scrolled by dragging here on the time column.
private let prefGutterWidth: CGFloat = 62

/// The selected day's vertical timeline: hours in a left gutter (on the dividing lines),
/// bare colored 30-min segments (no per-cell text), and ONE label pill per painted run.
/// The gesture model is SPLIT to remove the scroll-vs-paint conflict: the shift grid is a
/// pure paint canvas (press then drag to paint a contiguous range, a single tap toggles one
/// block, and it NEVER scrolls the page), while the enclosing page is scrolled by dragging
/// the left time column instead. `enabled` is false once the deadline has passed.
struct PrefTimelineView: View {
    let day: PrefDayView
    let enabled: Bool
    let activeBrush: PrefBrush
    let onBeginPaint: (String) -> Void
    let onPaintRange: (String, String) -> Void
    let onEndPaint: () -> Void
    let c: ShiftColors
    // The live drag preview: the affected block span + whether this sweep erases (red) or adds (blue).
    @State private var dragSpan: ClosedRange<Int>?
    @State private var dragErase = false

    private var cells: [PrefBlockCell] { day.cells }
    private var total: CGFloat { prefBlockHeight * CGFloat(cells.count) }

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
                // Sits centred on its boundary line; clamped so the first/last labels stay
                // fully on-screen (well padded from the top and bottom edges).
                Text(mark.label)
                    .font(ShiftFont.mono(12, .semibold))
                    .monospacedDigit()
                    .foregroundColor(c.sec)
                    .fixedSize()
                    .padding(.trailing, 10)
                    .offset(y: labelOffset(Int(mark.boundaryIndex)))
            }
        }
        .frame(width: prefGutterWidth, height: total, alignment: .topTrailing)
    }

    /// Vertical position of a gutter label: centred on its boundary line, but the first line
    /// (top) is nudged down and the last (bottom) nudged up so neither is clipped.
    private func labelOffset(_ boundaryIndex: Int) -> CGFloat {
        let onLine = prefBlockHeight * CGFloat(boundaryIndex) - 8
        if boundaryIndex == 0 { return 0 }
        if boundaryIndex == cells.count { return total - 16 }
        return onLine
    }

    private var timeline: some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(cells, id: \.blockId) { segment($0) }
            }
            ForEach(day.runs, id: \.startBlockIndex) { runPill($0) }
            // Live drag preview: outline + tint the affected span (blue add / red erase).
            if let span = dragSpan {
                let hl = dragErase ? c.danger.accent : c.blue
                RoundedRectangle(cornerRadius: 5)
                    .fill(hl.opacity(0.16))
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(hl, lineWidth: 2))
                    .frame(maxWidth: .infinity)
                    .frame(height: prefBlockHeight * CGFloat(span.count))
                    .offset(y: prefBlockHeight * CGFloat(span.lowerBound))
            }
        }
        .frame(maxWidth: .infinity, minHeight: total, maxHeight: total, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityIdentifier("pref_block_grid")
        // A raw-touch UIKit canvas (not SwiftUI gestures, not a long-press): the moment a finger
        // lands on the grid it disables the enclosing ScrollView's pan, so the grid NEVER scrolls
        // and every drag paints immediately. Scrolling the page is done from the time column on the
        // left instead. This removes the scroll-vs-paint arbitration entirely.
        .overlay(
            PaintSurface(
                blockCount: cells.count,
                blockHeight: prefBlockHeight,
                enabled: enabled,
                onBegin: { i in
                    dragErase = cells[i].brush == activeBrush
                    dragSpan = i...i
                    onBeginPaint(cells[i].blockId)
                },
                onChange: { start, cur in
                    dragSpan = min(start, cur)...max(start, cur)
                    onPaintRange(cells[start].blockId, cells[cur].blockId)
                },
                onEnd: {
                    dragSpan = nil
                    onEndPaint()
                }
            )
        )
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
                Image(systemName: style.icon).font(.system(size: 13, weight: .semibold)).foregroundColor(style.accent)
                Text(run.label).font(ShiftFont.sans(13, .medium)).foregroundColor(style.fg)
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

// MARK: - Paint canvas (raw UIKit touches, so the grid never scrolls)

/// A transparent overlay that turns the shift grid into a pure paint canvas. The moment a finger
/// touches down it disables the enclosing ScrollView's pan, so the grid NEVER scrolls under the
/// finger; every drag paints immediately and a plain touch toggles one block. The page is scrolled
/// from the time column on the left (which has no such overlay) instead. This sidesteps the whole
/// scroll-vs-paint gesture arbitration that made an in-grid drag behave erratically.
private struct PaintSurface: UIViewRepresentable {
    let blockCount: Int
    let blockHeight: CGFloat
    let enabled: Bool
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
        uiView.isUserInteractionEnabled = enabled
    }

    /// The raw-touch canvas. Painting is driven by touchesBegan/Moved/Ended rather than gesture
    /// recognizers so it can't be pre-empted by (or have to cooperate with) the scroll view's pan.
    final class PaintView: UIView {
        private var blockCount = 0
        private var blockHeight: CGFloat = 1
        private var onBegin: ((Int) -> Void)?
        private var onChange: ((Int, Int) -> Void)?
        private var onEnd: (() -> Void)?
        private var startIdx = 0
        // The enclosing scroll view's pan, disabled for the lifetime of a touch on the grid so the
        // page can't scroll while painting; re-enabled on lift. Dragging the time column (no overlay)
        // still scrolls normally.
        private weak var lockedPan: UIPanGestureRecognizer?

        func apply(_ surface: PaintSurface) {
            blockCount = surface.blockCount
            blockHeight = surface.blockHeight
            onBegin = surface.onBegin
            onChange = surface.onChange
            onEnd = surface.onEnd
        }

        private func enclosingScroll() -> UIScrollView? {
            var v = superview
            while let cur = v {
                if let scroll = cur as? UIScrollView { return scroll }
                v = cur.superview
            }
            return nil
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            // Deliver touches to this canvas without the scroll view's ~150ms "is it a scroll?" delay,
            // so painting starts on contact.
            enclosingScroll()?.delaysContentTouches = false
        }

        private func index(_ p: CGPoint) -> Int {
            let i = Int((p.y / blockHeight).rounded(.down))
            return min(max(i, 0), max(blockCount - 1, 0))
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard blockCount > 0, let t = touches.first else { return }
            let scroll = enclosingScroll()
            scroll?.panGestureRecognizer.isEnabled = false // the grid never scrolls
            lockedPan = scroll?.panGestureRecognizer
            startIdx = index(t.location(in: self))
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onBegin?(startIdx)
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard blockCount > 0, let t = touches.first else { return }
            onChange?(startIdx, index(t.location(in: self)))
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { finish() }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { finish() }

        private func finish() {
            onEnd?()
            lockedPan?.isEnabled = true
            lockedPan = nil
        }
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
