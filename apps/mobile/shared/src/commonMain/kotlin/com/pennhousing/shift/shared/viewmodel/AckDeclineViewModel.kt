package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.ack.AckPhase
import com.pennhousing.shift.shared.ack.ackDeadline
import com.pennhousing.shift.shared.ack.canRespondToFloat
import com.pennhousing.shift.shared.ack.isPastAckDeadline
import com.pennhousing.shift.shared.model.FloatAck
import com.pennhousing.shift.shared.model.House
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

data class AckDeclineUiState(
    val floatId: String,
    val destinationHouse: House,
    val floatStart: Instant,
    val deadline: Instant,
    val phase: AckPhase,
    val canRespond: Boolean,
    val modalVisible: Boolean,
)

/**
 * Phase 13a — the float ack/decline modal ViewModel (BEHAVIORAL_SPECIFICATION.md
 * §7.1 / §7.2). Thin `StateFlow` wrapper over the pure `ack/` deadline logic, in
 * the [MainViewModel] shape (synchronous, no `viewModelScope`).
 *
 * Phase machine (decision #16): PENDING → ACKNOWLEDGED | DECLINED |
 * DEADLINE_PASSED. Terminal states never change — an ACKNOWLEDGED float stays
 * acknowledged after the deadline, and a second response returns false. `now` is
 * injected on construction (the load instant) and on every action (decision #17).
 */
class AckDeclineViewModel(
    private val float: FloatAck,
    now: Instant,
) : ViewModel() {
    private val _uiState = MutableStateFlow(stateFor(initialPhase(now)))
    val uiState: StateFlow<AckDeclineUiState> = _uiState.asStateFlow()

    private fun initialPhase(now: Instant): AckPhase =
        if (isPastAckDeadline(float.floatStart, now)) AckPhase.DEADLINE_PASSED else AckPhase.PENDING

    private fun stateFor(phase: AckPhase): AckDeclineUiState =
        AckDeclineUiState(
            floatId = float.floatId,
            destinationHouse = float.destinationHouse,
            floatStart = float.floatStart,
            deadline = ackDeadline(float.floatStart),
            phase = phase,
            canRespond = phase == AckPhase.PENDING,
            modalVisible = true,
        )

    /** Re-resolve PENDING → DEADLINE_PASSED at the deadline; terminal states are stable. */
    fun refresh(now: Instant) {
        if (_uiState.value.phase == AckPhase.PENDING && isPastAckDeadline(float.floatStart, now)) {
            _uiState.value = stateFor(AckPhase.DEADLINE_PASSED)
        }
    }

    /** True iff this transitioned the modal to ACKNOWLEDGED (§7.1). */
    fun acknowledge(now: Instant): Boolean = respond(now, AckPhase.ACKNOWLEDGED)

    /** True iff this transitioned the modal to DECLINED — declining voids the float (§7.2). */
    fun decline(now: Instant): Boolean = respond(now, AckPhase.DECLINED)

    private fun respond(
        now: Instant,
        target: AckPhase,
    ): Boolean {
        if (_uiState.value.phase != AckPhase.PENDING) return false // terminal — idempotent
        return if (canRespondToFloat(float.floatStart, now)) {
            _uiState.value = stateFor(target)
            true
        } else {
            // The deadline passed before the worker acted: disable the modal.
            _uiState.value = stateFor(AckPhase.DEADLINE_PASSED)
            false
        }
    }
}
