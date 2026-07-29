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
        // The same two colours the tinted agenda cards use, so the banner and the card it
        // taps through to read as one thing.
        let accent = awaitingYou ? c.pending : c.blue
        let tint = awaitingYou ? c.warnSoft : c.blue.opacity(0.10)
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
                Image(systemName: awaitingYou ? "bell.fill" : "arrow.triangle.2.circlepath")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(accent)
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
                Text(entry.actionLabel)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(c.surface))
                    .accessibilityIdentifier("swap_banner_action")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(tint))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(accent.opacity(0.55), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
