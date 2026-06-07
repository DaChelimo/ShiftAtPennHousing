import SwiftUI

/// Mobile reskin foundation (iOS) — the token layer.
///
/// A faithful HIG-idiomatic translation of the `--tk-*` design tokens in
/// `apps/mobile/design/worker-app.html` (the visual source of truth), reconciled
/// with `docs/design-brief.md` §4. Mirrors the Android Compose foundation in
/// `androidApp/.../ui/theme` so both platforms share one token vocabulary. See
/// `apps/mobile/design/DESIGN_TOKENS.md`.
///
/// Colors resolve from the active `ColorScheme` (light/dark) — no asset catalog
/// required. Read them in a view via `@Environment(\.colorScheme)` +
/// `ShiftColors.resolve(scheme)`, or the `themed { c in … }` helper.

// MARK: - Color hex helper

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: 1.0
        )
    }

    init(hex: UInt32, opacity: Double) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: opacity
        )
    }
}

// MARK: - Shift state colors

/// One shift-state's four-part treatment (base accent, card tint, deep text, badge).
struct StateColors {
    let accent: Color
    let tint: Color
    let deep: Color
    let badge: Color
}

/// The load-bearing semantic palette + chrome surfaces (the `--tk-*` tokens).
struct ShiftColors {
    let isDark: Bool

    // Brand
    let blue: Color
    let bluePressed: Color
    let blueContainer: Color
    let onBlueContainer: Color

    // Neutrals
    let ink: Color
    let sec: Color
    let ter: Color
    let divider: Color
    let outline: Color
    let bg: Color
    let surface: Color
    let surfaceVar: Color

    // Shift states
    let floatOut: StateColors
    let floatIn: StateColors
    let permanent: StateColors
    let allied: StateColors
    let breakShift: StateColors
    let success: StateColors
    let danger: StateColors
    let pending: Color
    let pickupDot: Color
    let unpickBadge: Color
    let scheduledBadge: Color

    // Chrome
    let tabbar: Color
    let scrim: Color
    let toastBg: Color
    let toastFg: Color
    let switchTrack: Color
    let warnSoft: Color
    let floatSoft: Color
    let skeletonA: Color
    let skeletonB: Color

    static func resolve(_ scheme: ColorScheme) -> ShiftColors {
        scheme == .dark ? .dark : .light
    }

    static let light = ShiftColors(
        isDark: false,
        blue: Color(hex: 0x0061FC),
        bluePressed: Color(hex: 0x0A4ECB),
        blueContainer: Color(hex: 0xE4EDFF),
        onBlueContainer: Color(hex: 0x00307E),
        ink: Color(hex: 0x121622),
        sec: Color(hex: 0x545B6B),
        ter: Color(hex: 0x828A9A),
        divider: Color(hex: 0xE3E6EC),
        outline: Color(hex: 0xC8CED9),
        bg: Color(hex: 0xF6F7F9),
        surface: Color(hex: 0xFFFFFF),
        surfaceVar: Color(hex: 0xEDF0F5),
        floatOut: StateColors(accent: Color(hex: 0x6E56CF), tint: Color(hex: 0xEEEBFA), deep: Color(hex: 0x4A3C8F), badge: Color(hex: 0xE2DCF6)),
        floatIn: StateColors(accent: Color(hex: 0x2E8B57), tint: Color(hex: 0xE4F4EA), deep: Color(hex: 0x1E6B40), badge: Color(hex: 0xCDEAD8)),
        permanent: StateColors(accent: Color(hex: 0xD14185), tint: Color(hex: 0xFBE9F2), deep: Color(hex: 0x9E2566), badge: Color(hex: 0xF7D6E5)),
        allied: StateColors(accent: Color(hex: 0x007D79), tint: Color(hex: 0xD7F5F4), deep: Color(hex: 0x007D79), badge: Color(hex: 0xBEEBE9)),
        breakShift: StateColors(accent: Color(hex: 0xC28A1A), tint: Color(hex: 0xF8F1E2), deep: Color(hex: 0x7C5A12), badge: Color(hex: 0xF2E7CB)),
        success: StateColors(accent: Color(hex: 0x1E874B), tint: Color(hex: 0xDCFBE7), deep: Color(hex: 0x176B3B), badge: Color(hex: 0xC3F0CE)),
        danger: StateColors(accent: Color(hex: 0xDA1E28), tint: Color(hex: 0xFFF0F0), deep: Color(hex: 0xA8151D), badge: Color(hex: 0xFFF0F0)),
        pending: Color(hex: 0x9A7400),
        pickupDot: Color(hex: 0x0061FC),
        unpickBadge: Color(hex: 0xE0E3EA),
        scheduledBadge: Color(hex: 0xEDF0F5),
        tabbar: Color(hex: 0xF6F7F9, opacity: 0.86),
        scrim: Color(hex: 0x121622, opacity: 0.32),
        toastBg: Color(hex: 0x121622),
        toastFg: Color(hex: 0xFFFFFF),
        switchTrack: Color(hex: 0xE3E6EC),
        warnSoft: Color(hex: 0xF4ECD6),
        floatSoft: Color(hex: 0xF5F2FC),
        skeletonA: Color(hex: 0xECEFF3),
        skeletonB: Color(hex: 0xF4F6F9)
    )

