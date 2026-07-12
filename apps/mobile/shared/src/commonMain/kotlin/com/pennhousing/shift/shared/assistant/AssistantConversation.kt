package com.pennhousing.shift.shared.assistant

// Pure conversation transitions (V1_SCOPE §4). Ids are supplied by the caller so the
// logic is deterministic and host-testable (no clock, no id generator inside).

fun appendUserMessage(
    messages: List<AssistantMessage>,
    id: String,
    text: String,
): List<AssistantMessage> =
    messages + AssistantMessage(id = id, role = AssistantRole.USER, content = text)

fun appendAssistantResult(
    messages: List<AssistantMessage>,
    id: String,
    result: AskResult,
): List<AssistantMessage> =
    messages +
        AssistantMessage(
            id = id,
            role = AssistantRole.ASSISTANT,
            content = result.content,
            citations = result.citations,
            deferred = result.deferred,
            route = result.route,
            lifeSafety = result.lifeSafety,
        )
