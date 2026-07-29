import SwiftUI

/// Mobile reskin foundation (iOS) — the shared component kit, mirroring the Android
/// Compose kit (`androidApp/.../ui/kit`). Idiomatic SwiftUI / HIG: native `Toggle`,
/// `TabView` tab bar, `.sheet` with detents + grabber, SF Symbols. State color is
/// always paired with an icon + text tag (design-brief §4 / §9), never color alone.
///
/// These build in Xcode / the simulator (not the Gradle gate). Add the files under
/// `iosApp/iosApp/{Theme,Kit}` to the app target — see `iosApp/README.md`.

// MARK: - Press-scale button style

struct PressScaleStyle: ButtonStyle {
    var scale: CGFloat = Motion.pressScaleButton
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

// MARK: - Buttons

enum ShiftButtonVariant { case filled, tonal, outlined, text, destructive, destructiveFilled }
enum ShiftButtonSize { case sm, md, lg }

struct ShiftButton: View {
    let title: String
    let action: () -> Void
    var variant: ShiftButtonVariant = .filled
    var size: ShiftButtonSize = .md
    var systemIcon: String? = nil
    var fullWidth: Bool = false
    /// Work is in flight: an inline spinner takes the icon's place and taps are ignored.
    /// The label stays the caller's, so the button both SAYS what is happening ("Signing
    /// in…") and shows movement while it does. A button that only changes its words reads
    /// as a button that did nothing.
    var loading: Bool = false

    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if loading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: fg))
                        .scaleEffect(0.8)
                        .frame(width: iconSize, height: iconSize)
                } else if let systemIcon {
                    Image(systemName: systemIcon).font(.system(size: iconSize, weight: .semibold))
                }
                Text(title).font(ShiftFont.sans(labelSize, .semibold))
            }
            .padding(.horizontal, hPad)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: height)
            .foregroundColor(fg)
            .background(bg)
            .overlay(border)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
        .buttonStyle(PressScaleStyle())
        .allowsHitTesting(!loading)
    }

    private var height: CGFloat {
        switch size { case .sm: return Dims.buttonHeightSm; case .md: return Dims.buttonHeightMd; case .lg: return Dims.buttonHeightLg }
    }
    private var labelSize: CGFloat { switch size { case .sm: return 14; case .md: return 16; case .lg: return 17 } }
    private var iconSize: CGFloat { size == .sm ? Dims.iconSm : Dims.icon }
    private var hPad: CGFloat { variant == .text ? 8 : (size == .sm ? 14 : 20) }
    private var radius: CGFloat { size == .sm ? Radii.buttonSmall : Radii.button }

    private var fg: Color {
        switch variant {
        case .filled, .destructiveFilled: return .white
        case .tonal: return c.onBlueContainer
        case .outlined: return c.ink
        case .text: return c.blue
        case .destructive: return c.danger.accent
        }
    }
    @ViewBuilder private var bg: some View {
        switch variant {
        case .filled: c.blue
        case .tonal: c.blueContainer
        case .destructive: c.danger.tint
        case .destructiveFilled: c.danger.accent
        case .outlined, .text: Color.clear
        }
    }
    @ViewBuilder private var border: some View {
        if variant == .outlined {
            RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(c.outline, lineWidth: Dims.outlineStroke)
        }
    }
}

// MARK: - Shift state vocabulary

enum ShiftState {
    case scheduled, floatOut, pendingFloat, pickupHome, pickupCross, floatIn, breakShift, open, permanent, unpickable, dropped, allied, ack
}

struct StateVisual {
    var tint: Color
    var accent: Color?
    var badgeBg: Color
    var badgeFg: Color
    var tagLabel: String?
    var tagIcon: String?
    var tagColor: Color?
    var dot = false
    var leftBorder: Color? = nil
    var dashed = false
    var muted = false
    var strike = false
    var showsPending = false
    /// Render a full accent-colored border (white card body) instead of a tinted fill —
    /// used by permanent openings so the recurring slot reads at a glance without a pill.
    var prominentBorder = false
    /// Keep [tagLabel] for the legend but DON'T render the status pill on the card itself.
    var suppressPill = false
}

