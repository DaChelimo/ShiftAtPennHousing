import SwiftUI
import Shared

/// Onboarding chrome (iOS) — the SwiftUI overlay for the shared onboarding logic, the
/// mirror of the Android `ui/onboarding/Onboarding.kt`:
///   - `OnboardingObservable` wraps the shared `OnboardingViewModel`, seeds it from the
///     persisted seen-keys (UserDefaults, like `ThemeStore`), and persists on change.
///   - `OnboardingAnchorKey` + `.onboardingAnchor(_:)` collect the frames of the elements
///     the spotlight rings (the five tab items + the Ask button).
///   - `OnboardingOverlayView` draws the dim + spotlight ring + coach-mark card.
///
/// The tour steps, tip copy and sequencing all live in shared `onboarding/`; this file is
/// only rendering + persistence.

// MARK: - Persisted, observable wrapper

final class OnboardingObservable: ObservableObject {
    let vm: OnboardingViewModel
    @Published var state: OnboardingUiState
    private var task: Task<Void, Never>?
    private static let storageKey = "onboarding_seen_keys"

    init() {
        let seen = Set(UserDefaults.standard.stringArray(forKey: Self.storageKey) ?? [])
        let vm = OnboardingViewModel(initialSeen: seen)
        self.vm = vm
        self.state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState {
                // Mutate @Published on the main actor so SwiftUI reliably re-renders.
                await MainActor.run {
                    self.state = s
                    // Persist the seen-key set on every change (per-device UX state).
                    UserDefaults.standard.set(Array(s.seen), forKey: Self.storageKey)
                }
            }
        }
    }

    /// Begin the first-run welcome tour if it has not run yet.
    func start() { vm.start() }

    /// Restart the tour on demand (e.g. a "Replay app tour" row in Settings) — the way
    /// back in for a worker who skipped it or just wants a refresher.
    func replay() { vm.replayTour() }
}

// MARK: - Anchor collection

/// Stable ids for the spotlight targets (must match `anchorId(_:)`).
enum OnboardingAnchorId {
    static let myShifts = 1
    static let open = 2
    static let house = 3
    static let swaps = 4
    static let more = 5
    static let assistant = 6
}

/// Map a shared `OnboardingTarget` to its anchor id; 0 (none) for centered coach-marks.
func anchorId(_ target: OnboardingTarget) -> Int {
    switch target {
    case .myShiftsTab: return OnboardingAnchorId.myShifts
    case .openTab: return OnboardingAnchorId.open
    case .houseTab: return OnboardingAnchorId.house
    case .swapsTab: return OnboardingAnchorId.swaps
    case .moreTab: return OnboardingAnchorId.more
    case .assistantButton: return OnboardingAnchorId.assistant
    default: return 0
    }
}

struct OnboardingAnchorKey: PreferenceKey {
    static var defaultValue: [Int: Anchor<CGRect>] = [:]
    static func reduce(value: inout [Int: Anchor<CGRect>], nextValue: () -> [Int: Anchor<CGRect>]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

extension View {
    /// Report this view's bounds as the anchor for the spotlight id.
    func onboardingAnchor(_ id: Int) -> some View {
        anchorPreference(key: OnboardingAnchorKey.self, value: .bounds) { [id: $0] }
    }
}

// MARK: - The "Ask" affordance (Assistant discoverability)

/// A persistent "Ask" pill that surfaces the Assistant beyond the More overflow sheet.
/// The first-run tour rings it via `OnboardingTarget.assistantButton`.
struct AskAssistantButtonView: View {
    @Environment(\.colorScheme) private var scheme
    let action: () -> Void

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: ShiftIcons.sparkles).font(.system(size: 15, weight: .semibold))
                Text("Ask").font(ShiftFont.sans(15, .semibold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(c.blue)
            .clipShape(Capsule())
            .shadow(color: .black.opacity(0.18), radius: 8, x: 0, y: 3)
        }
        .buttonStyle(.plain)
        .onboardingAnchor(OnboardingAnchorId.assistant)
        .accessibilityIdentifier("ask_assistant")
    }
}

// MARK: - The spotlight + coach-mark overlay

struct OnboardingOverlayView: View {
    @Environment(\.colorScheme) private var scheme
    /// Observed directly (not a captured snapshot) so the overlay re-renders on its own
    /// whenever the tour state changes, independent of the parent body / preference timing.
    @ObservedObject var model: OnboardingObservable
    /// Resolve an anchor id to a rect in the overlay's coordinate space (nil = not laid out).
    let ringRect: (Int) -> CGRect?
    /// The overlay's full size, in the SAME coordinate space as `ringRect` (the parent's
    /// GeometryReader proxy) — needed to size the tap bands around the ring.
    let fullSize: CGSize

