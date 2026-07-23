package com.pennhousing.shift.shared.data

import com.pennhousing.shift.shared.assistant.AssistantRoute
import com.pennhousing.shift.shared.assistant.AssistantStreamEvent
import com.pennhousing.shift.shared.assistant.Citation
import com.pennhousing.shift.shared.network.EdgeFunctionClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Desk Assistant network call — the data layer behind [AssistantViewModel]'s
 * (deliberately untested, per its own doc comment) da-ask round trip. The mobile
 * analogue of the Edge/HTTP layer phases 07-12/13a scope out of kotlin.test;
 * correctness is verified manually against a running backend.
 *
 * POSTs `{ question }` to the `da-ask` Edge Function and parses its SSE response
 * (`meta`/`delta`/`retract`/`done`/`error` frames — see `supabase/functions/da-ask/index.ts`
 * and its mirrored web types in `apps/web/lib/assistant/streamTypes.ts`) into
 * [AssistantStreamEvent]s as they arrive.
 */
class AssistantRepository(
    private val edge: EdgeFunctionClient = EdgeFunctionClient(),
) {
    /**
     * A cold [Flow] of [AssistantStreamEvent]s that NEVER throws: a transport failure or an
     * unparseable frame is converted into a terminal [AssistantStreamEvent.Failed], which the
     * hosts already route to [AssistantViewModel.onError].
     *
     * The non-throwing contract is load-bearing on iOS, not a nicety. SKIE bridges this Flow
     * to a Swift `AsyncSequence` by collecting it inside a `launch`-ed coroutine; an exception
     * escaping the flow therefore surfaces as an UNCAUGHT exception in a `StandaloneCoroutine`,
     * and Kotlin/Native's uncaught-coroutine-exception handler calls `abort()`. That kills the
     * whole app before the Swift `do { for try await ... } catch` in `AssistantObservable.ask`
     * can ever see it, because the throw never crosses back as a Swift error. Confirmed from
     * two crash reports (2026-07-22) whose triggered thread was
     * `terminateWithUnhandledException` <- `handleUncaughtCoroutineException` <-
     * `StandaloneCoroutine.handleJobException` on SKIE's `SwiftCoroutineDispatcher`, produced
     * by asking a question while the local `da-ask` Edge Function was unreachable.
     *
     * So: do NOT "simplify" this by removing the [catch] and letting callers handle it. Android
     * would survive (its `runCatching` collects on the caller's own scope); iOS would crash.
     */
    fun askStream(question: String): Flow<AssistantStreamEvent> =
        flow {
            val body = Json.encodeToString(AskRequest(question))
            var pendingData: String? = null
            edge.stream("da-ask", body).collect { line ->
                when {
                    line.startsWith("data:") -> pendingData = line.removePrefix("data:").trim()
                    // A blank line ends an SSE frame; the `event:` line itself is ignored —
                    // the JSON payload's own `t` field already disambiguates the event type.
                    line.isEmpty() && pendingData != null -> {
                        val dto = assistantJson.decodeFromString<StreamFrameDto>(pendingData!!)
                        emit(dto.toStreamEvent())
                        pendingData = null
                    }
                }
            }
        }.catch { emit(AssistantStreamEvent.Failed("Couldn't reach the assistant. Try again.")) }
}

private val assistantJson = Json { ignoreUnknownKeys = true }

@Serializable
private data class AskRequest(val question: String)

@Serializable
private data class CitationDto(
    @SerialName("documentId") val documentId: String,
    @SerialName("sourceRef") val sourceRef: String,
)

@Serializable
private data class RouteDto(
    @SerialName("resolvedTier") val resolvedTier: String,
)

@Serializable
private data class SafetyDto(
    @SerialName("lifeSafety") val lifeSafety: String? = null,
)

/** One decoded SSE frame's JSON payload — fields not used by [t] are simply left null/default. */
@Serializable
private data class StreamFrameDto(
    val t: String,
    val citations: List<CitationDto> = emptyList(),
    val deferred: Boolean = false,
    val route: RouteDto? = null,
    val safety: SafetyDto? = null,
    val text: String? = null,
    val content: String? = null,
    val messageId: String? = null,
    val message: String? = null,
)

private fun StreamFrameDto.toStreamEvent(): AssistantStreamEvent =
    when (t) {
        "meta" ->
            AssistantStreamEvent.Meta(
                citations = citations.map { Citation(documentId = it.documentId, sourceRef = it.sourceRef) },
                deferred = deferred,
                route = route?.let { AssistantRoute(resolvedTier = it.resolvedTier, tierLabel = tierLabel(it.resolvedTier)) },
                lifeSafety = safety?.lifeSafety,
            )
        "delta" -> AssistantStreamEvent.Delta(text.orEmpty())
        "retract" -> AssistantStreamEvent.Retract(content.orEmpty())
        "done" -> AssistantStreamEvent.Done(messageId)
        else -> AssistantStreamEvent.Failed(message ?: "The assistant sent an unexpected response.")
    }

/**
 * Verbatim mirror of the EF's `tierLabel()` (`supabase/functions/_shared/desk-assistant-routing.ts`)
 * so the route tag reads identically to the text already embedded in `content`.
 */
private fun tierLabel(tier: String): String =
    when (tier) {
        "desk_sm" -> "the Student Manager on Duty (SMOD)"
        "csmod" -> "the Conferences Manager on Duty (CSMOD)"
        "rsm" -> "the Residential Services Manager"
        "hmod" -> "the Housing Manager on Duty"
        "ba" -> "the Building Administrator"
        "project_admin" -> "the project administrator"
        else -> "the on-duty contact"
    }
