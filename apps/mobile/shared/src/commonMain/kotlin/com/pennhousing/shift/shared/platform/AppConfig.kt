package com.pennhousing.shift.shared.platform

import kotlin.concurrent.Volatile

/**
 * Phase 13a — shared runtime config the data layer + platform hooks read.
 *
 * Set once at app start from each platform's config source: Android from
 * `BuildConfig` (gradle), iOS from `Info.plist`. `accessTokenProvider` returns
 * the authenticated worker's current JWT (from Supabase Auth) so privileged
 * calls — e.g. the push-token POST — carry the user's bearer token; it falls
 * back to the anon key before sign-in.
 */
object AppConfig {
    @Volatile
    var supabaseUrl: String = ""

    @Volatile
    var supabaseAnonKey: String = ""

    @Volatile
    var accessTokenProvider: () -> String? = { null }

    /**
     * Refreshes the worker's Supabase session before a privileged call reads its JWT via
     * [accessTokenProvider]. `force = false` refreshes only when the token is missing or
     * within the near-expiry window (the cheap pre-flight on every call); `force = true`
     * always refreshes (the 401 backstop, after a stale token slipped through).
     *
     * Wired to Supabase Auth in `WorkerBackend.wireAccessToken()` after sign-in/restore;
     * the default is a no-op so the demo / pre-sign-in path never tries to refresh. Must
     * never throw — the caller stays best-effort.
     */
    @Volatile
    var ensureFreshSession: suspend (force: Boolean) -> Unit = { _ -> }
}
