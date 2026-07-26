package com.pennhousing.shift.ui.manage

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
import androidx.compose.runtime.mutableStateOf
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
import com.pennhousing.shift.shared.swaps.HandoffWorker
import com.pennhousing.shift.shared.viewmodel.SwapCalendarUiState
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.Dimens
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * Hand-off (§8.5) recipient directory — replaces the swap calendar with a people picker:
 * a "My House" tab (the worker's own-house roster, flat) and an "Others" tab (every other
 * house, grouped + searchable, since 10+ houses × ~8 workers is too long to scan). Only
 * workers eligible to receive THIS shift are listed (the VM pre-filters via
 * `buildHandoffDirectory`); the server stays authoritative on create/accept.
 */
@Composable
internal fun HandoffRecipientPicker(
    state: SwapCalendarUiState,
    onPick: (HandoffWorker) -> Unit,
    onQuery: (String) -> Unit,
) {
    val c = ShiftTheme.colors
    var tab by remember { mutableStateOf(0) } // 0 = My House, 1 = Others
    val dir = state.handoffDirectory
    Column(Modifier.fillMaxWidth().testTag("handoff_picker"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            SwapModePill("My House", selected = tab == 0, modifier = Modifier.weight(1f).testTag("handoff_tab_my_house")) { tab = 0 }
            SwapModePill("Others", selected = tab == 1, modifier = Modifier.weight(1f).testTag("handoff_tab_others")) { tab = 1 }
        }
        if (tab == 0) {
            if (dir.myHouse.isEmpty()) {
                Text(
                    "No eligible workers in your house.",
                    color = c.ter,
                    fontSize = 13.sp,
                    modifier = Modifier.testTag("handoff_my_house_empty"),
                )
            } else {
                Column(Modifier.testTag("handoff_my_house_list"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    dir.myHouse.forEach { w ->
                        HandoffWorkerRow(w, selected = state.recipient?.userId == w.userId, showHouse = false) { onPick(w) }
                    }
                }
            }
        } else {
            HandoffSearchField(value = state.handoffQuery, onValue = onQuery)
            if (dir.others.isEmpty()) {
                Text(
                    if (state.handoffQuery.isBlank()) {
                        "No eligible workers in other houses."
                    } else {
                        "No matches for \"${state.handoffQuery}\"."
                    },
                    color = c.ter,
                    fontSize = 13.sp,
                    modifier = Modifier.testTag("handoff_others_empty"),
                )
            } else {
                Column(Modifier.testTag("handoff_others_list"), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    dir.others.forEach { group ->
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                group.houseName.uppercase(),
                                color = c.sec,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                letterSpacing = 0.5.sp,
                                modifier = Modifier.testTag("handoff_house_group"),
                            )
                            group.workers.forEach { w ->
                                HandoffWorkerRow(w, selected = state.recipient?.userId == w.userId, showHouse = false) { onPick(w) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One pickable hand-off recipient (name + optional house), selected-state highlighted. */
@Composable
internal fun HandoffWorkerRow(
    worker: HandoffWorker,
    selected: Boolean,
    showHouse: Boolean,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.08f) else c.surface)
            .border(
                BorderStroke(
                    if (selected) 1.5.dp else 1.dp,
                    if (selected) MaterialTheme.colorScheme.primary else c.divider,
                ),
                RoundedCornerShape(12.dp),
            ).clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag("handoff_worker_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        HouseBadge(worker.name.take(1), c.surfaceVar, c.ink)
        Column(Modifier.weight(1f)) {
            Text(worker.name, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            if (showHouse) Text(worker.homeHouseName, color = c.sec, fontSize = 12.5.sp)
        }
        if (selected) {
            Icon(
                ShiftIcons.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(Dimens.iconSm),
            )
        }
    }
}

/** A styled search field for the hand-off "Others" tab — filters by worker / house name. */
@Composable
internal fun HandoffSearchField(
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
            .testTag("handoff_search"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(ShiftIcons.Search, contentDescription = null, tint = c.ter, modifier = Modifier.size(Dimens.icon))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) {
                Text("Search workers or houses", color = c.ter, fontSize = 14.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValue,
                modifier = Modifier.fillMaxWidth().testTag("handoff_search_field"),
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
                modifier = Modifier
                    .size(Dimens.icon)
                    .clip(RoundedCornerShape(50))
                    .clickable { onValue("") }
                    .testTag("handoff_search_clear"),
            )
        }
    }
}
