import Foundation
import Shared

/// Which dataset this build runs on. Resolved once at launch from the build config
/// (the gitignored Configuration/Config.xcconfig -> Info.plist).
enum ShiftDataSource: Equatable {
    /// Bundled `DemoData` (the "Andrew P." sample worker). No backend, no login.
    case demo
    /// A real Supabase backend: login screen, real accounts, real rows.
    case live
    /// `SHIFT_DATA_SOURCE = live` was asked for but the backend config is incomplete.
    /// Surfaced as a visible error rather than a silent fall back to demo, which is
    /// exactly what used to make "am I on demo or live?" unpredictable.
    case misconfigured(reason: String)
}

/// The single place the demo-vs-live decision is made.
///
/// Previously this was inferred inline from `AppConfig.shared.supabaseUrl.isEmpty`,
/// which meant the mode was a side effect of *how* you built: an Xcode Cmd+R build
/// only ever saw the committed (empty) `Config.xcconfig` and so was always demo,
/// while a terminal build could pass `SUPABASE_URL=...` overrides and be live. The
/// mode is now an explicit flag that every build path reads from the same file.
enum ShiftConfig {
    /// Resolved exactly once, lazily and thread-safely (Swift `static let` semantics),
    /// so it does not matter whether `AppDelegate` or the first SwiftUI body touches
    /// it first. Reading it also installs the Supabase credentials into the shared
    /// `AppConfig` before any Kotlin code can observe them.
    static let dataSource: ShiftDataSource = resolve()

    /// Raw flag as written in the xcconfig, for logging and the config error screen.
    static var flag: String { string("SHIFT_DATA_SOURCE") ?? "auto" }

    private static func resolve() -> ShiftDataSource {
        let flag = (string("SHIFT_DATA_SOURCE") ?? "auto").lowercased()
        let url = backendUrl()
        let key = string("SUPABASE_ANON_KEY")

        // Both halves are required: a URL without an anon key cannot authenticate.
        if let url, let key {
            AppConfig.shared.supabaseUrl = url
            AppConfig.shared.supabaseAnonKey = key
        }

        let resolved: ShiftDataSource
        switch flag {
        case "demo":
            resolved = .demo
        case "live":
            if url == nil {
                resolved = .misconfigured(reason: "SUPABASE_HOST is not set.")
            } else if key == nil {
                resolved = .misconfigured(reason: "SUPABASE_ANON_KEY is not set.")
            } else {
                resolved = .live
            }
        default: // "auto" and anything unrecognised
            resolved = (url != nil && key != nil) ? .live : .demo
        }

        NSLog(
            "[ShiftConfig] SHIFT_DATA_SOURCE=%@ -> %@ (url=%@, anonKey=%@)",
            flag,
            String(describing: resolved),
            url ?? "unset",
            key == nil ? "unset" : "set"
        )
        return resolved
    }

    /// An Info.plist string, trimmed. nil when absent, blank, or still holding an
    /// unsubstituted `$(NAME)` placeholder (which means the build setting was never set).
    private static func string(_ key: String) -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.hasPrefix("$(") else { return nil }
        return value
    }

    /// `SUPABASE_URL` is composed in Config.xcconfig as
    /// `$(SUPABASE_SCHEME)://$(SUPABASE_HOST)`, so an unset host still yields a
    /// non-empty but useless `http://`. Treat a scheme with no host as unset.
    private static func backendUrl() -> String? {
        guard let url = string("SUPABASE_URL") else { return nil }
        let host = url
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
        return host.isEmpty ? nil : url
    }
}
