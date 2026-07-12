import Foundation

/// The data contract shared between the main app (writer) and the ShiftWidgets
/// extension (reader). These are plain `Codable` value types, deliberately decoupled
/// from the KMP `Shared` framework: the widget extension stays light (no framework
/// embed) and the JSON contract is the single source of truth across the process
/// boundary. The app converts the KMP domain models (`MyShift`, `OpenShift`,
/// `PendingFloat`) into these on every data refresh and writes them to the shared
/// App Group container; the widget reads the last-known snapshot and renders it.
///
/// Widgets are DISPLAY-ONLY: every tile deep-links into the app to act (see
/// `WidgetDeepLink`). The snapshot is a glanceable cache, never a write surface.

/// The App Group both targets share. Must match the `com.apple.security
/// .application-groups` entitlement on the app AND the widget target.
public let kShiftAppGroup = "group.com.pennhousing.shift"

/// A single scheduled shift the worker holds (Widget 1 — Upcoming shifts).
public struct WidgetShift: Codable, Identifiable, Hashable {
    public var id: String
    public var house: String
    public var start: Date
    public var end: Date

    public init(id: String, house: String, start: Date, end: Date) {
        self.id = id; self.house = house; self.start = start; self.end = end
    }
}

/// A claimable open desk shift (Widget 2 — Open shifts). `homeHouse` drives the
/// configurable scope filter (My house / Other houses / Both).
public struct WidgetOpenShift: Codable, Identifiable, Hashable {
    public var id: String
    public var house: String
    public var start: Date
    public var end: Date
    public var homeHouse: Bool

    public init(id: String, house: String, start: Date, end: Date, homeHouse: Bool) {
        self.id = id; self.house = house; self.start = start; self.end = end
        self.homeHouse = homeHouse
    }
}

/// A pending float the worker must acknowledge (Widget 1 — float banner). Sorted
/// closest-start first by the writer, mirroring the in-app carousel order.
public struct WidgetFloat: Codable, Identifiable, Hashable {
    public var id: String
    public var destinationHouse: String
    public var start: Date
    public var end: Date

    public init(id: String, destinationHouse: String, start: Date, end: Date) {
        self.id = id; self.destinationHouse = destinationHouse
        self.start = start; self.end = end
    }
}

/// The full payload the app writes and the widget reads.
public struct WidgetSnapshot: Codable, Hashable {
    public var updatedAt: Date
    public var upcomingShifts: [WidgetShift]
    public var openShifts: [WidgetOpenShift]
    public var pendingFloats: [WidgetFloat]

    public init(
        updatedAt: Date,
        upcomingShifts: [WidgetShift],
        openShifts: [WidgetOpenShift],
        pendingFloats: [WidgetFloat]
    ) {
        self.updatedAt = updatedAt
        self.upcomingShifts = upcomingShifts
        self.openShifts = openShifts
        self.pendingFloats = pendingFloats
    }

    public static let empty = WidgetSnapshot(
        updatedAt: .distantPast, upcomingShifts: [], openShifts: [], pendingFloats: []
    )
}

/// Reads and writes the snapshot in the shared App Group `UserDefaults`. The blob is
/// small (a worker's week), so a single JSON value keyed in defaults is sufficient and
/// avoids file-coordination ceremony.
public enum WidgetSnapshotStore {
    private static let key = "shift.widget.snapshot.v1"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: kShiftAppGroup)
    }

    private static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }

    private static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    /// Persist the latest snapshot. Returns true if it actually changed (so the caller
    /// can skip a redundant `WidgetCenter` reload when nothing moved).
    @discardableResult
    public static func write(_ snapshot: WidgetSnapshot) -> Bool {
        guard let defaults, let data = try? encoder.encode(snapshot) else { return false }
        if let existing = defaults.data(forKey: key), existing == data { return false }
        defaults.set(data, forKey: key)
        return true
    }

    /// The last-known snapshot, or `nil` if the app has not written one yet (cold install,
    /// or the worker has never opened the app since adding the widget).
    public static func read() -> WidgetSnapshot? {
        guard let defaults, let data = defaults.data(forKey: key) else { return nil }
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }
}