extension ShiftColors {
    func visual(_ s: ShiftState) -> StateVisual {
        switch s {
        case .scheduled:
            return StateVisual(tint: surface, accent: nil, badgeBg: scheduledBadge, badgeFg: ink, tagLabel: nil, tagIcon: nil, tagColor: nil)
        case .floatOut:
            return StateVisual(tint: floatOut.tint, accent: floatOut.accent, badgeBg: floatOut.badge, badgeFg: floatOut.deep, tagLabel: "Float-out", tagIcon: ShiftIcons.floatOut, tagColor: floatOut.deep)
        case .pendingFloat:
            return StateVisual(tint: floatOut.tint, accent: floatOut.accent, badgeBg: floatOut.badge, badgeFg: floatOut.deep, tagLabel: "Float-out", tagIcon: ShiftIcons.floatOut, tagColor: floatOut.deep, showsPending: true)
        case .pickupHome:
            return StateVisual(tint: surface, accent: nil, badgeBg: blueContainer, badgeFg: onBlueContainer, tagLabel: "Picked up", tagIcon: ShiftIcons.check, tagColor: pickupDot, dot: true)
        case .pickupCross:
            return StateVisual(tint: floatOut.tint, accent: floatOut.accent, badgeBg: floatOut.badge, badgeFg: floatOut.deep, tagLabel: "Picked up", tagIcon: ShiftIcons.check, tagColor: pickupDot, dot: true)
        case .floatIn:
            return StateVisual(tint: floatIn.tint, accent: floatIn.accent, badgeBg: floatIn.badge, badgeFg: floatIn.deep, tagLabel: "Float-in", tagIcon: ShiftIcons.floatIn, tagColor: floatIn.deep)
        case .breakShift:
            return StateVisual(tint: surface, accent: nil, badgeBg: breakShift.badge, badgeFg: breakShift.deep, tagLabel: "Break", tagIcon: ShiftIcons.snowflake, tagColor: breakShift.deep, leftBorder: breakShift.accent)
        case .open:
            return StateVisual(tint: surface, accent: nil, badgeBg: scheduledBadge, badgeFg: ter, tagLabel: nil, tagIcon: nil, tagColor: nil, dashed: true)
        case .permanent:
            return StateVisual(tint: surface, accent: permanent.accent, badgeBg: permanent.badge, badgeFg: permanent.deep, tagLabel: "Permanent opening", tagIcon: ShiftIcons.refresh, tagColor: permanent.deep, prominentBorder: true, suppressPill: true)
        case .unpickable:
            return StateVisual(tint: surfaceVar, accent: nil, badgeBg: unpickBadge, badgeFg: ter, tagLabel: "Unpickable", tagIcon: ShiftIcons.lock, tagColor: ter, muted: true)
        case .dropped:
            return StateVisual(tint: surface, accent: nil, badgeBg: scheduledBadge, badgeFg: ter, tagLabel: "Dropped (still open)", tagIcon: ShiftIcons.dropped, tagColor: sec, strike: true)
        case .allied:
            return StateVisual(tint: allied.tint, accent: allied.accent, badgeBg: allied.badge, badgeFg: allied.deep, tagLabel: "Allied", tagIcon: ShiftIcons.person, tagColor: allied.deep)
        case .ack:
            return StateVisual(tint: success.tint, accent: success.accent, badgeBg: success.badge, badgeFg: success.deep, tagLabel: "Acknowledged", tagIcon: ShiftIcons.checkCircle, tagColor: success.deep)
        }
    }
}

/// The "never color alone" status pill — icon + text.
struct StatePill: View {
    let state: ShiftState
    var strong: Bool = false
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        let v = c.visual(state)
        if let label = v.tagLabel {
            let fg = strong ? Color.white : (v.tagColor ?? c.ink)
            let bg = strong ? (v.accent ?? c.ink) : v.badgeBg
            HStack(spacing: 4) {
                if let icon = v.tagIcon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                Text(label).font(ShiftFont.sans(12, .semibold))
            }
            .padding(EdgeInsets(top: 3, leading: 6, bottom: 3, trailing: 8))
            .foregroundColor(fg)
            .background(bg)
            .clipShape(Capsule())
        }
    }
}

