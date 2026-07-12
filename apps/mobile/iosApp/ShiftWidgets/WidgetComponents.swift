import SwiftUI
import WidgetKit

/// A small blue rounded square used as the section glyph next to a widget title.
struct SectionDot: View {
    var size: CGFloat = 13
    var body: some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(WidgetStyle.brand)
            .frame(width: size, height: size)
    }
}

/// "Upcoming shifts" / "Open shifts · Both" style header, with an optional trailing note.
struct WidgetHeader: View {
    var title: String
    var trailing: String? = nil
    var showDot: Bool = true
    var body: some View {
        HStack(spacing: 6) {
            if showDot { SectionDot() }
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(WidgetStyle.brand)
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(WidgetStyle.hint)
            }
        }
    }
}

/// One "date · time / place" row. Today's date renders in brand blue; other days in ink.
/// Optionally shows a trailing "Open" pill (open-shifts feed).
struct ShiftRow: View {
    var day: String
    var isToday: Bool
    var time: String
    var place: String
    var showOpenPill: Bool = false
    var compact: Bool = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: compact ? 1 : 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(day)
                        .foregroundColor(isToday ? WidgetStyle.brand : WidgetStyle.ink)
                    Text("·").foregroundColor(Color(.systemGray3))
                    Text(time).foregroundColor(WidgetStyle.ink)
                }
                .font(.system(size: compact ? 14 : 15, weight: .semibold))
                Text(place)
                    .font(.system(size: 12))
                    .foregroundColor(WidgetStyle.hint)
            }
            if showOpenPill {
                Spacer(minLength: 4)
                OpenPill()
            }
        }
    }
}

/// The rounded "Open" capsule on open-shift rows.
struct OpenPill: View {
    var body: some View {
        Text("Open")
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(WidgetStyle.brand)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(Capsule().fill(WidgetStyle.pillFill))
    }
}

/// The float banner pinned above the shift list (Widget 1, float pending). Single-float
/// shows the destination + "tonight"; multi-float shows a count badge.
struct FloatBanner: View {
    /// nil = single float (uses the arrow glyph); non-nil = the count badge.
    var count: Int?
    var title: String
    var subtitle: String

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(WidgetStyle.brand)
                    .frame(width: 26, height: 26)
                if let count {
                    Text("\(count)")
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundColor(.white)
                } else {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 13.5, weight: .bold))
                    .foregroundColor(Color(red: 0x00 / 255, green: 0x52 / 255, blue: 0xCC / 255))
                    .lineLimit(1).minimumScaleFactor(0.85)
                Text(subtitle)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundColor(Color(red: 0x3A / 255, green: 0x78 / 255, blue: 0xE0 / 255))
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color(red: 0x7F / 255, green: 0xA8 / 255, blue: 0xEE / 255))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WidgetStyle.floatFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(WidgetStyle.brand, lineWidth: 1.5)
                )
        )
    }
}

/// Centered empty state for the small tiles ("No upcoming shifts").
struct WidgetEmptyState: View {
    var systemImage: String
    var title: String
    var subtitle: String
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 22, weight: .regular))
                .foregroundColor(Color(.systemGray3))
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(WidgetStyle.ink)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundColor(WidgetStyle.hint)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
