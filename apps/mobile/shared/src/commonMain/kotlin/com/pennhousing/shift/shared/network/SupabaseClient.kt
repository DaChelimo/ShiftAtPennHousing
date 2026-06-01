package com.pennhousing.shift.shared.network

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime

/**
 * Phase 13a — the shared Supabase client (commonMain).
 *
 * Both front ends build it with their platform-resolved config and pass the URL
 * + anon key in: Android from `BuildConfig` (see `androidApp/build.gradle.kts`),
 * iOS from `Info.plist` (see `iosApp/README.md`). The Ktor engine is provided per
 * platform — OkHttp in `androidMain`, Darwin in `iosMain`.
 *
 * Installs the three plugins the worker app uses:
 * - [Auth]      — the authenticated worker's session (RLS scopes every query).
 * - [Realtime]  — live `shift_block_assignments` / `notifications` subscriptions.
 * - [Postgrest] — the REST surface the repository reads feeds through.
 *
 * The data layer is the mobile analogue of the Edge/HTTP layer scoped out of the
 * phase-13a test plan; it is not exercised by the kotlin.test suite.
 */
fun createAppSupabaseClient(
    supabaseUrl: String,
    supabaseAnonKey: String,
): SupabaseClient =
    createSupabaseClient(supabaseUrl = supabaseUrl, supabaseKey = supabaseAnonKey) {
        install(Auth)
        install(Realtime)
        install(Postgrest)
    }
