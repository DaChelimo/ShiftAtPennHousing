package com.pennhousing.shift.shared.platform

import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlin.concurrent.Volatile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Phase 13a — POSTs a device push token to the phase-12 `register-push-token`
 * Edge Function (which upserts `push_tokens`). Shared across platforms; each
 * `registerPushToken` actual only differs in where the token comes from
 * (Android FCM registration token vs iOS Firebase FCM token derived from APNs).
 *
 * Fire-and-forget on a background scope — registration is best-effort and must
 * never block app start. The Ktor [HttpClient] resolves its engine from the
 * classpath (OkHttp on Android, Darwin on iOS).
 *
 * The OS/Firebase token callback that triggers [enqueue] can fire at app launch —
 * before `WorkerBackend.wireAccessToken()` runs post-login — so `accessTokenProvider()`
 * can still be null at that instant. Mirrors `EdgeFunctionClient.authed`'s fix for the
 * same race: pre-flight `ensureFreshSession(false)`, then on a `401` force a refresh and
 * retry once. Before this fix the call silently sent the anon key, 401-ed, and was
 * swallowed by `runCatching` with no retry — no token ever reached `push_tokens`.
 */
internal object PushTokenRegistrar {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client by lazy { HttpClient() }

    /**
     * The last token the OS handed us, remembered so [retryLastRegistration] can re-send it
     * once a session exists. `kotlin.concurrent.Volatile` deliberately: the bare `@Volatile`
     * resolves to `kotlin.jvm.Volatile` and is an unresolved reference on Kotlin/Native, which
     * keeps Android green while iOS silently breaks (see apps/mobile/AGENTS.md).
     */
    @Volatile
    private var lastToken: String? = null

    @Volatile
    private var lastPlatform: String? = null

    /**
     * Re-send the most recent device token, if the OS has given us one this launch.
     *
     * Called after sign-in / session restore ([WorkerBackend.wireAccessToken]). The OS token
     * callbacks fire at LAUNCH, which on a first-ever sign-in is before any session exists, so
     * both the initial POST and its 401 retry legitimately fail. Nothing else would ever try
     * again -- FCM only re-issues a token on rotation, which may be weeks away or never -- so
     * a brand new worker would install the app, sign in, and silently never receive a push.
     * No-ops when no token has arrived yet; the callbacks register directly in that case.
     */
    fun retryLastRegistration() {
        val token = lastToken ?: return
        val platform = lastPlatform ?: return
        enqueue(token, platform)
    }

    fun enqueue(
        token: String,
        platform: String,
    ) {
        lastToken = token
        lastPlatform = platform
        val base = AppConfig.supabaseUrl
        if (base.isBlank()) return
        scope.launch {
            runCatching {
                AppConfig.ensureFreshSession(false)
                var response = post(base, token, platform)
                if (response.status.value == 401) {
                    AppConfig.ensureFreshSession(true)
                    response = post(base, token, platform)
                }
                response
            }
        }
    }

    private suspend fun post(
        base: String,
        token: String,
        platform: String,
    ): HttpResponse {
        val bearer = AppConfig.accessTokenProvider() ?: AppConfig.supabaseAnonKey
        return client.post("$base/functions/v1/register-push-token") {
            headers {
                append("apikey", AppConfig.supabaseAnonKey)
                append("Authorization", "Bearer $bearer")
            }
            contentType(ContentType.Application.Json)
            setBody("{\"device_token\":\"$token\",\"platform\":\"$platform\"}")
        }
    }
}
