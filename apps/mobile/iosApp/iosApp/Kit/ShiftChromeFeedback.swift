import SwiftUI

/// Mobile reskin foundation (iOS) — chrome (large title + tab bar) and feedback.

// MARK: - Avatar + icon button

struct Avatar: View {
    let initial: String
    var onTap: (() -> Void)? = nil
    var body: some View {
        let inner = Text(String(initial.prefix(1)).uppercased())
            .font(ShiftFont.sans(15, .semibold)).foregroundColor(.white)
            .frame(width: Dims.avatar, height: Dims.avatar)
            .background(LinearGradient(colors: [Color(hex: 0x2F6BFF), Color(hex: 0x0061FC)], startPoint: .topLeading, endPoint: .bottomTrailing))
            .clipShape(Circle())
        if let onTap { Button(action: onTap) { inner }.buttonStyle(.plain) } else { inner }
    }
}

struct ShiftIconButton: View {
    let systemIcon: String
    let action: () -> Void
    var badgeCount: Int = 0
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        Button(action: action) {
            Image(systemName: systemIcon).font(.system(size: Dims.iconLg, weight: .regular)).foregroundColor(c.ink)
                .frame(width: Dims.iconButton, height: Dims.iconButton)
                .background(c.surface).clipShape(Circle())
                .shadow(color: Color.black.opacity(scheme == .dark ? 0.4 : 0.06), radius: 2, y: 1)
        }
        .buttonStyle(.plain)
        .overlay(alignment: .topTrailing) {
            if badgeCount > 0 { CountBadge(count: badgeCount).offset(x: 3, y: -3) }
        }
    }
}

// MARK: - Large title header (custom: eyebrow + 30pt title + avatar)

struct ShiftLargeHeader: View {
    let title: String
    var context: String? = nil
    var avatarInitial: String? = nil
    var onAvatar: (() -> Void)? = nil
    var trailing: AnyView? = nil
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 1) {
                if let context { Text(context).font(ShiftFont.sans(13, .semibold)).foregroundColor(c.blue) }
                Text(title).font(ShiftFont.sans(30, .bold, relativeTo: .largeTitle)).tracking(-0.5).foregroundColor(c.ink)
            }
            Spacer(minLength: 8)
            HStack(spacing: 10) {
                if let trailing { trailing }
                if let avatarInitial { Avatar(initial: avatarInitial, onTap: onAvatar) }
            }
        }
        .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 8)
        .background(c.bg)
    }
}

// MARK: - Tab scaffold (native TabView = the iOS tab bar)

struct ShiftTabItem {
    let title: String
    let systemIcon: String
    var badge: Int = 0
}

let workerTabItems: [ShiftTabItem] = [
    .init(title: "My Shifts", systemIcon: ShiftIcons.list),
    .init(title: "Open", systemIcon: ShiftIcons.plus),
    .init(title: "Calendar", systemIcon: ShiftIcons.calendar),
    .init(title: "Updates", systemIcon: ShiftIcons.bell),
]

struct ShiftTabScaffold<Content: View>: View {
    @Binding var selection: Int
    var items: [ShiftTabItem] = workerTabItems
    @ViewBuilder let content: (Int) -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        TabView(selection: $selection) {
            ForEach(items.indices, id: \.self) { i in
                content(i)
                    .tabItem { Label(items[i].title, systemImage: items[i].systemIcon) }
                    .badge(items[i].badge)
                    .tag(i)
            }
        }
        .tint(ShiftColors.resolve(scheme).blue)
    }
}

// MARK: - Toast

enum ToastTone { case neutral, success, error }

struct ShiftToast: View {
    let message: String
    var tone: ToastTone = .neutral
    var systemIcon: String? = nil
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        HStack(spacing: 10) {
            if let icon = systemIcon {
                ZStack {
                    Circle().fill(dotColor).frame(width: 22, height: 22)
                    Image(systemName: icon).font(.system(size: 12, weight: .bold)).foregroundColor(c.toastBg)
                }
            }
            Text(message).font(ShiftFont.sans(14.5, .medium)).foregroundColor(c.toastFg)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 13)
        .background(c.toastBg)
        .clipShape(RoundedRectangle(cornerRadius: Radii.toast, style: .continuous))
    }
    private var dotColor: Color {
        switch tone { case .success: return c.success.accent; case .error: return c.danger.accent; case .neutral: return c.ink }
    }
}

