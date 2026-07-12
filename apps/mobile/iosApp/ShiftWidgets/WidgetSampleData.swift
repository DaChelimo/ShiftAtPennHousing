import Foundation

/// Sample data for the widget gallery preview and the placeholder/snapshot timeline
/// entries — mirrors the values in the Claude-design mockup so the gallery looks right
/// before the app has ever written a real snapshot. Built relative to "now" so the
/// "Today"/weekday labels stay sensible whenever the gallery is opened.
enum WidgetSampleData {
    private static var zoneCal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = WidgetFormat.zone
        return c
    }

    /// `date`: days from today; `h`/`m`: NY wall-clock start; `dur`: minutes.
    private static func at(_ days: Int, _ h: Int, _ m: Int, _ durMin: Int, now: Date) -> (Date, Date) {
        let cal = zoneCal
        let base = cal.date(byAdding: .day, value: days, to: now) ?? now
        var comps = cal.dateComponents([.year, .month, .day], from: base)
        comps.hour = h; comps.minute = m
        let start = cal.date(from: comps) ?? now
        let end = start.addingTimeInterval(TimeInterval(durMin * 60))
        return (start, end)
    }

    static func snapshot(now: Date = Date()) -> WidgetSnapshot {
        let s1 = at(0, 16, 0, 240, now: now)   // Today 4:00–8:00 PM
        let s2 = at(1, 9, 0, 120, now: now)    // Tue 9:00–11:00 AM
        let s3 = at(2, 14, 0, 120, now: now)   // Wed 2:00–4:00 PM
        let s4 = at(3, 18, 0, 240, now: now)
        let s5 = at(4, 12, 0, 120, now: now)
        let s6 = at(5, 20, 0, 120, now: now)

        let o1 = at(0, 20, 0, 120, now: now)   // Today 8:00–10:00 PM, my house
        let o2 = at(1, 11, 0, 120, now: now)   // Tue 11–1, other
        let o3 = at(2, 16, 0, 120, now: now)   // Wed 4–6, other
        let o4 = at(3, 19, 0, 120, now: now)   // Thu 7–9, other

        return WidgetSnapshot(
            updatedAt: now,
            upcomingShifts: [
                WidgetShift(id: "s1", house: "Harnwell", start: s1.0, end: s1.1),
                WidgetShift(id: "s2", house: "Quad", start: s2.0, end: s2.1),
                WidgetShift(id: "s3", house: "DuBois", start: s3.0, end: s3.1),
                WidgetShift(id: "s4", house: "Gregory", start: s4.0, end: s4.1),
                WidgetShift(id: "s5", house: "Harnwell", start: s5.0, end: s5.1),
                WidgetShift(id: "s6", house: "Rodin", start: s6.0, end: s6.1),
            ],
            openShifts: [
                WidgetOpenShift(id: "o1", house: "Harnwell", start: o1.0, end: o1.1, homeHouse: true),
                WidgetOpenShift(id: "o2", house: "Rodin", start: o2.0, end: o2.1, homeHouse: false),
                WidgetOpenShift(id: "o3", house: "DuBois", start: o3.0, end: o3.1, homeHouse: false),
                WidgetOpenShift(id: "o4", house: "Gregory", start: o4.0, end: o4.1, homeHouse: false),
            ],
            // No float in the default sample: this also backs the cold-install fallback,
            // so it must not show a fake pending float on a real home screen. The
            // float-banner state is exercised once the app writes a real snapshot.
            pendingFloats: []
        )
    }
}
