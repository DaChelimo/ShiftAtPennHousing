package com.pennhousing.shift.shared.assistant

// Desk Assistant (mobile) — the pure decision surface (V1_SCOPE §4). Mirrors the
// da-ask Edge Function response shape. The network call itself is the data/UI layer
// (scoped out of tests, like phases 07-12's HTTP layer); this holds the tested logic.

enum class AssistantRole { USER, ASSISTANT }

data class Citation(val documentId: String, val sourceRef: String)

data class AssistantRoute(
    val resolvedTier: String,
    val tierLabel: String? = null,
    val contactName: String? = null,
)

/**
 * One event from the streaming da-ask SSE wire contract (mirrors
 * `apps/web/lib/assistant/streamTypes.ts`'s `AssistantStreamEvent` union 1:1). [Meta]
 * arrives first (citations/route/safety are known before generation starts); zero or
 * more [Delta]s carry live text; [Retract] replaces everything streamed so far when the
 * server's incident-leakage guardrail trips mid-stream (only the refusal is ever
 * persisted server-side); [Done] is always last on success and carries the persisted
 * `messageId` (unknown until the final content is written); [Failed] replaces [Done] on
 * a mid-stream failure.
 */
sealed class AssistantStreamEvent {
    data class Meta(
        val citations: List<Citation>,
        val deferred: Boolean,
        val route: AssistantRoute?,
        val lifeSafety: String?,
    ) : AssistantStreamEvent()

    data class Delta(val text: String) : AssistantStreamEvent()

    data class Retract(val content: String) : AssistantStreamEvent()

    data class Done(val messageId: String?) : AssistantStreamEvent()

    data class Failed(val message: String) : AssistantStreamEvent()
}

/** Starter chips shown on the empty chat screen, shared so both platforms render identical copy. */
object AssistantPrompts {
    val starters: List<String> = listOf(
        "Who's on duty right now?",
        "What's my next shift?",
        "How do I check if a resident has access to a specific room?",
        "A resident is locked out of their room. What are the steps?",
    )
}

data class AssistantMessage(
    val id: String,
    val role: AssistantRole,
    val content: String,
    val citations: List<Citation> = emptyList(),
    val deferred: Boolean = false,
    val route: AssistantRoute? = null,
    val lifeSafety: String? = null,
) {
    /** Life-safety preamble is shown as a loud banner above the answer (§8 rule 2). */
    val showSafetyBanner: Boolean get() = role == AssistantRole.ASSISTANT && lifeSafety != null

    /** A deferred (ungrounded) answer offers the routing card + "draft a page" (§4.2/§4.3). */
    val offersPageDraft: Boolean get() = role == AssistantRole.ASSISTANT && deferred
}
