import AppIntents

/// The configurable scope of the Open Shifts widget (Widget 2). The user picks this in the
/// widget's edit sheet; the choice shows as the tile title.
///
/// IMPORTANT: this lives in WidgetShared so it compiles into BOTH the app and the widget
/// extension. A `WidgetConfigurationIntent` used only by the extension cannot be
/// materialized by the system's AppIntents helper (which is rooted in the containing app):
/// chronod fails with "Unable to get LNAction from intent" / "No AppIntent in
/// timeline(for:with:)" and the widget is stuck on its placeholder. Compiling it into the
/// app makes the app emit AppIntents metadata for it, so resolution succeeds.
public enum OpenScopeChoice: String, AppEnum {
    case myHouse
    case otherHouses
    case both

    public static var typeDisplayRepresentation: TypeDisplayRepresentation { "Scope" }
    public static var caseDisplayRepresentations: [OpenScopeChoice: DisplayRepresentation] {
        [.myHouse: "My house", .otherHouses: "Other houses", .both: "Both"]
    }

    public var scope: WidgetOpenScope {
        switch self {
        case .myHouse: return .myHouse
        case .otherHouses: return .otherHouses
        case .both: return .both
        }
    }
}

public struct OpenShiftsConfigIntent: WidgetConfigurationIntent {
    public static var title: LocalizedStringResource { "Open shifts" }
    public static var description: IntentDescription { "Pick which houses' open shifts to show." }

    @Parameter(title: "Show", default: .both)
    public var scope: OpenScopeChoice

    public init() {}

    // Configuration intents are never executed, but the app target (iOS 16) needs an
    // explicit perform() since the protocol's default is iOS 17+.
    public func perform() async throws -> some IntentResult { .result() }
}
