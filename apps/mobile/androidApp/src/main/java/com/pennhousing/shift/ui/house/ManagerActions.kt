package com.pennhousing.shift.ui.house

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.house.HouseGridBlock
import com.pennhousing.shift.shared.manager.AssignAdvisory
import com.pennhousing.shift.shared.manager.RosterWorker
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/** A soft-advisory confirm in flight: re-submit [block] for [worker] with `override = true`. */
internal data class AssignConfirmState(
    val block: HouseGridBlock,
    val worker: RosterWorker,
    val advisories: List<AssignAdvisory>,
)

/**
 * The two-option chooser for a tapped OPEN seat: assign a specific worker, or ask the
 * system to find coverage now (force a float lookup). A thin bottom sheet with the house +
 * time range as context.
 */
@Composable
internal fun ManagerActionSheet(
    houseName: String,
    block: HouseGridBlock,
    onAssign: () -> Unit,
    onForce: () -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, title = "Open seat") {
        Column(
            Modifier.fillMaxWidth().testTag("house_manage_sheet"),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("$houseName · ${block.timeLabel}", color = c.sec, fontSize = 14.sp)
            ShiftButton(
                "Assign a worker",
                onClick = onAssign,
                modifier = Modifier.fillMaxWidth().testTag("house_assign_worker_option"),
                icon = ShiftIcons.Plus,
                fullWidth = true,
            )
            ShiftButton(
                "Get coverage now",
                onClick = onForce,
                modifier = Modifier.fillMaxWidth().testTag("house_force_trigger"),
                variant = ButtonVariant.Outlined,
                fullWidth = true,
            )
        }
    }
}

/**
 * The add-a-worker roster picker (BSpec §2.2): the house's own workers, name-searchable.
 * Tapping a worker assigns them to the vacant run; the server owns the hard cap and the
 * soft-advisory confirm (handled by the caller via [onPick]'s outcome).
 */
@Composable
internal fun AssignWorkerSheet(
    houseName: String,
    block: HouseGridBlock,
    roster: List<RosterWorker>,
    loading: Boolean,
    search: String,
    onSearch: (String) -> Unit,
    onPick: (RosterWorker) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    val filtered =
        remember(roster, search) {
            if (search.isBlank()) roster else roster.filter { it.name.contains(search.trim(), ignoreCase = true) }
        }
    ShiftBottomSheet(onDismiss = onDismiss, title = "Assign worker") {
        Column(
            Modifier.fillMaxWidth().testTag("house_assign_sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("$houseName · ${block.timeLabel}", color = c.sec, fontSize = 14.sp)
            RosterSearchField(value = search, onValue = onSearch)
            when {
                loading -> Text("Loading workers.", color = c.ter, fontSize = 14.sp)
                filtered.isEmpty() ->
                    Text(
                        if (roster.isEmpty()) "No workers to assign." else "No workers match your search.",
                        color = c.ter,
                        fontSize = 14.sp,
                    )
                else ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        filtered.forEach { worker ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(c.surface)
                                    .border(1.dp, c.divider, RoundedCornerShape(12.dp))
                                    .clickable { onPick(worker) }
                                    .padding(horizontal = 13.dp, vertical = 12.dp)
                                    .testTag("house_assign_worker_row"),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                HouseBadge(worker.name.take(1), c.surfaceVar, c.ink)
                                Text(
                                    worker.name,
                                    color = c.ink,
                                    fontSize = 14.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.weight(1f),
                                )
                                Icon(ShiftIcons.ChevronRight, contentDescription = null, tint = c.ter, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
            }
        }
    }
}

/** A styled search field for the assign-worker roster picker (filters by worker name). */
@Composable
internal fun RosterSearchField(
    value: String,
    onValue: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(c.surfaceVar)
            .border(BorderStroke(1.dp, c.divider), RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp)
            .testTag("house_assign_search"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Search, contentDescription = null, tint = c.ter, modifier = Modifier.size(18.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text("Search workers", color = c.ter, fontSize = 14.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                modifier = Modifier.fillMaxWidth().testTag("house_assign_search_field"),
                singleLine = true,
                textStyle = TextStyle(color = c.ink, fontSize = 14.sp),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                ShiftIcons.Close,
                contentDescription = "Clear",
                tint = c.sec,
                modifier = Modifier.size(18.dp).clip(RoundedCornerShape(50)).clickable { onValue("") },
            )
        }
    }
}

// ===================================================================
// Drop flow (§5.2) — occurrence vs permanent, short-notice warning.
// ===================================================================
