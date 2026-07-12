import SwiftUI

/// Design tokens + formatting for the home-screen widgets, translated from the
/// Claude-design mockup. All timestamps are America/New_York (the project tz invariant);
/// the widget formats wall-clock there regardless of device locale tz.
enum WidgetStyle {
    /// Brand blue (#0061FC) — section labels, today's date, the float accent.
    static let brand = Color(red: 0x00 / 255, green: 0x61 / 255, blue: 0xFC / 255)
    /// Near-black primary text (#1C1C1E).
    static let ink = Color(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255)
    /// Muted secondary text (#8A8A8E).
    static let muted = Color(red: 0x8A / 255, green: 0x8A / 255, blue: 0x8E / 255)
    /// Lighter hint text (#9A9AA0).
    static let hint = Color(red: 0x9A / 255, green: 0x9A / 255, blue: 0xA0 / 255)
    /// Hairline row divider (#F1F1F4).
    static let divider = Color(red: 0xF1 / 255, green: 0xF1 / 255, blue: 0xF4 / 255)
    /// Float banner fill (#F2F7FF) and the "Open" pill fill (#E8F0FF).
    static let floatFill = Color(red: 0xF2 / 255, green: 0xF7 / 255, blue: 0xFF / 255)
    static let pillFill = Color(red: 0xE8 / 255, green: 0xF0 / 255, blue: 0xFF / 255)
}

/// Shared spacing rhythm so every tile reads with the same vertical cadence.
enum WidgetSpace {
    /// Outer tile padding (large adds a touch more).
    static let pad: CGFloat = 14
    static let padLarge: CGFloat = 18
    /// Gap between the float banner and the shift section below it.
    static let afterBanner: CGFloat = 11
    /// Gap between a section header and its first row.
    static let afterHeader: CGFloat = 7
    /// Per-row vertical padding.
    static let rowV: CGFloat = 6
    static let rowVLarge: CGFloat = 9
}

/// Wall-clock formatting in America/New_York.
enum WidgetFormat {
    static let zone = TimeZone(identifier: "America/New_York") ?? .current

    private static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    /// "Today" when the start is today in NY, else the short weekday ("Tue").
    static func dayLabel(_ start: Date, now: Date = Date()) -> String {
        if calendar.isDate(start, inSameDayAs: now) { return "Today" }
        let f = DateFormatter()
        f.timeZone = zone
        f.dateFormat = "EEE"
        return f.string(from: start)
    }

    static func isToday(_ start: Date, now: Date = Date()) -> Bool {
        calendar.isDate(start, inSameDayAs: now)
    }

    /// A compact range like "4:00–8:00 PM" — drops the meridiem on the start when both
    /// ends share it, and minutes when the time is on the hour, matching the mockup.
    static func timeRange(_ start: Date, _ end: Date) -> String {
        let sMer = meridiem(start), eMer = meridiem(end)
        let s = clock(start, withMeridiem: sMer != eMer)
        let e = clock(end, withMeridiem: true)
        return "\(s)–\(e)"
    }

    /// A single clock time like "8:00 PM" (used by the small float tile).
    static func clockTime(_ date: Date) -> String { clock(date, withMeridiem: true) }

    private static func meridiem(_ date: Date) -> String {
        let f = DateFormatter(); f.timeZone = zone; f.dateFormat = "a"
        return f.string(from: date)
    }

    private static func clock(_ date: Date, withMeridiem: Bool) -> String {
        let f = DateFormatter()
        f.timeZone = zone
        let comps = calendar.dateComponents([.minute], from: date)
        let onHour = (comps.minute ?? 0) == 0
        if withMeridiem {
            f.dateFormat = onHour ? "h a" : "h:mm a"
        } else {
            f.dateFormat = onHour ? "h" : "h:mm"
        }
        // Normalize "8 PM" → "8:00 PM" to match the design's explicit minutes.
        var out = f.string(from: date)
        if onHour {
            out = out.replacingOccurrences(of: " AM", with: ":00 AM")
                     .replacingOccurrences(of: " PM", with: ":00 PM")
            if !withMeridiem { out += ":00" }
        }
        return out
    }
}
