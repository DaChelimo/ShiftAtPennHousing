package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.assistant.AssistantMessage
import com.pennhousing.shift.shared.assistant.AssistantRoute
import com.pennhousing.shift.shared.assistant.Citation
import com.pennhousing.shift.shared.assistant.appendDelta
import com.pennhousing.shift.shared.assistant.appendUserMessage
import com.pennhousing.shift.shared.assistant.applyStreamMeta
import com.pennhousing.shift.shared.assistant.retractLast
import com.pennhousing.shift.shared.assistant.startAssistantMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AssistantUiState(
    val messages: List<AssistantMessage> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
) {
    val isEmpty: Boolean get() = messages.isEmpty()
}

/**
 * Desk Assistant chat ViewModel (V1_SCOPE §4, streaming da-ask). Thin synchronous
 * StateFlow wrapper in the [UpdatesViewModel] / [ShiftsScreenViewModel] shape: it emits
 * synchronously (no `viewModelScope`) so it runs on the JVM host without an Android
 * runtime. The actual da-ask SSE call is the data/UI layer's job (scoped out of tests);
 * the host drives this VM by calling [onUserSubmitted], then [onStreamStart] once the
 * connection opens, then [onStreamMeta]/[onStreamDelta] as SSE frames arrive, then
 * [onStreamRetract] (if the leakage guardrail trips) and finally [onStreamDone] — or
 * [onError] on a transport failure at any point.
 */
class AssistantViewModel : ViewModel() {
    private var seq = 0
    private val _uiState = MutableStateFlow(AssistantUiState())
    val uiState: StateFlow<AssistantUiState> = _uiState.asStateFlow()

    private fun nextId(): String {
        seq += 1
        return "m$seq"
    }

    /** Append the user's question and enter the loading state. Ignores blank input and
     *  re-entrancy while a request is in flight. */
    fun onUserSubmitted(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || _uiState.value.loading) return
        val current = _uiState.value
        _uiState.value = current.copy(
            messages = appendUserMessage(current.messages, nextId(), trimmed),
            loading = true,
            error = null,
        )
    }

    /** The SSE connection opened: append the empty assistant placeholder deltas will fill in. */
    fun onStreamStart() {
        val current = _uiState.value
        _uiState.value = current.copy(messages = startAssistantMessage(current.messages, nextId()))
    }

    /** The `meta` frame arrived: patch citations/deferred/route/lifeSafety onto the placeholder. */
    fun onStreamMeta(
        citations: List<Citation>,
        deferred: Boolean,
        route: AssistantRoute?,
        lifeSafety: String?,
    ) {
        val current = _uiState.value
        _uiState.value = current.copy(
            messages = applyStreamMeta(current.messages, citations, deferred, route, lifeSafety),
        )
    }

    /** A `delta` frame arrived: append its text to the in-progress answer. */
    fun onStreamDelta(text: String) {
        val current = _uiState.value
        _uiState.value = current.copy(messages = appendDelta(current.messages, text))
    }

    /** The leakage guardrail tripped: replace the in-progress answer with the refusal. */
    fun onStreamRetract(content: String) {
        val current = _uiState.value
        _uiState.value = current.copy(messages = retractLast(current.messages, content))
    }

    /** The stream finished successfully: clear loading. */
    fun onStreamDone() {
        _uiState.value = _uiState.value.copy(loading = false)
    }

    /** Surface an error and clear loading; the user's message stays in the thread. */
    fun onError(message: String) {
        _uiState.value = _uiState.value.copy(loading = false, error = message)
    }
}