    private func onNext() { model.vm.next() }
    private func onBack() { model.vm.back() }
    private func onSkip() { model.vm.skipTour() }
    private func onDismissTip() { model.vm.dismissTip() }

    var body: some View {
        let state = model.state
        guard let coach = state.current else { return AnyView(EmptyView()) }
        let c = ShiftColors.resolve(scheme)
        // anchorId(...) returns 0 for the centered (no-spotlight) targets, so we never
        // have to name the bridged `.none` case (SKIE may rename it to dodge Optional.none).
        let aid = anchorId(coach.target)
        let ring: CGRect? = aid == 0 ? nil : ringRect(aid)
        let scrim = Color.black.opacity(scheme == .dark ? 0.78 : 0.6)
        let onTap: () -> Void = { state.isTour ? onNext() : onDismissTip() }

        return AnyView(
            ZStack {
                // Dim, with a punched-out hole around the ring (destinationOut in a group).
                // `.allowsHitTesting(false)`: a `.blendMode(.destinationOut)` cutout is a
                // COMPOSITING trick only — it makes the punched area visually transparent,
                // it does NOT remove that area from hit-testing. Without this modifier the
                // full-screen scrim Rectangle underneath still intercepts every tap across
                // its whole frame, ring "hole" included, which was the actual reason taps on
                // a spotlighted real element (the Ask button) never reached it, even after
                // every explicit tap-catcher was removed.
                ZStack {
                    Rectangle().fill(scrim).ignoresSafeArea()
                    if let r = ring {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .frame(width: r.width + 12, height: r.height + 12)
                            .position(x: r.midX, y: r.midY)
                            .blendMode(.destinationOut)
                    }
                }
                .compositingGroup()
                .allowsHitTesting(false)

                // Highlight ring around the spotlighted element — purely visual.
                if let r = ring {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.white.opacity(0.9), lineWidth: 2)
                        .frame(width: r.width + 12, height: r.height + 12)
                        .position(x: r.midX, y: r.midY)
                        .allowsHitTesting(false)
                }

                // Tapping the dim advances the tour / dismisses a tip — but ONLY on steps
                // with no spotlighted target (centered welcome/tip cards). A step that
                // rings a real, interactive element (a tab, the Ask button) gets NO tap
                // catcher anywhere: not a full-screen one (that swallows every tap,
                // including ones meant for the real element beneath) and not a hole-punched
                // one either (matching the ring's exact on-screen hole to the real element's
                // true hit-testable frame proved fragile — small discrepancies between the
                // anchor-preference geometry and the rendered frame left the real element
                // still unreachable at its edges). With no catcher at all, the real element
                // is always simply itself, fully tappable; the worker advances via the
                // card's own Skip/Next/Done, or by directly using the highlighted control.
                if ring == nil {
                    Color.clear
                        .contentShape(Rectangle())
                        .ignoresSafeArea()
                        .onTapGesture(perform: onTap)
                }

                // The coach-mark card: bottom-anchored above the ring when it points at a
                // target, centered otherwise (welcome + tips). The gap above the card is
                // computed from the ring's OWN position (fullSize.height - r.top), not a
                // flat guess for "the tab bar" — a fixed guess undershoots for a target that
                // floats higher up the screen (like the Ask button), letting the card
                // visually and HIT-TESTABLY overlap the very element it is spotlighting, so
                // a tap meant for that element lands on the card's own Next/Done instead.
                VStack {
                    if ring != nil { Spacer() }
                    card(coach, c)
                    if let r = ring {
                        Spacer().frame(height: max(fullSize.height - r.minY + 12, 12))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: ring == nil ? .center : .bottom)
                .padding(.horizontal, 20)
            }
            // A non-wrapping marker, not the container itself — an identifier set directly on a
            // wrapping container leaks onto every descendant element in the XCUITest tree,
            // shadowing that container's own more-specific descendant identifiers (confirmed
            // empirically; see ContentView.swift's `shifts_screen` fix for the full explanation).
            .overlay(alignment: .topLeading) {
                Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("onboarding_overlay")
            }
        )
    }

