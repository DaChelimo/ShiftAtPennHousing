import SwiftUI
import Shared

/// The manager Hours tab (docs/manager-app/SPEC.md §6.5) — a straight port of
/// `HoursScreen.kt`. The question this screen answers is "who can I give these hours to, and
/// can I trust this number" — so the roster sorts by hours held descending (already done by
/// `buildHouseHoursReport` in `:shared`), and EVERY row shows its total, its home-desk hours,
/// and a chip for every shift worked away from the home desk, with NO tap required to see any
/// of it.
///
/// Each away-shift chip is a verification tool: tapping "Lauder · Wed 14:00 to 16:00" opens
/// that house's live calendar on that week so the manager can independently confirm the shift
/// happened. The Hours report is current-week only, which is why a chip navigates with no
/// week offset — the House tab always opens on the current week for a newly-selected house.
///
/// All arithmetic and ordering is in the pure `manager/hours/HouseHours.kt`. This file renders.

struct HoursView: View {
    let result: HouseHoursResult?
    /// Verify a worker's away shift: open the House tab on this house's current-week calendar.
    let onOpenHouseCalendar: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(spacing: 0) {
            PageTitle(title: "Hours")

            if let result {
                let report = result.report
                HStack(spacing: 8) {
                    Text(report.houseName).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                    Text(report.weekLabel).font(ShiftFont.sans(13)).foregroundColor(c.sec)
                    Spacer(minLength: 0)
                    Text(report.totalLabel).font(ShiftFont.sans(15, .bold)).foregroundColor(c.ink)
                        .accessibilityIdentifier("hours_total")
                }
                .padding(.horizontal, 16).padding(.vertical, 4)

                // An SM's token cannot read another house's assignments, so their
                // breakdown genuinely cannot show away shifts. Say so.
                if result.partial {
                    HStack(spacing: 8) {
                        Image(systemName: ShiftIcons.info).font(.system(size: 15)).foregroundColor(c.sec)
                        Text("Shifts at your house only.").font(ShiftFont.sans(12.5)).foregroundColor(c.sec)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(c.surfaceVar)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .accessibilityIdentifier("hours_partial_note")
                }

                if report.isEmpty {
                    EmptyState(title: "No workers at this house", systemIcon: ShiftIcons.person, bodyText: "Nobody is on the roster for this week.")
                        .accessibilityIdentifier("hours_empty")
                } else {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(report.rows, id: \.userId) { row in
                                WorkerHoursRowView(row: row, onOpenHouseCalendar: onOpenHouseCalendar)
                            }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 8)
                    }
                    .accessibilityIdentifier("hours_list")
                }
            } else {
                EmptyState(title: "Loading hours", systemIcon: ShiftIcons.clock)
                    .accessibilityIdentifier("hours_empty")
            }
        }
        .accessibilityIdentifier("hours_screen")
    }
}

private struct WorkerHoursRowView: View {
    let row: WorkerHoursRow
    let onOpenHouseCalendar: (String) -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    private var accent: Color { row.isAtCap ? c.danger.accent : c.success.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(row.name).font(ShiftFont.sans(15.5, .semibold)).foregroundColor(c.ink)
                Spacer(minLength: 0)
                Text(row.capLabel).font(ShiftFont.sans(13.5, .medium)).foregroundColor(row.isAtCap ? accent : c.sec)
            }

            if let fraction = row.capFraction?.doubleValue {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(c.surfaceVar)
                        Capsule().fill(accent).frame(width: geo.size.width * CGFloat(fraction))
                    }
                }
                .frame(height: 5)
            }

            if let remaining = row.remainingHours?.doubleValue {
                Text(row.isAtCap ? "At the cap. No room this week." : "\(HouseHoursKt.hoursLabel(hours: remaining)) of room left")
                    .font(ShiftFont.sans(12)).foregroundColor(row.isAtCap ? accent : c.ter)
            }

            // Total / home / away, ALWAYS visible — no tap required.
            HStack(spacing: 14) {
                StatPair(label: "Total", value: row.totalLabel, color: c.ink)
                StatPair(label: "Home desk", value: row.homeLabel, color: c.sec)
                if !row.awayShifts.isEmpty { StatPair(label: "Away", value: row.awayLabel, color: c.sec) }
            }

            // Every away shift, as a tappable chip — visible directly in the roster.
            if !row.awayShifts.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(row.awayShifts.enumerated()), id: \.offset) { _, shift in
                        AwayShiftChip(shift: shift, onTap: { onOpenHouseCalendar(shift.houseId) })
                    }
                }
            }
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.surface)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(c.divider, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("hours_row")
    }
}

private struct StatPair: View {
    let label: String
    let value: String
    let color: Color
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(ShiftFont.sans(11)).foregroundColor(c.ter)
            Text(value).font(ShiftFont.sans(13, .semibold)).foregroundColor(color)
        }
    }
}

/// "Lauder · Wed 14:00 to 16:00 · 2h" — one verifiable away shift, tappable to open that
/// house's live calendar (see the file header). The chevron signals a link out.
private struct AwayShiftChip: View {
    let shift: AwayShift
    let onTap: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 5) {
                        Text(shift.houseName).font(ShiftFont.sans(12.5, .bold)).foregroundColor(c.ink)
                        Text("·").font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
                        Text(shift.kindLabel).font(ShiftFont.sans(11.5)).foregroundColor(c.sec)
                    }
                    Text("\(shift.dayLabel), \(shift.timeLabel)  ·  \(shift.durationLabel)")
                        .font(ShiftFont.sans(11.5)).foregroundColor(c.sec)
                }
                Image(systemName: ShiftIcons.chevronRight).font(.system(size: 11)).foregroundColor(c.ter)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(c.surfaceVar)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("hours_away_shift")
    }
}

/// A minimal wrapping HStack (SwiftUI has no stock FlowRow pre-iOS 16 `Layout`-free API used
/// elsewhere in this app). A worker with several away shifts needs all of them visible per the
/// verification mandate (docs/manager-app/SPEC.md §6.5), so this must wrap, never truncate.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