struct PendingTag: View {
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: ShiftIcons.clock).font(.system(size: 11, weight: .semibold))
            Text("Pending").font(ShiftFont.sans(12, .semibold))
        }
        .padding(EdgeInsets(top: 3, leading: 6, bottom: 3, trailing: 8))
        .foregroundColor(c.pending)
        .background(c.warnSoft)
        .clipShape(Capsule())
    }
}

struct LegendEntry: Identifiable {
    let id = UUID()
    let state: ShiftState
    let description: String
}

let workerStateLegend: [LegendEntry] = [
    .init(state: .scheduled, description: "Your normal scheduled shift at your home desk."),
    .init(state: .floatOut, description: "You're sent to cover another desk. Your hours don't change."),
    .init(state: .pendingFloat, description: "A float assigned but not yet acknowledged."),
    .init(state: .pickupHome, description: "A shift you picked up at your home desk."),
    .init(state: .pickupCross, description: "A shift you picked up at another desk."),
    .init(state: .floatIn, description: "Someone from another desk is covering here."),
    .init(state: .breakShift, description: "A break-period shift (short or winter break)."),
    .init(state: .open, description: "An open one-time gap you can claim."),
    .init(state: .permanent, description: "A recurring slot whose owner permanently dropped it."),
    .init(state: .unpickable, description: "Past the T-2h cutoff: visible but no longer claimable."),
    .init(state: .dropped, description: "You dropped this; still open until someone claims it."),
    .init(state: .allied, description: "Covered by external Allied Security."),
    .init(state: .ack, description: "A float you've acknowledged."),
]

struct StateLegend: View {
    var entries: [LegendEntry] = workerStateLegend
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(spacing: 10) {
            ForEach(entries) { entry in
                let v = c.visual(entry.state)
                HStack(spacing: 12) {
                    LegendSwatch(v: v)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(v.tagLabel ?? "Scheduled").font(ShiftFont.sans(13, .semibold)).foregroundColor(c.ink)
                        Text(entry.description).font(ShiftFont.sans(11.5)).foregroundColor(c.ter)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(c.bg)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }
}

private struct LegendSwatch: View {
    let v: StateVisual
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(v.tint)
            if v.dot {
                Circle().fill(c.pickupDot).frame(width: 8, height: 8)
            } else if let icon = v.tagIcon {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundColor(v.tagColor ?? c.ink)
            }
        }
        .frame(width: 30, height: 30)
        .overlay(swatchBorder)
    }
    @ViewBuilder private var swatchBorder: some View {
        if v.dashed {
            RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(c.outline, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        } else if let a = v.accent {
            RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(a.opacity(0.33), lineWidth: 1)
        } else {
            RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(c.divider, lineWidth: 1)
        }
    }
}

// MARK: - Atoms

struct PickupDot: View {
    var size: CGFloat = Dims.pickupDot
    @Environment(\.colorScheme) private var scheme
    var body: some View { Circle().fill(ShiftColors.resolve(scheme).pickupDot).frame(width: size, height: size) }
}

enum DurationTone { case neutral, blue }

struct DurationChip: View {
    let label: String
    var tone: DurationTone = .neutral
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }
    var body: some View {
        Text(label)
            .font(ShiftType.monoId).monospacedDigit()
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundColor(tone == .blue ? c.onBlueContainer : c.sec)
            .background(tone == .blue ? c.blueContainer : c.surfaceVar)
            .clipShape(RoundedRectangle(cornerRadius: Radii.durationChip, style: .continuous))
    }
}

struct HouseBadge: View {
    let initial: String
    let bg: Color
    let fg: Color
    var body: some View {
        Text(String(initial.prefix(1)).uppercased())
            .font(ShiftFont.sans(17, .semibold)).foregroundColor(fg)
            .frame(width: Dims.houseBadge, height: Dims.houseBadge)
            .background(bg)
            .clipShape(RoundedRectangle(cornerRadius: Radii.houseBadge, style: .continuous))
    }
}

// MARK: - Shift card

