import SwiftUI
import WidgetKit

/// Widget 1 — Upcoming shifts (the hero). Shows the worker's own scheduled shifts:
/// time, day, and place. When one or more floats are pending, a float banner is pinned
/// above the list (single → destination + "tap to acknowledge"; multiple → a count that
/// deep-links into Updates). Display-only: tapping opens the app.

struct UpcomingEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct UpcomingProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpcomingEntry {
        UpcomingEntry(date: Date(), snapshot: WidgetSampleData.snapshot())
    }

    func getSnapshot(in context: Context, completion: @escaping (UpcomingEntry) -> Void) {
        let snap = context.isPreview ? WidgetSampleData.snapshot()
            : (WidgetSnapshotStore.read() ?? WidgetSampleData.snapshot())
        completion(UpcomingEntry(date: Date(), snapshot: snap))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpcomingEntry>) -> Void) {
        let now = Date()
        let snap = WidgetSnapshotStore.read() ?? WidgetSampleData.snapshot()
        let entry = UpcomingEntry(date: now, snapshot: snap)
        // The app pushes a reload on every data change; this periodic refresh just keeps
        // the relative "Today"/weekday labels honest if the app stays closed.
        let next = now.addingTimeInterval(30 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct UpcomingShiftsWidget: Widget {
    let kind = "UpcomingShiftsWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpcomingProvider()) { entry in
            UpcomingEntryView(entry: entry)
                .containerBackground(.white, for: .widget)
        }
        .configurationDisplayName("Upcoming shifts")
        .description("Your next desk shifts, and any float that needs acknowledgment.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        // Take over the inner margins so our own padding is the only inset — otherwise
        // iOS's default ~16pt content margins stack on top and the content overflows.
        .contentMarginsDisabled()
    }
}

private struct UpcomingEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: UpcomingEntry

    private var now: Date { entry.date }
    private var shifts: [WidgetShift] {
        entry.snapshot.upcomingShifts
            .filter { $0.end > now }
            .sorted { $0.start < $1.start }
    }
    private var floats: [WidgetFloat] {
        entry.snapshot.pendingFloats
            .filter { $0.end > now }
            .sorted { $0.start < $1.start }
    }

    var body: some View {
        switch family {
        case .systemSmall: small
        case .systemLarge: large
        default: medium
        }
    }

    // MARK: Small

    @ViewBuilder private var small: some View {
        if let f = floats.first {
            floatSmall(f).widgetURL(WidgetDeepLink.floatAck(id: f.id))
        } else if let s = shifts.first {
            nextShiftSmall(s).widgetURL(WidgetDeepLink.myShifts)
        } else {
            WidgetEmptyState(systemImage: "calendar",
                             title: "No upcoming shifts",
                             subtitle: "You're all caught up")
                .padding(15)
                .widgetURL(WidgetDeepLink.myShifts)
        }
    }

    private func nextShiftSmall(_ s: WidgetShift) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                SectionDot()
                Text("NEXT SHIFT")
                    .font(.system(size: 11, weight: .semibold))
                    .kerning(0.3)
                    .foregroundColor(WidgetStyle.brand)
            }
            Spacer(minLength: 0)
            Text(WidgetFormat.dayLabel(s.start, now: now))
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(WidgetStyle.brand)
            Text(WidgetFormat.timeRange(s.start, s.end))
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(WidgetStyle.ink)
                .minimumScaleFactor(0.7).lineLimit(1)
            Text("\(s.house) Desk")
                .font(.system(size: 14))
                .foregroundColor(WidgetStyle.muted)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(15)
    }

    private func floatSmall(_ f: WidgetFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 7) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(WidgetStyle.brand).frame(width: 22, height: 22)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                }
                Text("FLOAT")
                    .font(.system(size: 11, weight: .bold)).kerning(0.2)
                    .foregroundColor(WidgetStyle.brand)
            }
            Spacer(minLength: 0)
            Text(WidgetFormat.dayLabel(f.start, now: now) == "Today" ? "Tonight"
                 : WidgetFormat.dayLabel(f.start, now: now))
                .font(.system(size: 14, weight: .semibold)).foregroundColor(WidgetStyle.brand)
            Text(WidgetFormat.clockTime(f.start))
                .font(.system(size: 20, weight: .bold)).foregroundColor(WidgetStyle.ink)
                .minimumScaleFactor(0.7).lineLimit(1)
            Text("\(f.destinationHouse) Desk")
                .font(.system(size: 14)).foregroundColor(WidgetStyle.muted).padding(.top, 4)
            HStack(spacing: 4) {
                Text("Tap to acknowledge")
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(WidgetStyle.brand)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Color(red: 0x7F/255, green: 0xA8/255, blue: 0xEE/255))
            }
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(WidgetStyle.brand, lineWidth: 2)
        )
    }

    // MARK: Medium

    @ViewBuilder private var medium: some View {
        let hasFloat = !floats.isEmpty
        // A float costs vertical room, so the list shows fewer rows alongside it.
        let rows = Array(shifts.prefix(hasFloat ? 2 : 3))
        if !hasFloat && rows.isEmpty {
            WidgetEmptyState(systemImage: "calendar",
                             title: "No upcoming shifts",
                             subtitle: "You're all caught up")
                .padding(WidgetSpace.pad)
                .widgetURL(WidgetDeepLink.myShifts)
        } else {
            shiftSection(rows: rows, hasFloat: hasFloat,
                         trailing: nil, rowVPad: WidgetSpace.rowV,
                         pad: WidgetSpace.pad)
        }
    }

    // MARK: Large

    @ViewBuilder private var large: some View {
        let hasFloat = !floats.isEmpty
        let rows = Array(shifts.prefix(hasFloat ? 5 : 6))
        if !hasFloat && rows.isEmpty {
            WidgetEmptyState(systemImage: "calendar",
                             title: "No upcoming shifts",
                             subtitle: "You're all caught up")
                .padding(WidgetSpace.padLarge)
                .widgetURL(WidgetDeepLink.myShifts)
        } else {
            shiftSection(rows: rows, hasFloat: hasFloat,
                         trailing: "This week", rowVPad: WidgetSpace.rowVLarge,
                         pad: WidgetSpace.padLarge)
        }
    }

    /// The shared shift section: optional float banner pinned on top, then the
    /// "Upcoming shifts" header, then the rows (or a quiet empty line). The banner is a
    /// compact strip ABOVE the labeled shift list, never the whole tile.
    private func shiftSection(rows: [WidgetShift], hasFloat: Bool,
                              trailing: String?, rowVPad: CGFloat, pad: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if hasFloat {
                floatBanner()
                Spacer().frame(height: WidgetSpace.afterBanner)
            }
            WidgetHeader(title: "Upcoming shifts", trailing: trailing)
            Spacer().frame(height: WidgetSpace.afterHeader)
            if rows.isEmpty {
                Text("No more shifts this week")
                    .font(.system(size: 13))
                    .foregroundColor(WidgetStyle.hint)
                    .padding(.top, 2)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { idx, s in
                    row(s, showDivider: idx > 0, vpad: rowVPad)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(pad)
        .widgetURL(WidgetDeepLink.myShifts)
    }

    // MARK: Pieces

    private func row(_ s: WidgetShift, showDivider: Bool, vpad: CGFloat) -> some View {
        ShiftRow(day: WidgetFormat.dayLabel(s.start, now: now),
                 isToday: WidgetFormat.isToday(s.start, now: now),
                 time: WidgetFormat.timeRange(s.start, s.end),
                 place: "\(s.house) Desk")
            .padding(.vertical, vpad)
            .overlay(alignment: .top) {
                if showDivider { Rectangle().fill(WidgetStyle.divider).frame(height: 1) }
            }
    }

    @ViewBuilder private func floatBanner() -> some View {
        if floats.count == 1, let f = floats.first {
            let day = WidgetFormat.dayLabel(f.start, now: now)
            let when = day == "Today" ? "tonight" : day
            Link(destination: WidgetDeepLink.floatAck(id: f.id)) {
                FloatBanner(count: nil,
                            title: "Float to \(f.destinationHouse) · \(when)",
                            subtitle: "Tap to acknowledge")
            }
        } else if floats.count > 1 {
            Link(destination: WidgetDeepLink.updates) {
                FloatBanner(count: floats.count,
                            title: "\(floats.count) floats need acknowledgment",
                            subtitle: "Tap to review in Updates")
            }
        }
    }
}