    static let dark = ShiftColors(
        isDark: true,
        blue: Color(hex: 0x0A84FF),
        bluePressed: Color(hex: 0x409CFF),
        blueContainer: Color(hex: 0x0C2C4F),
        onBlueContainer: Color(hex: 0xBBD6FF),
        ink: Color(hex: 0xECF0F6),
        sec: Color(hex: 0xA7AFBE),
        ter: Color(hex: 0x6E7686),
        divider: Color(hex: 0x282D38),
        outline: Color(hex: 0x3C4350),
        bg: Color(hex: 0x0E1116),
        surface: Color(hex: 0x171B22),
        surfaceVar: Color(hex: 0x232834),
        floatOut: StateColors(accent: Color(hex: 0xB6A4F0), tint: Color(hex: 0x221D31), deep: Color(hex: 0xD5C9FF), badge: Color(hex: 0x2E2742)),
        floatIn: StateColors(accent: Color(hex: 0x4FC07E), tint: Color(hex: 0x13271B), deep: Color(hex: 0xA6E7BE), badge: Color(hex: 0x1C3A27)),
        permanent: StateColors(accent: Color(hex: 0xF072AE), tint: Color(hex: 0x311425), deep: Color(hex: 0xFFC2DD), badge: Color(hex: 0x3D1C30)),
        allied: StateColors(accent: Color(hex: 0x2FC2BB), tint: Color(hex: 0x0D2A28), deep: Color(hex: 0x2FC2BB), badge: Color(hex: 0x123B38)),
        breakShift: StateColors(accent: Color(hex: 0xE0AE4A), tint: Color(hex: 0x281F12), deep: Color(hex: 0xF0CE8A), badge: Color(hex: 0x322816)),
        success: StateColors(accent: Color(hex: 0x4FC07E), tint: Color(hex: 0x13271B), deep: Color(hex: 0x8FE0AE), badge: Color(hex: 0x1C3A27)),
        danger: StateColors(accent: Color(hex: 0xFF6B6B), tint: Color(hex: 0x311818), deep: Color(hex: 0xFF9B9B), badge: Color(hex: 0x311818)),
        pending: Color(hex: 0xE0B341),
        pickupDot: Color(hex: 0x0A84FF),
        unpickBadge: Color(hex: 0x262B35),
        scheduledBadge: Color(hex: 0x232834),
        tabbar: Color(hex: 0x0F1218, opacity: 0.84),
        scrim: Color(hex: 0x000000, opacity: 0.55),
        toastBg: Color(hex: 0xECF0F6),
        toastFg: Color(hex: 0x121622),
        switchTrack: Color(hex: 0x3C4350),
        warnSoft: Color(hex: 0x2A2414),
        floatSoft: Color(hex: 0x1E1A2C),
        skeletonA: Color(hex: 0x1E232C),
        skeletonB: Color(hex: 0x272D38)
    )
}

// MARK: - Typography (IBM Plex + Dynamic Type)

/// IBM Plex font helpers. `.custom(_:size:relativeTo:)` gives Dynamic Type scaling;
/// SF Pro is the graceful fallback if the bundled Plex weights aren't registered
/// yet (see `iosApp/README.md` — add the `Fonts/*.ttf` to the target + `UIAppFonts`).
enum ShiftFont {
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(plexSans(weight), size: size, relativeTo: style)
    }

    /// Monospaced (times / durations / IDs). Plex Mono is inherently tabular; pair
    /// with `.monospacedDigit()` on the `Text` for SF Pro fallback parity.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(plexMono(weight), size: size, relativeTo: style)
    }

    private static func plexSans(_ weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: return "IBMPlexSans-Bold"
        case .semibold: return "IBMPlexSans-SemiBold"
        case .medium: return "IBMPlexSans-Medium"
        default: return "IBMPlexSans-Regular"
        }
    }

    private static func plexMono(_ weight: Font.Weight) -> String {
        switch weight {
        case .semibold, .bold, .heavy, .black: return "IBMPlexMono-SemiBold"
        case .medium: return "IBMPlexMono-Medium"
        default: return "IBMPlexMono-Regular"
        }
    }
}

