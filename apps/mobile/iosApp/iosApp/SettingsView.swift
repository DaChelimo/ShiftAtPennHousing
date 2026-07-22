import SwiftUI
import Shared

/// Settings / Profile in SwiftUI, over the shared `SettingsViewModel` (observed — the
/// broadcast toggle + theme mutate). Rebuilds worker-app.html `SettingsScreen`: the
/// profile card, the Notifications group (only "General updates" / broadcast is
/// user-toggleable), the Appearance theme segmented control, the read-only Hours &
/// limits, and the Account group (Sign out). Selector ids match the Maestro contract.
@MainActor
final class SettingsObservable: ObservableObject {
    private(set) var vm: SettingsViewModel
    @Published var state: SettingsUiState
    private var task: Task<Void, Never>?
    private var live = false

    init(vm: SettingsViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        observe()
    }

    private func observe() {
        task?.cancel()
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    /// Live host: load the worker's real profile + broadcast subscription, rebuild the
    /// VM, re-observe. Falls back to the demo profile (no swap) when the read fails.
    /// `DemoFactory` supplies the app version Kotlin-side. Mirrors the Android
    /// `MainActivity` live wiring and the ack/updates `activateLive` pattern.
    func activateLive(repo: ProfileRepository, userId: String) async {
        guard !live else { return }
        live = true
        guard let snapshot = try? await repo.fetchProfile(userId: userId) else { return }
        vm = DemoFactory.shared.settingsViewModel(snapshot: snapshot)
        state = vm.uiState.value
        observe()
    }

    deinit { task?.cancel() }
}

struct SettingsScreen: View {
    @ObservedObject var model: SettingsObservable
    var onSignOut: () -> Void = {}
    /// Live host PATCHes `users-broadcast-subscription` with the NEW desired state; demo
    /// (nil) keeps the VM's optimistic local toggle only. Only the broadcast / "General
    /// updates" channel is interactive — the three personal-notif rows stay disabled (§10.1).
    var onToggleBroadcast: ((Bool) -> Void)? = nil
    /// Restart the first-run welcome tour on demand — the way back in for a worker who
    /// skipped it or just wants a refresher.
    var onReplayTour: () -> Void = {}
    /// Replay the interactive "Manage a shift" tour (the My-Shifts drop/swap/hand-off demo).
    var onReplayShiftTour: () -> Void = {}
    /// Replay the interactive Preferences (availability paint) tour.
    var onReplayPreferencesTour: () -> Void = {}
    /// Replay the interactive Break calendar (claim/drop) tour.
    var onReplayBreakTour: () -> Void = {}
    /// Replay the interactive swap-composer tour (fires the next time the swap page opens).
    var onReplaySwapTour: () -> Void = {}
    /// Replay the interactive House grid tour.
    var onReplayHouseGridTour: () -> Void = {}
    /// Replay the interactive Open-shifts claim tour (one-time vs permanent pickup).
    var onReplayOpenClaimTour: () -> Void = {}
    @Environment(\.colorScheme) private var scheme
    /// The app-wide appearance override the segmented control drives (and that the root
    /// applies via `.preferredColorScheme`). Persisted, so it is the source of truth for
    /// the selected segment — not the in-session-only VM theme.
    @ObservedObject private var theme = ThemeController.shared

