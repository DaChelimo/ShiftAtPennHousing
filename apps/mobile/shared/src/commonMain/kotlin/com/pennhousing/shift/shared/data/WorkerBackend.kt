package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.auth.AuthSession
import com.pennhousing.shift.shared.auth.SessionValidity
import com.pennhousing.shift.shared.network.createAppSupabaseClient
import com.pennhousing.shift.shared.platform.AppConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import kotlin.time.Clock

/**
 * Worker auth — the single shared Supabase client + token wiring (DESIGN §5, item 2).
 *
 * One place builds the [SupabaseClient] from [AppConfig] (URL + anon key, set by each
 * platform's entry point) and hands out the auth gateway + shifts repository over it.
 * Building it lazily means a no-backend (demo) launch never constructs a client.
 *
 * After a successful sign-in, call [wireAccessToken] so `AppConfig.accessTokenProvider`
 * returns the authenticated worker's live JWT — every privileged call (Postgrest reads,
 * the push-token POST) then carries the worker's bearer token instead of the anon key.
 * The provider reads the token lazily on each call, so supabase-kt's internal refresh
 * is always reflected.
 */
object WorkerBackend {
    val client: SupabaseClient by lazy {
        createAppSupabaseClient(AppConfig.supabaseUrl, AppConfig.supabaseAnonKey)
    }

    val authGateway: SupabaseAuthGateway by lazy { SupabaseAuthGateway(client) }

    val shiftsRepository: WorkerShiftsRepository by lazy { WorkerShiftsRepository(client) }

    val preferencesRepository: PreferencesRepository by lazy { PreferencesRepository(client) }

    val profileRepository: ProfileRepository by lazy { ProfileRepository(client) }

    val breakRepository: BreakRepository by lazy { BreakRepository(client) }

    /** Point `AppConfig.accessTokenProvider` at the live worker JWT (call after sign-in). */
    fun wireAccessToken() {
        AppConfig.accessTokenProvider = { client.auth.currentAccessTokenOrNull() }
    }

    /**
     * Launch-time session restore (the iOS analogue of Android `MainActivity`'s
     * `produceState { currentSession() }` + `AppBootstrap.decide` gate). Restores any
     * persisted Supabase session through [authGateway] and returns it only when the
     * shared, tested [SessionValidity] check passes for the current wall clock —
     * otherwise null (caller shows login). On a valid restore it wires the worker JWT.
     *
     * The clock read and the `kotlin.time` validity arithmetic stay Kotlin-side so the
     * Swift caller never has to bridge `kotlin.time.Instant`/`Duration`; the pure
     * `auth/` package (and its tests) is untouched.
     */
    suspend fun restoreValidSession(): AuthSession? {
        val session = authGateway.currentSession()
        val valid = if (SessionValidity.isValid(session, Clock.System.now())) session else null
        if (valid != null) wireAccessToken()
        return valid
    }
}
