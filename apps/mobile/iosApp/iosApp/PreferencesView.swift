import SwiftUI
import Shared

/// Preference submission (the tri-state paint grid + target weekly hours) in SwiftUI,
/// over the shared `PreferencesViewModel` (observed — its brush/grid/target mutate).
/// Rebuilds worker-app.html `PreferenceScreen` with the kit: context eyebrow, deadline
/// banner, Mon–Sun strip, target stepper card, the Available/Preferred/Cannot brush
/// selector, the 2-column block grid (tap to paint), and the submit button. Read-only
/// once submitted. Selector `accessibilityIdentifier`s match the Maestro contract.

/// Observes the preference `StateFlow` (selectDay/paint/setBrush/… mutate state).
@MainActor
final class PreferencesObservable: ObservableObject {
    let vm: PreferencesViewModel
    @Published var state: PreferencesUiState
    private var task: Task<Void, Never>?

    init(vm: PreferencesViewModel) {
        self.vm = vm
        self.state = vm.uiState.value
        task = Task { [weak self] in
            guard let self else { return }
            for await s in self.vm.uiState { self.state = s }
        }
    }

    deinit { task?.cancel() }
}

struct PreferencesScreen: View {
    @ObservedObject var model: PreferencesObservable
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = ShiftColors.resolve(scheme)
        let st = model.state
        return VStack(alignment: .leading, spacing: 0) {
            Text(st.contextLabel)
                .font(ShiftFont.sans(11, .semibold)).tracking(0.5).foregroundColor(c.blue)
                .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 6)

            ShiftBanner(
                title: st.banner.title,
                bodyText: st.banner.body,
                tone: st.banner.tone == .success ? .success : .info
            )
            .padding(.horizontal, 16).padding(.bottom, 8)

            weekStrip(st.weekStrip, c)

            VStack(alignment: .leading, spacing: 12) {
                targetCard(st, c)
                if st.optedOut {
                    EmptyState(
                        title: "No hours marked",
                        systemIcon: ShiftIcons.ban,
                        bodyText: "You won't be scheduled next week. Untick \"no hours\" to set availability."
                    )
                } else {
                    brushSelector(st, c)
                    if !st.submitted {
                        Text("Tap a block to paint it for the selected day")
                            .font(ShiftFont.sans(12)).foregroundColor(c.ter)
                    }
                    Text(st.day.title).font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    blockGrid(st.day.cells, st.submitted, c)
                }
            }
            .padding(.horizontal, 16).padding(.top, 4).padding(.bottom, 16)

            if !st.submitted {
                ShiftButton(title: "Submit preferences", action: { model.vm.submit() }, size: .lg, fullWidth: true)
                    .padding(.horizontal, 16).padding(.bottom, 24)
                    .accessibilityIdentifier("submit_preferences_button")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(c.bg)
        .accessibilityIdentifier("preferences_screen")
    }

    // MARK: week strip

