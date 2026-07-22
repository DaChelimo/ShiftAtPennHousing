import SwiftUI
import Shared

/// Break CALENDAR picker (Break redesign B5) in SwiftUI, over the shared
/// `BreakCalendarViewModel`. The spatial replacement for the flat break list: the break
/// window renders like the house schedule (1 lane for regular houses, 2 Harnwell, 3 Quad);
/// occupied seats are read-only and the remaining capacity is drag-claimable. Tap a block
/// or drag a range; the claim fills one open seat per block ("system-assigned lane") and
/// the confirm bar reports the trim. After T-1d the calendar is read-only → Open Shifts.
/// Selector `accessibilityIdentifier`s match the Maestro contract.

@MainActor
final class BreakCalendarObservable: ObservableObject {
    private(set) var vm: BreakCalendarViewModel
    @Published var state: BreakCalendarUiState
    private var task: Task<Void, Never>?
    private var activated = false

    init(vm: BreakCalendarViewModel) {
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

    /// Live host: load the active break, its home-house grid scoped to the window + phase,
    /// and the §4.4 opt-out; build the live VM. Falls back to the demo calendar (no swap)
    /// when there is no current/upcoming break.
    func activateLive(shiftsRepo: WorkerShiftsRepository, breakRepo: BreakRepository, userId: String) async {
        guard !activated else { return }
        activated = true
        await load(shiftsRepo: shiftsRepo, breakRepo: breakRepo, userId: userId)
    }

    /// Re-read the live calendar after a failed optimistic claim/drop so the picker snaps
    /// back to server truth (same load, minus the `activated` guard).
    func refreshFromServer(shiftsRepo: WorkerShiftsRepository, breakRepo: BreakRepository, userId: String) async {
        await load(shiftsRepo: shiftsRepo, breakRepo: breakRepo, userId: userId)
    }

    private func load(shiftsRepo: WorkerShiftsRepository, breakRepo: BreakRepository, userId: String) async {
        // No active break (or the grid can't be read) → the honest "no break" VM, NOT the demo
        // calendar (whose fake ids make claims silently fail).
        guard let active = try? await breakRepo.fetchActiveBreak(),
              let snapshot = try? await shiftsRepo.fetchBreakCalendarFor(userId: userId, activeBreak: active)
        else {
            vm = DemoFactory.shared.emptyBreakCalendarViewModel()
            state = vm.uiState.value
            observe()
            return
        }
        let optedOut = (try? await breakRepo.fetchBreakOptOut(userId: userId, breakId: active.breakId))?.boolValue ?? false
        vm = DemoFactory.shared.breakCalendarViewModel(snapshot: snapshot, breakId: active.breakId, optedOut: optedOut)
        state = vm.uiState.value
        observe()
    }
}

struct BreakCalendarScreen: View {
    @ObservedObject var model: BreakCalendarObservable
    /// Live host POSTs the dragged block ids to `break-claim` and reconciles to the server's
    /// actual claimed seats; demo passes `nil` (local-only).
    var onClaimRange: (([String]) -> Void)? = nil
    /// Live host POSTs a `drop-shift` covering the run's seats; demo passes `nil`.
    var onDropSeats: (([String]) -> Void)? = nil
    /// Live host writes the §4.4 "no break hours" opt-out; demo passes `nil`.
    var onToggleOptOut: ((Bool) -> Void)? = nil
    // Replays the interactive Break tour (nil in previews / call sites that don't wire it).
    // See BreakTourView.swift.
    var onReplayTour: (() -> Void)? = nil

    @Environment(\.colorScheme) private var scheme
    @State private var showToast = false
    @State private var toastMsg = "Break shift claimed"
    @State private var selFrom = -1
    @State private var selTo = -1
    // The lane (desk) column the finger is over + the measured lanes-area width — together
    // they drive the nearest-seat highlight.
    @State private var selCol = 0
    @State private var laneAreaWidth: CGFloat = 0

