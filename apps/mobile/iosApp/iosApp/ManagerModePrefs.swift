import Foundation
import Shared

/// On-device storage for the remembered app shape (docs/manager-app/SPEC.md §5.1). The iOS
/// half of `ManagerRoleCache.kt` in `:shared`; `ManagerModePrefs.kt` in `androidApp` is the
/// Android half over `SharedPreferences`.
///
/// `UserDefaults.standard` directly, matching this app's existing convention (`ThemeController`
/// in Theme/ShiftTheme.swift, the per-tour "seen" stores in Onboarding.swift) — no shared
/// UserDefaults wrapper abstraction exists here, so this does not introduce one either.
///
/// WHY THIS EXISTS: capabilities come from `user_roles`, a network read. Without a cache, every
/// cold launch renders the plain-worker shape while that read is in flight, then re-shapes
/// navigation when the roles arrive — a visible flip on every single launch for a manager. These
/// roles change roughly once a year; re-deriving them from the network before drawing anything is
/// the wrong trade. See the full rationale in `ManagerRoleCache.kt`'s header and
/// `docs/manager-app/SPEC.md` §5.1 (written against the Android incident this fixed).
///
/// NOT A SECURITY BOUNDARY. Nothing here is trusted for authorization — it only decides which
/// tabs to draw. Every manager write still re-checks authorization server-side from the bearer
/// token. See the header on `ManagerCapability.kt`.
enum ManagerModePrefs {
    private static let key = "manager_mode_role_shape"

    /// The stored shape, or nil when absent, stale-versioned, or malformed. `UserDefaults` is
    /// backed by an in-memory cache after first touch, so this is safe to call synchronously on
    /// the launch path (in `ShiftsRootView.init`), before the first frame — the same requirement
    /// that makes `ManagerModePrefs.kt` read via `SharedPreferences` rather than anything async.
    static func read() -> CachedRoleShape? {
        ManagerRoleCacheKt.decodeRoleShape(raw: UserDefaults.standard.string(forKey: key))
    }

    static func write(_ shape: CachedRoleShape) {
        UserDefaults.standard.set(ManagerRoleCacheKt.encodeRoleShape(shape: shape), forKey: key)
    }

    /// Forget the shape. Called on sign-out, so the next person to sign in on this device gets a
    /// cache miss and one honest slow launch rather than inheriting somebody else's tabs.
    ///
    /// `read()` already refuses a shape belonging to a different user id (see
    /// `resolveRoleShape` in `ManagerRoleCache.kt`), so this is belt and braces: it protects
    /// against a signed-out device carrying a record of who last used it and what they could do.
    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }
}
