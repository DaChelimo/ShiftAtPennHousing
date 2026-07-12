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
    let recentRows: [RecentFloatRow]
    let onAccept: (String) -> Void
    let onDecline: (String) -> Void
    let onOpenDetail: (String) -> Void

    @Environment(\.colorScheme) private var scheme
    @State private var page = 0

    var body: some View {
        if cards.isEmpty && recentRows.isEmpty {
            EmptyView()
        } else {
            let c = ShiftColors.resolve(scheme)
            VStack(spacing: 8) {
                if !cards.isEmpty {
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
                    .background(Color.clear)
                    .frame(height: cardHeight)
                    if cards.count > 1 {
                        PagerDots(count: cards.count, selected: min(page, cards.count - 1), c: c)
                    }
                }
                if !recentRows.isEmpty {
                    RecentFloatsSection(rows: recentRows, c: c)
                        .padding(.horizontal, 16)
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
                .strokeBorder(c.isDark ? blue : Color.clear, lineWidth: 2)
        )
        .shadow(
            color: c.isDark ? Color.black.opacity(0.10) : Color.black.opacity(0.08),
            radius: c.isDark ? 14 : 20,
            x: 0,
            y: c.isDark ? 5 : 4
        )
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

/// The collapsible "Recent float requests" history (§7.1/§7.2) — resolved floats from the
/// last 24h (accepted / declined / expired), de-emphasized and collapsed by default so they
/// never compete with the actionable carousel above. Auto-ages: the shared layer drops
/// anything older than 24h, so there is no manual dismiss to maintain. Mirrors Compose's
/// `RecentFloatsSection`.
private struct RecentFloatsSection: View {
    let rows: [RecentFloatRow]
    let c: ShiftColors
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text("Recent float requests")
                        .font(ShiftFont.sans(14, .medium))
                        .foregroundColor(c.sec)
                    Text("\(rows.count)")
                        .font(ShiftFont.sans(12, .medium))
                        .foregroundColor(c.ter)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 1)
                        .background(c.surfaceVar)
                        .clipShape(Capsule())
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(c.ter)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
                .padding(.vertical, 6)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("recent_floats_header")

            if expanded {
                Text("Past 24 hours")
                    .font(ShiftFont.sans(12))
                    .foregroundColor(c.ter)
                ForEach(rows, id: \.floatId) { row in
                    RecentFloatRowView(row: row, c: c)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("recent_floats_section")
    }
}

private struct RecentFloatRowView: View {
    let row: RecentFloatRow
    let c: ShiftColors

    var body: some View {
        let accepted = row.status == .accepted
        let chipBg = accepted ? c.success.tint : c.surfaceVar
        let chipFg = accepted ? c.success.deep : c.sec
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).font(ShiftFont.sans(14, .medium)).foregroundColor(c.ink)
                Text(row.detail).font(ShiftFont.sans(12)).foregroundColor(c.ter)
            }
            Spacer(minLength: 8)
            Text(row.statusChip)
                .font(ShiftFont.sans(11, .medium))
                .foregroundColor(chipFg)
                .padding(.horizontal, 9)
                .padding(.vertical, 3)
                .background(chipBg)
                .clipShape(Capsule())
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous).fill(c.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(c.divider, lineWidth: 0.5)
        )
        .accessibilityIdentifier("recent_float_row")
    }
}
