import SwiftUI
import Shared

/// The House tab: §11.4 home-house schedule (Excel-style week grid) + contact lookup (T3b).
///
/// Split out of ContentView.swift (a quarantined God class, AGENTS.md §5.2) as its own
/// extension file. The `@State`/`@StateObject` storage this code reads and writes stays
/// declared on `ShiftsRootView` itself in ContentView.swift (Swift extensions cannot add
/// stored properties) at `internal` access so it is visible here.
extension ShiftsRootView {
    /// The home-house schedule as a week grid: a fixed left time rail + Mon–Sun day
    /// columns that scroll sideways (the rail stays put), concurrent desks side-by-side.
    /// The week navigator (last week … +4) pages the grid; tapping a staffed block opens
    /// the contact sheet — the "who do I swap with" affordance.
    /// The home-house schedule as a week grid: a fixed left time rail + Mon-Sun day
    /// columns that scroll sideways (the rail stays put), concurrent desks side-by-side.
    /// The week navigator (last week to +4) pages the grid; tapping a staffed block opens
    /// the contact sheet, the "who do I swap with" affordance.
    ///
    /// SPLIT IN TWO deliberately. The layout and the eight presentation modifiers used to
    /// be a single expression, and Swift type-checks an expression as a whole: it tipped
    /// past the solver's budget and failed the build with "unable to type-check this
    /// expression in reasonable time". AnyView at the seam erases the accumulated generic
    /// type so each half is solved on its own. Do not merge them back.
    var houseTab: some View {
        let c = ShiftColors.resolve(scheme)
        let st = houseModel.state
        return houseTabLayout(st, c)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityIdentifier("house_screen")
        .task { await houseModel.loadHouses() }
        // Reload whenever the shown house OR week changes (switching re-centres on today).
        .task(id: "\(st.selectedHouseId ?? "")#\(st.weekOffset)") { await houseModel.loadWeek() }
        .sheet(isPresented: $showHouseWeekPicker) { houseWeekPickerSheet(st, c) }
        .sheet(isPresented: $showHousePicker) { housePickerSheet(st, c) }
        .sheet(item: $contactTarget) { block in
            ContactSheetView(
                block: block,
                deskPhone: houseModel.state.deskPhone,
                deskHouseName: houseModel.state.houseName
            )
        }
        // Manager tap on an OPEN seat (canManage) → choose an action.
        .confirmationDialog(
            "Open seat",
            isPresented: Binding(get: { houseActionTarget != nil }, set: { if !$0 { houseActionTarget = nil } }),
            titleVisibility: .visible,
            presenting: houseActionTarget
        ) { block in
            Button("Assign a worker") { assignTarget = block }
            Button("Get coverage now") { coverageTarget = block }
            Button("Cancel", role: .cancel) { }
        } message: { block in
            Text("\(st.houseName) · \(block.timeLabel)")
        }
        // "Assign a worker" — roster picker; the sheet owns the assign call + soft-advisory
        // confirm and reports the terminal result back here for the toast + grid refetch.
        .sheet(item: $assignTarget) { block in
            AssignWorkerSheet(
                houseName: st.houseName,
                houseId: st.selectedHouseId ?? st.homeHouseId ?? "",
                block: block,
                onAssigned: { count in
                    assignTarget = nil
                    claimSuccessMessage = count == 1 ? "Worker assigned" : "Worker assigned to \(count) blocks"
                    Task { await houseModel.loadWeek() }
                },
                onRejected: { message in assignTarget = nil; writeError = message },
                onFailed: { assignTarget = nil; writeError = "That could not be done. Try again." }
            )
        }
        // "Get coverage now" — force-trigger a float lookup for the vacant run.
        .confirmationDialog(
            "Get coverage now",
            isPresented: Binding(get: { coverageTarget != nil }, set: { if !$0 { coverageTarget = nil } }),
            titleVisibility: .visible,
            presenting: coverageTarget
        ) { block in
            Button("Run float lookup") { triggerCoverage(block) }
            Button("Cancel", role: .cancel) { }
        } message: { _ in
            Text("Run a float lookup to cover this seat now?")
        }
    }

