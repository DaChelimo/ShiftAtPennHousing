import Foundation

/// The `pennshift://` deep links a widget tile opens. Display-only widgets never write;
/// tapping always routes into the app to act. The float-ack route already exists
/// (`pennshift://float-ack/{id}`, parsed Kotlin-side by `parseFloatAckDeepLink`); the
/// rest land the app on the relevant tab.
public enum WidgetDeepLink {
    public static let scheme = "pennshift"

    /// Worker's own shifts (My Shifts tab).
    public static var myShifts: URL { URL(string: "\(scheme)://my-shifts")! }

    /// Open-shifts feed. `scope` carries the widget's configured scope so the app can
    /// land on the matching sub-tab (my house vs. others).
    public static func openShifts(scope: WidgetOpenScope) -> URL {
        URL(string: "\(scheme)://open-shifts?scope=\(scope.rawValue)")!
    }

    /// The full-screen acknowledgment for a single pending float.
    public static func floatAck(id: String) -> URL {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return URL(string: "\(scheme)://float-ack/\(safe)")!
    }

    /// The Updates list, where multiple pending floats are reviewed.
    public static var updates: URL { URL(string: "\(scheme)://updates")! }
}

/// The configurable scope of the Open Shifts widget (Widget 2). The user picks this when
/// adding or editing the widget; the choice shows as the tile title.
public enum WidgetOpenScope: String, Codable, CaseIterable {
    case myHouse
    case otherHouses
    case both

    /// Title shown on the tile, e.g. "Open · My house".
    public var shortTitle: String {
        switch self {
        case .myHouse: return "My house"
        case .otherHouses: return "Other houses"
        case .both: return "Both"
        }
    }

    /// Keeps only the open shifts in scope.
    public func filter(_ shifts: [WidgetOpenShift]) -> [WidgetOpenShift] {
        switch self {
        case .myHouse: return shifts.filter { $0.homeHouse }
        case .otherHouses: return shifts.filter { !$0.homeHouse }
        case .both: return shifts
        }
    }
}
