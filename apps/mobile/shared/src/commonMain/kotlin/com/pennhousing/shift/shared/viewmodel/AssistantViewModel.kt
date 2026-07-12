package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.assistant.AskResult
import com.pennhousing.shift.shared.assistant.AssistantMessage
import com.pennhousing.shift.shared.assistant.appendAssistantResult
import com.pennhousing.shift.shared.assistant.appendUserMessage
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
 * Desk Assistant chat ViewModel (V1_SCOPE §4). Thin synchronous StateFlow wrapper in
 * the [UpdatesViewModel] / [ShiftsScreenViewModel] shape: it emits synchronously (no
 * `viewModelScope`) so it runs on the JVM host without an Android runtime. The actual
 * da-ask network call is the data/UI layer's job (scoped out of tests); the host drives
 * this VM by calling [onUserSubmitted] then, when the EF returns, [onResult] or [onError].
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

    /** Append the assistant's answer and clear loading. */
    fun onResult(result: AskResult) {
        val current = _uiState.value
        _uiState.value = current.copy(
            messages = appendAssistantResult(current.messages, nextId(), result),
            loading = false,
        )
    }

    /** Surface an error and clear loading; the user's message stays in the thread. */
    fun onError(message: String) {
        _uiState.value = _uiState.value.copy(loading = false, error = message)
    }
}
