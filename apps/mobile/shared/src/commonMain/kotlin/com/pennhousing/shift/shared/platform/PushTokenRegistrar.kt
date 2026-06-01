package com.pennhousing.shift.shared.platform

import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
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
 */
internal object PushTokenRegistrar {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val client by lazy { HttpClient() }

    fun enqueue(
        token: String,
        platform: String,
    ) {
        val base = AppConfig.supabaseUrl
        if (base.isBlank()) return
        val bearer = AppConfig.accessTokenProvider() ?: AppConfig.supabaseAnonKey
        scope.launch {
            runCatching {
                client.post("$base/functions/v1/register-push-token") {
                    headers {
                        append("apikey", AppConfig.supabaseAnonKey)
                        append("Authorization", "Bearer $bearer")
                    }
                    contentType(ContentType.Application.Json)
                    setBody("{\"token\":\"$token\",\"platform\":\"$platform\"}")
                }
            }
        }
    }
}