    private let blockH: CGFloat = 30
    // The actual per-row pitch: the block's 30pt content + its 1pt vertical padding on
    // each side (see blockRow). The gutter and the drag's y→index math MUST use this, or
    // they drift ~2pt/row and the wrong (often the first/last) cell gets selected.
    private var rowPitch: CGFloat { blockH + 2 }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(spacing: 0) {
            if st.noActiveBreak {
                // LIVE build, no break scheduled → honest empty state (never the fake demo
                // calendar, whose claims silently fail).
                PageTitle(title: "Break shifts")
                EmptyState(title: "No break scheduled", systemIcon: ShiftIcons.snowflake,
                           bodyText: "There's no break open for claiming right now. When a break's calendar opens, you'll be able to pick your shifts here.")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                // Fixed header — stays put while the grid scrolls beneath it.
                VStack(alignment: .leading, spacing: 0) {
                    PageTitle(title: "Break shifts") {
                        if let onReplayTour {
                            BreakTourHelpButton(action: onReplayTour)
                        }
                    }
                    Text("\(st.breakName.uppercased()) · CLAIM-BASED")
                        .font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.breakShift.deep)
                        .padding(.horizontal, 16).padding(.top, 2).padding(.bottom, 10)

                    if showToast {
                        ShiftToast(message: toastMsg, tone: .success, systemIcon: ShiftIcons.snowflake)
                            .padding(.horizontal, 16).padding(.bottom, 4)
                            .accessibilityIdentifier("break_calendar_success")
                    }

                    infoCard(st, c)
                    Spacer().frame(height: 6)
                    hoursMeter(st.meter, c)
                    optOutToggle(st.optedOut, c)

                    if st.weeks.count > 1 {
                        Spacer().frame(height: 4)
                        weekTabs(st, c)
                    }
                    Spacer().frame(height: 4)
                    dayStrip(st, c)
                }
                // Breathing room between the day selector and the shifts grid.
                Spacer().frame(height: 14)

                gridArea(st, c)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // The contextual action bar — PINNED above the bottom nav whenever a selection
                // exists (claim open capacity, or confirm dropping the worker's own coverage).
                if selFrom >= 0 && !st.readOnly && !st.optedOut {
                    actionBar(st, c)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(c.bg)
        .accessibilityIdentifier("break_calendar_screen")
        // Reset the selection when the shown day/week changes.
        .onChange(of: st.selectedDayIndex) { _ in selFrom = -1; selTo = -1; selCol = 0 }
        .onChange(of: st.weekIndex) { _ in selFrom = -1; selTo = -1; selCol = 0 }
    }

    @ViewBuilder
    private func gridArea(_ st: BreakCalendarUiState, _ c: ShiftColors) -> some View {
        if st.optedOut {
            EmptyState(title: "No break hours", systemIcon: ShiftIcons.ban,
                       bodyText: "You won't be scheduled this break. Untick \"no break hours\" to claim shifts.")
        } else if st.phase == .preOpen {
            EmptyState(title: "Opens soon", systemIcon: ShiftIcons.snowflake,
                       bodyText: "The \(st.breakName) calendar (\(st.windowLabel)) opens 14 days before the break.")
        } else if !st.day.inWindow {
            EmptyState(title: "Outside the break", systemIcon: ShiftIcons.snowflake,
                       bodyText: "Pick a day inside \(st.windowLabel) to claim break shifts.")
        } else if st.day.isEmpty {
            EmptyState(title: "Nothing scheduled", systemIcon: ShiftIcons.snowflake,
                       bodyText: "No blocks open for this day.")
        } else {
            let lanes = Int(st.day.blocks.first?.requiredHeadcount ?? 1)
            VStack(spacing: 0) {
                // Greyed "Desk 1 / Desk 2 …" column headers so a multi-staff house's
                // side-by-side seats read clearly. Fixed above the scrolling grid.
                if lanes > 1 { deskHeader(lanes, c) }
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if st.readOnly {
                            ShiftBanner(title: "Claiming closed",
                                        bodyText: "The picker closed for this break. Remaining shifts are now in Open Shifts.",
                                        tone: .info)
                                .padding(.horizontal, 16).padding(.vertical, 6)
                                .accessibilityIdentifier("break_calendar_readonly_banner")
                        }
                        dayGrid(st, c)
                        Spacer().frame(height: 16)
                    }
                }
            }
        }
    }