    /// The grid itself: header, legend, scrolling week, week navigator.
    private func houseTabLayout(_ st: HouseScheduleUiState, _ c: ShiftColors) -> AnyView {
        AnyView(VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "House") {
                HouseGridTourHelpButton { houseGridTourModel.replay() }
            }
            houseHeaderCard(st, c)
            houseLegend(c)
            houseGrid(st.grid, st, c)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            houseWeekNavBar(st, c)
        })
    }

    /// Force-trigger a float lookup for the tapped vacant run (BSpec §6.6). Best-effort:
    /// on success show the confirmation toast + refetch the grid; a server rejection or a
    /// network failure surfaces the error toast. Own-house is enforced server-side.
    private func triggerCoverage(_ block: HouseGridBlock) {
        let houseId = houseModel.state.selectedHouseId ?? houseModel.state.homeHouseId ?? ""
        let ids = block.assignmentIds
        Task { @MainActor in
            do {
                let outcome = try await WorkerBackend.shared.managerRepository.forceTrigger(houseId: houseId, assignmentIds: ids)
                switch onEnum(of: outcome) {
                case .triggered:
                    claimSuccessMessage = "Coverage requested"
                    await houseModel.loadWeek()
                case .rejected(let r):
                    writeError = r.message
                case .failed:
                    writeError = "That could not be done. Try again."
                }
            } catch {
                writeError = "That could not be done. Try again."
            }
        }
    }

    /// The house header — a DROPDOWN (2026-06-23 cross-house ruling): tapping the card opens
    /// the switcher, EXCEPT the desk-phone line, which dials the desk (the device dialer
    /// opens with the number prefilled; it does not auto-call).
    private func houseHeaderCard(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 12) {
            HouseBadge(initial: String(st.houseName.prefix(1)), bg: c.blueContainer, fg: c.blue)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(st.houseName).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                    if st.isHomeHouse {
                        Text("Your house")
                            .font(ShiftFont.sans(10.5, .semibold)).foregroundColor(c.blue)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(c.blueContainer)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                }
                if let desk = st.deskPhone {
                    Button(action: { dial(desk) }) {
                        HStack(spacing: 5) {
                            Image(systemName: ShiftIcons.phone).font(.system(size: 12)).foregroundColor(c.blue)
                            Text("Desk · \(desk)").font(ShiftFont.sans(13, .medium)).foregroundColor(c.blue)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("house_call_desk")
                } else {
                    Text("House schedule").font(ShiftFont.sans(13)).foregroundColor(c.sec)
                }
            }
            Spacer(minLength: 0)
            if st.canSwitchHouse {
                Image(systemName: "chevron.down").font(.system(size: 14, weight: .semibold)).foregroundColor(c.ter)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { if st.canSwitchHouse { showHousePicker = true } }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .accessibilityIdentifier("house_picker_open")
    }

    /// The house switcher (cross-house view): pick any house to read its schedule.
    private func housePickerSheet(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        ShiftSheet(title: "View a house", onClose: { showHousePicker = false }) {
            VStack(spacing: 8) {
                ForEach(st.houses, id: \.id) { house in
                    let selected = house.id == st.selectedHouseId
                    Button(action: {
                        houseModel.selectHouse(house.id)
                        showHousePicker = false
                    }) {
                        HStack(spacing: 10) {
                            HouseBadge(initial: String(house.name.prefix(1)), bg: c.surfaceVar, fg: c.ink)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(house.name).font(ShiftFont.sans(14.5, .semibold)).foregroundColor(c.ink)
                                    if house.id == st.homeHouseId {
                                        Text("Your house").font(ShiftFont.sans(10, .semibold)).foregroundColor(c.blue)
                                    }
                                }
                                Text(house.deskPhone.map { "Desk · \($0)" } ?? "No desk phone")
                                    .font(ShiftFont.sans(12)).foregroundColor(c.sec)
                            }
                            Spacer(minLength: 0)
                            if selected {
                                Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold)).foregroundColor(c.blue)
                            }
                        }
                        .padding(.horizontal, 13).padding(.vertical, 12)
                        .background(selected ? c.blueContainer.opacity(0.45) : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? c.blue : c.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("house_picker_option")
                }
            }
            .accessibilityIdentifier("house_picker_sheet")
        }
    }

    /// Legend strip (design): You / Float-in / Open + the swipe-sideways hint.
    private func houseLegend(_ c: ShiftColors) -> some View {
        HStack(spacing: 10) {
            houseLegendSwatch(c.blueContainer, c.blue, "You", dashed: false, c)
            houseLegendSwatch(c.floatIn.tint, c.floatIn.accent, "Float-in", dashed: false, c)
            houseLegendSwatch(c.surface, c.outline, "Open", dashed: true, c)
            Spacer(minLength: 0)
            Text("Swipe").font(ShiftFont.sans(11)).foregroundColor(c.ter)
            Image(systemName: ShiftIcons.chevronRight).font(.system(size: 11, weight: .semibold)).foregroundColor(c.ter)
        }
        .padding(.horizontal, 16).padding(.vertical, 4)
    }

    private func houseLegendSwatch(_ fill: Color, _ accent: Color, _ label: String, dashed: Bool, _ c: ShiftColors) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(fill)
                .frame(width: 10, height: 10)
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(accent, style: StrokeStyle(lineWidth: dashed ? 1.5 : 1, dash: dashed ? [3, 2] : []))
                )
            Text(label).font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
        }
    }

    /// The grid: a frozen left time rail + horizontally-scrolling day columns, with a
    /// frozen day-header row above. The body's horizontal offset is mirrored to the header
    /// (`houseHOffset`) so the headers track the columns; the rail sits outside the
    /// horizontal scroll, so it stays put when the days scroll sideways — the requirement.
    private func houseGrid(_ grid: HouseGridWeek, _ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        let lanes = max(Int(grid.laneCount), 1)
        let colW = CGFloat(lanes) * Self.houseLaneW + CGFloat(lanes - 1) * Self.houseLaneGap + Self.houseColPad * 2
        let startMin = Int(grid.startMin)
        let endMin = Int(grid.endMin)
        let gridHeight = Self.housePxPerHour * CGFloat(endMin - startMin) / 60
        let focusDayIndex = Int(st.todayIndex)
        let nowMin = Int(st.nowMinOfDay)
        // Re-centre the scroll on open / house-switch / week-change (and when seats land and
        // expand the bounds): the today column scrolls into view + the body drops to "now".
        let scrollTrigger = "\(st.selectedHouseId ?? "")#\(st.weekOffset)#\(startMin)#\(lanes)"
        return ScrollViewReader { proxy in
            VStack(spacing: 0) {
                // Frozen day-header row — horizontally synced to the body via houseHOffset.
                HStack(spacing: 0) {
                    Color.clear.frame(width: Self.houseRailW, height: Self.houseHeaderH)
                    GeometryReader { _ in
                        HStack(spacing: Self.houseColGap) {
                            ForEach(grid.days, id: \.index) { day in houseDayHeader(day, colW, c) }
                        }
                        .offset(x: houseHOffset)
                    }
                    .frame(height: Self.houseHeaderH, alignment: .leading)
                    .clipped()
                }
                .padding(.leading, 12)
                // Body: rail (frozen horizontally) + horizontally-scrolling columns.
                ScrollView(.vertical, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 0) {
                        houseTimeRail(startMin, endMin, gridHeight, nowMin, c)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Self.houseColGap) {
                                ForEach(grid.days, id: \.index) { day in
                                    houseDayColumn(day, colW, gridHeight, startMin, endMin, c)
                                        .id("house-day-\(day.index)")
                                }
                            }
                            .padding(.trailing, 8)
                            .background(
                                GeometryReader { g in
                                    Color.clear.preference(key: HouseHScrollKey.self, value: g.frame(in: .named("houseHBody")).minX)
                                }
                            )
                        }
                        .coordinateSpace(name: "houseHBody")
                        // Mirror the body's live horizontal offset to the frozen header row so the
                        // dates track the columns. `onScrollGeometryChange` (iOS 18+) reads the
                        // scroll's `contentOffset` continuously during the gesture — reliable where
                        // the preference-frame read below silently fails to update mid-scroll. The
                        // preference path stays as the pre-iOS-18 fallback.
                        .onPreferenceChange(HouseHScrollKey.self) { houseHOffset = $0 }
                        .houseTrackHScroll { houseHOffset = $0 }
                    }
                    .padding(.leading, 12).padding(.top, 2).padding(.bottom, 8)
                }
            }
            .onChange(of: scrollTrigger) { _ in scrollToToday(proxy, focusDayIndex) }
            .onAppear { scrollToToday(proxy, focusDayIndex) }
        }
    }

    /// Scroll the grid so today's column is visible (it may sit at the end of the week) and
    /// the body drops to the current hour. No-op when the shown week has no "today".
    private func scrollToToday(_ proxy: ScrollViewProxy, _ focusDayIndex: Int) {
        guard focusDayIndex >= 0 else { return }
        DispatchQueue.main.async {
            withAnimation(.easeInOut(duration: 0.25)) {
                proxy.scrollTo("house-day-\(focusDayIndex)", anchor: .leading)
                proxy.scrollTo("house-now", anchor: .center)
            }
        }
    }

    /// The 2-hour clock marks (e.g. 06:00, 08:00, …) strictly between `startMin` and `endMin`
    /// — shared by the rail's labels and each day column's gridlines.
    private func houseHourMarks(_ startMin: Int, _ endMin: Int) -> [Int] {
        var marks: [Int] = []
        var h = (startMin / 120 + 1) * 120
        while h < endMin {
            marks.append(h)
            h += 120
        }
        return marks
    }

    private func fmtHm(_ min: Int) -> String { String(format: "%02d:%02d", min / 60, min % 60) }

    /// The fixed left time rail — frozen during sideways scroll. The top label is the EXACT
    /// grid origin (e.g. "05:30" when that's the week's earliest actual shift start, not
    /// rounded to an hour), then a label at every 2-hour clock mark, and a final label at the
    /// bottom bound. Carries a hidden "house-now" anchor at the current time so the body can
    /// scroll to it.
    private func houseTimeRail(_ startMin: Int, _ endMin: Int, _ gridHeight: CGFloat, _ nowMin: Int, _ c: ShiftColors) -> some View {
        let labels = Array(Set([startMin, endMin] + houseHourMarks(startMin, endMin))).sorted()
        return ZStack(alignment: .topTrailing) {
            Color.clear.frame(width: Self.houseRailW, height: gridHeight)
            Color.clear.frame(width: Self.houseRailW, height: 1)
                .offset(y: max(Self.housePxPerHour * CGFloat(nowMin - startMin) / 60, 0))
                .id("house-now")
            ForEach(labels, id: \.self) { m in
                Text(fmtHm(m))
                    .font(ShiftFont.mono(10)).monospacedDigit().foregroundColor(c.ter)
                    .offset(y: max(Self.housePxPerHour * CGFloat(m - startMin) / 60 - 5, 0))
                    .padding(.trailing, 6)
            }
        }
        .frame(width: Self.houseRailW, height: gridHeight, alignment: .topTrailing)
        .accessibilityIdentifier("house_time_rail")
    }

    /// One Mon–Sun header cell (day + date), highlighted when it is today.
    private func houseDayHeader(_ day: HouseGridDay, _ colW: CGFloat, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            Text(day.dayLabel).font(ShiftFont.sans(11, .semibold)).foregroundColor(day.isToday ? c.blue : c.ter)
            Text(day.dateLabel).font(ShiftFont.mono(13)).monospacedDigit().fontWeight(.semibold)
                .foregroundColor(day.isToday ? c.blue : c.ink)
        }
        .frame(width: colW, height: Self.houseHeaderH)
        .background(day.isToday ? c.blue.opacity(0.10) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// One day column: the surface card + 2-hour gridlines + the lane-placed blocks.
    private func houseDayColumn(
        _ day: HouseGridDay, _ colW: CGFloat, _ gridHeight: CGFloat, _ startMin: Int, _ endMin: Int, _ c: ShiftColors
    ) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(c.surface)
                .frame(width: colW, height: gridHeight)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
            ForEach(houseHourMarks(startMin, endMin), id: \.self) { h in
                Rectangle().fill(c.divider.opacity(0.6))
                    .frame(width: colW, height: 1)
                    .offset(y: Self.housePxPerHour * CGFloat(h - startMin) / 60)
            }
            ForEach(day.blocks, id: \.id) { b in houseBlockView(b, colW, startMin, day.isToday, c) }
        }
        .frame(width: colW, height: gridHeight, alignment: .topLeading)
        .accessibilityIdentifier("house_day_column")
    }

    /// One positioned desk block, coloured by its state (design `HouseBlock`).
    ///
    /// Two colour systems, in this order:
    ///
    /// 1. **Per-worker colour** (docs/design/worker-colors.md) — a plain SCHEDULED seat
    ///    wears its occupant's own colour, a pure hash of their `user_id`, so the same
    ///    person reads the same here and on the web calendars. Fill is that colour at
    ///    90%, the leading rail and border full strength, the name its contrast foreground.
    /// 2. **State colour** — float-in, pending and vacant seats KEEP their state colours,
    ///    because those carry meaning (a float must still read as a float).
    ///
    /// The "mine" emphasis rides on top of either: my shift TODAY keeps its solid brand
    /// ring so it's still the one block that pops.
    ///
    /// 3. **Find-mine dimming** — a grid where every seat wears a saturated colour is
    ///    pretty but useless for the one question a worker actually asks ("where am I?").
    ///    So every seat that is NOT mine recedes (mixed toward white; see the recede
    ///    block below); mine stays at full strength in its own colour. Vacant seats are
    ///    not anyone's card and are not dimmed (they're the actionable open-seat
    ///    affordance for a manager).
    private func houseBlockView(_ b: HouseGridBlock, _ colW: CGFloat, _ startMin: Int, _ isToday: Bool, _ c: ShiftColors) -> some View {
        let top = Self.housePxPerHour * CGFloat(Int(b.startMin) - startMin) / 60
        let h = max(Self.housePxPerHour * CGFloat(Int(b.endMin) - Int(b.startMin)) / 60 - 3, 18)
        // A desk that's never concurrent with another during this run (segmentLanes == 1)
        // collapses to one full-width column instead of a narrow lane next to empty space.
        let collapsed = Int(b.segmentLanes) <= 1
        let width = collapsed ? colW - Self.houseColPad * 2 : Self.houseLaneW
        let x = collapsed ? Self.houseColPad : Self.houseColPad + (Self.houseLaneW + Self.houseLaneGap) * CGFloat(Int(b.lane))
        let bg: Color
        let accent: Color
        let fg: Color
        // mine + today → solid blue ring (the one block that should pop).
        var emphatic = false
        let wc = WorkerTint.forBlock(b)
        if b.vacant {
            bg = c.surface; accent = c.outline; fg = c.ter
        } else if let wc {
            bg = wc.color.opacity(0.90); accent = wc.color; fg = wc.onColor
            emphatic = b.mine && isToday
        } else if b.mine && b.floatIn {
            bg = c.floatIn.tint; accent = c.floatIn.accent; fg = c.floatIn.deep
        } else if b.mine && isToday {
            bg = c.today; accent = c.blue; fg = c.onBlueContainer; emphatic = true
        } else if b.mine {
            bg = c.blueContainer.opacity(0.5); accent = c.blue.opacity(0.5); fg = c.onBlueContainer
        } else if b.pending {
            bg = c.surfaceVar; accent = c.pending; fg = c.ink
        } else if b.floatIn {
            bg = c.floatIn.tint; accent = c.floatIn.accent; fg = c.floatIn.deep
        } else {
            bg = c.surfaceVar; accent = c.outline; fg = c.ink
        }
        // The time label keeps a hint of the worker's hue without losing contrast (web:
        // `color-mix(in srgb, F 75%, C 25%)`); on a state-coloured block it's just `fg`.
        let timeFg = wc.map { $0.labelColor(0.25) } ?? fg
        // Everyone else's seats recede so mine is findable at a glance (see doc comment #3).
        // Recede by MIXING the fill/border toward white, not by reducing alpha: alpha-
        // blending a saturated fill over the (often dark) app background reads as a
        // translucent glow, and it silently breaks `fg`'s contrast decision. `fg` is chosen
        // against the FULL-strength color, so light-on-vivid text can go illegible once
        // that fill is diluted toward a dark ground (the black-on-purple bug). White-mixing
        // is a flat, predictable lighten regardless of theme, so receded text switches to
        // one fixed dark ink instead of the per-block `fg`/`timeFg`.
        let receded = !(b.mine || b.vacant)
        let recededBg = receded ? bg.mixedWithWhite(Self.houseOtherWhiteMix).opacity(Self.houseOtherFinalAlpha) : bg
        let recededAccent = receded ? accent.mixedWithWhite(Self.houseOtherWhiteMix) : accent
        let displayFg = receded ? Self.houseRecededInk : fg
        let displayTimeFg = receded ? Self.houseRecededInk.opacity(0.65) : timeFg
        let displayPendingFg = receded ? Self.houseRecededInk.opacity(0.8) : c.pending
        let borderColor: Color =
            b.vacant ? accent
                : (emphatic ? c.blue
                    : (wc != nil ? recededAccent : recededAccent.opacity(0.45)))
        return VStack(alignment: .leading, spacing: 1) {
            Text(b.timeLabel).font(ShiftFont.mono(10.5)).monospacedDigit().foregroundColor(displayTimeFg).lineLimit(1)
            Text(b.workerLabel + (b.mine && b.floatIn ? " ·float" : ""))
                .font(ShiftFont.sans(12, .semibold)).foregroundColor(displayFg).lineLimit(1)
            if b.pending {
                Text("Pending").font(ShiftFont.sans(10, .semibold)).foregroundColor(displayPendingFg).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 7).padding(.trailing, 5).padding(.top, 4).padding(.bottom, 3)
        .frame(width: width, height: h, alignment: .topLeading)
        .background(recededBg)
        .overlay(alignment: .leading) { Rectangle().fill(recededAccent).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(
                    borderColor,
                    style: StrokeStyle(lineWidth: b.vacant ? 1.5 : (emphatic ? 1.5 : 1), dash: b.vacant ? [6, 4] : [])
                )
        )
        // Hit region and gesture MUST be attached BEFORE `.offset`, never after.
        // `.offset` is a render-only transform: it moves the drawn result but leaves the
        // view's LAYOUT bounds at the ZStack's top-leading origin. A `.contentShape`
        // applied after it therefore builds the tap target from those un-offset bounds,
        // so every block in a column stacks its hit rect at (0,0) while drawing at
        // (x, top) — taps then resolve by z-order to some OTHER block (wrong contact
        // card), or to a vacant one whose handler no-ops (nothing opens at all).
        // Declared here, the shape is the block's own bounds and `.offset` transforms
        // the rendering and the hit region together.
        .contentShape(Rectangle())
        // `.highPriorityGesture`, not `.onTapGesture`: the block sits inside nested
        // vertical + horizontal `ScrollView`s (the House grid body), whose pan gesture
        // recognizers otherwise win the race for a stationary tap. High-priority still
        // lets a genuine drag pass through once it exceeds the tap gesture's slop.
        .highPriorityGesture(
            TapGesture().onEnded {
                if b.vacant {
                    // A manager on the home house gets the open-seat actions; everyone else
                    // sees an open seat as passive (view-only).
                    if houseModel.state.canManage { houseActionTarget = b }
                } else {
                    contactTarget = b
                }
            }
        )
        .offset(x: x, y: top)
        .accessibilityIdentifier("house_grid_block")
    }

    /// The week navigator (last week … +4) — the same slim bottom bar as My Shifts.
    private func houseWeekNavBar(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 0) {
                if st.canPreviousWeek {
                    Button(action: { houseModel.prevWeek() }) {
                        Image(systemName: "chevron.left").font(.system(size: 18, weight: .semibold))
                            .foregroundColor(c.sec).frame(width: 40, height: 40)
                    }.buttonStyle(.plain).accessibilityIdentifier("house_prev_week")
                } else {
                    Spacer().frame(width: 40)
                }
                Button(action: { showHouseWeekPicker = true }) {
                    HStack(spacing: 7) {
                        Image(systemName: ShiftIcons.calendar).font(.system(size: 18)).foregroundColor(c.blue)
                        Text(st.weekRelative).font(ShiftFont.sans(15.5, .semibold)).foregroundColor(c.ink)
                        Text("·  \(st.weekRange)").font(ShiftFont.sans(14)).foregroundColor(c.sec)
                    }
                    .frame(maxWidth: .infinity).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("house_week_picker_open")
                if st.canNextWeek {
                    Button(action: { houseModel.nextWeek() }) {
                        Image(systemName: "chevron.right").font(.system(size: 18, weight: .semibold))
                            .foregroundColor(c.sec).frame(width: 40, height: 40)
                    }.buttonStyle(.plain).accessibilityIdentifier("house_next_week")
                } else {
                    Spacer().frame(width: 40)
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9).background(c.surface)
        }
    }

    /// The week-picker sheet (last week … +4) — mirrors the calendar's picker.
    private func houseWeekPickerSheet(_ st: HouseScheduleUiState, _ c: ShiftColors) -> some View {
        ShiftSheet(title: "Pick a week", onClose: { showHouseWeekPicker = false }) {
            VStack(spacing: 8) {
                ForEach(st.weekOptions, id: \.offset) { option in
                    Button(action: {
                        houseModel.selectWeek(Int(option.offset))
                        showHouseWeekPicker = false
                    }) {
                        HStack {
                            Text(option.label).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                            Spacer(minLength: 0)
                            Text(option.rangeLabel).font(ShiftFont.mono(12.5)).monospacedDigit().foregroundColor(c.sec)
                        }
                        .padding(.horizontal, 13).padding(.vertical, 11)
                        .background(Int(st.weekOffset) == Int(option.offset) ? c.today : c.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(option.offset == 0 ? c.blue : c.divider, lineWidth: option.offset == 0 ? 1.5 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("house_week_picker_option")
                }
            }
            .accessibilityIdentifier("house_week_picker_sheet")
        }
    }

    private func dial(_ phone: String) {
        let digits = phone.filter { !$0.isWhitespace }
        if let url = URL(string: "tel://\(digits)") {
            UIApplication.shared.open(url)
        }
    }
}

/// Reports the House grid's horizontal day-column scroll offset (≤ 0) so the frozen
/// day-header row can track it. Last value wins (one scroll view feeds it).
private struct HouseHScrollKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private extension View {
    /// Continuously mirror a horizontal `ScrollView`'s content offset to `onOffset` (≤ 0,
    /// matching the preference convention) so the House grid's frozen day-header row tracks
    /// the columns as they scroll sideways. `onScrollGeometryChange` (iOS 18+) updates on
    /// every offset change during the drag; on older systems this is a no-op and the
    /// `HouseHScrollKey` preference path remains the (best-effort) fallback.
    @ViewBuilder
    func houseTrackHScroll(_ onOffset: @escaping (CGFloat) -> Void) -> some View {
        if #available(iOS 18.0, *) {
            self.onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x } action: { _, x in
                onOffset(-x)
            }
        } else {
            self
        }
    }
}