    @ViewBuilder
    private func card(_ coach: CoachMark, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(coach.title).font(ShiftFont.sans(18, .semibold)).foregroundColor(c.ink)
            Text(coach.body).font(ShiftFont.sans(15, .regular)).foregroundColor(c.sec)
                .fixedSize(horizontal: false, vertical: true)
            if model.state.isTour {
                HStack {
                    Button("Skip", action: onSkip)
                        .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.sec)
                        .buttonStyle(.plain)
                    Spacer()
                    Text("\(model.state.stepIndex) of \(model.state.stepCount)")
                        .font(ShiftFont.sans(13, .medium)).foregroundColor(c.ter)
                    Spacer()
                    HStack(spacing: 8) {
                        if model.state.canGoBack {
                            Button("Back", action: onBack)
                                .font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .overlay(Capsule().stroke(c.divider, lineWidth: 1))
                                .buttonStyle(.plain)
                        }
                        Button(model.state.stepIndex >= model.state.stepCount ? "Done" : "Next", action: onNext)
                            .font(ShiftFont.sans(14, .semibold)).foregroundColor(.white)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(c.blue).clipShape(Capsule())
                            .buttonStyle(.plain)
                    }
                }
                .padding(.top, 6)
            } else {
                Button(action: onDismissTip) {
                    Text("Got it").font(ShiftFont.sans(15, .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(c.blue).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
            }
        }
        .padding(20)
        .frame(maxWidth: 420)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

// MARK: - Notification priming (pre-permission primer)

/// Per-device flag for the notification priming card (UserDefaults, like the seen-keys).
enum NotificationPrimingStore {
    private static let key = "notif_primer_responded"
    static func hasResponded() -> Bool { UserDefaults.standard.bool(forKey: key) }
    static func markResponded() { UserDefaults.standard.set(true, forKey: key) }
}

/// The pre-permission primer: a scrim + centered card explaining WHY alerts matter, with a
/// primary "Turn on alerts" and a quiet "Not now". Shown once the welcome tour is done;
/// Confirm fires the real OS request (`NotificationAuthorizer.request`), Dismiss never
/// touches it. Copy comes from the shared `NotificationPriming`, so both platforms match.
struct NotificationPrimingCardView: View {
    @Environment(\.colorScheme) private var scheme
    let onConfirm: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Scrim swallows taps: the worker must make an explicit choice.
            Color.black.opacity(scheme == .dark ? 0.78 : 0.6)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {}
            VStack(alignment: .leading, spacing: 8) {
                Text(NotificationPriming.shared.TITLE)
                    .font(ShiftFont.sans(18, .semibold)).foregroundColor(c.ink)
                Text(NotificationPriming.shared.BODY)
                    .font(ShiftFont.sans(15, .regular)).foregroundColor(c.sec)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onConfirm) {
                    Text(NotificationPriming.shared.CONFIRM)
                        .font(ShiftFont.sans(15, .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(c.blue).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                .accessibilityIdentifier("notification_primer_confirm")
                Button(action: onDismiss) {
                    Text(NotificationPriming.shared.DISMISS)
                        .font(ShiftFont.sans(15, .semibold)).foregroundColor(c.sec)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("notification_primer_dismiss")
            }
            .padding(20)
            .frame(maxWidth: 420)
            .background(c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.horizontal, 20)
        }
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping container leaks onto every descendant element in the XCUITest tree,
        // shadowing that container's own more-specific descendant identifiers (confirmed
        // empirically; see ContentView.swift's `shifts_screen` fix for the full explanation).
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("notification_primer")
        }
    }
}

