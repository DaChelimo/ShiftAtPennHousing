import Foundation
import UIKit

/// Open the dialer on a number, pre-filled but NOT dialled. Mirrors the existing `dial(_:)`
/// helper on the contact-card view (`ContentView.swift`, near line 4575) exactly — same
/// `tel://` scheme, same digit-stripping — pulled out as a free function so the Coverage
/// Respond sheet (`CoverageView.swift`) can use it without duplicating the contact card's
/// private method or make it non-private.
///
/// `tel:`, deliberately, never places the call itself — it leaves the manager one deliberate
/// tap away from connecting. On the Respond sheet that matters: an accidental tap on "Call
/// Allied" should not silently start a call at 22:00.
enum PhoneDialer {
    static func dial(_ phone: String) {
        let digits = phone.filter { !$0.isWhitespace && $0 != "(" && $0 != ")" && $0 != "-" }
        guard !digits.isEmpty, let url = URL(string: "tel://\(digits)") else { return }
        UIApplication.shared.open(url)
    }
}
