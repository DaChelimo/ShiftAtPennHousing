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
        cards.contains { $0.respondable } ? 224 : 196
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
        let blue = c.blue
        let white = Color.white
        let white80 = Color.white.opacity(0.82)

        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                HStack(spacing: 7) {
                    Image(systemName: ShiftIcons.floatOut)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(white)
                    Text("FLOAT REQUEST")
                        .font(ShiftFont.sans(12, .bold))
                        .tracking(0.8)
                        .foregroundColor(white)
                }
                Spacer()
                if total > 1 {
                    Text("\(position) of \(total)")
                        .font(ShiftFont.sans(12, .semibold))
                        .foregroundColor(white80)
                }
            }

            Text("You're needed at \(card.destinationName)")
                .font(ShiftFont.sans(20, .bold))
                .foregroundColor(white)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 7) {
                Image(systemName: ShiftIcons.clock)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(white80)
                Text("\(card.whenLabel) · \(card.rangeLabel)")
                    .font(ShiftFont.sans(15, .medium))
                    .foregroundColor(white)
            }
            Text("\(card.startsInLabel) · \(card.durationLabel)")
                .font(ShiftFont.sans(13, .medium))
                .foregroundColor(white80)

            if card.respondable {
                HStack(spacing: 10) {
                    // Accept — solid white pill, blue label (primary).
                    FloatCardButton(
                        text: "Accept",
                        icon: ShiftIcons.check,
                        container: white,
                        content: blue,
                        bordered: false,
                        action: onAccept
                    )
                    .accessibilityIdentifier("float_card_accept")
                    // Decline — outlined white (secondary).
                    FloatCardButton(
                        text: "Decline",
                        icon: ShiftIcons.close,
                        container: .clear,
                        content: white,
                        bordered: true,
                        action: onDecline
                    )
                    .accessibilityIdentifier("float_card_decline")
                }
            } else {
                Text("This float has been reassigned to another worker.")
                    .font(ShiftFont.sans(13, .medium))
                    .foregroundColor(white80)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(blue)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .contentShape(Rectangle())
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
                    .strokeBorder(bordered ? Color.white.opacity(0.7) : Color.clear, lineWidth: 1.5)
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
