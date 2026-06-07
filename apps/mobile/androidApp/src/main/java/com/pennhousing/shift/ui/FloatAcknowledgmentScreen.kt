package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.ack.AckPhase
import com.pennhousing.shift.shared.ack.FloatAckHero
import com.pennhousing.shift.shared.ack.floatAckHero
import com.pennhousing.shift.shared.viewmodel.AckDeclineUiState
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.CountdownChip
import com.pennhousing.shift.ui.kit.CountdownTone
import com.pennhousing.shift.ui.kit.KeyValueRow
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlin.time.Clock

/**
 * Phase 13a — the Float Acknowledgment hero (BEHAVIORAL_SPECIFICATION.md §7.1/§7.2,
 * deliverable #4). The design's "launched from Updates" sheet variant
 * (worker-app.html `FloatAckSheet`/`FloatBody`): a centred float-out hero, the
 * Desk/When/Starts-in card, the "your weekly hours don't change" reassurance
 * (invariant #4), and a phase-driven countdown / status + actions. All copy +
 * formatting comes from the shared, tested [floatAckHero]; this is native Compose
 * over the existing [AckDeclineViewModel] (no VM/data change). The action instant is
 * the wall clock at tap time — the ViewModel re-checks it against the T-10m deadline.
 */
@Composable
fun FloatAcknowledgmentModal(
    ackVm: AckDeclineViewModel,
    onClose: () -> Unit,
) {
    val state by ackVm.uiState.collectAsStateWithLifecycle()
    // The screen's load instant — drives the static "starts in" + countdown (the kit
    // never ticks a clock; the snapshot ViewModel is decided once, decision #17).
    val now = remember { Clock.System.now() }
    val hero =
        remember(state, now) {
            floatAckHero(state.phase, state.destinationHouse.name, state.floatStart, state.deadline, now)
        }

    ShiftBottomSheet(onDismiss = onClose) {
        Column(
            Modifier.fillMaxWidth().testTag("ack_modal"),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            HeroHeader(state.phase, hero)
            DetailCard(state, hero)
            HoursReassuranceBanner()
            StatusOrCountdown(state.phase, hero)
            ActionButtons(
                state = state,
                onAck = { ackVm.acknowledge(Clock.System.now()) },
                onDecline = { ackVm.decline(Clock.System.now()) },
                onClose = onClose,
            )
        }
    }
}

@Composable
private fun HeroHeader(
    phase: AckPhase,
    hero: FloatAckHero,
) {
    val c = ShiftTheme.colors
    val acked = phase == AckPhase.ACKNOWLEDGED
    // worker-app.html `FloatBody`: float-OUT (purple) treatment — you're sent out.
    val circleBg =
        when (phase) {
            AckPhase.ACKNOWLEDGED -> c.success.tint
            AckPhase.PENDING -> c.floatOut.tint
            else -> c.surfaceVar
        }
    val icon: ImageVector =
        when (phase) {
            AckPhase.ACKNOWLEDGED -> ShiftIcons.Check
            AckPhase.DECLINED -> ShiftIcons.Close
            AckPhase.DEADLINE_PASSED -> ShiftIcons.Clock
            AckPhase.PENDING -> ShiftIcons.FloatOut
        }
    val iconTint =
        when (phase) {
            AckPhase.ACKNOWLEDGED -> c.success.accent
            AckPhase.DECLINED -> c.sec
            AckPhase.DEADLINE_PASSED -> c.ter
            AckPhase.PENDING -> c.floatOut.accent
        }
    val eyebrowColor = if (acked) c.success.accent else c.floatOut.accent

    Column(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.size(60.dp).clip(RoundedCornerShape(50)).background(circleBg),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(28.dp))
        }
        Text(
            hero.eyebrow.uppercase(),
            color = eyebrowColor,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.06.em,
        )
        Text(
            hero.headline,
            color = c.ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.02).em,
            lineHeight = 30.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun DetailCard(
    state: AckDeclineUiState,
    hero: FloatAckHero,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp),
    ) {
        KeyValueRow(
            label = "Desk",
            trailing = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(
                        Modifier.size(26.dp).clip(RoundedCornerShape(8.dp)).background(c.floatOut.badge),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            state.destinationHouse.name
                                .take(1)
                                .uppercase(),
                            color = c.floatOut.deep,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Text(state.destinationHouse.name, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            },
        )
        KeyValueRow(label = "When", trailing = { Text(hero.whenLabel, style = ShiftTheme.type.monoTime, color = c.ink) })
        KeyValueRow(
            label = "Starts in",
            last = true,
            trailing = { Text(hero.startsInLabel, style = ShiftTheme.type.monoTime, color = c.ink) },
        )
    }
}

/** The §6.1 / invariant-#4 reassurance — a float relocates hours, never adds them. */
@Composable
private fun HoursReassuranceBanner() {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.floatOut.tint)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(ShiftIcons.Info, contentDescription = null, tint = c.floatOut.accent, modifier = Modifier.size(18.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("Your weekly hours don't change.") }
                append(" A float moves an already-scheduled shift — it never adds hours.")
            },
            color = c.floatOut.deep,
            fontSize = 13.sp,
            lineHeight = 19.sp,
        )
    }
}

@Composable
private fun StatusOrCountdown(
    phase: AckPhase,
    hero: FloatAckHero,
) {
    val c = ShiftTheme.colors
    when (phase) {
        AckPhase.PENDING ->
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                CountdownChip(
                    hero.countdownLabel.orEmpty(),
                    tone = if (hero.countdownUrgent) CountdownTone.Urgent else CountdownTone.Normal,
                )
            }
        AckPhase.ACKNOWLEDGED -> StatusLine(hero.statusLine.orEmpty(), c.success.accent, Modifier.testTag("ack_success"))
        AckPhase.DECLINED -> StatusLine(hero.statusLine.orEmpty(), c.sec)
        AckPhase.DEADLINE_PASSED -> StatusLine(hero.statusLine.orEmpty(), c.ter, Modifier.testTag("ack_deadline_passed"))
    }
}

@Composable
private fun StatusLine(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        modifier = modifier.fillMaxWidth(),
        color = color,
        fontSize = 13.5.sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun ActionButtons(
    state: AckDeclineUiState,
    onAck: () -> Unit,
    onDecline: () -> Unit,
    onClose: () -> Unit,
) {
    if (state.phase == AckPhase.PENDING) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ShiftButton(
                "Acknowledge",
                onAck,
                modifier = Modifier.fillMaxWidth().testTag("ack_button"),
                variant = ButtonVariant.Filled,
                size = ButtonSize.Lg,
                icon = ShiftIcons.Check,
                enabled = state.canRespond,
                fullWidth = true,
            )
            ShiftButton(
                "Decline",
                onDecline,
                modifier = Modifier.fillMaxWidth().testTag("decline_button"),
                variant = ButtonVariant.Outlined,
                size = ButtonSize.Lg,
                enabled = state.canRespond,
                fullWidth = true,
            )
        }
    } else {
        ShiftButton(
            "Close",
            onClose,
            modifier = Modifier.fillMaxWidth(),
            variant = ButtonVariant.Tonal,
            size = ButtonSize.Lg,
            fullWidth = true,
        )
    }
}
