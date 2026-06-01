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
}
