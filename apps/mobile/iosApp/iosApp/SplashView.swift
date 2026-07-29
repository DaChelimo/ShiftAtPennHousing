import SwiftUI

/// The in-app continuation of the OS launch screen.
///
/// `Info.plist`'s `UILaunchScreen` draws `LaunchLogo` centred on `LaunchBackground`, and iOS
/// tears that down the instant the first SwiftUI frame is ready. Everything the app does
/// before it can show real content — restoring the persisted session, resolving the launch
/// gate, loading the signed-in worker's first week — used to render as a bare `ProgressView`
/// on a plain background, so a cold launch read as: brand splash, then a stray spinner, then
/// the login screen. This view removes that seam: it repeats the launch screen EXACTLY (same
/// asset, same background, same natural 254x111pt size, centred), so the handoff is invisible
/// and the worker sees one continuous splash until there is something real to show.
///
/// A caption + spinner fade in only after `progressDelay`, so the common fast path shows a
/// clean, still splash and never a flash of loading chrome. `caption` is what the app is
/// actually doing ("Signing you in"), shown when the wait is the worker's own action rather
/// than a cold launch.
struct ShiftSplashView: View {
    /// Shown under the lockup once the wait is long enough to be worth explaining. Nil on a
    /// cold launch, where there is nothing to say beyond the brand.
    var caption: String? = nil
    /// How long to wait before admitting we are loading. Below this, the splash stays still.
    var progressDelay: Double = 0.6

    @Environment(\.colorScheme) private var scheme
    @State private var showProgress = false

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // The launch screen's own background colour, so there is no seam at handoff.
            Color("LaunchBackground").ignoresSafeArea()

            // Natural size, dead centre — matching how UILaunchScreen lays the image out.
            // Deliberately NOT `.resizable()`: any resize would shift or rescale the lockup
            // relative to the OS splash and give away the transition.
            Image("LaunchLogo")
                .accessibilityHidden(true)

            // The loading chrome sits BELOW the lockup without moving it (an overlay, not a
            // stack), so the brand mark stays exactly where the launch screen left it.
            VStack(spacing: 12) {
                if showProgress {
                    ProgressView()
                        .progressViewStyle(.circular)
                    if let caption {
                        Text(caption)
                            .font(ShiftFont.sans(14, .medium))
                            .foregroundColor(c.sec)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, 72)
            .animation(.easeIn(duration: 0.25), value: showProgress)
        }
        .task {
            // `Task.sleep` throws on cancellation (the splash was dismissed first), which is
            // exactly the case where the chrome should never appear.
            try? await Task.sleep(nanoseconds: UInt64(progressDelay * 1_000_000_000))
            showProgress = true
        }
        // A non-wrapping marker rather than an identifier on the container: an identifier set
        // on a wrapping container leaks onto every descendant in the XCUITest tree. See the
        // `shifts_screen` note in ContentView.swift.
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("splash_screen")
        }
    }
}