    private func weekStrip(_ strip: PrefWeekStrip, _ c: ShiftColors) -> some View {
        HStack(spacing: 2) {
            ForEach(strip.cells, id: \.dayIndex) { cell in
                Button(action: { model.vm.selectDay(index: cell.dayIndex) }) {
                    VStack(spacing: 4) {
                        Text(cell.dayLetter).font(ShiftFont.sans(11, .semibold)).foregroundColor(c.ter)
                        ZStack {
                            Circle().fill(cell.selected ? c.blue : Color.clear).frame(width: 34, height: 34)
                            Text(cell.dateLabel)
                                .font(ShiftFont.sans(14, .medium))
                                .foregroundColor(cell.selected ? .white : c.ink)
                        }
                        Circle().fill(cell.painted ? c.blue : Color.clear).frame(width: 5, height: 5)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pref_day_cell")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 2)
        .accessibilityIdentifier("pref_week_strip")
    }

    // MARK: target card

    private func targetCard(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Target weekly hours").font(ShiftFont.sans(14, .semibold)).foregroundColor(c.ink)
                    Text("Soft cap \(st.targetMeter.capLabel) this period").font(ShiftFont.sans(12)).foregroundColor(c.ter)
                }
                Spacer(minLength: 8)
                HStack(spacing: 12) {
                    stepButton(ShiftIcons.minus, enabled: !st.submitted && !st.optedOut) { model.vm.decrementTarget() }
                    Text(st.targetMeter.label)
                        .font(ShiftType.monoTimeHero).monospacedDigit().foregroundColor(c.ink)
                        .frame(width: 52)
                    stepButton(ShiftIcons.plus, enabled: !st.submitted && !st.optedOut) { model.vm.incrementTarget() }
                }
                .opacity(st.optedOut ? 0.35 : 1)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(c.surfaceVar)
                    Capsule().fill(c.blue).frame(width: geo.size.width * CGFloat(st.targetMeter.fraction))
                }
            }
            .frame(height: 6)
            Button(action: { model.vm.toggleOptedOut() }) {
                HStack(spacing: 9) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(st.optedOut ? c.blue : Color.clear)
                            .frame(width: 22, height: 22)
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .strokeBorder(st.optedOut ? c.blue : c.outline, lineWidth: 1.5)
                            .frame(width: 22, height: 22)
                        if st.optedOut {
                            Image(systemName: ShiftIcons.check).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                        }
                    }
                    Text("I have no hours this week").font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.sec)
                }
            }
            .buttonStyle(.plain)
            .disabled(st.submitted)
            .accessibilityIdentifier("pref_no_hours_toggle")
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(c.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(c.divider, lineWidth: 1))
        .accessibilityIdentifier("pref_target_stepper")
    }

    private func stepButton(_ icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundColor(ShiftColors.resolve(scheme).ink)
                .frame(width: 36, height: 36)
                .background(ShiftColors.resolve(scheme).surface)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(ShiftColors.resolve(scheme).divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(icon == ShiftIcons.plus ? "pref_target_increment" : "pref_target_decrement")
    }

    // MARK: brush selector

    private func brushSelector(_ st: PreferencesUiState, _ c: ShiftColors) -> some View {
        HStack(spacing: 8) {
            ForEach([PrefBrush.available, PrefBrush.preferred, PrefBrush.cannot], id: \.self) { brush in
                let style = brushStyle(brush, c)
                let on = st.brush == brush
                Button(action: { model.vm.setBrush(value: brush) }) {
                    VStack(spacing: 4) {
                        Image(systemName: style.icon).font(.system(size: 17, weight: .semibold)).foregroundColor(on ? style.fg : c.ter)
                        Text(brushLabel(brush)).font(ShiftFont.sans(12.5, .semibold)).foregroundColor(on ? style.fg : c.sec)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9).padding(.horizontal, 4)
                    .background(on ? style.bg : c.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(on ? style.accent : c.divider, lineWidth: 1.5))
                }
                .buttonStyle(.plain)
                .disabled(st.submitted)
                .accessibilityIdentifier(brushTag(brush))
            }
        }
    }

    // MARK: block grid

    private func blockGrid(_ cells: [PrefBlockCell], _ submitted: Bool, _ c: ShiftColors) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
            ForEach(cells, id: \.blockId) { cell in
                blockCell(cell, submitted, c)
            }
        }
        .accessibilityIdentifier("pref_block_grid")
    }

    private func blockCell(_ cell: PrefBlockCell, _ submitted: Bool, _ c: ShiftColors) -> some View {
        let style = brushStyle(cell.brush, c)
        let border = cell.brush == .available ? c.divider : style.accent.opacity(0.33)
        return HStack {
            Text(cell.timeLabel).font(ShiftFont.mono(11.5, .medium)).monospacedDigit().foregroundColor(style.fg)
            Spacer(minLength: 0)
            if cell.brush != .available {
                Image(systemName: style.icon).font(.system(size: 11, weight: .semibold)).foregroundColor(style.accent)
            }
        }
        .padding(.horizontal, 10).frame(height: 30)
        .background(style.bg)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(border, lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { if !submitted { model.vm.paint(blockId: cell.blockId) } }
        .accessibilityIdentifier("pref_block_cell")
    }
}

// MARK: - Brush styling (color + icon + text — never color alone)

private func brushStyle(_ brush: PrefBrush, _ c: ShiftColors) -> (bg: Color, fg: Color, accent: Color, icon: String) {
    switch brush {
    case .available: return (c.surfaceVar, c.sec, c.sec, ShiftIcons.check)
    case .preferred: return (c.blueContainer, c.onBlueContainer, c.pickupDot, ShiftIcons.heart)
    case .cannot: return (c.danger.tint, c.danger.accent, c.danger.accent, ShiftIcons.ban)
    }
}

private func brushLabel(_ brush: PrefBrush) -> String {
    switch brush {
    case .available: return "Available"
    case .preferred: return "Preferred"
    case .cannot: return "Cannot"
    }
}

private func brushTag(_ brush: PrefBrush) -> String {
    switch brush {
    case .available: return "pref_brush_available"
    case .preferred: return "pref_brush_preferred"
    case .cannot: return "pref_brush_cannot"
    }
}
