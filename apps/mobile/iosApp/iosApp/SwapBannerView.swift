import SwiftUI
import Shared

/// The always-visible pending-swap banner at the top of My Shifts (BSpec §10.1).
///
/// A pending swap used to be visible ONLY as a tint on the affected shift card, which
/// meant a request needing an answer could sit on a day the worker never scrolled to.
/// Both directions now surface here, above the week, whatever week is being viewed:
/// "someone is waiting on you" (actionable, first) and "you are waiting on someone".
///
/// Tapping a row opens the same surface the tinted card does. Kotlin's `SwapBanner` is
/// the single source of the ordering and the copy, so iOS and Android read identically.
extension ShiftsRootView {
    @ViewBuilder
    func swapBannerColumn(_ banner: SwapBanner, _ c: ShiftColors) -> some View {
        if !banner.isEmpty {
            VStack(spacing: 8) {
                ForEach(banner.entries, id: \.swapId) { entry in
                    swapBannerCard(entry, c)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
    }

    @ViewBuilder
    private func swapBannerCard(_ entry: SwapBannerEntry, _ c: ShiftColors) -> some View {
        let awaitingYou = entry.tone == .awaitingYou
        // Only the actionable row (someone needs YOUR answer) carries a color signal, in
        // brand blue — the app's one "take action" hue everywhere else (never orange/amber,
        // which reads as a caution state elsewhere in the shift-state legend). The outgoing
        // row is purely informational and stays fully neutral instead of borrowing a second
        // accent — that contrast in weight is what tells the two rows apart. Both rows share
        // the same swap (exchange-arrows) icon rather than a bell, so the glyph reads as
        // "this is a swap" and not "this is a notification". Mirrors Android's
        // `SwapBannerRow.kt` exactly.
        let accent = awaitingYou ? c.blue : c.ter
        let borderColor = awaitingYou ? c.blue.opacity(0.45) : c.divider
        Button {
            // The same two destinations the tinted agenda card opens: the accept/decline
            // decision for an incoming swap, the cancel-or-keep-waiting notice for one
            // this worker proposed.
            if awaitingYou {
                decisionTarget = calendarModel.decisionFor(entry.swapId).map {
                    IdentifiedSwapDecision(decision: $0)
                }
            } else {
                pendingNotice = calendarModel.vm.pendingSwapNoticeFor(swapId: entry.swapId).map {
                    IdentifiedPendingSwapNotice(notice: $0)
                }
            }
        } label: {
            HStack(spacing: 10) {
                // A soft accent chip behind the glyph: the one place the tint survives, so
                // the card still carries its state colour without wearing it everywhere.
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(accent)
                    .frame(width: 30, height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 9).fill(awaitingYou ? accent.opacity(0.14) : c.surfaceVar)
                    )
                    // Identifiers go on LEAVES: a container identifier shadows its children.
                    .accessibilityIdentifier("swap_banner_icon")
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(c.ink)
                        .accessibilityIdentifier(
                            awaitingYou ? "swap_banner_incoming" : "swap_banner_outgoing"
                        )
                    Text(entry.detail)
                        .font(.system(size: 12.5))
                        .foregroundColor(c.sec)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("swap_banner_detail")
                }
                Spacer(minLength: 0)
                // Incoming needs an answer, so its action is a solid blue pill. Outgoing is
                // informational and gets a quiet neutral outline: the weight of the control
                // tells the worker which row is actually theirs to act on.
                Text(entry.actionLabel)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(awaitingYou ? .white : c.sec)
                    .padding(.horizontal, awaitingYou ? 12 : 11)
                    .padding(.vertical, 5)
                    .background(
                        Capsule().fill(awaitingYou ? accent : Color.clear)
                    )
                    .overlay(
                        Capsule().stroke(
                            awaitingYou ? Color.clear : c.outline, lineWidth: 1
                        )
                    )
                    .accessibilityIdentifier("swap_banner_action")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(c.surface))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(borderColor, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
