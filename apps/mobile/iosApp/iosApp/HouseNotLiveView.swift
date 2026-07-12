import SwiftUI
import Shared

/// Staggered-launch placeholder (rollout). Shown to a worker whose home house has not
/// gone live yet: they are signed in, but the app is held back until an admin switches
/// their house on. Mirrors the Android `HouseNotLiveScreen`. No em dashes in surfaced copy.
struct HouseNotLiveView: View {
    let houseName: String
    var onSignOut: () -> Void

    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        ZStack {
            c.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Text("Shift isn't live at \(houseName) yet")
                    .font(ShiftFont.sans(22, .semibold))
                    .foregroundColor(c.ink)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("house_not_live_title")
                Spacer().frame(height: 12)
                Text(
                    "We're rolling Shift out house by house, and \(houseName) is coming soon. "
                    + "You'll be able to see your shifts, pick up open shifts, and manage swaps "
                    + "here as soon as your house goes live."
                )
                .font(ShiftFont.sans(15, .regular))
                .foregroundColor(c.sec)
                .multilineTextAlignment(.center)
                Spacer().frame(height: 28)
                ShiftButton(title: "Sign out", action: onSignOut, variant: .outlined, fullWidth: true)
            }
            .padding(24)
        }
        .accessibilityIdentifier("house_not_live")
    }
}
