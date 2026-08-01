package com.pennhousing.shift.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
import com.pennhousing.shift.shared.data.HouseHoursResult
import com.pennhousing.shift.shared.manager.hours.AwayShift
import com.pennhousing.shift.shared.manager.hours.WorkerHoursRow
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/*
 * The manager Hours tab (docs/manager-app/SPEC.md §6.5).
 *
 * The question this screen answers is "who can I give these hours to, and can I trust this
 * number" — so the roster sorts by hours held descending, and EVERY row shows its total, its
 * home-desk hours, and a chip for every shift worked away from the home desk, with NO tap
 * required to see any of it. A manager auditing a house's hours cannot afford to open every
 * worker individually; that defeats the point of a roster view.
 *
 * Each away-shift chip is itself a verification tool: tapping "Lauder · Wed 14:00-16:00" opens
 * that house's live calendar on that week so the manager can independently confirm the shift
 * happened, rather than trusting the number alone. This IS the mechanism (2026-07-29
 * stakeholder decision) — do not regress this back behind an expand/collapse. The Hours report
 * covers the current week only (SPEC §6.5 open question #4), which is why a chip navigates
 * with no week offset: `HouseScheduleViewModel.selectHouse` resets to the current week, which
 * always matches this report's week.
 *
 * All arithmetic and ordering is in the pure `manager/hours/HouseHours.kt`. This file renders.
 */

internal object HoursTags {
    const val SCREEN = "hours_screen"
    const val LIST = "hours_list"
    const val EMPTY = "hours_empty"
    const val ROW = "hours_row"
    const val STATS = "hours_stats"
    const val AWAY_SHIFT = "hours_away_shift"
    const val PARTIAL_NOTE = "hours_partial_note"
    const val TOTAL = "hours_total"
}

@Composable
internal fun HoursScreen(
    result: HouseHoursResult?,
    /**
     * Verify a worker's away shift: open the House tab on [houseId]'s current-week calendar.
     * No-op default so demo/test call sites that do not care are unaffected.
     */
    onOpenHouseCalendar: (houseId: String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Column(modifier.fillMaxWidth().testTag(HoursTags.SCREEN)) {
        PageTitle("Hours")

        if (result == null) {
            EmptyState(
                title = "Loading hours",
                icon = ShiftIcons.Clock,
                modifier = Modifier.testTag(HoursTags.EMPTY),
            )
            return@Column
        }

        val report = result.report

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(report.houseName, color = c.ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(report.weekLabel, color = c.sec, fontSize = 13.sp, modifier = Modifier.weight(1f))
            Text(
                report.totalLabel,
                color = c.ink,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.testTag(HoursTags.TOTAL),
            )
        }

        // An SM's token cannot read another house's assignments, so their breakdown genuinely
        // cannot show away shifts. Say so, rather than rendering a list that looks complete.
        if (result.partial) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(c.surfaceVar)
                    .padding(10.dp)
                    .testTag(HoursTags.PARTIAL_NOTE),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(ShiftIcons.Info, contentDescription = null, tint = c.sec, modifier = Modifier.size(16.dp))
                Text("Shifts at your house only.", color = c.sec, fontSize = 12.5.sp)
            }
        }

        if (report.isEmpty) {
            EmptyState(
                title = "No workers at this house",
                icon = ShiftIcons.Person,
                body = "Nobody is on the roster for this week.",
                modifier = Modifier.testTag(HoursTags.EMPTY),
            )
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().testTag(HoursTags.LIST),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(report.rows, key = { it.userId }) { row -> WorkerRow(row, onOpenHouseCalendar) }
            }
        }
    }
}

@Composable
private fun WorkerRow(
    row: WorkerHoursRow,
    onOpenHouseCalendar: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = if (row.isAtCap) c.danger.accent else c.success.accent

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(13.dp)
            .testTag(HoursTags.ROW),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(row.name, color = c.ink, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Text(row.capLabel, color = if (row.isAtCap) accent else c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
        }

        // The cap meter. Reads as "how much room is left", which is the manager's question.
        row.capFraction?.let { fraction ->
            Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(999.dp)).background(c.surfaceVar)) {
                Box(
                    Modifier
                        .fillMaxWidth(fraction.toFloat())
                        .height(5.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(accent),
                )
            }
        }

        row.remainingHours?.let { remaining ->
            Text(
                if (row.isAtCap) {
                    "At the cap. No room this week."
                } else {
                    "${com.pennhousing.shift.shared.manager.hours.hoursLabel(remaining)} of room left"
                },
                color = if (row.isAtCap) accent else c.ter,
                fontSize = 12.sp,
            )
        }

        // Total / home / away, ALWAYS visible — no tap required. This is the number a manager
        // needs to sanity-check before they even look at the away shifts below.
        Row(
            Modifier.fillMaxWidth().testTag(HoursTags.STATS),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            StatPair("Total", row.totalLabel, c.ink)
            StatPair("Home desk", row.homeLabel, c.sec)
            if (row.awayShifts.isNotEmpty()) StatPair("Away", row.awayLabel, c.sec)
        }

        // Every away shift, as a tappable chip — visible directly in the roster, never behind
        // an expand. Tapping one opens that house's live calendar so the manager can verify
        // the shift independently rather than trusting the number alone.
        if (row.awayShifts.isNotEmpty()) {
            FlowRow(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                row.awayShifts.forEach { shift -> AwayShiftChip(shift, onOpenHouseCalendar) }
            }
        }
    }
}

@Composable
private fun StatPair(
    label: String,
    value: String,
    valueColor: Color,
) {
    val c = ShiftTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(label, color = c.ter, fontSize = 11.sp)
        Text(value, color = valueColor, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}

/**
 * "Lauder · Wed 14:00 to 16:00 · 2h" — one verifiable away shift.
 *
 * A chip, not a full-width row, because the roster needs to hold several of these per worker
 * without dominating the screen; [FlowRow] wraps them onto as many lines as needed. Tapping
 * opens the house's own calendar (see the file header) — the arrow icon signals that this is a
 * link out, not just a label.
 */
@Composable
private fun AwayShiftChip(
    shift: AwayShift,
    onOpenHouseCalendar: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(c.surfaceVar)
            .clickable { onOpenHouseCalendar(shift.houseId) }
            .padding(horizontal = 10.dp, vertical = 7.dp)
            .testTag(HoursTags.AWAY_SHIFT),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(shift.houseName, color = c.ink, fontSize = 12.5.sp, fontWeight = FontWeight.Bold)
                Text("·", color = c.ter, fontSize = 11.5.sp)
                Text(shift.kindLabel, color = c.sec, fontSize = 11.5.sp)
            }
            Text(
                "${shift.dayLabel}, ${shift.timeLabel}  ·  ${shift.durationLabel}",
                color = c.sec,
                fontSize = 11.5.sp,
            )
        }
        Icon(
            ShiftIcons.ChevronRight,
            contentDescription = "Verify at ${shift.houseName}",
            tint = c.ter,
            modifier = Modifier.size(13.dp),
        )
    }
}

/**
 * Shown when a manager-only destination is reached by somebody who is not a manager.
 *
 * This is not defensive paranoia. Navigation 3 serializes the back stack across process death,
 * so a manager whose role was revoked between launches lands here, and a blank screen would look
 * like a broken app rather than a changed permission.
 */
@Composable
internal fun NotAManagerPlaceholder(
    surface: String,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        title = "$surface is for managers",
        icon = ShiftIcons.Lock,
        body = "Your account does not have access to this. If that looks wrong, contact your Housing Manager.",
        modifier = modifier.testTag("not_a_manager_placeholder"),
    )
}
