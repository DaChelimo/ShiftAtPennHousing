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
            .accessibilityIdentifier("onboarding_overlay")
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
        .accessibilityIdentifier("notification_primer")
    }
}

// MARK: - Widget-add prompt (behavioral)

/// Per-device counters for the widget-add prompt (UserDefaults, like the seen-keys).
/// `recordLaunch` is called once per process; `recordCalendarOpen` each time the worker
/// opens the My-Shifts tab. Mirrors Android's WidgetPromptPrefs.
enum WidgetPromptStore {
    private static let opens = "widget_calendar_opens"
    private static let launches = "widget_launch_count"
    private static let shows = "widget_prompt_shows"
    private static let lastShown = "widget_prompt_last_shown_launch"
    private static let acceptedKey = "widget_prompt_accepted"
    private static var d: UserDefaults { .standard }

    static func calendarOpens() -> Int { d.integer(forKey: opens) }
    static func launchCount() -> Int { d.integer(forKey: launches) }
    static func showCount() -> Int { d.integer(forKey: shows) }
    static func lastShownLaunch() -> Int { d.integer(forKey: lastShown) }
    static func accepted() -> Bool { d.bool(forKey: acceptedKey) }

    static func recordLaunch() { d.set(launchCount() + 1, forKey: launches) }
    static func recordCalendarOpen() -> Int { let n = calendarOpens() + 1; d.set(n, forKey: opens); return n }
    static func recordShown() { d.set(showCount() + 1, forKey: shows); d.set(launchCount(), forKey: lastShown) }
    static func markAccepted() { d.set(true, forKey: acceptedKey) }
}

/// A pre-formatted preview of the worker's next shift for the prompt tile.
struct WidgetPreview {
    let house: String
    let whenLabel: String
}

/// Derives the next upcoming shift preview from the worker's shown shifts. Formatting is
/// America/New_York (the block-time invariant), mirroring the Android WidgetSync formatter.
enum WidgetPromptPreview {
    private static let ny = TimeZone(identifier: "America/New_York")!

    static func next(from shifts: [MyShift], nowMillis: Int64) -> WidgetPreview? {
        let upcoming = shifts
            .filter { !$0.droppedStillOpen && $0.end.toEpochMilliseconds() >= nowMillis }
            .sorted { $0.start.toEpochMilliseconds() < $1.start.toEpochMilliseconds() }
        guard let s = upcoming.first else { return nil }
        return WidgetPreview(
            house: s.house.name,
            whenLabel: label(startMs: s.start.toEpochMilliseconds(), endMs: s.end.toEpochMilliseconds(), nowMs: nowMillis)
        )
    }

    private static func fmt(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = ny
        f.dateFormat = pattern
        return f
    }

    private static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000.0) }

    private static func label(startMs: Int64, endMs: Int64, nowMs: Int64) -> String {
        let day = dayLabel(startMs: startMs, nowMs: nowMs)
        let sameMeridiem = fmt("a").string(from: date(startMs)) == fmt("a").string(from: date(endMs))
        let start = sameMeridiem ? fmt("h:mm").string(from: date(startMs)) : fmt("h:mm a").string(from: date(startMs))
        return "\(day), \(start) to \(fmt("h:mm a").string(from: date(endMs)))"
    }

    private static func dayLabel(startMs: Int64, nowMs: Int64) -> String {
        let days = Int((Double(nyMidnight(startMs) - nyMidnight(nowMs)) / 86_400_000.0).rounded())
        switch days {
        case 0: return "Today"
        case 1: return "Tomorrow"
        default: return fmt("EEE, MMM d").string(from: date(startMs))
        }
    }

    private static func nyMidnight(_ ms: Int64) -> Int64 {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = ny
        return Int64(cal.startOfDay(for: date(ms)).timeIntervalSince1970 * 1000)
    }
}

/// The widget-add prompt (iOS). A two-step card: the benefit nudge with a LIVE preview of
/// the worker's real next shift, then (on "Show me how") the 3-step how-to. Copy comes from
/// the shared `WidgetPrompt`, so both platforms match.
struct WidgetPromptCardView: View {
    @Environment(\.colorScheme) private var scheme
    let previewHouse: String?
    let previewWhen: String?
    let onConfirm: () -> Void
    let onDismiss: () -> Void
    @State private var showHowTo = false

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        return ZStack {
            // Tapping the scrim dismisses (a lighter touch than the notification primer):
            // the widget nudge is optional, and this counts as "Maybe later".
            Color.black.opacity(scheme == .dark ? 0.78 : 0.6)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }
            VStack(alignment: .leading, spacing: 10) {
                if !showHowTo {
                    Text(WidgetPrompt.shared.TITLE).font(ShiftFont.sans(18, .semibold)).foregroundColor(c.ink)
                    Text(WidgetPrompt.shared.BODY).font(ShiftFont.sans(15, .regular)).foregroundColor(c.sec)
                        .fixedSize(horizontal: false, vertical: true)
                    previewTile(c)
                    filledButton(WidgetPrompt.shared.CONFIRM, c) { showHowTo = true; onConfirm() }
                        .accessibilityIdentifier("widget_prompt_confirm")
                    Button(action: onDismiss) {
                        Text(WidgetPrompt.shared.DISMISS)
                            .font(ShiftFont.sans(15, .semibold)).foregroundColor(c.sec)
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("widget_prompt_dismiss")
                } else {
                    Text(WidgetPrompt.shared.HOW_TO_TITLE).font(ShiftFont.sans(18, .semibold)).foregroundColor(c.ink)
                    howToStep(1, "Touch and hold an empty area of your Home Screen.", c)
                    howToStep(2, "Tap the plus in the top corner.", c)
                    howToStep(3, "Search for Shift and add the widget.", c)
                    filledButton(WidgetPrompt.shared.HOW_TO_DONE, c) { onDismiss() }
                        .padding(.top, 2)
                        .accessibilityIdentifier("widget_prompt_done")
                }
            }
            .padding(20)
            .frame(maxWidth: 420)
            .background(c.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .padding(.horizontal, 20)
        }
        .accessibilityIdentifier("widget_prompt")
    }

    @ViewBuilder
    private func previewTile(_ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Upcoming shifts").font(ShiftFont.sans(11, .medium)).foregroundColor(c.ter)
            if let house = previewHouse {
                Text(house).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink)
                if let whenLabel = previewWhen {
                    Text(whenLabel).font(ShiftFont.sans(13, .regular)).foregroundColor(c.sec)
                }
            } else {
                Text("No upcoming shifts").font(ShiftFont.sans(13, .regular)).foregroundColor(c.sec)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(scheme == .dark ? Color(red: 0.106, green: 0.133, blue: 0.188) : Color(red: 0.953, green: 0.961, blue: 0.973))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder
    private func filledButton(_ title: String, _ c: ShiftColors, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(ShiftFont.sans(15, .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 11)
                .background(c.blue).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func howToStep(_ number: Int, _ text: String, _ c: ShiftColors) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(number)").font(ShiftFont.sans(15, .semibold)).foregroundColor(c.blue)
            Text(text).font(ShiftFont.sans(14, .regular)).foregroundColor(c.sec)
        }
    }
}
