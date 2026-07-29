import SwiftUI
import Shared

// MARK: - Calendar swap (CALENDAR_REDESIGN.md) — week-paged give/take picker
//
// Split out of ContentView.swift (2026-07-24, ~490 lines) when the take-hours selector
// moved next to the give control — ContentView.swift is quarantined at AGENTS.md §5.2 and
// this was the section actually touched, mirroring the Android split into SwapComposer.kt.

/// Holds the `SwapCalendarViewModel`; created with the tapped shift as the pinned "give".
/// On the live path it fetches each navigated week's house grid (`fetchHouseScheduleForWeek`)
/// and feeds it to the VM (`setWeekSeats`); the demo path feeds the current week's seats once.
@MainActor
final class SwapCalendarObservable: ObservableObject {
    let vm: SwapCalendarViewModel
    @Published var state: SwapCalendarUiState
    private var task: Task<Void, Never>?
    private let repo: WorkerShiftsRepository?
    private let userId: String?

    init(giveShift: MyShift, meUserId: String?, repo: WorkerShiftsRepository?, demoSeats: [HouseSeat], pendingGiveAssignmentIds: Set<String> = [], initialPermanent: Bool = false) {
        let model = DemoFactory.shared.swapCalendarViewModel(giveShift: giveShift, meUserId: meUserId ?? "demo", breakProfile: false, pendingGiveAssignmentIds: pendingGiveAssignmentIds, initialPermanent: initialPermanent)
        self.vm = model
        self.state = model.uiState.value
        self.repo = repo
        self.userId = meUserId
        subscribe()
        if repo != nil, meUserId != nil {
            Task { await loadWeek() }
            Task { await loadDirectory() }
        } else {
            model.setWeekSeats(forOffset: model.uiState.value.weekOffset, seats: demoSeats)
            model.setWorkerDirectory(workers: DemoFactory.shared.workerDirectory())
        }
    }

