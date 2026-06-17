package com.pennhousing.shift.shared.network

import com.pennhousing.shift.shared.platform.AppConfig
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.patch
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
 * (T1-2), claim (T1-3), float ack (T1-4), break claim (T1-5), broadcast (T1-7), swap
 * create/accept/reject/void (§8) — POSTs through here, so the bearer/apikey/contentType
 * boilerplate lives in one place. The shared Supabase client installs no Functions
 * plugin, so this is a raw Ktor request carrying the worker's live JWT
 * (`AppConfig.accessTokenProvider`, falling back to the anon key before sign-in).
 *
 * Session freshness is handled HERE, not by the caller: every request first runs
 * `AppConfig.ensureFreshSession(false)` (a cheap refresh-if-near-expiry), and any `401`
 * triggers one forced refresh + retry. Before this, an expired worker JWT silently 401-ed
 * every write — the symptom that made "propose swap" no-op while the optimistic UI
 * reported success.
 *
 * It is the mobile analogue of the Edge/HTTP layer the phase-13a test plan scopes out,
 * so it is intentionally untested by kotlin.test; correctness is verified manually
 * against a running backend.
 */
class EdgeFunctionClient(
    private val http: HttpClient = HttpClient(),
) {
    /**
     * Sends an authenticated Edge-Function [request] (the caller supplies the verb/body;
     * we inject the freshness handling). Refreshes a near-expiry session first, sends with
     * the live bearer, and on a `401` forces one refresh + retry so a token that expired
     * mid-session recovers transparently. Returns `ok = true` on a 2xx. Never throws: a
     * blank backend URL or any transport failure resolves to `EdgeResult(false, 0, "")`.
     */
    private suspend fun authed(request: suspend (bearer: String) -> HttpResponse): EdgeResult {
        if (AppConfig.supabaseUrl.isBlank()) return EdgeResult(false, 0, "")
        return runCatching {
            AppConfig.ensureFreshSession(false)
            var response = request(AppConfig.accessTokenProvider() ?: AppConfig.supabaseAnonKey)
            if (response.status.value == 401) {
                // The token expired out from under us — force a refresh and retry once.
                AppConfig.ensureFreshSession(true)
                response = request(AppConfig.accessTokenProvider() ?: AppConfig.supabaseAnonKey)
            }
            EdgeResult(response.status.isSuccess(), response.status.value, response.bodyAsText())
        }.getOrDefault(EdgeResult(false, 0, ""))
    }

    private fun HttpRequestBuilder.authHeaders(bearer: String) {
        headers {
            append("apikey", AppConfig.supabaseAnonKey)
            append("Authorization", "Bearer $bearer")
        }
    }

    /**
     * POST [jsonBody] to `<supabaseUrl>/functions/v1/<path>`. [path] is the function
     * name plus any sub-route (e.g. `"submit-preferences/preferences"`). Returns
     * `ok = true` on a 2xx; session-fresh + 401-retry handled by [authed].
     */
    suspend fun invoke(
        path: String,
        jsonBody: String,
    ): EdgeResult =
        authed { bearer ->
            http.post("${AppConfig.supabaseUrl}/functions/v1/$path") {
                authHeaders(bearer)
                contentType(ContentType.Application.Json)
                setBody(jsonBody)
            }
        }

    /**
     * GET `<supabaseUrl>/functions/v1/<path>` — the same auth/headers as [invoke], for the
     * few Edge Functions that expose a read-only/dry-run GET (e.g. `permanent-pickup`, whose
     * GET returns the pickup SCOPE — assigned vs skipped weeks — without committing). The
     * full query string is encoded into [path] by the caller.
     */
    suspend fun get(path: String): EdgeResult =
        authed { bearer ->
            http.get("${AppConfig.supabaseUrl}/functions/v1/$path") {
                authHeaders(bearer)
            }
        }

    /**
     * PATCH [jsonBody] to `<supabaseUrl>/functions/v1/<path>` — the same auth/headers as
     * [invoke], for the few Edge Functions that are PATCH-only (e.g.
     * `users-broadcast-subscription`, which 405s on anything but PATCH).
     */
    suspend fun patch(
        path: String,
        jsonBody: String,
    ): EdgeResult =
        authed { bearer ->
            http.patch("${AppConfig.supabaseUrl}/functions/v1/$path") {
                authHeaders(bearer)
                contentType(ContentType.Application.Json)
                setBody(jsonBody)
            }
        }
}
