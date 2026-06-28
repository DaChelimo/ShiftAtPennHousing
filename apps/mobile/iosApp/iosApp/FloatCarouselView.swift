import SwiftUI
import Shared

/// The My-Shifts float-request carousel (§7.1) — a prominent brand-blue card stack that
/// sits directly under the "This week — Xh" chip (both Week and Day modes) so an
/// outstanding float can't be missed in the Updates feed. One full-width card per
/// pending float, SORTED closest-start first; swipe advances to the next. Accept/Decline
/// live on the card (primary action); tapping the body opens the full ack hero for
/// detail. When the last one is resolved the stack collapses and the host snackbars.
///
/// Pure-blue by request (white bold/medium text) — it intentionally overrides the theme
/// surface to stand out. The data + accept/decline machine are the shared
/// `FloatCarouselUiState` / `FloatCarouselViewModel`; this is the thin SwiftUI skin and
/// the native mirror of the Compose `FloatRequestCarousel`.
struct FloatCarouselView: View {
    let cards: [FloatRequestCard]
    let onAccept: (String) -> Void
    let onDecline: (String) -> Void
    let onOpenDetail: (String) -> Void

    @Environment(\.colorScheme) private var scheme
    @State private var page = 0

    var body: some View {
        if cards.isEmpty {
            EmptyView()
        } else {
            let c = ShiftColors.resolve(scheme)
            VStack(spacing: 8) {
                TabView(selection: $page) {
                    ForEach(Array(cards.enumerated()), id: \.element.floatId) { index, card in
                        FloatRequestCardView(
                            card: card,
                            position: index + 1,
                            total: cards.count,
                            onAccept: { onAccept(card.floatId) },
                            onDecline: { onDecline(card.floatId) },
                            onOpenDetail: { onOpenDetail(card.floatId) },
                            c: c
                        )
                        .padding(.horizontal, 16)
                        .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(height: cardHeight)
                if cards.count > 1 {
                    PagerDots(count: cards.count, selected: min(page, cards.count - 1), c: c)
                }
            }
            .frame(maxWidth: .infinity)
            // The page count shrinks as cards resolve; clamp the binding defensively.
            .onChange(of: cards.count) { _ in
                if page > cards.count - 1 { page = max(0, cards.count - 1) }
            }
            .accessibilityIdentifier("float_carousel")
        }
    }

    /// A respondable card is taller (it carries the Accept/Decline row); a reassigned one
    /// shows a single note line. The paging TabView needs a fixed height, so size for the
    /// tallest card on screen.
    private var cardHeight: CGFloat {
        // Respondable cards now also carry the accept-by pill above the button row.
        cards.contains { $0.respondable } ? 258 : 196
    }
}

private struct FloatRequestCardView: View {
    let card: FloatRequestCard
    let position: Int
    let total: Int
    let onAccept: () -> Void
    let onDecline: () -> Void
    let onOpenDetail: () -> Void
    let c: ShiftColors

    var body: some View {
        // Softer treatment: a white card with elevation + a 2px blue outline, rather
        // than a solid-blue field. Blue is kept as an ACCENT (eyebrow, countdown pill,
        // Accept) so the request still stands out without flooding the screen.
        let blue = c.blue
        let ink = c.ink
        let sec = c.sec
        let ter = c.ter

        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                HStack(spacing: 7) {
                    Image(systemName: ShiftIcons.floatOut)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(blue)
                    Text("FLOAT REQUEST")
                        .font(ShiftFont.sans(12, .bold))
                        .tracking(0.8)
                        .foregroundColor(blue)
                }
                Spacer()
                if total > 1 {
                    Text("\(position) of \(total)")
                        .font(ShiftFont.sans(12, .semibold))
                        .foregroundColor(ter)
                }
            }

            Text("You're needed at \(card.destinationName)")
                .font(ShiftFont.sans(20, .bold))
                .foregroundColor(ink)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 7) {
                Image(systemName: ShiftIcons.clock)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(sec)
                Text("\(card.whenLabel) · \(card.rangeLabel)")
                    .font(ShiftFont.sans(15, .medium))
                    .foregroundColor(ink)
            }
            Text("\(card.startsInLabel) · \(card.durationLabel) shift")
                .font(ShiftFont.sans(13, .medium))
                .foregroundColor(ter)

            // The time-to-RESPOND countdown — the load-bearing number. Rendered as a
            // pill so it reads as the primary call to action, not buried alongside the
            // shift-start/duration line above. Tinted normally; solid-blue when urgent.
            if let acceptBy = card.acceptByLabel {
                HStack(spacing: 6) {
                    Image(systemName: "hourglass")
                        .font(.system(size: 12, weight: .semibold))
                    Text(acceptBy)
                        .font(ShiftFont.sans(13, .semibold))
                }
                .foregroundColor(card.acceptUrgent ? Color.white : c.onBlueContainer)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(card.acceptUrgent ? blue : c.blueContainer)
                .clipShape(Capsule())
                .accessibilityIdentifier("float_card_accept_by")
            }

            if card.respondable {
                HStack(spacing: 10) {
                    // Accept — solid blue pill, white label (primary).
                    FloatCardButton(
                        text: "Accept",
                        icon: ShiftIcons.check,
                        container: blue,
                        content: Color.white,
                        bordered: false,
                        action: onAccept
                    )
                    .accessibilityIdentifier("float_card_accept")
                    // Decline — outlined neutral (secondary).
                    FloatCardButton(
                        text: "Decline",
                        icon: ShiftIcons.close,
                        container: .clear,
                        content: ink,
                        bordered: true,
                        action: onDecline
                    )
                    .accessibilityIdentifier("float_card_decline")
                }
            } else {
                Text("The window to respond has passed.")
                    .font(ShiftFont.sans(13, .medium))
                    .foregroundColor(ter)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(c.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(blue, lineWidth: 2)
        )
        .shadow(color: Color.black.opacity(0.10), radius: 14, x: 0, y: 5)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .onTapGesture { onOpenDetail() }
        .accessibilityIdentifier("float_card")
    }
}

private struct FloatCardButton: View {
    let text: String
    let icon: String
    let container: Color
    let content: Color
    let bordered: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                Text(text)
                    .font(ShiftFont.sans(15, .semibold))
            }
            .foregroundColor(content)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(container)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(bordered ? content.opacity(0.32) : Color.clear, lineWidth: 1.5)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct PagerDots: View {
    let count: Int
    let selected: Int
    let c: ShiftColors

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { i in
                let active = i == selected
                Circle()
                    .fill(active ? c.blue : c.outline)
                    .frame(width: active ? 8 : 6, height: active ? 8 : 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 2)
    }
}