    private let themes: [ThemeChoice] = [.system, .light, .dark]

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(alignment: .leading, spacing: 0) {
            PageTitle(title: "Settings")
            VStack(alignment: .leading, spacing: 22) {
                profileCard(st.profile, c)

            group("Notifications", c) {
                ForEach(Array(st.notifications.enumerated()), id: \.offset) { idx, row in
                    notificationRow(row, last: idx == st.notifications.count - 1, c)
                }
            }

            group("Appearance", c) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Theme").font(ShiftFont.sans(15, .medium)).foregroundColor(c.ink)
                    ShiftSegmented(
                        options: themes.map { themeLabel($0) },
                        selection: Binding(
                            get: { themes.firstIndex(of: theme.choice) ?? 0 },
                            set: {
                                // Apply + persist the choice app-wide, and keep the shared VM
                                // state in step so any consumer of `st.theme` stays consistent.
                                theme.choice = themes[$0]
                                model.vm.setTheme(choice: themes[$0])
                            }
                        )
                    )
                    .accessibilityIdentifier("settings_theme_segmented")
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
            }

            group("Hours & limits", c) {
                settingsRow(icon: ShiftIcons.tune, tint: c.blue, title: "Weekly soft cap", c: c) {
                    AnyView(Text(st.hours.softCapLabel).font(ShiftFont.mono(14, .semibold)).monospacedDigit().foregroundColor(c.sec))
                }
                divider(c)
                settingsRow(icon: ShiftIcons.ban, tint: c.danger.accent, title: "Break-period hard cap", c: c) {
                    AnyView(Text(st.hours.hardCapLabel).font(ShiftFont.mono(14, .semibold)).monospacedDigit().foregroundColor(c.sec))
                }
            }

            group("Account", c) {
                settingsRow(icon: ShiftIcons.person, tint: c.blue, title: "PennKey & security", c: c) {
                    AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                }
                divider(c)
                settingsRow(icon: ShiftIcons.info, tint: c.ter, title: "Help & policy", c: c) {
                    AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                }
                divider(c)
                Button(action: onReplayTour) {
                    settingsRow(icon: ShiftIcons.refresh, tint: c.blue, title: "Replay app tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_tour")
                divider(c)
                Button(action: onReplayShiftTour) {
                    settingsRow(icon: ShiftIcons.list, tint: c.blue, title: "Replay shift tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_shift_tour")
                divider(c)
                // Five more interactive tours, own Settings row each (never merged — a
                // worker replaying "the shift tour" should not also see an unrelated
                // break-calendar demo). Same row chrome, same "?" family they replay.
                Button(action: onReplayPreferencesTour) {
                    settingsRow(icon: ShiftIcons.tune, tint: c.blue, title: "Replay preferences tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_preferences_tour")
                divider(c)
                Button(action: onReplayBreakTour) {
                    settingsRow(icon: ShiftIcons.snowflake, tint: c.blue, title: "Replay break tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_break_tour")
                divider(c)
                Button(action: onReplaySwapTour) {
                    settingsRow(icon: "arrow.left.arrow.right", tint: c.blue, title: "Replay swap tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_swap_tour")
                divider(c)
                Button(action: onReplayHouseGridTour) {
                    settingsRow(icon: ShiftIcons.building, tint: c.blue, title: "Replay house grid tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_housegrid_tour")
                divider(c)
                Button(action: onReplayOpenClaimTour) {
                    settingsRow(icon: ShiftIcons.plus, tint: c.blue, title: "Replay open-shifts tour", c: c) {
                        AnyView(Image(systemName: ShiftIcons.chevronRight).font(.system(size: 15, weight: .semibold)).foregroundColor(c.outline))
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_replay_openclaim_tour")
                divider(c)
                Button(action: onSignOut) {
                    settingsRow(icon: ShiftIcons.logout, tint: c.danger.accent, title: "Sign out", titleColor: c.danger.accent, c: c) { AnyView(EmptyView()) }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_sign_out")
            }

            Text("Shift@PennHousing · v\(st.appVersion)")
                .font(ShiftFont.mono(11.5)).monospacedDigit().foregroundColor(c.ter)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.bg)
        .accessibilityIdentifier("settings_screen")
    }

    private func profileCard(_ profile: SettingsProfile, _ c: ShiftColors) -> some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(LinearGradient(colors: [Color(hex: 0x2F6BFF), Color(hex: 0x0061FC)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Text(profile.initial).font(ShiftFont.sans(21, .semibold)).foregroundColor(.white)
            }
            .frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 1) {
                Text(profile.name).font(ShiftFont.sans(17, .bold)).foregroundColor(c.ink)
                Text(profile.subtitle).font(ShiftFont.sans(13)).foregroundColor(c.sec)
            }
            Spacer(minLength: 0)
            Image(systemName: ShiftIcons.chevronRight).font(.system(size: 16, weight: .semibold)).foregroundColor(c.outline)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }

    private func group<Content: View>(_ title: String, _ c: ShiftColors, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(ShiftFont.sans(12.5, .bold)).tracking(0.6).foregroundColor(c.sec).padding(.leading, 6)
            VStack(spacing: 0) { content() }
                .background(c.surface)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        }
    }

    private func divider(_ c: ShiftColors) -> some View {
        Rectangle().fill(c.divider).frame(height: 1).padding(.leading, 57)
    }

    private func settingsRow(
        icon: String, tint: Color, title: String, titleColor: Color? = nil, c: ShiftColors,
        trailing: () -> AnyView
    ) -> some View {
        HStack(spacing: 13) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.14)).frame(width: 30, height: 30)
                Image(systemName: icon).font(.system(size: 16)).foregroundColor(tint)
            }
            Text(title).font(ShiftFont.sans(15, .medium)).foregroundColor(titleColor ?? c.ink)
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private func notificationRow(_ row: NotificationRowModel, last: Bool, _ c: ShiftColors) -> some View {
        let (icon, tint) = notificationVisual(row.channel, c)
        return VStack(spacing: 0) {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.14)).frame(width: 30, height: 30)
                    Image(systemName: icon).font(.system(size: 16)).foregroundColor(tint)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.title).font(ShiftFont.sans(15, .medium)).foregroundColor(c.ink)
                    Text(row.sub).font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                }
                Spacer(minLength: 0)
                Toggle("", isOn: Binding(get: { row.on }, set: { _ in
                    // Only GENERAL_UPDATES is interactive. Flip the optimistic local state,
                    // then PATCH the EF (live host) with the resulting subscription value.
                    if row.interactive {
                        model.vm.toggleBroadcast()
                        let subscribed = model.vm.uiState.value.notifications
                            .first { $0.channel == .generalUpdates }?.on ?? false
                        onToggleBroadcast?(subscribed)
                    }
                }))
                    .labelsHidden().tint(c.blue).disabled(!row.interactive)
                    .accessibilityIdentifier(row.channel == .generalUpdates ? "settings_broadcast_toggle" : "")
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            if !last { divider(c) }
        }
    }

    private func notificationVisual(_ channel: NotificationChannel, _ c: ShiftColors) -> (String, Color) {
        switch channel {
        case .float: return (ShiftIcons.floatOut, c.floatOut.accent)
        case .shiftReminders: return (ShiftIcons.clock, c.breakShift.accent)
        case .schedulePublished: return (ShiftIcons.calendar, c.blue)
        case .generalUpdates: return (ShiftIcons.bell, c.ter)
        default: return (ShiftIcons.bell, c.ter)
        }
    }

    private func themeLabel(_ choice: ThemeChoice) -> String {
        switch choice {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        default: return "System"
        }
    }
}