    private func subscribe() {
        task?.cancel()
        state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    func loadWeek() async {
        guard let repo, let uid = userId else { return }
        let off = vm.uiState.value.weekOffset
        let anchor = vm.uiState.value.anchor
        let snap = try? await repo.fetchHouseScheduleForWeek(userId: uid, anchor: anchor)
        vm.setWeekSeats(forOffset: off, seats: snap?.seats ?? [])
    }

    /// The §8.5 hand-off recipient directory (cross-house) — fetched once; a people
    /// roster, independent of which week the give shift sits in.
    func loadDirectory() async {
        guard let repo else { return }
        let dir = (try? await repo.fetchWorkerDirectory()) ?? []
        vm.setWorkerDirectory(workers: dir)
    }

    func prevWeek() { vm.previousWeek(); Task { await loadWeek() } }
    func nextWeek() { vm.nextWeek(); Task { await loadWeek() } }
    func selectDay(_ i: Int) { vm.selectDay(index: Int32(i)) }
    func pickTake(_ c: SwapDayCard) { vm.pickTake(card: c) }
    func togglePermanent() { vm.togglePermanent() }
    func setHandoff(_ on: Bool) { vm.setHandoff(on: on) }
    func setHandoffQuery(_ q: String) { vm.setHandoffQuery(query: q) }
    func pickRecipient(_ w: HandoffWorker) { vm.pickRecipient(worker: w) }
    func setGiveRange(_ from: Int, _ to: Int) { vm.setGiveRange(from: Int32(from), to: Int32(to)) }
    func setTakeRange(_ from: Int, _ to: Int) { vm.setTakeRange(from: Int32(from), to: Int32(to)) }
    func focusGiveRun(_ index: Int) { vm.focusGiveRun(index: Int32(index)) }
    func focusTakeRun(_ index: Int) { vm.focusTakeRun(index: Int32(index)) }
    func acceptSuggestion() { vm.acceptSuggestion() }
    func addLeg() { vm.addLeg() }
    func removeLeg(_ index: Int) { vm.removeLeg(index: Int32(index)) }
    func proposals() -> [SwapProposal] { vm.proposals() }

    deinit { task?.cancel() }
}

/// The calendar swap sheet: a pinned "give" (the tapped shift), a week navigator + Mon–Sun
/// strip, and the selected day's housemate cards to "take". Cross-week + retroactive fall
/// out of week paging; the give persists across weeks. Whole-run swaps in v1.
struct SwapCalendarPage: View {
    @StateObject private var obs: SwapCalendarObservable
    // Scrolls the enclosing ShiftSheet body up to the take-hours selector right after a
    // pick; nil for any caller that doesn't route through ManageShiftSheet's ShiftSheet.
    let scrollProxy: ScrollViewProxy?
    let onSubmit: ([SwapProposal]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var handoffTab = 0 // 0 = My House, 1 = Others (hand-off recipient directory)
    // Roster expand/collapse — collapses to the picked person's row alone once chosen, so
    // the take-hours selector above (moved up beside "how much to give?") doesn't get
    // buried below a long housemate list again. A different day re-expands: that day's
    // roster may not include the current pick.
    @State private var takeExpanded = true

    init(giveShift: MyShift, meUserId: String?, repo: WorkerShiftsRepository?, demoSeats: [HouseSeat], initialPermanent: Bool = false, pendingGiveAssignmentIds: Set<String> = [], scrollProxy: ScrollViewProxy? = nil, onSubmit: @escaping ([SwapProposal]) -> Void) {
        _obs = StateObject(wrappedValue: SwapCalendarObservable(giveShift: giveShift, meUserId: meUserId, repo: repo, demoSeats: demoSeats, pendingGiveAssignmentIds: pendingGiveAssignmentIds, initialPermanent: initialPermanent))
        self.scrollProxy = scrollProxy
        self.onSubmit = onSubmit
    }

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let s = obs.state
        let legCount = s.legs.count + (s.take != nil ? 1 : 0)
        VStack(alignment: .leading, spacing: 14) {
                if !s.legs.isEmpty {
                    VStack(spacing: 6) {
                        ForEach(Array(s.legs.enumerated()), id: \.offset) { i, leg in
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(leg.workerName).font(ShiftFont.sans(13, .semibold)).foregroundColor(c.ink)
                                    Text(leg.summary).font(ShiftFont.sans(12)).foregroundColor(c.sec)
                                }
                                Spacer(minLength: 0)
                                Button(action: { obs.removeLeg(i) }) {
                                    Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundColor(c.sec)
                                        .frame(width: 24, height: 24).background(c.surface).clipShape(Circle())
                                }.buttonStyle(.plain)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(c.surfaceVar).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }.accessibilityIdentifier("swap_legs")
                }

                // After banking a leg, the one-tap "give the next part to the same person too"
                // shortcut (the chosen same-person flow): two non-contiguous parts of one shift
                // to one person stay independent legs, but feel like one intent.
                if let sug = s.suggestion {
                    suggestionChip(sug, c)
                }

                if let deal = s.deal {
                    dealCard(deal, s, c)
                }

                HStack(spacing: 8) {
                    modeButton("Swap", handoff: false, c, s)
                    modeButton("Hand off", handoff: true, c, s)
                }

                // Hand-off (§8.5) is NOT a calendar exchange — you just pick who covers
                // the shift, so the whole calendar is replaced by the recipient directory.
                if s.handoff {
                    handoffPicker(s, c)
                } else {
                // ── "Your shift" controls — PROMINENT, above the calendar. Partial swaps are
                // uncommon but heavily used; the old hidden "adjust hours" link was
                // undiscoverable. Shown whenever your shift is splittable — for a plain swap
                // AND a permanent swap (§8.1/§8.3 partial).
                if s.giveSplittable, let g = s.give {
                    // Once a part is banked the shift fragments — spell out who holds each
                    // piece and when (swapSegmentList) above the slider; the slider then only
                    // adjusts "how much" within the focused free run.
                    if s.giveSegments.contains(where: { $0.locked }) {
                        let givePlan = planSwapSpanFor(blockIds: g.seatIds, spanStart: g.start, spanEnd: g.end,
                                                        fromBlock: Int32(s.giveFrom), toBlock: Int32(max(Int(s.giveTo), Int(s.giveFrom) + 1)))
                        swapSegmentList(s.giveSegments, dayLabel: givePlan.dayLabel, counterpartyName: "", isGive: true, c, "swap_give_timeline") { obs.focusGiveRun($0) }
                    }
                    giveRangeCard(s.permanent ? "How much of your slot to give?" : "How much of your shift to give?",
                                  card: g, count: Int(s.giveBlockCount), from: Int(s.giveFrom), to: Int(s.giveTo),
                                  runFrom: Int(s.giveRunFrom), runTo: Int(s.giveRunTo),
                                  set: { f, t in obs.setGiveRange(f, t) }, c, "swap_give_range")
                }
                if s.permanentToggleVisible {
                    permanentToggleCard(s, c)
                }

                HStack {
                    Button(action: { obs.prevWeek() }) { Image(systemName: "chevron.left").font(.system(size: 16)).foregroundColor(c.ink) }
                        .accessibilityIdentifier("swap_week_prev")
                    Spacer()
                    VStack(spacing: 1) {
                        Text(s.weekRange).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                        Text(s.weekRelative).font(ShiftFont.sans(12)).foregroundColor(c.ter)
                    }
                    Spacer()
                    Button(action: { obs.nextWeek() }) { Image(systemName: "chevron.right").font(.system(size: 16)).foregroundColor(c.ink) }
                        .accessibilityIdentifier("swap_week_next")
                }

                HStack(spacing: 4) {
                    ForEach(s.days, id: \.index) { d in
                        let sel = Int(d.index) == Int(s.selectedDayIndex)
                        Button(action: { obs.selectDay(Int(d.index)) }) {
                            VStack(spacing: 4) {
                                Text(d.dayLetter).font(ShiftFont.sans(11)).foregroundColor(c.sec)
                                Text(d.dateLabel).font(ShiftFont.sans(13, sel ? .semibold : .regular))
                                    .foregroundColor(sel ? .white : c.ink)
                                    .frame(width: 28, height: 28)
                                    .background(sel ? c.blue : Color.clear).clipShape(Circle())
                                Circle().fill(d.hasShifts ? c.blue : Color.clear).frame(width: 4, height: 4)
                            }.frame(maxWidth: .infinity)
                        }.buttonStyle(.plain)
                    }
                }.accessibilityIdentifier("swap_day_strip")

                SectionHeader(title: s.permanent ? "Swap your slot with whom?" : "Whose shift do you want?")

                // Take hours — moved right below the header (2026-07-24) so it sits beside
                // "how much of your shift to give?" above, without scrolling to the bottom
                // to compare give vs. take. Contextual to the picked person (1:1 swaps
                // only; permanent is person-level, so this is hidden when permanent is on).
                if s.takeSplittable, let t = s.take {
                    // Re-taking a counterparty shift you already took part of: spell out
                    // what you already hold from them and when (swapSegmentList).
                    if s.takeSegments.contains(where: { $0.locked }) {
                        let takePlan = planSwapSpanFor(blockIds: t.seatIds, spanStart: t.start, spanEnd: t.end,
                                                        fromBlock: Int32(s.takeFrom), toBlock: Int32(max(Int(s.takeTo), Int(s.takeFrom) + 1)))
                        swapSegmentList(s.takeSegments, dayLabel: takePlan.dayLabel, counterpartyName: t.workerName, isGive: false, c, "swap_take_timeline") { obs.focusTakeRun($0) }
                    }
                    giveRangeCard("Hours you want from \(t.workerName)",
                                  card: t, count: Int(s.takeBlockCount), from: Int(s.takeFrom), to: Int(s.takeTo),
                                  runFrom: Int(s.takeRunFrom), runTo: Int(s.takeRunTo),
                                  set: { f, t in obs.setTakeRange(f, t) }, c, "swap_take_range")
                        .id("swap_take_range")
                }

                // Once someone is picked, the roster collapses to their row alone — the
                // full list (up to 9+ housemates) would otherwise bury the hours selector
                // above it again. The chevron re-expands to pick someone else; switching
                // day re-expands automatically since that day's roster may not include the
                // current pick.
                if s.loadingWeek {
                    Text("Loading housemates…").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else if s.day.others.isEmpty {
                    Text("No housemates on this day. Try another day or week.").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else if let t = s.take, !takeExpanded {
                    selectedTakeCard(t, c) { takeExpanded = true }
                } else {
                    VStack(spacing: 8) {
                        ForEach(s.day.others, id: \.seatIds) { card in
                            takeCard(card, s, c) {
                                let wasSelected = s.take?.userId == card.userId && s.take?.seatIds == card.seatIds
                                obs.pickTake(card)
                                if !wasSelected {
                                    takeExpanded = false
                                    withAnimation { scrollProxy?.scrollTo("swap_take_range", anchor: .top) }
                                }
                            }
                        }
                    }
                    // Same shadowing issue as swap_calendar_sheet above — an identifier on
                    // this VStack would leak onto every swap_take_row button inside it.
                    .overlay(alignment: .topLeading) {
                        Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("swap_take_list")
                    }
                }

                if s.canAddLeg {
                    ShiftButton(title: "+ Add another person", action: { obs.addLeg() }, variant: .tonal, fullWidth: true)
                        .accessibilityIdentifier("swap_add_leg")
                }
                } // end !handoff calendar block

                ShiftButton(title: s.handoff ? "Hand off shift" : (legCount > 1 ? "Propose \(legCount) swaps" : "Propose swap"),
                            action: { onSubmit(obs.proposals()); dismiss() }, fullWidth: true)
                    .disabled(!s.canPropose)
                    .accessibilityIdentifier("swap_submit_button")
        }
        // An accessibilityIdentifier on a wrapping VStack leaks onto every descendant element
        // in the XCUITest tree (see the identical fix on manage_shift_sheet in ContentView.swift),
        // shadowing swap_take_row/swap_take_range/swap_take_selected/swap_give_range and every
        // other leaf identifier inside this composer. An invisible 1x1 marker carries the
        // container-level identifier instead.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("swap_calendar_sheet")
        }
        // A different day's roster may not include the current pick, so re-expand it.
        .onChange(of: s.selectedDayIndex) { _ in takeExpanded = true }
    }

    /// The give ⇄ take "deal" card at the top of the sheet — the always-visible review of
    /// the forming proposal. The give side is pinned from the tapped shift; the take side
    /// fills in as the worker picks (or stays a muted placeholder). Connector is ⇄ for a
    /// swap, → for a hand-off; a "Permanent" tag rides the card when the swap is permanent.
    private func dealCard(_ deal: SwapDeal, _ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("YOU GIVE").font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.sec)
                    Spacer(minLength: 0)
                    if s.permanent {
                        Text("Permanent").font(ShiftFont.sans(11, .semibold)).foregroundColor(c.blue)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(c.blue.opacity(0.12)).clipShape(Capsule())
                    }
                }
                Text(deal.giveTitle).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                Text(deal.giveDetail).font(ShiftFont.sans(13)).foregroundColor(c.sec)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.surfaceVar)

