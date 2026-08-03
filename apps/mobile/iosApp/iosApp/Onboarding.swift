import SwiftUI
import UserNotifications
import Shared

/// The notification ask (iOS) — the SwiftUI rendering for the shared `NotificationPriming`
/// decision + copy, and the mirror of the Android `ui/onboarding/NotificationNudge.kt`.
///
/// This file used to also carry the first-run welcome tour (a spotlight overlay across the
/// five tabs) and the one-card contextual tips. Both were cut on 2026-08-03: the six
/// interactive tours are the app's onboarding now, and the flat cards were the "guide" people
/// dismiss on reflex. See BEHAVIORAL_SPECIFICATION.md §16.
///
/// Two callers:
///   - the STANDING row, pinned above the My-Shifts schedule while alerts are off;
///   - the CONTEXTUAL row, shown once each after a claim and after a swap or hand-off is sent.

// MARK: - Persistence

/// Per-device flags for the notification ask (UserDefaults, like the tours' seen-keys).
enum NotificationPrimingStore {
    /// Whether the once-per-install contextual row for `key` has already been shown.
    static func hasAsked(_ key: String) -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markAsked(_ key: String) { UserDefaults.standard.set(true, forKey: key) }
}

// MARK: - Live state

/// Live notification state plus the one action the rows need, resolved asynchronously from
/// `UNUserNotificationCenter`. `refresh()` is cheap and is called whenever the app comes
/// forward, so a grant made in Settings (after the row deep-links there) retires the row.
@MainActor
final class NotificationNudgeObservable: ObservableObject {
    /// Whether the worker actually receives pushes right now.
    @Published var granted = true
    /// Whether the OS would still surface its own dialog (status is `.notDetermined`). Once
    /// false the row must route to Settings instead of firing a request that does nothing.
    @Published var osCanPrompt = false

    func refresh() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status = settings.authorizationStatus
            Task { @MainActor in
                // .provisional and .ephemeral still deliver, so they count as granted.
                self.granted = status == .authorized || status == .provisional || status == .ephemeral
                self.osCanPrompt = status == .notDetermined
            }
        }
    }

    /// Fire the real OS dialog while it can still surface; deep-link to this app's settings
    /// once it cannot, so the button is never a no-op.
    func confirm() {
        if osCanPrompt {
            NotificationAuthorizer.request()
            // The dialog is modal and asynchronous; re-read shortly after so a grant is
            // reflected without waiting for the next foreground.
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                self.refresh()
            }
        } else if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - The row

/// The ask itself: a single-line row with a bell, the benefit, and one clear action on the
/// right. Deliberately NOT dismissible and deliberately not a scrim: it costs nothing to
/// scroll past, which is what lets it stay until alerts are actually on.
struct NotificationNudgeRow: View {
    @Environment(\.colorScheme) private var scheme
    @ObservedObject var model: NotificationNudgeObservable
    let body_: String
    let tag: String

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return HStack(spacing: 10) {
            Image(systemName: "bell.badge")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(c.blue)
            Text(body_)
                .font(ShiftFont.sans(13.5, .medium))
                .foregroundColor(c.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: model.confirm) {
                Text(NotificationPriming.shared.confirmLabel(osCanPrompt: model.osCanPrompt))
                    .font(ShiftFont.sans(13, .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(c.blue).clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("\(tag)_confirm")
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping container leaks onto every descendant element in the XCUITest tree,
        // shadowing that container's own more-specific descendant identifiers (confirmed
        // empirically; see ContentView.swift's `shifts_screen` fix for the full explanation).
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier(tag)
        }
    }
}
