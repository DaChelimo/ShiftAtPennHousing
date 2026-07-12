import WidgetKit
import SwiftUI

/// The widget extension's entry point. Bundles the two worker widgets:
///  - Upcoming shifts (own shifts + float banner)
///  - Open shifts (configurable scope: my house / other houses / both)
@main
struct ShiftWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpcomingShiftsWidget()
        OpenShiftsWidget()
    }
}