            HStack(spacing: 10) {
                Rectangle().fill(c.divider).frame(height: 1)
                Image(systemName: s.handoff ? "arrow.right" : "arrow.left.arrow.right")
                    .font(.system(size: 13, weight: .medium)).foregroundColor(c.blue)
                    .frame(width: 28, height: 28).background(c.blue.opacity(0.12)).clipShape(Circle())
                Rectangle().fill(c.divider).frame(height: 1)
            }
            .padding(.horizontal, 14)

            VStack(alignment: .leading, spacing: 2) {
                Text(deal.takeEyebrow.uppercased()).font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.sec)
                if let title = deal.takeTitle {
                    HStack(spacing: 10) {
                        HouseBadge(initial: deal.takeInitial ?? "?", bg: c.surfaceVar, fg: c.ink)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(title).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                            if let detail = deal.takeDetail { Text(detail).font(ShiftFont.sans(13)).foregroundColor(c.sec) }
                        }
                        Spacer(minLength: 0)
                    }.padding(.top, 4)
                } else {
                    Text(deal.takePlaceholder).font(ShiftFont.sans(14)).foregroundColor(c.ter).padding(.top, 2)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("swap_deal_card")
    }

    /// A labelled 30-min range slider that reads its position from VM state and writes back
    /// through [set] (computed bindings — the VM stays the single source of truth).
    /// A prominent give/take duration control: the picked span's live "10:00–12:00 · 2h"
    /// label over a stepped 30-min range slider. Used for the give-shift trim (above the
    /// calendar) and the take-hours trim (under the picked person).
    private func giveRangeCard(_ title: String, card: SwapDayCard, count: Int, from: Int, to: Int,
                               runFrom: Int = 0, runTo: Int = -1,
                               set: @escaping (Int, Int) -> Void, _ c: ShiftColors, _ id: String) -> some View {
        let plan = planSwapSpanFor(blockIds: card.seatIds, spanStart: card.start, spanEnd: card.end,
                                   fromBlock: Int32(from), toBlock: Int32(max(to, from + 1)))
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(ShiftFont.sans(13, .medium)).foregroundColor(c.sec)
            Text("\(plan.rangeLabel) · \(plan.durationLabel)\(plan.wholeSpan ? " · whole shift" : "")")
                .font(ShiftFont.mono(13.5, .semibold)).monospacedDigit().foregroundColor(c.ink)
            BlockRangeSlider(
                blockCount: count,
                from: Binding(get: { from }, set: { set($0, to) }),
                to: Binding(get: { to }, set: { set(from, $0) }),
                lowerBound: runFrom,
                upperBound: runTo
            )
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier(id)
    }

    /// The give/take split, once part of the shift is already spoken for: one row per
    /// segment, each spelling out who has it and when ("You gave it to Drew", "Fri · Jul 24 ·
    /// 23:00 - 00:00"), not just a bare name in a compact strip (2026-07-25, replacing the
    /// compact segmented timeline that read "Giving" / "Drew" with no date, which lost the
    /// plot once more than one leg was in play). Locked rows show who holds that piece; the
    /// free run is tap-to-focus for the slider below. Shown only once a part is reserved, so
    /// the common single-leg case stays a plain slider with no list at all.
    private func swapSegmentList(_ segments: [SwapSegment], dayLabel: String, counterpartyName: String,
                                 isGive: Bool, _ c: ShiftColors, _ id: String,
                                 focus: @escaping (Int) -> Void) -> some View {
        VStack(spacing: 6) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                segmentRow(seg, dayLabel: dayLabel, counterpartyName: counterpartyName, isGive: isGive, c, focus)
            }
        }
        .accessibilityIdentifier(id)
    }

    private func segmentRow(_ seg: SwapSegment, dayLabel: String, counterpartyName: String, isGive: Bool,
                            _ c: ShiftColors, _ focus: @escaping (Int) -> Void) -> some View {
        let locked = seg.locked
        let active = seg.active
        let focusable = !locked && !active
        let bg = locked ? c.surfaceVar : (active ? c.blue.opacity(0.08) : c.surface)
        let border = active ? c.blue : c.divider
        let title = isGive
            ? (locked ? "You → \(seg.note ?? counterpartyName)" : "You give")
            : (locked ? "\(counterpartyName) → You" : "You take")
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(ShiftFont.sans(14, .semibold)).foregroundColor(active ? c.blue : c.ink)
                Text("\(dayLabel) · \(seg.rangeLabel)").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            if focusable {
                Text("Tap to adjust").font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
            }
        }
        .padding(.horizontal, 13).padding(.vertical, 11)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(border, lineWidth: active ? 1.5 : 1))
        .contentShape(Rectangle())
        .accessibilityIdentifier(locked ? "swap_seg_locked" : (active ? "swap_seg_active" : "swap_seg_free"))
        .onTapGesture { if focusable { focus(Int(seg.from)) } }
    }

    /// The same-person "give the next part to X too" chip (accent, one tap → [acceptSuggestion]).
    private func suggestionChip(_ sug: SwapLegSuggestion, _ c: ShiftColors) -> some View {
        Button(action: { obs.acceptSuggestion() }) {
            HStack(spacing: 8) {
                Image(systemName: "plus").font(.system(size: 14, weight: .semibold)).foregroundColor(c.blue)
                Text(sug.label).font(ShiftFont.sans(13, .medium)).foregroundColor(c.blue)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundColor(c.blue)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(c.blue.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.blue.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("swap_suggestion")
    }

    /// The permanent-swap toggle as a prominent card (§8.3) — promoted from the old tiny
    /// checkbox, shown up front and partial-aware (the give control above still applies).
    private func permanentToggleCard(_ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        Button(action: { obs.togglePermanent() }) {
            HStack(spacing: 12) {
                Image(systemName: s.permanent ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20)).foregroundColor(s.permanent ? c.blue : c.outline)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Make it permanent").font(ShiftFont.sans(14, .medium)).foregroundColor(c.ink)
                    Text("Swap this slot every week for the rest of the period").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(s.permanent ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(s.permanent ? c.blue : c.divider, lineWidth: s.permanent ? 1.5 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("swap_permanent_toggle")
    }

    private func modeButton(_ title: String, handoff: Bool, _ c: ShiftColors, _ s: SwapCalendarUiState) -> some View {
        let on = s.handoff == handoff
        return Button(action: { obs.setHandoff(handoff) }) {
            Text(title)
                .font(ShiftFont.sans(13.5, on ? .semibold : .regular))
                .foregroundColor(on ? .white : c.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(on ? c.blue : c.surfaceVar)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(handoff ? "swap_mode_handoff" : "swap_mode_swap")
    }

    private func takeCard(_ card: SwapDayCard, _ s: SwapCalendarUiState, _ c: ShiftColors, onTap: @escaping () -> Void) -> some View {
        let sel = s.take?.userId == card.userId && s.take?.seatIds == card.seatIds
        return Button(action: onTap) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(card.workerName.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.workerName).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Text("\(card.timeLabel) · \(card.durationLabel)").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
                if sel { Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(sel ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(sel ? c.blue : c.divider, lineWidth: sel ? 1.5 : 1))
        }.buttonStyle(.plain).accessibilityIdentifier("swap_take_row")
    }

    /// The picked take-candidate, collapsed to one row once selected — the full [takeCard]
    /// list underneath it would otherwise push the hours selector (moved up beside it) back
    /// below the fold. Tapping the row re-expands the list to pick someone else.
    private func selectedTakeCard(_ card: SwapDayCard, _ c: ShiftColors, onExpand: @escaping () -> Void) -> some View {
        Button(action: onExpand) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(card.workerName.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.workerName).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Text("\(card.timeLabel) · \(card.durationLabel)").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                }
                Spacer(minLength: 0)
                Image(systemName: ShiftIcons.chevronRight).font(.system(size: 14, weight: .semibold)).foregroundColor(c.outline)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(c.blue.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(c.blue, lineWidth: 1.5))
        }.buttonStyle(.plain).accessibilityIdentifier("swap_take_selected")
    }

    // MARK: hand-off recipient directory (§8.5)

    /// The hand-off recipient directory — "My House" (own roster, flat) + "Others" (every
    /// other house, grouped + searchable, since 10+ houses × ~8 workers is too long to
    /// scan). Eligible recipients only (the VM pre-filters); the server stays authoritative.
    private func handoffPicker(_ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        let dir = s.handoffDirectory
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                handoffTabButton("My House", tab: 0, c)
                handoffTabButton("Others", tab: 1, c)
            }
            if handoffTab == 0 {
                if dir.myHouse.isEmpty {
                    Text("No eligible workers in your house.").font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else {
                    VStack(spacing: 8) {
                        ForEach(dir.myHouse, id: \.userId) { w in handoffWorkerRow(w, s, c) }
                    }.accessibilityIdentifier("handoff_my_house_list")
                }
            } else {
                handoffSearchField(s, c)
                if dir.others.isEmpty {
                    Text(s.handoffQuery.isEmpty ? "No eligible workers in other houses." : "No matches for \"\(s.handoffQuery)\".")
                        .font(ShiftFont.sans(13)).foregroundColor(c.ter)
                } else {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(dir.others, id: \.houseId) { group in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(group.houseName.uppercased()).font(ShiftFont.sans(11, .medium)).tracking(0.5).foregroundColor(c.sec)
                                ForEach(group.workers, id: \.userId) { w in handoffWorkerRow(w, s, c) }
                            }
                        }
                    }.accessibilityIdentifier("handoff_others_list")
                }
            }
        }.accessibilityIdentifier("handoff_picker")
    }

    private func handoffTabButton(_ title: String, tab: Int, _ c: ShiftColors) -> some View {
        let on = handoffTab == tab
        return Button(action: { handoffTab = tab }) {
            Text(title)
                .font(ShiftFont.sans(13.5, on ? .semibold : .regular))
                .foregroundColor(on ? .white : c.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(on ? c.blue : c.surfaceVar)
                .clipShape(Capsule())
        }.buttonStyle(.plain)
        .accessibilityIdentifier(tab == 0 ? "handoff_tab_my_house" : "handoff_tab_others")
    }

    private func handoffWorkerRow(_ w: HandoffWorker, _ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        let sel = s.recipient?.userId == w.userId
        return Button(action: { obs.pickRecipient(w) }) {
            HStack(spacing: 10) {
                HouseBadge(initial: String(w.name.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                Text(w.name).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                Spacer(minLength: 0)
                if sel { Image(systemName: ShiftIcons.checkCircle).font(.system(size: 16)).foregroundColor(c.blue) }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(sel ? c.blue.opacity(0.08) : c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(sel ? c.blue : c.divider, lineWidth: sel ? 1.5 : 1))
        }.buttonStyle(.plain).accessibilityIdentifier("handoff_worker_row")
    }

    private func handoffSearchField(_ s: SwapCalendarUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundColor(c.ter)
            TextField("Search workers or houses", text: Binding(get: { s.handoffQuery }, set: { obs.setHandoffQuery($0) }))
                .font(ShiftFont.sans(14)).foregroundColor(c.ink)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("handoff_search_field")
            if !s.handoffQuery.isEmpty {
                Button(action: { obs.setHandoffQuery("") }) {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(c.sec)
                }.buttonStyle(.plain).accessibilityIdentifier("handoff_search_clear")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 11)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("handoff_search")
    }
}