    private func deskHeader(_ lanes: Int, _ c: ShiftColors) -> some View {
        HStack(spacing: 0) {
            Spacer().frame(width: 46)
            HStack(spacing: 3) {
                ForEach(0 ..< lanes, id: \.self) { i in
                    Text("Desk \(i + 1)")
                        .font(ShiftFont.sans(10.5, .medium)).foregroundColor(c.ter)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
    }

    private func flashToast(_ msg: String) {
        toastMsg = msg
        showToast = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { showToast = false }
    }

    // ── header / meter / opt-out ────────────────────────────────────────────────
    private func infoCard(_ st: BreakCalendarUiState, _ c: ShiftColors) -> some View {
        let body: String
        switch st.phase {
        case .claimWindow: body = "First-come, first-served · drag to pick your hours · 40h hard cap · \(st.windowLabel)"
        case .openFeed: body = "Claiming closed. Leftover shifts are in Open Shifts · \(st.windowLabel)"
        default: body = "Opens 14 days before the break · \(st.windowLabel)"
        }
        return HStack(alignment: .top, spacing: 11) {
            Image(systemName: ShiftIcons.snowflake).font(.system(size: 20)).foregroundColor(c.breakShift.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(st.houseName).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.breakShift.deep)
                Text(body).font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 2)
    }

    private func hoursMeter(_ meter: BreakHoursMeter, _ c: ShiftColors) -> some View {
        let barColor = meter.atCap ? c.danger.accent : c.breakShift.accent
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("This break").font(ShiftFont.sans(13, .semibold)).foregroundColor(c.sec)
                Spacer()
                HStack(spacing: 0) {
                    Text(meter.currentLabel).font(ShiftFont.mono(13, .semibold)).monospacedDigit()
                        .foregroundColor(meter.atCap ? c.danger.accent : c.ink)
                    Text(" / \(meter.capLabel)").font(ShiftFont.mono(13)).monospacedDigit().foregroundColor(c.ter)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(c.surfaceVar)
                    Capsule().fill(barColor).frame(width: geo.size.width * CGFloat(meter.fraction))
                }
            }
            .frame(height: 6)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .accessibilityIdentifier("break_hours_meter")
    }

    private func optOutToggle(_ optedOut: Bool, _ c: ShiftColors) -> some View {
        Button(action: {
            let now = model.vm.toggleOptedOut()
            onToggleOptOut?(now)
        }) {
            HStack(spacing: 9) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(optedOut ? c.breakShift.accent : Color.clear).frame(width: 22, height: 22)
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(optedOut ? c.breakShift.accent : c.outline, lineWidth: 1.5).frame(width: 22, height: 22)
                    if optedOut { Image(systemName: ShiftIcons.check).font(.system(size: 12, weight: .bold)).foregroundColor(.white) }
                }
                Text("I have no hours this break").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16).padding(.vertical, 6)
        .accessibilityIdentifier("break_no_hours_toggle")
    }

    // ── week tabs + day strip ────────────────────────────────────────────────────
    private func weekTabs(_ st: BreakCalendarUiState, _ c: ShiftColors) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(st.weeks.enumerated()), id: \.offset) { i, tab in
                    let on = Int(st.weekIndex) == i
                    Text(tab.rangeLabel)
                        .font(ShiftFont.sans(12.5, on ? .semibold : .medium))
                        .foregroundColor(on ? c.breakShift.deep : c.sec)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(on ? c.breakShift.tint : c.surfaceVar)
                        .clipShape(Capsule())
                        .onTapGesture { model.vm.selectWeek(index: Int32(i)) }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 4)
        }
        .accessibilityIdentifier("break_calendar_week_tabs")
    }

    private func dayStrip(_ st: BreakCalendarUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 4) {
            ForEach(st.weekStrip, id: \.index) { cell in
                let on = cell.index == st.selectedDayIndex
                VStack(spacing: 3) {
                    Text(cell.dayLetter).font(ShiftFont.sans(10.5, .medium)).foregroundColor(on ? .white : c.ter)
                    Text(cell.dateLabel).font(ShiftFont.sans(13, on ? .bold : .medium))
                        .foregroundColor(on ? .white : (cell.inWindow ? c.ink : c.ter.opacity(0.5)))
                    Circle().fill(cell.hasSeats && !on ? c.breakShift.accent : Color.clear).frame(width: 4, height: 4)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(on ? c.breakShift.accent : (cell.inWindow ? c.surface : Color.clear))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onTapGesture { if cell.inWindow { model.vm.selectDay(index: cell.index) } }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .accessibilityIdentifier("break_calendar_week_strip")
    }

    // ── the day grid (claim surface) ──────────────────────────────────────────────
    private func dayGrid(_ st: BreakCalendarUiState, _ c: ShiftColors) -> some View {
        let blocks = st.day.blocks
        let lanes = max(1, Int(st.day.blocks.first?.requiredHeadcount ?? 1))
        let lo = selFrom < 0 ? -1 : min(selFrom, selTo)
        let hi = selFrom < 0 ? -1 : max(selFrom, selTo)
        func idx(_ y: CGFloat) -> Int { max(0, min(blocks.count - 1, Int(y / rowPitch))) }
        func col(_ x: CGFloat) -> Int {
            guard laneAreaWidth > 0 else { return 0 }
            return max(0, min(lanes - 1, Int(x / (laneAreaWidth / CGFloat(lanes)))))
        }

        return HStack(alignment: .top, spacing: 0) {
            // hour gutter — each hour label is vertically CENTERED on its block's TOP
            // boundary line (the line between the previous :30 block and this :00 block),
            // so you can read exactly where a shift edge falls. The topmost label stays
            // top-aligned so it doesn't clip above the grid. Row height = rowPitch so the
            // gutter lines up with the blocks beside it.
            VStack(spacing: 0) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { i, b in
                    Text(b.isHourStart ? b.startLabel : "")
                        .font(ShiftFont.sans(11)).foregroundColor(c.ter)
                        .frame(width: 46, height: rowPitch, alignment: .topTrailing)
                        .padding(.trailing, 8)
                        .offset(y: i == 0 ? 0 : -7)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { i, b in
                    let selected = lo >= 0 && i >= lo && i <= hi
                    let hlLane: Int? = selected ? b.highlightLane(preferredColumn: Int32(selCol)).map { Int(truncating: $0) } : nil
                    blockRow(b, highlightedLane: hlLane, c)
                }
            }
            .background(GeometryReader { geo in
                Color.clear
                    .onAppear { laneAreaWidth = geo.size.width }
                    .onChange(of: geo.size.width) { laneAreaWidth = $0 }
            })
            .contentShape(Rectangle())
            // Tap selects one 30-min chunk under the finger's desk column. A vertical
            // long-press-then-drag extends the selection chunk-by-chunk (the x picks the
            // desk column, the y picks the time), while a plain swipe still scrolls.
            .simultaneousGesture(
                SpatialTapGesture()
                    .onEnded { v in
                        guard !st.readOnly else { return }
                        let i = idx(v.location.y)
                        selFrom = i
                        selTo = i
                        selCol = col(v.location.x)
                    },
            )
            .gesture(
                LongPressGesture(minimumDuration: 0.16)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onChanged { value in
                        guard !st.readOnly else { return }
                        if case .second(true, let drag?) = value {
                            selFrom = idx(drag.startLocation.y)
                            selTo = idx(drag.location.y)
                            selCol = col(drag.location.x)
                        }
                    },
            )
        }
        .padding(.horizontal, 12)
        .accessibilityIdentifier("break_calendar_day")
    }

    private func blockRow(_ block: BreakBlockCoverage, highlightedLane: Int?, _ c: ShiftColors) -> some View {
        HStack(spacing: 3) {
            ForEach(Array(block.lanes.enumerated()), id: \.offset) { idx, lane in
                // Only ONE seat per timeslot highlights — the open seat nearest the finger
                // (highlightedLane); the other open seat stays neutral so it never looks like
                // both desks are being taken at once.
                let isHi = idx == highlightedLane
                let bg: Color = lane.mine ? c.breakShift.accent
                    : (isHi ? c.breakShift.accent.opacity(0.35) : (lane.open ? c.surfaceVar : c.surface))
                let borderColor: Color = isHi ? c.breakShift.accent : (lane.open ? Color.clear : c.divider)
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(bg)
                    RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(borderColor, lineWidth: 1)
                    if !lane.open {
                        Text(lane.mine ? "You" : (lane.workerName.map { firstName($0) } ?? "Taken"))
                            .font(ShiftFont.sans(11.5, lane.mine ? .semibold : .medium))
                            .foregroundColor(lane.mine ? .white : c.sec)
                            .padding(.horizontal, 8)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: blockH)
        .padding(.vertical, 1)
        .accessibilityIdentifier("break_block_row")
    }

    // ── the contextual action bar (pinned above the bottom nav) ────────────────────
    @ViewBuilder
    private func actionBar(_ st: BreakCalendarUiState, _ c: ShiftColors) -> some View {
        let plan = model.vm.previewDrag(fromIndex: Int32(selFrom), toIndex: Int32(selTo))
        let isDrop = plan.droppable
        HStack(spacing: 10) {
            Text(plan.message)
                .font(ShiftFont.sans(13, isDrop ? .medium : .regular))
                .foregroundColor(isDrop ? c.danger.accent : c.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            ShiftButton(title: "Cancel", action: { selFrom = -1; selTo = -1 }, variant: .outlined, size: .sm)
            if isDrop {
                ShiftButton(title: "Drop", action: {
                    model.vm.drop(seatIds: plan.dropSeatIds)
                    onDropSeats?(plan.dropSeatIds)
                    flashToast("Break shift dropped")
                    selFrom = -1; selTo = -1
                }, variant: .destructive, size: .sm)
                    .accessibilityIdentifier("break_calendar_drop_button")
            } else {
                ShiftButton(title: "Claim", action: {
                    let blockIds = model.vm.commitDrag(plan: plan)
                    if !blockIds.isEmpty {
                        onClaimRange?(blockIds)
                        flashToast("Break shift claimed")
                    }
                    selFrom = -1; selTo = -1
                }, variant: .filled, size: .sm)
                    .disabled(!plan.claimable)
                    .opacity(plan.claimable ? 1 : 0.4)
                    .accessibilityIdentifier("break_calendar_claim_button")
            }
        }
        .padding(16)
        .background(c.surface)
        .overlay(Rectangle().frame(height: 1).foregroundColor(c.divider), alignment: .top)
        .accessibilityIdentifier("break_calendar_claim_bar")
    }

    private func firstName(_ s: String) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.split(separator: " ").first.map(String.init) ?? t
    }
}

/// The active-break promotion banner (Break redesign B6): shown on the other tabs while a
/// break's claim window is open, deep-linking into the Break calendar.
struct BreakOpenBanner: View {
    let breakName: String
    let onOpen: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: onOpen) {
            HStack(spacing: 10) {
                Image(systemName: ShiftIcons.snowflake).font(.system(size: 18)).foregroundColor(c.breakShift.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(breakName) is open").font(ShiftFont.sans(13.5, .semibold)).foregroundColor(c.breakShift.deep)
                    Text("Pick your break shifts").font(ShiftFont.sans(12)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
                Text("→").font(ShiftFont.sans(16, .semibold)).foregroundColor(c.breakShift.accent)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(c.breakShift.tint)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("break_open_banner")
    }
}
