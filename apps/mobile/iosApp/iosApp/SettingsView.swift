import SwiftUI
import UIKit
import Shared

/// Settings / Profile in SwiftUI, over the shared `SettingsViewModel` (observed — the
/// broadcast toggle + theme mutate). Rebuilds worker-app.html `SettingsScreen`,
/// redesigned 2026-08-06 (BSpec §10.1): Notifications splits into what a worker can
/// change (shift reminders, the merged open-shifts card, general updates) and a
/// collapsed "Always-on notifications" disclosure for the five mandatory channels; the
/// Account group is Sign out only, with Privacy policy / Terms of service links below
/// it. Selector ids match the Maestro contract.
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
    // Persist the configurable channels (open shifts at my/other houses, and the
    // shift-reminder lead times). Called with the WHOLE preference set, because the
    // RPC upserts every column at once. Nil on the demo path (local-only).
    var onToggleNotification: ((NotificationPreferences) -> Void)? = nil
    @Environment(\.colorScheme) private var scheme
    /// Whether the five mandatory notification rows are expanded (BSpec §10.1, 2026-08-06).
    @State private var alwaysOnExpanded = false
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
                let configurable = st.notifications.filter { $0.interactive }
                let alwaysOn = st.notifications.filter { !$0.interactive }
                ForEach(Array(configurable.enumerated()), id: \.offset) { idx, row in
                    // The two open-shift channels render as ONE merged card; only emit it
                    // once, on the home-house row, and skip the other-houses peer entirely.
                    if row.channel == .openShiftsOtherHouses {
                        EmptyView()
                    } else if row.channel == .openShiftsHomeHouse {
                        let otherHouses = configurable.first { $0.channel == .openShiftsOtherHouses }
                        if let otherHouses {
                            openShiftsRow(homeHouse: row, otherHouses: otherHouses, c: c)
                        }
                    } else {
                        notificationRow(row, last: idx == configurable.count - 1, c)
                    }
                }
                alwaysOnDisclosure(alwaysOn, c)
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

            // PennKey & security, Help & policy, and the six tour-replay rows are gone
            // (2026-08-06): every tour already has its own "?" entry point on its own tab
            // header, so nothing is lost by dropping the Settings duplicate. Account is
            // Sign out only.
            group("Account", c) {
                Button(action: onSignOut) {
                    settingsRow(icon: ShiftIcons.logout, tint: c.danger.accent, title: "Sign out", titleColor: c.danger.accent, c: c) { AnyView(EmptyView()) }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("settings_sign_out")
            }

            legalLinks(c)

            Text("SHIFT · v\(st.appVersion)")
                .font(ShiftFont.mono(11.5)).monospacedDigit().foregroundColor(c.ter)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 28)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.bg)
        // A non-wrapping marker, not the container itself — an identifier set directly on a
        // wrapping VStack leaks onto every descendant element in the XCUITest tree, shadowing
        // sibling rows below it (confirmed empirically; see ContentView.swift's matching
        // `shifts_screen` fix for the full explanation).
        .overlay(alignment: .topLeading) {
            Color.clear.frame(width: 1, height: 1).accessibilityIdentifier("settings_screen")
        }
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
            // No trailing chevron: this card has never opened anything on tap, and the
            // arrow read as a dead end (2026-08-06). Tapping the row does nothing today.
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
        // The shift-reminder row owns three lead-time checkboxes underneath. They ARE the
        // control; its switch is a shortcut for "all off" / "back to the default".
        let isReminders = row.channel == .shiftReminders
        return VStack(spacing: 0) {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.14)).frame(width: 30, height: 30)
                    Image(systemName: icon).font(.system(size: 16)).foregroundColor(tint)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.title).font(ShiftFont.sans(15, .medium)).foregroundColor(c.ink)
                        .accessibilityIdentifier("settings_notification_title")
                    Text(row.sub).font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                        .accessibilityIdentifier("settings_notification_sub")
                }
                Spacer(minLength: 0)
                Toggle("", isOn: Binding(get: { row.on }, set: { _ in toggleChannel(row) }))
                    .labelsHidden().tint(c.blue).disabled(!row.interactive)
                    .accessibilityIdentifier(toggleIdentifier(row.channel))
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            if isReminders { leadTimeChecklist(c) }
            if !last { divider(c) }
        }
    }

    /// The merged "Open shift notifications" card: one header over two independent switch
    /// rows, "At my house" and "At other houses" — the same disclosure shape the
    /// shift-reminder row uses for its lead-time checkboxes, so a worker reads one concept
    /// ("a shift opened up") with two toggles rather than two unrelated peer rows.
    private func openShiftsRow(homeHouse: NotificationRowModel, otherHouses: NotificationRowModel, c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 13) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(c.blue.opacity(0.14)).frame(width: 30, height: 30)
                    Image(systemName: ShiftIcons.building).font(.system(size: 16)).foregroundColor(c.blue)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(SettingsKt.OPEN_SHIFTS_GROUP_TITLE).font(ShiftFont.sans(15, .medium)).foregroundColor(c.ink)
                    Text(SettingsKt.OPEN_SHIFTS_GROUP_SUB).font(ShiftFont.sans(12.5)).foregroundColor(c.ter)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
            ForEach([homeHouse, otherHouses], id: \.channel) { row in
                HStack {
                    Text(row.title).font(ShiftFont.sans(13.5)).foregroundColor(c.ink)
                    Spacer(minLength: 0)
                    Toggle("", isOn: Binding(get: { row.on }, set: { _ in toggleChannel(row) }))
                        .labelsHidden().tint(c.blue)
                        .accessibilityIdentifier(toggleIdentifier(row.channel))
                }
                .padding(.leading, 57).padding(.trailing, 14).padding(.bottom, 8)
            }
            divider(c)
        }
    }

    /// The five mandatory notification rows, collapsed behind a disclosure so they do not
    /// compete with the rows a worker can actually change. Shown, never hidden entirely: a
    /// worker can still see that a swap request will always reach them, just one tap away.
    private func alwaysOnDisclosure(_ rows: [NotificationRowModel], _ c: ShiftColors) -> some View {
        VStack(spacing: 0) {
            Button {
                alwaysOnExpanded.toggle()
            } label: {
                HStack {
                    Text(SettingsKt.alwaysOnNotificationsLabel(count: Int32(rows.count)))
                        .font(ShiftFont.sans(13)).foregroundColor(c.sec)
                    Spacer(minLength: 0)
                    Image(systemName: ShiftIcons.chevronRight)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(c.outline)
                        .rotationEffect(.degrees(alwaysOnExpanded ? 90 : 0))
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("settings_always_on_disclosure")
            if alwaysOnExpanded {
                ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                    notificationRow(row, last: idx == rows.count - 1, c)
                }
            }
        }
    }

    /// Privacy policy / Terms of service — plain text links to the guide site
    /// (`shiftatpenn.com/guide/legal/...`), above the version string.
    private func legalLinks(_ c: ShiftColors) -> some View {
        HStack(spacing: 6) {
            Spacer(minLength: 0)
            Button("Privacy policy") {
                if let url = URL(string: SettingsKt.PRIVACY_POLICY_URL) { UIApplication.shared.open(url) }
            }
            .accessibilityIdentifier("settings_privacy_policy_link")
            Text("·").foregroundColor(c.outline)
            Button("Terms of service") {
                if let url = URL(string: SettingsKt.TERMS_OF_SERVICE_URL) { UIApplication.shared.open(url) }
            }
            .accessibilityIdentifier("settings_terms_of_service_link")
            Spacer(minLength: 0)
        }
        .font(ShiftFont.sans(12)).foregroundColor(c.sec)
        .buttonStyle(.plain)
    }

    /// Flip one channel. Only the interactive ones reach here; GENERAL_UPDATES still goes
    /// through its own Edge Function, the rest through `set_notification_preferences`.
    private func toggleChannel(_ row: NotificationRowModel) {
        guard row.interactive else { return }
        if row.channel == .generalUpdates {
            model.vm.toggleBroadcast()
            let subscribed = model.vm.uiState.value.notifications
                .first { $0.channel == .generalUpdates }?.on ?? false
            onToggleBroadcast?(subscribed)
        } else if let next = model.vm.toggleNotification(channel: row.channel) {
            onToggleNotification?(next)
        }
    }

    /// The 2h / 1h / 30m checkboxes (BSpec §10.1a, 2026-07-28).
    ///
    /// Checkboxes rather than a picker because the choices are not exclusive: a worker may
    /// want a 2-hour heads-up AND a 30-minute nudge. All three, some, or none. Unticking
    /// the last one is allowed; the row's summary then reads "Off", so "no reminders" is
    /// visibly different from "something failed to load".
    @ViewBuilder
    private func leadTimeChecklist(_ c: ShiftColors) -> some View {
        let chosen = model.vm.shiftReminderOffsets
        VStack(alignment: .leading, spacing: 2) {
            ForEach(SettingsKt.SHIFT_REMINDER_LEAD_TIMES, id: \.self) { minutes in
                let ticked = chosen.contains(minutes)
                Button {
                    if let next = model.vm.toggleShiftReminder(offsetMinutes: minutes.int32Value) {
                        onToggleNotification?(next)
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: ticked ? "checkmark.square.fill" : "square")
                            .font(.system(size: 17))
                            .foregroundColor(ticked ? c.blue : c.ter)
                            .accessibilityIdentifier("settings_lead_time_box_\(minutes)")
                        Text(SettingsKt.shiftReminderLabel(offsetMinutes: minutes.int32Value))
                            .font(ShiftFont.sans(14))
                            .foregroundColor(ticked ? c.ink : c.sec)
                            .accessibilityIdentifier("settings_lead_time_\(minutes)")
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 57).padding(.trailing, 14).padding(.bottom, 10)
    }

    private func toggleIdentifier(_ channel: NotificationChannel) -> String {
        switch channel {
        case .generalUpdates: return "settings_broadcast_toggle"
        case .openShiftsHomeHouse: return "settings_open_home_toggle"
        case .openShiftsOtherHouses: return "settings_open_other_toggle"
        case .shiftReminders: return "settings_shift_reminders_toggle"
        default: return ""
        }
    }

    private func notificationVisual(_ channel: NotificationChannel, _ c: ShiftColors) -> (String, Color) {
        switch channel {
        case .float: return (ShiftIcons.floatOut, c.floatOut.accent)
        case .swapRequests: return (ShiftIcons.refresh, c.pending)
        case .breakSignup: return (ShiftIcons.snowflake, c.breakShift.accent)
        case .preferences: return (ShiftIcons.calendar, c.pickupDot)
        case .shiftReminders: return (ShiftIcons.clock, c.breakShift.accent)
        case .schedulePublished: return (ShiftIcons.calendar, c.blue)
        case .openShiftsHomeHouse: return (ShiftIcons.building, c.blue)
        case .openShiftsOtherHouses: return (ShiftIcons.building, c.ter)
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