struct ShiftCard: View {
    let state: ShiftState
    let houseInitial: String
    let timeLabel: String
    var eyebrow: String? = nil
    var houseName: String? = nil
    var destination: String? = nil
    var durationLabel: String? = nil
    var meta: String? = nil
    /// "2 open" — concurrent identical openings at a multi-staff house (nil = single).
    var countLabel: String? = nil
    var active: Bool = false
    var onTap: (() -> Void)? = nil
    var trailing: AnyView? = nil

    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        let v = c.visual(state)
        let content = HStack(spacing: 12) {
            if let lb = v.leftBorder {
                Rectangle().fill(lb).frame(width: Dims.breakBorder)
            }
            HouseBadge(initial: houseInitial, bg: v.badgeBg, fg: v.badgeFg)
            VStack(alignment: .leading, spacing: 3) {
                if let eyebrow { Text(eyebrow.uppercased()).font(ShiftType.labelSmall).tracking(0.5).foregroundColor(c.sec) }
                HStack(spacing: 8) {
                    Text(timeLabel).font(ShiftType.monoTime).monospacedDigit()
                        .foregroundColor(v.muted ? c.ter : c.ink)
                        .strikethrough(v.strike)
                    if let durationLabel { DurationChip(label: durationLabel) }
                    if v.dot { PickupDot() }
                }
                if hasMeta(v) {
                    HStack(spacing: 6) {
                        if let houseName { Text(houseName).font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec) }
                        if let countLabel {
                            Text(countLabel)
                                .font(ShiftFont.sans(11.5, .semibold))
                                .foregroundColor(v.accent ?? c.sec)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background((v.accent ?? c.sec).opacity(0.12))
                                .clipShape(Capsule())
                                .accessibilityIdentifier("open_shift_count_badge")
                        }
                        if let destination { Text("→ \(destination)").font(ShiftFont.sans(13.5, .medium)).foregroundColor(v.accent ?? c.sec) }
                        if v.tagLabel != nil && !v.suppressPill { StatePill(state: state) }
                        if v.showsPending { PendingTag() }
                    }
                }
                if let meta { Text(meta).font(ShiftFont.sans(12.5)).foregroundColor(c.ter) }
            }
            Spacer(minLength: 0)
            if let trailing {
                trailing
            } else if onTap != nil {
                Image(systemName: ShiftIcons.chevronRight).font(.system(size: 16, weight: .semibold)).foregroundColor(c.outline)
            }
        }
        .padding(.horizontal, Spacing.cardPadH).padding(.vertical, Spacing.cardPadV)
        .background(v.tint)
        .clipShape(RoundedRectangle(cornerRadius: Radii.card, style: .continuous))
        .overlay(cardBorder(v))
        .opacity(v.muted ? 0.72 : 1)
        .shadow(color: Color.black.opacity(v.muted ? 0 : (scheme == .dark ? 0.4 : 0.05)), radius: active ? 10 : 3, y: active ? 4 : 1)

        if let onTap {
            Button(action: onTap) { content }.buttonStyle(PressScaleStyle(scale: Motion.pressScaleCard))
        } else {
            content
        }
    }

    private func hasMeta(_ v: StateVisual) -> Bool { houseName != nil || destination != nil || v.tagLabel != nil || v.showsPending || countLabel != nil }

    @ViewBuilder private func cardBorder(_ v: StateVisual) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radii.card, style: .continuous)
        if active {
            shape.strokeBorder(c.pickupDot, lineWidth: 2)
        } else if v.dashed {
            shape.strokeBorder(c.outline, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
        } else if v.prominentBorder, let a = v.accent {
            shape.strokeBorder(a.opacity(0.65), lineWidth: 1.5)
        } else if let a = v.accent {
            shape.strokeBorder(a.opacity(0.22), lineWidth: 1)
        } else {
            shape.strokeBorder(c.divider, lineWidth: 1)
        }
    }
}

/// Open-shift card (reuses `ShiftCard` with a trailing action).
struct OpenShiftCard: View {
    let state: ShiftState
    let houseInitial: String
    let timeLabel: String
    var eyebrow: String? = nil
    var houseName: String? = nil
    var meta: String? = nil
    var actionLabel: String? = nil
    var actionVariant: ShiftButtonVariant = .filled
    var onAction: (() -> Void)? = nil

    var body: some View {
        ShiftCard(
            state: state, houseInitial: houseInitial, timeLabel: timeLabel,
            eyebrow: eyebrow, houseName: houseName, meta: meta,
            trailing: (actionLabel != nil && onAction != nil)
                ? AnyView(ShiftButton(title: actionLabel!, action: onAction!, variant: actionVariant, size: .sm))
                : nil
        )
    }
}
