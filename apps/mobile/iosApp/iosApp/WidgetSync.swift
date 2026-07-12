import Foundation
import WidgetKit
import Shared

/// Bridges the app's live data into the home-screen widgets. The app fetches the
/// worker's week and pending floats already (ShiftsObservable / FloatCarouselObservable);
/// on every refresh it hands the KMP domain models here, which convert them to the plain
/// `Codable` snapshot, persist it in the shared App Group container, and ask WidgetKit
/// to reload. The widget is display-only, so this is the ONLY write direction.
///
/// Shifts and floats arrive on independent refresh paths, so the latest of each is held
/// and the merged snapshot is rewritten on any update. A no-op write (nothing actually
/// changed) skips the reload.
@MainActor
enum WidgetSync {
    private static var latestShifts: [WidgetShift] = []
    private static var latestOpen: [WidgetOpenShift] = []
    private static var latestFloats: [WidgetFloat] = []

    /// Called when a fresh `WorkerSnapshot` (own shifts + open feed) streams in.
    static func update(myShifts: [MyShift], openShifts: [OpenShift]) {
        latestShifts = myShifts
            // Own held shifts only. A personally-dropped-still-open block is no longer
            // yours, so it belongs in the open feed, not "upcoming".
            .filter { !$0.droppedStillOpen }
            .map { WidgetShift(id: $0.id, house: $0.house.name,
                               start: date($0.start.toEpochMilliseconds()),
                               end: date($0.end.toEpochMilliseconds())) }

        latestOpen = openShifts.map {
            WidgetOpenShift(id: $0.id, house: $0.house.name,
                            start: date($0.start.toEpochMilliseconds()),
                            end: date($0.end.toEpochMilliseconds()),
                            homeHouse: $0.homeHouse)
        }
        flush()
    }

    /// Called when the pending-float list is rebuilt (§7.1 carousel).
    static func update(pendingFloats: [PendingFloat]) {
        latestFloats = pendingFloats.map {
            WidgetFloat(id: $0.floatId, destinationHouse: $0.destinationHouse.name,
                        start: date($0.start.toEpochMilliseconds()),
                        end: date($0.end.toEpochMilliseconds()))
        }
        flush()
    }

    private static func flush() {
        let snapshot = WidgetSnapshot(
            updatedAt: Date(),
            upcomingShifts: latestShifts.sorted { $0.start < $1.start },
            openShifts: latestOpen.sorted { $0.start < $1.start },
            pendingFloats: latestFloats.sorted { $0.start < $1.start }
        )
        if WidgetSnapshotStore.write(snapshot) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Epoch millis (from `kotlin.time.Instant.toEpochMilliseconds()`) → Swift `Date`.
    /// Taking the Int64 avoids naming the SKIE-exported `Instant` type.
    private static func date(_ epochMillis: Int64) -> Date {
        Date(timeIntervalSince1970: Double(epochMillis) / 1000.0)
    }
}
