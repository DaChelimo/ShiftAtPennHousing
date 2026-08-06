package com.pennhousing.shift.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.manager.coverage.CoverageCard
import com.pennhousing.shift.shared.manager.coverage.CoverageOutcome
import com.pennhousing.shift.shared.manager.coverage.CoverageRequestState
import com.pennhousing.shift.shared.manager.coverage.outcomeLabel
import com.pennhousing.shift.shared.viewmodel.CoverageUiState
import com.pennhousing.shift.shared.viewmodel.RespondSheetState
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/*
 * The Coverage tab (BSpec §5.4a; docs/manager-app/SPEC.md §6.1) — the manager surface this
 * app exists for. When the escalation chain runs out of internal options, a desk goes empty
 * unless a human procures Allied, and this is where that human acts.
 *
 * This file renders only. Every decision (which requests appear, in what order, what state
 * each is in, whether a note is required, whether the banner shows) is made by the pure
 * `manager/coverage/Coverage.kt` and `viewmodel/CoverageViewModel.kt` in :shared, and is
 * tested there. If you find yourself writing a condition about time or eligibility in this
 * file, it belongs one layer down.
 */

/** Selector contract for the UI tests. Kept in one place so a rename cannot silently drift. */
internal object CoverageTags {
    const val SCREEN = "coverage_screen"
    const val LIST = "coverage_list"
    const val EMPTY = "coverage_empty"
    const val BANNER = "coverage_banner"
    const val CARD = "coverage_card"
    const val SHEET = "coverage_respond_sheet"
    const val CALL_ALLIED = "coverage_call_allied"
    const val COVER_IT = "coverage_cover_it"
    const val OTHER_OUTCOMES = "coverage_other_outcomes"
    const val NOTE_FIELD = "coverage_note"
    const val SUBMIT = "coverage_submit"
    const val NOT_YET = "coverage_not_yet"
    const val ALREADY_HANDLED = "coverage_already_handled"

    fun outcome(outcome: CoverageOutcome): String = "coverage_outcome_${outcome.wire}"
}

/**
 * The whole Coverage tab.
 *
 * [onRespond] is called with a request id when the manager taps a card. IT ACKNOWLEDGES: the
 * host fires the acknowledge write and the ViewModel has already flipped local state, so the
 * ladder and the reminders stop the moment a human looks at the request. That is deliberate
 * and is the single most important behaviour on this screen.
 */
@Composable
internal fun CoverageScreen(
    state: CoverageUiState,
    onRespond: (String) -> Unit,
    onSelectOutcome: (CoverageOutcome) -> Unit,
    onCoverPersonally: () -> Unit,
    onNoteChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onDismissSheet: () -> Unit,
    onCallAllied: (String?) -> Unit,
    onClearAlreadyHandled: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Column(modifier.fillMaxSize().background(c.bg).testTag(CoverageTags.SCREEN)) {
        PageTitle("Coverage")

        if (state.feed.isEmpty) {
            EmptyState(
                title = "All clear. No coverage needed.",
                icon = ShiftIcons.CheckCircle,
                body = "You will be alerted here, and on your phone, the moment a desk needs Allied.",
                modifier = Modifier.testTag(CoverageTags.EMPTY),
            )
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().testTag(CoverageTags.LIST),
                contentPadding = androidx.compose.foundation.layout
                    .PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.feed.cards, key = { it.requestId }) { card ->
                    CoverageRequestCard(card = card, onClick = { onRespond(card.requestId) })
                }
            }
        }

        // A colleague resolved the request first, or a duplicate push replayed. Informational,
        // not an error: the manager should feel relief, not failure.
        state.alreadyHandledMessage?.let { message ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.surfaceVar)
                    .clickable(onClick = onClearAlreadyHandled)
                    .padding(12.dp)
                    .testTag(CoverageTags.ALREADY_HANDLED),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(ShiftIcons.Info, contentDescription = null, tint = c.sec, modifier = Modifier.size(18.dp))
                Text(message, color = c.sec, fontSize = 13.5.sp)
            }
        }
    }

    state.sheet?.let { sheet ->
        RespondSheet(
            sheet = sheet,
            onSelectOutcome = onSelectOutcome,
            onCoverPersonally = onCoverPersonally,
            onNoteChange = onNoteChange,
            onSubmit = onSubmit,
            onDismiss = onDismissSheet,
            onCallAllied = { onCallAllied(sheet.card.deskPhone) },
        )
    }
}

