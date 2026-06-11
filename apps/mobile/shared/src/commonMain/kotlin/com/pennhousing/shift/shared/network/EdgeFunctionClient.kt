package com.pennhousing.shift.shared.network

import com.pennhousing.shift.shared.platform.AppConfig
import io.ktor.client.HttpClient
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess

/** The outcome of an Edge-Function POST. `ok` is true on a 2xx; transport failure → (false, 0, ""). */
data class EdgeResult(
    val ok: Boolean,
    val status: Int,
    val body: String,
)

/**
 * The single authenticated Edge-Function write path for the worker app (parity T1-0).
 *
 * Every privileged mobile write — preferences submit (T1-6), drop / permanent-drop
 * (T1-2), claim (T1-3), float ack (T1-4), break claim (T1-5), broadcast (T1-7) —
 * POSTs through here, so the bearer/apikey/contentType boilerplate lives in one place.
 * The shared Supabase client installs no Functions plugin, so this is a raw Ktor POST
 * carrying the worker's live JWT (`AppConfig.accessTokenProvider`, falling back to the
 * anon key before sign-in), exactly as `PreferencesRepository.submitPreferences` and
 * `PushTokenRegistrar` did inline before this was extracted.
 *
 * It is the mobile analogue of the Edge/HTTP layer the phase-13a test plan scopes out,
 * so it is intentionally untested by kotlin.test; correctness is verified manually
 * against a running backend.
 */
class EdgeFunctionClient(
    private val http: HttpClient = HttpClient(),
) {
    /**
     * POST [jsonBody] to `<supabaseUrl>/functions/v1/<path>`. [path] is the function
     * name plus any sub-route (e.g. `"submit-preferences/preferences"`). Returns
     * `ok = true` on a 2xx. Never throws: a blank backend URL or any transport failure
     * resolves to `EdgeResult(false, 0, "")` so callers can stay best-effort.
     */
    suspend fun invoke(
        path: String,
        jsonBody: String,
    ): EdgeResult {
        val base = AppConfig.supabaseUrl
        if (base.isBlank()) return EdgeResult(false, 0, "")
        val bearer = AppConfig.accessTokenProvider() ?: AppConfig.supabaseAnonKey
        return runCatching {
            val response: HttpResponse =
                http.post("$base/functions/v1/$path") {
                    headers {
                        append("apikey", AppConfig.supabaseAnonKey)
                        append("Authorization", "Bearer $bearer")
                    }
                    contentType(ContentType.Application.Json)
                    setBody(jsonBody)
                }
            EdgeResult(response.status.isSuccess(), response.status.value, response.bodyAsText())
        }.getOrDefault(EdgeResult(false, 0, ""))
    }
}
