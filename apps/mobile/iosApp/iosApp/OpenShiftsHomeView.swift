import SwiftUI
import Shared

/// Tab 2 of Open Shifts — "Open in My House" (BEHAVIORAL_SPECIFICATION.md §5.6 Tab 2).
///
/// Split out of ContentView.swift (a quarantined God class, AGENTS.md §5.2) as its own
/// extension file. The `@State`/`@StateObject` storage this code reads (`model`,
/// `claimTarget`, `scheme`) stays declared on `ShiftsRootView` itself in ContentView.swift
/// (Swift extensions cannot add stored properties); `pastOpenShiftsSection` and
/// `openKitState`/`isPermanentOpen` are shared with the "Other Houses" tab and stay there.
extension ShiftsRootView {
    var homeOpen: some View {
        let c = ShiftColors.resolve(scheme)
        // Split the shown-week feed: upcoming in the live section, already-started ones in
        // the collapsed-by-default "Earlier this week" card.
        let weeklySplit = model.vm.pastUpcoming(openShifts: model.state.homeOpen.weekly)
        return VStack(alignment: .leading, spacing: 22) {
            ShiftSection(
                title: "Weekly open shifts",
                isEmpty: weeklySplit.upcoming.isEmpty,
                count: weeklySplit.upcoming.count,
                emptyText: "No open shifts in your house this week.",
                prominent: true,
                icon: ShiftIcons.calendar,
                accent: c.pickupDot
            ) {
                // Same-day openings collapse under one outer card so a busy week doesn't
                // read as a wall of near-identical rows (product decision 2026-08-06). A
                // day with a single opening renders bare, exactly as it did before.
                VStack(spacing: 10) {
                    ForEach(ShiftsKt.groupOpenShiftsByDay(shifts: weeklySplit.upcoming, zone: ShiftsKt.NEW_YORK), id: \.key) { group in
                        if Int(group.count) > 1 {
                            dayGroupCard(group, c)
                        } else if let single = group.shifts.first {
                            openFeedCard(single)
                        }
                    }
                }
            }
            .accessibilityIdentifier("home_weekly_feed")

            if !weeklySplit.past.isEmpty {
                pastOpenShiftsSection(weeklySplit.past, c)
            }

            ShiftSection(
                title: "Permanent openings",
                isEmpty: model.state.homeOpen.permanentOpenings.isEmpty,
                count: model.state.homeOpen.permanentOpenings.count,
                emptyText: "No permanent openings right now.",
                prominent: true,
                icon: ShiftIcons.refresh,
                accent: ShiftColors.resolve(scheme).permanent.accent
            ) {
                VStack(spacing: 10) {
                    ForEach(model.state.homeOpen.permanentOpenings, id: \.feedKey) { openFeedCard($0) }
                }
            }
            .accessibilityIdentifier("home_permanent_feed")
        }
        .padding(16)
    }

    /// One open-shift feed card, driven by the shared `OpenShift.toRow(claimable:)`:
    /// OPEN → Claim, PERMANENT → Pick up, UNPICKABLE → no action + "Locked" meta
    /// (§5.4 keeps the gap visible past T-2h, withholding only the action). Shared by
    /// the My-House and Other-Houses feeds; cross-house cards claim too (design).
    /// `showEyebrow` is false for a card rendered inside `dayGroupCard` below, whose
    /// header already states the date every card in the group shares.
    func openFeedCard(_ shift: OpenShift, showEyebrow: Bool = true) -> some View {
        let claimable = model.vm.claimable(shift: shift)
        let row = shift.toRow(claimable: claimable, zone: ShiftsKt.NEW_YORK)
        return ShiftCard(
            state: openKitState(row.state),
            houseInitial: row.houseInitial,
            timeLabel: row.timeLabel,
            eyebrow: showEyebrow ? row.dayLabel : nil,
            houseName: row.houseName,
            durationLabel: row.durationLabel,
            meta: row.meta,
            countLabel: row.countLabel,
            trailing: row.actionLabel.map { label in
                AnyView(
                    ShiftButton(
                        title: label,
                        action: { claimTarget = shift },
                        variant: isPermanentOpen(row.state) ? .tonal : .filled,
                        size: .sm
                    )
                    .accessibilityIdentifier("claim_button")
                )
            }
        )
        .accessibilityIdentifier("open_shift_card")
    }

    /// The outer wrapper for a day with 2+ open shifts in "Weekly open shifts": one
    /// header carrying the shared date + an "N open" count, then each shift's card
    /// (its own eyebrow date suppressed) stacked inside. `group.shifts` and
    /// `group.count` are the shared `groupOpenShiftsByDay` result (Shifts.kt) — a
    /// count-1 group is never routed here, `homeOpen` renders it as a bare card instead.
    func dayGroupCard(_ group: OpenShiftGroup, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(group.title.uppercased())
                    .font(ShiftFont.sans(11.5, .bold))
                    .tracking(0.4)
                    .foregroundColor(c.pickupDot)
                Spacer(minLength: 0)
                Text("\(Int(group.count)) open")
                    .font(ShiftFont.sans(11, .semibold))
                    .foregroundColor(c.pickupDot)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(c.surface)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, 4)
            .accessibilityIdentifier("day_group_header")

            VStack(spacing: 8) {
                ForEach(group.shifts, id: \.feedKey) { openFeedCard($0, showEyebrow: false) }
            }
        }
        .padding(10)
        .background(c.pickupDot.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: Radii.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radii.card, style: .continuous)
                .strokeBorder(c.pickupDot.opacity(0.28), lineWidth: 1.5)
        )
        .accessibilityIdentifier("day_group_card")
    }
}