/**
 * The app-wide banner, shown on EVERY screen while a covered house has an unacknowledged
 * request (SPEC §6.1). Not dismissable, by design: an open request never clears itself.
 *
 * It downgrades to the tab badge alone once acknowledged, so a manager who has said "I've got
 * this" is not nagged on every screen while they are on the phone to Allied. That downgrade
 * is not a condition here; it falls out of `CoverageFeed.showsBanner` counting only
 * action-required requests.
 */
@Composable
internal fun CoverageBanner(
    count: Int,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .background(c.danger.tint)
            .clickable(onClick = onOpen)
            .padding(horizontal = 16.dp, vertical = 11.dp)
            .testTag(CoverageTags.BANNER),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(ShiftIcons.Warning, contentDescription = null, tint = c.danger.accent, modifier = Modifier.size(19.dp))
        Text(
            if (count == 1) "A desk needs Allied coverage" else "$count desks need Allied coverage",
            color = c.danger.deep,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Text("Respond", color = c.danger.accent, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
    }
}

/**
 * One request card. Overdue wears the danger state, an open request the caution state, and an
 * acknowledged one drops to a neutral surface, because it is no longer asking anything of the
 * reader.
 */
@Composable
private fun CoverageRequestCard(
    card: CoverageCard,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val overdue = card.state == CoverageRequestState.OVERDUE
    val acknowledged = card.state == CoverageRequestState.ACKNOWLEDGED
    val accent: Color =
        when {
            overdue -> c.danger.accent
            acknowledged -> c.success.accent
            else -> c.allied.accent
        }
    val fill: Color =
        when {
            overdue -> c.danger.tint
            acknowledged -> c.surface
            else -> c.warnSoft
        }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(fill)
            .border(1.dp, accent.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(14.dp)
            .testTag(CoverageTags.CARD),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(card.houseName, color = c.ink, fontSize = 16.5.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            StatusPill(card = card, accent = accent)
        }

        Text(
            "${card.windowLabel}  ·  ${card.hoursLabel}",
            color = c.ink,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
        )
        Text(card.reasonLabel, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)

        Spacer(Modifier.size(2.dp))

        // Who holds it, and what happens next. On the terminal rung the countdown says
        // "No further escalation" instead, which is the honest thing to tell someone who is
        // the last line: nobody is coming after them.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(ShiftIcons.Person, contentDescription = null, tint = c.ter, modifier = Modifier.size(15.dp))
            Text(card.rungLabel, color = c.sec, fontSize = 12.5.sp)
            card.countdownLabel?.let {
                Text("·", color = c.ter, fontSize = 12.5.sp)
                Text(
                    it,
                    color = if (card.isTerminalRung) c.ter else accent,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun StatusPill(
    card: CoverageCard,
    accent: Color,
) {
    val c = ShiftTheme.colors
    val label =
        when (card.state) {
            CoverageRequestState.OVERDUE -> "Overdue"
            CoverageRequestState.ACKNOWLEDGED -> "You have this"
            CoverageRequestState.AWAITING_ACK -> "Needs Allied"
            // Never rendered: closed requests are dropped from the feed.
            CoverageRequestState.CLOSED -> card.outcomeLabel ?: "Closed"
        }
    Box(
        Modifier.clip(RoundedCornerShape(999.dp)).background(accent.copy(alpha = 0.16f)).padding(horizontal = 9.dp, vertical = 3.dp),
    ) {
        Text(label, color = accent, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
    }
    if (card.isMissedCoverageIncident) {
        Icon(ShiftIcons.Warning, contentDescription = null, tint = c.danger.accent, modifier = Modifier.size(15.dp))
    }
}

/**
 * The Respond sheet — ONE job, presented as one job.
 *
 * The manager never reads "acknowledge" or "close out". Opening this sheet already
 * acknowledged the request; what they see is: call Allied, then tell us how it went. The
 * two-state record survives underneath (see the header comment on
 * `manager/coverage/Coverage.kt`), because the outcome is not known until the call connects.
 *
 * "Not yet" leaves without an outcome. The request stays acknowledged and open, and remains in
 * the list, because an open request never clears itself.
 */
@Composable
private fun RespondSheet(
    sheet: RespondSheetState,
    onSelectOutcome: (CoverageOutcome) -> Unit,
    onCoverPersonally: () -> Unit,
    onNoteChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onDismiss: () -> Unit,
    onCallAllied: () -> Unit,
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, modifier = Modifier.testTag(CoverageTags.SHEET)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(sheet.card.houseName, color = c.ink, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            Text(
                "${sheet.card.windowLabel}  ·  ${sheet.card.hoursLabel}",
                color = c.ink,
                fontSize = 14.5.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(sheet.card.reasonLabel, color = c.sec, fontSize = 13.sp, lineHeight = 18.sp)

            // 1. Get coverage. Roughly 80% of the time an RSM covers it themselves and 20%
            // it goes to Allied, so the two actions sit at EQUAL weight — neither is the
            // fallback for the other. Both record their outcome immediately: there is
            // nothing left to confirm once the manager has committed to one.
            SectionHeader("Get coverage")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ShiftButton(
                    text = "I can cover it",
                    onClick = {
                        onSelectOutcome(CoverageOutcome.COVERED_INTERNALLY)
                        onSubmit()
                    },
                    modifier = Modifier.weight(1f).testTag(CoverageTags.COVER_IT),
                    variant = ButtonVariant.Success,
                    size = ButtonSize.Lg,
                    icon = ShiftIcons.Person,
                )
                ShiftButton(
                    text = sheet.card.deskPhone?.let { "Call Allied ($it)" } ?: "Call Allied",
                    onClick = onCallAllied,
                    modifier = Modifier.weight(1f).testTag(CoverageTags.CALL_ALLIED),
                    size = ButtonSize.Lg,
                    icon = ShiftIcons.Phone,
                )
            }

            // 2. What happened. One flat, organized list of the remaining outcomes — no
            // separate confirm button plus a buried "something else" list to parse.
            SectionHeader("What happened", modifier = Modifier.testTag(CoverageTags.OTHER_OUTCOMES))

            OTHER_OUTCOMES.forEach { outcome ->
                val selected = sheet.selectedOutcome == outcome
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(11.dp))
                        .background(if (selected) c.surfaceVar else Color.Transparent)
                        .border(
                            1.dp,
                            if (selected) c.outline else c.divider,
                            RoundedCornerShape(11.dp),
                        ).clickable { onSelectOutcome(outcome) }
                        .padding(horizontal = 12.dp, vertical = 11.dp)
                        .testTag(CoverageTags.outcome(outcome)),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        outcomeLabel(outcome),
                        color = c.ink,
                        fontSize = 14.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.weight(1f),
                    )
                    if (selected) {
                        Icon(ShiftIcons.Check, contentDescription = null, tint = c.success.accent, modifier = Modifier.size(17.dp))
                    }
                }
            }

            // Only "Desk went unstaffed" asks for a note, and the submit stays disabled until
            // there is one. An unexplained incident is the row nobody can act on later.
            if (sheet.noteRequired) {
                OutlinedTextField(
                    value = sheet.note,
                    onValueChange = onNoteChange,
                    label = { Text("What happened?") },
                    modifier = Modifier.fillMaxWidth().testTag(CoverageTags.NOTE_FIELD),
                    minLines = 2,
                )
            }

            if (sheet.selectedOutcome != null) {
                ShiftButton(
                    text = "Record and close",
                    onClick = onSubmit,
                    fullWidth = true,
                    enabled = sheet.canSubmit,
                    loading = sheet.submitting,
                    modifier = Modifier.testTag(CoverageTags.SUBMIT),
                )
            }

            ShiftButton(
                text = "Not yet",
                onClick = onDismiss,
                fullWidth = true,
                variant = ButtonVariant.Text,
                modifier = Modifier.testTag(CoverageTags.NOT_YET),
            )
            Spacer(Modifier.size(6.dp))
        }
    }
}

/**
 * The three outcomes left once "I can cover it" is out of the way, in the order a manager
 * is likely to need them. `COVERED_INTERNALLY` is deliberately NOT here: it is recorded
 * directly by the "I can cover it" action above.
 */
private val OTHER_OUTCOMES =
    listOf(
        CoverageOutcome.ALLIED_SECURED,
        CoverageOutcome.DESK_UNSTAFFED,
        CoverageOutcome.NO_LONGER_NEEDED,
    )
