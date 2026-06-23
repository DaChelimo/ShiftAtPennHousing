package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.ack.FloatRequestCard
import com.pennhousing.shift.shared.ack.buildFloatRequestCards
import com.pennhousing.shift.shared.model.PendingFloat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class FloatCarouselUiState(
    /** The still-unresolved cards, closest-start first. Empty → the carousel hides. */
    val cards: List<FloatRequestCard>,
    /** How many floats the worker started this session with (for "1 of 3" style copy). */
    val total: Int,
    /**
     * True on the transition that resolved the LAST outstanding float (and only when
     * there was at least one) — the host shows the "all handled" confirmation snackbar.
     * Stays true until the VM is rebuilt from a fresh (now-empty) snapshot, so a boolean
     * key in the UI fires the snackbar exactly once (false → true).
     */
    val allHandled: Boolean,
)

/**
 * Phase 13a — the My-Shifts float-request carousel ViewModel. Thin synchronous
 * `StateFlow` wrapper (the [MainViewModel] shape — no `viewModelScope`) over the pure
 * `buildFloatRequestCards` logic.
 *
 * Accept and Decline are the SAME local move — drop the card and advance to the next
 * closest float; the actual `acknowledge-float` / `decline-float` POST is the host's
 * (best-effort), exactly like the ack hero. `now` is injected on construction (the
 * load instant); the cards' respondable/deadline state is decided once.
 */
class FloatCarouselViewModel(
    floats: List<PendingFloat>,
    now: Instant,
) : ViewModel() {
    private val initialCards = buildFloatRequestCards(floats, now)
    private val resolved = mutableSetOf<String>()

    private val _uiState = MutableStateFlow(stateNow())
    val uiState: StateFlow<FloatCarouselUiState> = _uiState.asStateFlow()

    private fun stateNow(): FloatCarouselUiState =
        FloatCarouselUiState(
            cards = initialCards.filter { it.floatId !in resolved },
            total = initialCards.size,
            allHandled = initialCards.isNotEmpty() && resolved.size >= initialCards.size,
        )

    /** Drop [floatId] from the stack and advance; idempotent. */
    fun resolve(floatId: String) {
        if (resolved.add(floatId)) _uiState.value = stateNow()
    }

    /** Worker accepted [floatId] — local advance (host POSTs `acknowledge-float`). */
    fun acknowledge(floatId: String) = resolve(floatId)

    /** Worker declined [floatId] — local advance (host POSTs `decline-float`). */
    fun decline(floatId: String) = resolve(floatId)
}
