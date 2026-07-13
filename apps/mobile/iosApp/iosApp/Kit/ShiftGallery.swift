import SwiftUI

/// A living catalog of the iOS reskin foundation — every component, light + dark,
/// for Xcode `#Preview`. NOT a shipped screen (foundation only; feature screens are
/// reskinned later). Mirrors the Compose `ComponentGallery`.
struct ShiftComponentGallery: View {
    @State private var seg = 0
    @State private var toggleOn = true
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                group("Buttons")
                HStack(spacing: 8) {
                    ShiftButton(title: "Filled", action: {})
                    ShiftButton(title: "Tonal", action: {}, variant: .tonal)
                    ShiftButton(title: "Outlined", action: {}, variant: .outlined)
                }
                HStack(spacing: 8) {
                    ShiftButton(title: "Text", action: {}, variant: .text)
                    ShiftButton(title: "Decline", action: {}, variant: .destructive)
                    ShiftButton(title: "Drop", action: {}, variant: .destructiveFilled)
                }
                HStack(spacing: 8) {
                    ShiftButton(title: "Small", action: {}, size: .sm)
                    ShiftButton(title: "Large", action: {}, size: .lg, systemIcon: ShiftIcons.check)
                }

                group("Status pills")
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) { StatePill(state: .floatOut); StatePill(state: .floatIn); StatePill(state: .permanent) }
                    HStack(spacing: 8) { StatePill(state: .allied); StatePill(state: .ack); PendingTag() }
                }

                group("Worker state legend")
                StateLegend()

                group("Shift cards")
                VStack(spacing: 8) {
                    ShiftCard(state: .scheduled, houseInitial: "H", timeLabel: "09:00 - 13:00", houseName: "Harnwell", durationLabel: "4h", onTap: {})
                    ShiftCard(state: .floatOut, houseInitial: "Q", timeLabel: "21:00 - 23:00", eyebrow: "Today", houseName: "Harnwell", destination: "Quad", durationLabel: "2h", onTap: {})
                    ShiftCard(state: .pendingFloat, houseInitial: "Q", timeLabel: "21:00 - 23:00", houseName: "Harnwell", destination: "Quad", onTap: {})
                    ShiftCard(state: .pickupHome, houseInitial: "H", timeLabel: "13:00 - 15:00", houseName: "Harnwell", onTap: {})
                    ShiftCard(state: .floatIn, houseInitial: "H", timeLabel: "18:00 - 20:00", houseName: "from Quad", onTap: {})
                    ShiftCard(state: .breakShift, houseInitial: "H", timeLabel: "10:00 - 14:00", houseName: "Harnwell", durationLabel: "4h")
                    ShiftCard(state: .ack, houseInitial: "Q", timeLabel: "21:00 - 23:00", houseName: "Quad")
                    ShiftCard(state: .dropped, houseInitial: "H", timeLabel: "15:00 - 17:00", houseName: "Harnwell")
                }

                group("Open shifts")
                VStack(spacing: 8) {
                    OpenShiftCard(state: .open, houseInitial: "H", timeLabel: "16:00 - 18:00", eyebrow: "Wed · Jun 3", houseName: "Harnwell", actionLabel: "Claim", onAction: {})
                    OpenShiftCard(state: .permanent, houseInitial: "Q", timeLabel: "Every Wed · 18:00 - 20:00", houseName: "Quad", meta: "8 weeks remaining", actionLabel: "Pick up", actionVariant: .tonal, onAction: {})
                    OpenShiftCard(state: .unpickable, houseInitial: "H", timeLabel: "14:00 - 16:00", houseName: "Harnwell", meta: "Locked — within 2h of start")
                }

                group("Sections & rows")
                ShiftSection(title: "Picked up", isEmpty: false, count: 1) {
                    ShiftCard(state: .pickupHome, houseInitial: "H", timeLabel: "13:00 - 15:00", houseName: "Harnwell")
                }
                ShiftSection(title: "Dropped", isEmpty: true) { EmptyView() }
                VStack(spacing: 0) {
                    KeyValueRow(label: "Weekly soft cap", value: "20h")
                    KeyValueRow(label: "Break hard cap", value: "40h", last: true)
                }

                group("Controls")
                ShiftSegmented(options: ["My House", "Other Houses"], selection: $seg)
                HStack(spacing: 12) {
                    ShiftToggle(isOn: $toggleOn)
                    DurationChip(label: "2h")
                    DurationChip(label: "30m", tone: .blue)
                    CountBadge(count: 3)
                }

                group("Feedback")
                ShiftBanner(title: "You're needed at Quad", bodyText: "Float starts in 2h 14m. Acknowledge before 20:50.", tone: .warning, actionLabel: "View", onAction: {})
                HStack(spacing: 8) {
                    CountdownChip(label: "06:11")
                    CountdownChip(label: "02:30", tone: .urgent)
                    CountdownChip(label: "Passed", tone: .passed)
                }
                ShiftToast(message: "Shift claimed", tone: .success, systemIcon: ShiftIcons.check)
                SkeletonShiftCard()
                EmptyState(title: "All caught up", systemIcon: ShiftIcons.bell, bodyText: "No action needed right now.")
            }
            .padding(16)
        }
        .background(c.bg)
    }

    private func group(_ title: String) -> some View {
        Text(title).font(ShiftFont.sans(18, .bold)).foregroundColor(c.ink).padding(.top, 4)
    }
}

/// The native chrome: a TabView tab bar + a large-title header.
struct ShiftChromeShowcase: View {
    @State private var tab = 0
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        ShiftTabScaffold(
            selection: $tab,
            items: workerTabItems.enumerated().map { i, it in
                i == 3 ? ShiftTabItem(title: it.title, systemIcon: it.systemIcon, badge: 2) : it
            }
        ) { _ in
            VStack(spacing: 0) {
                ShiftLargeHeader(
                    title: "My Shifts",
                    context: "This week · Jun 1 - 7",
                    avatarInitial: "A",
                    trailing: AnyView(ShiftIconButton(systemIcon: ShiftIcons.bell, action: {}, badgeCount: 2))
                )
                ScrollView {
                    VStack(spacing: 8) {
                        ShiftCard(state: .scheduled, houseInitial: "H", timeLabel: "09:00 - 13:00", houseName: "Harnwell", durationLabel: "4h", onTap: {})
                        ShiftCard(state: .floatOut, houseInitial: "Q", timeLabel: "21:00 - 23:00", houseName: "Harnwell", destination: "Quad", onTap: {})
                    }
                    .padding(16)
                }
                .background(c.bg)
            }
        }
    }
}

#Preview("Gallery · Light") {
    ShiftComponentGallery().preferredColorScheme(.light)
}

#Preview("Gallery · Dark") {
    ShiftComponentGallery().preferredColorScheme(.dark)
}

#Preview("Chrome · Light") {
    ShiftChromeShowcase().preferredColorScheme(.light)
}
