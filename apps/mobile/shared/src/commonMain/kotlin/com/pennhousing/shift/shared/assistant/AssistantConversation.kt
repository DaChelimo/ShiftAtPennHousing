package com.pennhousing.shift.shared.assistant

// Pure conversation transitions (V1_SCOPE §4). Ids are supplied by the caller so the
// logic is deterministic and host-testable (no clock, no id generator inside).

fun appendUserMessage(
    messages: List<AssistantMessage>,
    id: String,
    text: String,
): List<AssistantMessage> =
    messages + AssistantMessage(id = id, role = AssistantRole.USER, content = text)

// Streaming transitions (SSE `da-ask`). An in-progress answer is an empty ASSISTANT
// message appended up front, then mutated in place as [AssistantStreamEvent]s arrive.

/** `AssistantStreamEvent.Meta` hasn't arrived yet, or `Delta`s are still accumulating. */
fun startAssistantMessage(
    messages: List<AssistantMessage>,
    id: String,
): List<AssistantMessage> = messages + AssistantMessage(id = id, role = AssistantRole.ASSISTANT, content = "")

/** Patches citations/deferred/route/lifeSafety onto the in-progress (last) message. */
fun applyStreamMeta(
    messages: List<AssistantMessage>,
    citations: List<Citation>,
    deferred: Boolean,
    route: AssistantRoute?,
    lifeSafety: String?,
): List<AssistantMessage> {
    val last = messages.lastOrNull() ?: return messages
    return messages.dropLast(1) +
        last.copy(citations = citations, deferred = deferred, route = route, lifeSafety = lifeSafety)
}

/** Appends [delta] to the in-progress (last) message's content. */
fun appendDelta(
    messages: List<AssistantMessage>,
    delta: String,
): List<AssistantMessage> {
    val last = messages.lastOrNull() ?: return messages
    return messages.dropLast(1) + last.copy(content = last.content + delta)
}

/**
 * The leakage guardrail tripped mid-stream: replace the in-progress (last) message's
 * content with the refusal and clear any grounded-answer metadata it had started to
 * accumulate — it is never a grounded answer once retracted.
 */
fun retractLast(
    messages: List<AssistantMessage>,
    content: String,
): List<AssistantMessage> {
    val last = messages.lastOrNull() ?: return messages
    return messages.dropLast(1) +
        last.copy(content = content, citations = emptyList(), deferred = false, route = null)
}