// MARK: - Banner

enum BannerTone { case info, warning, error, success }

struct ShiftBanner: View {
    let title: String
    var bodyText: String? = nil
    var tone: BannerTone = .info
    var actionLabel: String? = nil
    var onAction: (() -> Void)? = nil
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: icon).font(.system(size: 18, weight: .regular)).foregroundColor(accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(ShiftFont.sans(14, .semibold)).foregroundColor(deep)
                if let bodyText { Text(bodyText).font(ShiftFont.sans(13)).foregroundColor(c.sec) }
            }
            Spacer(minLength: 0)
            if let actionLabel, let onAction {
                Button(action: onAction) { Text(actionLabel).font(ShiftFont.sans(13.5, .bold)).foregroundColor(accent) }
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .overlay(alignment: .leading) { Rectangle().fill(accent).frame(width: Dims.breakBorder) }
        .clipShape(RoundedRectangle(cornerRadius: Radii.banner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radii.banner, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }
    private var accent: Color {
        switch tone { case .info: return c.pickupDot; case .warning: return c.breakShift.accent; case .error: return c.danger.accent; case .success: return c.success.accent }
    }
    private var deep: Color {
        switch tone { case .info: return c.onBlueContainer; case .warning: return c.breakShift.deep; case .error: return c.danger.deep; case .success: return c.success.deep }
    }
    private var icon: String {
        switch tone { case .info: return ShiftIcons.info; case .warning, .error: return ShiftIcons.warning; case .success: return ShiftIcons.checkCircle }
    }
}

// MARK: - Countdown chip

enum CountdownTone { case normal, urgent, passed }

struct CountdownChip: View {
    let label: String
    var tone: CountdownTone = .normal
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: ShiftIcons.clock).font(.system(size: 14, weight: .semibold))
            Text(label).font(ShiftFont.mono(13.5, .semibold)).monospacedDigit()
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .foregroundColor(fg).background(bg).clipShape(Capsule())
    }
    private var fg: Color { switch tone { case .normal: return c.pending; case .urgent: return c.danger.accent; case .passed: return c.ter } }
    private var bg: Color { switch tone { case .normal: return c.warnSoft; case .urgent: return c.danger.tint; case .passed: return c.surfaceVar } }
}

// MARK: - Count badge

struct CountBadge: View {
    let count: Int
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(ShiftFont.sans(10, .bold)).foregroundColor(.white)
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(c.danger.accent).clipShape(Capsule())
                .overlay(Capsule().stroke(c.bg, lineWidth: 1.5))
        }
    }
}

// MARK: - Empty state

struct EmptyState: View {
    let title: String
    let systemIcon: String
    var bodyText: String? = nil
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        VStack(spacing: 5) {
            Image(systemName: systemIcon).font(.system(size: 26, weight: .regular)).foregroundColor(c.ter)
                .frame(width: 56, height: 56).background(c.surfaceVar)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            Text(title).font(ShiftFont.sans(16, .semibold)).foregroundColor(c.ink).padding(.top, 14)
            if let bodyText { Text(bodyText).font(ShiftFont.sans(13.5)).foregroundColor(c.ter).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32).padding(.vertical, 40)
    }
}

// MARK: - Skeleton

struct ShimmerBar: View {
    var corner: CGFloat = 8
    @State private var x: CGFloat = -1
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        RoundedRectangle(cornerRadius: corner, style: .continuous).fill(c.skeletonA)
            .overlay(
                GeometryReader { geo in
                    RoundedRectangle(cornerRadius: corner, style: .continuous)
                        .fill(LinearGradient(colors: [.clear, c.skeletonB, .clear], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: x * geo.size.width)
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { x = 1.4 }
            }
    }
}

struct SkeletonShiftCard: View {
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        HStack(spacing: 12) {
            ShimmerBar(corner: 11).frame(width: Dims.houseBadge, height: Dims.houseBadge)
            VStack(alignment: .leading, spacing: 8) {
                ShimmerBar().frame(width: 150, height: 14)
                ShimmerBar().frame(width: 90, height: 11)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Spacing.cardPadH).padding(.vertical, Spacing.cardPadV)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radii.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radii.card, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
    }
}
