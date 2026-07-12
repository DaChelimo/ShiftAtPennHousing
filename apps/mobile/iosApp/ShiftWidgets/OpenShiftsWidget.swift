import SwiftUI
import WidgetKit
import AppIntents

/// Widget 2 — Open shifts. A single configurable widget: the worker picks the scope
/// (My house / Other houses / Both) when adding or editing it, and the chosen scope
/// shows as the tile title. Display-only: tapping opens the Open Shifts feed.
///
/// The configuration intent (`OpenShiftsConfigIntent` / `OpenScopeChoice`) lives in
/// WidgetShared so it compiles into the app too — see that file for why.

struct OpenEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let scope: WidgetOpenScope
}

struct OpenProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> OpenEntry {
        OpenEntry(date: Date(), snapshot: WidgetSampleData.snapshot(), scope: .both)
    }

    func snapshot(for configuration: OpenShiftsConfigIntent, in context: Context) async -> OpenEntry {
        let snap = context.isPreview ? WidgetSampleData.snapshot()
            : (WidgetSnapshotStore.read() ?? WidgetSampleData.snapshot())
        return OpenEntry(date: Date(), snapshot: snap, scope: configuration.scope.scope)
    }

    func timeline(for configuration: OpenShiftsConfigIntent, in context: Context) async -> Timeline<OpenEntry> {
        let now = Date()
        let snap = WidgetSnapshotStore.read() ?? WidgetSampleData.snapshot()
        let entry = OpenEntry(date: now, snapshot: snap, scope: configuration.scope.scope)
        return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(30 * 60)))
    }
}

struct OpenShiftsWidget: Widget {
    let kind = "OpenShiftsWidget"
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: OpenShiftsConfigIntent.self, provider: OpenProvider()) { entry in
            OpenEntryView(entry: entry)
                .containerBackground(.white, for: .widget)
        }
        .configurationDisplayName("Open shifts")
        .description("Open desk shifts you can pick up. Choose which houses to show.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

private struct OpenEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: OpenEntry

    private var now: Date { entry.date }
    private var open: [WidgetOpenShift] {
        entry.scope.filter(entry.snapshot.openShifts)
            .filter { $0.end > now }
            .sorted { $0.start < $1.start }
    }
    private var scopeTitle: String { entry.scope.shortTitle }

    var body: some View {
        switch family {
        case .systemSmall: small
        case .systemLarge: list(max: 5, vpad: WidgetSpace.rowVLarge, pad: WidgetSpace.padLarge)
        default: list(max: 3, vpad: WidgetSpace.rowV, pad: WidgetSpace.pad)
        }
    }

    // MARK: Small

    @ViewBuilder private var small: some View {
        if let s = open.first {
            VStack(alignment: .leading, spacing: 0) {
                Text("Open · \(scopeTitle)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(WidgetStyle.brand)
                Spacer(minLength: 0)
                Text(WidgetFormat.dayLabel(s.start, now: now))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(WidgetStyle.brand)
                Text(WidgetFormat.timeRange(s.start, s.end))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(WidgetStyle.ink)
                    .minimumScaleFactor(0.7).lineLimit(1)
                HStack(spacing: 7) {
                    Text("\(s.house) Desk")
                        .font(.system(size: 13)).foregroundColor(WidgetStyle.muted)
                        .lineLimit(1)
                    OpenPill()
                }
                .padding(.top, 5)
                Spacer(minLength: 0)
                if open.count > 1 {
                    Text("+\(open.count - 1) more open")
                        .font(.system(size: 12)).foregroundColor(WidgetStyle.hint)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(14)
            .widgetURL(WidgetDeepLink.openShifts(scope: entry.scope))
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text("Open · \(scopeTitle)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(WidgetStyle.brand)
                WidgetEmptyState(systemImage: "circle.dashed",
                                 title: "No open shifts right now",
                                 subtitle: "Check back later")
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(14)
            .widgetURL(WidgetDeepLink.openShifts(scope: entry.scope))
        }
    }

    // MARK: Medium / Large

    @ViewBuilder private func list(max: Int, vpad: CGFloat, pad: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetHeader(title: "Open shifts · \(scopeTitle)",
                         trailing: open.isEmpty ? nil : "\(open.count) open",
                         showDot: false)
            Spacer().frame(height: WidgetSpace.afterHeader)
            if open.isEmpty {
                WidgetEmptyState(systemImage: "circle.dashed",
                                 title: "No open shifts right now",
                                 subtitle: "Check back later")
            } else {
                ForEach(Array(open.prefix(max).enumerated()), id: \.element.id) { idx, s in
                    ShiftRow(day: WidgetFormat.dayLabel(s.start, now: now),
                             isToday: WidgetFormat.isToday(s.start, now: now),
                             time: WidgetFormat.timeRange(s.start, s.end),
                             place: "\(s.house) Desk",
                             showOpenPill: true)
                        .padding(.vertical, vpad)
                        .overlay(alignment: .top) {
                            if idx > 0 { Rectangle().fill(WidgetStyle.divider).frame(height: 1) }
                        }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(pad)
        .widgetURL(WidgetDeepLink.openShifts(scope: entry.scope))
    }
}
