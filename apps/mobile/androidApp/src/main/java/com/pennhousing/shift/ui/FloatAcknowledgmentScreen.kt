package com.pennhousing.shift.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.ack.AckPhase
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import kotlin.time.Clock

/**
 * Phase 13a — the float ack/decline modal (BEHAVIORAL_SPECIFICATION.md §7.1/§7.2,
 * deliverable #4). Renders the [AckDeclineViewModel] state: float details, the
 * T-10m acknowledgment deadline, and Acknowledge / Decline buttons that disable
 * once the deadline passes. The action instant is the wall clock at tap time —
 * the ViewModel re-checks it against the deadline (the pure decision surface).
 */
@Composable
fun FloatAcknowledgmentModal(
    ackVm: AckDeclineViewModel,
    onClose: () -> Unit,
) {
    val state by ackVm.uiState.collectAsStateWithLifecycle()

    Dialog(onDismissRequest = onClose) {
        Surface(
            shape = MaterialTheme.shapes.large,
            tonalElevation = 6.dp,
            modifier = Modifier.testTag("ack_modal"),
        ) {
            Column(
                modifier = Modifier.padding(20.dp).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Float assignment", style = MaterialTheme.typography.titleLarge)
                Text("Destination: ${state.destinationHouse.name}")
                Text("Float starts: ${state.floatStart}")
                Text("Acknowledge by: ${state.deadline}")

                when (state.phase) {
                    AckPhase.ACKNOWLEDGED ->
                        Text("Acknowledged ✓", modifier = Modifier.testTag("ack_success"))
                    AckPhase.DECLINED ->
                        Text("Declined — the float was voided.")
                    AckPhase.DEADLINE_PASSED ->
                        Text("Deadline passed", modifier = Modifier.testTag("ack_deadline_passed"))
                    AckPhase.PENDING ->
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Button(
                                onClick = { ackVm.acknowledge(Clock.System.now()) },
                                enabled = state.canRespond,
                                modifier = Modifier.testTag("ack_button"),
                            ) { Text("Acknowledge") }
                            OutlinedButton(
                                onClick = { ackVm.decline(Clock.System.now()) },
                                enabled = state.canRespond,
                                modifier = Modifier.testTag("decline_button"),
                            ) { Text("Decline") }
                        }
                }
            }
        }
    }
}