/// The brand type ramp (worker-app.html `TypePanel`), mapped to Dynamic Type styles.
enum ShiftType {
    static let displaySmall = ShiftFont.sans(28, .semibold, relativeTo: .largeTitle)
    static let headlineLarge = ShiftFont.sans(26, .bold, relativeTo: .title)
    static let headlineMedium = ShiftFont.sans(22, .bold, relativeTo: .title2)
    static let titleLarge = ShiftFont.sans(19, .bold, relativeTo: .title3)
    static let titleMedium = ShiftFont.sans(18, .semibold, relativeTo: .headline)
    static let titleSmall = ShiftFont.sans(16, .semibold, relativeTo: .headline)
    static let bodyLarge = ShiftFont.sans(16, .regular, relativeTo: .body)
    static let bodyMedium = ShiftFont.sans(15, .regular, relativeTo: .body)
    static let bodySmall = ShiftFont.sans(13, .regular, relativeTo: .subheadline)
    static let labelLarge = ShiftFont.sans(14, .semibold, relativeTo: .callout)
    static let labelMedium = ShiftFont.sans(13, .semibold, relativeTo: .footnote)
    static let labelSmall = ShiftFont.sans(11, .semibold, relativeTo: .caption2)

    static let monoTimeHero = ShiftFont.mono(22, .semibold, relativeTo: .title2)
    static let monoTime = ShiftFont.mono(15, .medium, relativeTo: .body)
    static let monoId = ShiftFont.mono(12, .medium, relativeTo: .caption)
    static let monoMeta = ShiftFont.mono(11, .semibold, relativeTo: .caption2)
}

// MARK: - Spacing / radii / dims / motion

enum Spacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let s: CGFloat = 6
    static let m: CGFloat = 8
    static let l: CGFloat = 12
    static let xl: CGFloat = 16
    static let xxl: CGFloat = 20
    static let xxxl: CGFloat = 24
    static let screen: CGFloat = 16
    static let cardPadH: CGFloat = 14
    static let cardPadV: CGFloat = 13
    static let sectionGap: CGFloat = 24
}

enum Radii {
    static let card: CGFloat = 16
    static let sheet: CGFloat = 28
    static let button: CGFloat = 12
    static let buttonSmall: CGFloat = 10
    static let houseBadge: CGFloat = 11
    static let durationChip: CGFloat = 6
    static let toast: CGFloat = 14
    static let banner: CGFloat = 14
    static let pill: CGFloat = 999
}

enum Dims {
    static let buttonHeightSm: CGFloat = 34
    static let buttonHeightMd: CGFloat = 44
    static let buttonHeightLg: CGFloat = 52
    static let pickupDot: CGFloat = 8
    static let breakBorder: CGFloat = 4
    static let houseBadge: CGFloat = 40
    static let avatar: CGFloat = 36
    static let iconButton: CGFloat = 36
    static let iconTag: CGFloat = 13
    static let iconSm: CGFloat = 16
    static let icon: CGFloat = 18
    static let iconLg: CGFloat = 20
    static let hairline: CGFloat = 1
    static let outlineStroke: CGFloat = 1.5
}

enum Motion {
    /// iOS sheet/dialog curve cubic-bezier(0.32,0.72,0,1) ≈ a strong ease-out.
    static let sheet = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.30)
    static let dialog = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.26)
    static let press = Animation.easeInOut(duration: 0.12)
    /// Success-pop overshoot cubic-bezier(0.34,1.56,0.64,1) ≈ a light spring.
    static let successPop = Animation.spring(response: 0.4, dampingFraction: 0.55)
    static let pressScaleButton: CGFloat = 0.97
    static let pressScaleCard: CGFloat = 0.985
}

// MARK: - Icons (SF Symbols — the HIG equivalent of the design's outline glyphs)

enum ShiftIcons {
    static let floatOut = "arrow.up.forward"
    static let floatIn = "arrow.down.backward"
    static let check = "checkmark"
    static let checkCircle = "checkmark.circle"
    static let clock = "clock"
    static let coffee = "cup.and.saucer"
    static let refresh = "arrow.triangle.2.circlepath"
    static let lock = "lock"
    static let dropped = "arrow.down"
    static let person = "person"
    static let list = "list.bullet"
    static let plus = "plus"
    static let minus = "minus"
    static let calendar = "calendar"
    static let bell = "bell"
    static let chevronRight = "chevron.right"
    static let chevronLeft = "chevron.left"
    static let close = "xmark"
    static let warning = "exclamationmark.triangle"
    static let info = "info.circle"
    static let phone = "phone"
    static let building = "building.2"
    static let heart = "heart"
    static let ban = "nosign"
}
