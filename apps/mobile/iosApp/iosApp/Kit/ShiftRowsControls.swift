import SwiftUI

/// Mobile reskin foundation (iOS) — rows, section containers, controls, sheets.

// MARK: - Section header + section container

struct SectionHeader: View {
    let title: String
    var count: Int? = nil
    var trailing: AnyView? = nil
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        HStack(spacing: 8) {
            Text(title.uppercased()).font(ShiftFont.sans(13, .bold)).tracking(0.6).foregroundColor(c.sec)
            if let count {
                Text("\(count)").font(ShiftType.monoId).monospacedDigit()
                    .padding(.horizontal, 7).padding(.vertical, 1)
                    .foregroundColor(c.ter).background(c.surfaceVar).clipShape(Capsule())
            }
            Spacer(minLength: 0)
            if let trailing { trailing }
        }
        .padding(.horizontal, 4)
    }
}

/// A My-Shifts–style section that ALWAYS renders (the `section_*` selector contract);
/// shows an inline empty placeholder when `isEmpty`.
struct ShiftSection<Content: View>: View {
    let title: String
    let isEmpty: Bool
    var count: Int? = nil
    var emptyText: String = "None this week"
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: title, count: count)
            if isEmpty {
                Text(emptyText).font(ShiftFont.sans(13.5)).foregroundColor(c.ter)
            } else {
                content()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Generic key/value list row (settings & detail rows).
struct KeyValueRow: View {
    let label: String
    var value: String? = nil
    var last: Bool = false
    var trailing: AnyView? = nil
    var onTap: (() -> Void)? = nil
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(label).font(ShiftFont.sans(13.5, .medium)).foregroundColor(c.ter)
                Spacer(minLength: 8)
                if let value { Text(value).font(ShiftFont.sans(15, .semibold)).foregroundColor(c.ink) }
                if let trailing { trailing }
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
            .onTapGesture { onTap?() }
            if !last { Rectangle().fill(c.divider).frame(height: 1) }
        }
    }
}

// MARK: - Segmented control (brand) + toggle (native)

struct ShiftSegmented: View {
    let options: [String]
    @Binding var selection: Int
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { i in
                let selected = i == selection
                Text(options[i])
                    .font(ShiftFont.sans(13.5, selected ? .semibold : .medium))
                    .foregroundColor(selected ? c.ink : c.sec)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7).padding(.horizontal, 8)
                    .background(
                        Group {
                            if selected {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(c.surface)
                                    .shadow(color: Color.black.opacity(0.12), radius: 1.5, y: 1)
                            }
                        }
                    )
                    .contentShape(Rectangle())
                    .onTapGesture { selection = i }
            }
        }
        .padding(2)
        .background(c.surfaceVar)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// The brand toggle — native `Toggle` tinted blue (the iOS switch idiom).
struct ShiftToggle: View {
    @Binding var isOn: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Toggle("", isOn: $isOn).labelsHidden().tint(ShiftColors.resolve(scheme).blue)
    }
}

// MARK: - Bottom sheet + confirm (native .sheet with detents + grabber)

/// Wrap inside a `.sheet { ShiftSheet(title:…, onClose:…) { … } }`. Supplies the
/// brand header (title + close) and applies detents + the grabber (HIG).
struct ShiftSheet<Content: View>: View {
    var title: String? = nil
    let onClose: () -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                HStack {
                    Text(title).font(ShiftFont.sans(19, .bold)).foregroundColor(c.ink)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: ShiftIcons.close).font(.system(size: 14, weight: .semibold)).foregroundColor(c.sec)
                            .frame(width: 30, height: 30).background(c.surfaceVar).clipShape(Circle())
                    }
                }
                .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 4)
            }
            content()
                .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 28)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
        }
        .background(c.surface)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// A confirm-in-a-sheet (drop / decline). Use `.destructiveFilled` for destructive.
struct ShiftConfirmSheet: View {
    let title: String
    var bodyText: String? = nil
    let confirmLabel: String
    var confirmVariant: ShiftButtonVariant = .filled
    var cancelLabel: String = "Cancel"
    let onConfirm: () -> Void
    let onCancel: () -> Void
    @Environment(\.colorScheme) private var scheme
    private var c: ShiftColors { .resolve(scheme) }

    var body: some View {
        ShiftSheet(title: title, onClose: onCancel) {
            VStack(alignment: .leading, spacing: 16) {
                if let bodyText { Text(bodyText).font(ShiftFont.sans(15)).foregroundColor(c.sec) }
                HStack(spacing: 10) {
                    ShiftButton(title: cancelLabel, action: onCancel, variant: .outlined, fullWidth: true)
                    ShiftButton(title: confirmLabel, action: onConfirm, variant: confirmVariant, fullWidth: true)
                }
            }
        }
    }
}
