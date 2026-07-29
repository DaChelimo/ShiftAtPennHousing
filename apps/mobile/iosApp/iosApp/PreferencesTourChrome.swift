import SwiftUI
import UIKit

// The preferences tour's chrome: the header "?" that replays it and the one-time pointer
// callout at that "?". Split out of `PreferencesTourView.swift` (which is the overlay's
// rendering only) to keep both files inside the size ceiling.

// MARK: - Header help button (re-entry)

/// Collects the on-screen frame of the Preferences help button, the same anchor-preference
/// idiom as `ShiftTourHelpAnchorKey`, so the one-time pointer callout below can find it without
/// either view needing to know the other's layout.
struct PreferencesTourHelpAnchorKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>?
    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        value = nextValue() ?? value
    }
}

/// The "?" affordance in the Preferences header that replays the tour.
struct PreferencesTourHelpButton: View {
    @Environment(\.colorScheme) private var scheme
    let action: () -> Void

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: action) {
            Image(systemName: "questionmark")
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(c.blue)
                .frame(width: 34, height: 34)
                .background(c.blueContainer)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .anchorPreference(key: PreferencesTourHelpAnchorKey.self, value: .bounds) { $0 }
        .accessibilityIdentifier("preferences_tour_help")
    }
}

// MARK: - One-time "look here" pointer (re-entry callout)

/// A small speech-bubble-and-arrow callout pointing straight at the Preferences help button,
/// shown once right after the tour first finishes so the worker learns where it went without
/// another card to read and dismiss. Non-blocking (`allowsHitTesting(false)`) and auto-fades on
/// a timer driven by the host, mirroring `ShiftTourPointerCallout` exactly.
struct PreferencesTourPointerCallout: View {
    @Environment(\.colorScheme) private var scheme
    /// The help button's frame, in the overlay's coordinate space (from `PreferencesTourHelpAnchorKey`).
    let targetRect: CGRect
    /// The overlay's full size, same coordinate space as [targetRect].
    let fullSize: CGSize

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let bubbleWidth: CGFloat = 200
        // The arrow always points at the button's true center; the bubble clamps inside the
        // screen and the arrow nudges toward it independently, so a button near the edge never
        // pushes the bubble off-screen.
        let arrowX = targetRect.midX
        let bubbleCenterX = min(max(arrowX, bubbleWidth / 2 + 16), fullSize.width - bubbleWidth / 2 - 16)
        let arrowY = targetRect.maxY + 10
        return ZStack(alignment: .top) {
            Image(systemName: "arrowtriangle.up.fill")
                .font(.system(size: 13))
                .foregroundColor(c.blue)
                .position(x: arrowX, y: arrowY)
            VStack(alignment: .leading, spacing: 2) {
                Text("Find this again here").font(ShiftFont.sans(13, .semibold)).foregroundColor(.white)
                Text("Tap to replay the tour").font(ShiftFont.sans(12, .regular)).foregroundColor(.white.opacity(0.85))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(width: bubbleWidth, alignment: .leading)
            .background(c.blue)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .position(x: bubbleCenterX, y: arrowY + 30)
        }
        .shadow(color: .black.opacity(0.22), radius: 10, x: 0, y: 4)
        .allowsHitTesting(false)
        .accessibilityIdentifier("preferences_tour_pointer")
    }
}

/// Per-device flag: whether the header "?" has already shown its one-time post-tour pointer.
/// Its own UserDefaults key, separate from `ShiftTourPointerStore`.
enum PreferencesTourPointerStore {
    private static let key = "preferences_tour_pointer_shown"
    static func hasShown() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markShown() { UserDefaults.standard.set(true, forKey: key) }
}
