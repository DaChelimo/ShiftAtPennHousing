package com.pennhousing.shift.ui.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import com.pennhousing.shift.shared.calendar.CalendarWeek
import com.pennhousing.shift.shared.calendar.TemplateSlot
import com.pennhousing.shift.shared.calendar.WeekDayCell
import com.pennhousing.shift.shared.calendar.WeekOption
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The week navigator — a slim bar pinned at the BOTTOM of the My Shifts tab (above the
 * nav bar): ‹ {title} · {range} › with the centre tappable to open the week picker.
 * prev/next chevrons appear only when both handlers are supplied (template mode omits
 * them). Selectors carry over from the old top card so Maestro flow 09 is unchanged.
 */
@Composable
internal fun WeekNavBar(
    title: String,
    rangeLabel: String,
    onOpenPicker: () -> Unit,
    onPreviousWeek: (() -> Unit)? = null,
    onNextWeek: (() -> Unit)? = null,
    // Selectors default to the My-Shifts (calendar) tags; the Open-Shifts bar overrides them.
    pickerTag: String = "calendar_week_picker_open",
    prevTag: String = "calendar_prev_week",
    nextTag: String = "calendar_next_week",
) {
    val c = ShiftTheme.colors
    Column(Modifier.fillMaxWidth().background(c.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.divider))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onPreviousWeek != null) {
                Icon(
                    ShiftIcons.ChevronLeft,
                    contentDescription = "Previous week",
                    tint = c.sec,
                    modifier =
                        Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .clickable(onClick = onPreviousWeek)
                            .testTag(prevTag)
                            .padding(8.dp),
                )
            } else {
                Spacer(Modifier.size(40.dp))
            }
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onOpenPicker)
                    .testTag(pickerTag)
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    ShiftIcons.Calendar,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(7.dp))
                Text(title, color = c.ink, fontSize = 15.5.sp, fontWeight = FontWeight.SemiBold)
                Text("  ·  $rangeLabel", color = c.sec, fontSize = 14.sp)
            }
            if (onNextWeek != null) {
                Icon(
                    ShiftIcons.ChevronRight,
                    contentDescription = "Next week",
                    tint = c.sec,
                    modifier =
                        Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .clickable(onClick = onNextWeek)
                            .testTag(nextTag)
                            .padding(8.dp),
                )
            } else {
                Spacer(Modifier.size(40.dp))
            }
        }
    }
}

/**
 * D5 — the week-picker sheet: quick weeks (last / this / next / +2 / +3) plus the
 * derived recurring-template entry. The pure `weekPickerOptions` labels each row.
 */
@Composable
internal fun WeekPickerSheet(
    options: List<WeekOption>,
    currentOffset: Int,
    onPick: (Int) -> Unit,
    onDismiss: () -> Unit,
    // The Calendar tab offers the derived recurring template; My-Shifts does not
    // (null → the row is hidden).
    onTemplate: (() -> Unit)? = null,
    sheetTag: String = "week_picker_sheet",
    optionTag: String = "week_picker_option",
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, title = "Pick a week") {
        Column(
            Modifier.fillMaxWidth().testTag(sheetTag),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            options.forEach { option ->
                val selected = option.offset == currentOffset
                // "This week" (offset 0) always wears a brand-blue ring — the anchor —
                // while the selected week takes the soft `today` fill. Both can coexist.
                val isThisWeek = option.offset == 0
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (selected) c.today else c.surface)
                        .border(
                            if (isThisWeek) 1.5.dp else 1.dp,
                            if (isThisWeek) MaterialTheme.colorScheme.primary else c.divider,
                            RoundedCornerShape(12.dp),
                        ).clickable { onPick(option.offset) }
                        .padding(horizontal = 13.dp, vertical = 11.dp)
                        .testTag(optionTag),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(option.label, color = c.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text(option.rangeLabel, style = ShiftTheme.type.monoTime.copy(fontSize = 12.5.sp), color = c.sec)
                }
            }
            if (onTemplate != null) {
                // Derived, secondary entry — a calm gray that recedes into the sheet
                // background (no longer the pink permanent-state tint).
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(c.surfaceVar)
                        .border(1.dp, c.divider, RoundedCornerShape(12.dp))
                        .clickable(onClick = onTemplate)
                        .padding(horizontal = 13.dp, vertical = 11.dp)
                        .testTag("week_picker_template"),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Recurring template", color = c.sec, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text("derived", color = c.ter, fontSize = 12.5.sp)
                }
            }
        }
    }
}

/** One derived recurring slot ("Mon · 14:00 - 18:00 · Harnwell · seen 4 weeks"). */
@Composable
internal fun TemplateSlotRow(slot: TemplateSlot) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(12.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("template_slot_row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(slot.dayLabel, color = c.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(slot.timeLabel, style = ShiftTheme.type.monoTime, color = c.ink)
            Text("${slot.houseName} · ${slot.durationLabel}", color = c.sec, fontSize = 12.5.sp)
        }
        Text(
            if (slot.weeksSeen > 1) "seen ${slot.weeksSeen} weeks" else "seen once",
            color = c.ter,
            fontSize = 11.5.sp,
        )
    }
}

/** Mon-Sun day picker: weekday letter, a date pill (selected fill / today ring), a shift dot. */
@Composable
internal fun WeekStrip(
    week: CalendarWeek,
    selected: Int,
    onSelect: (Int) -> Unit,
    tag: String = "calendar_week_strip",
) {
    Row(
        Modifier.fillMaxWidth().testTag(tag).padding(horizontal = 12.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        week.days.forEach { day ->
            WeekDayCellView(day, day.index == selected, Modifier.weight(1f)) { onSelect(day.index) }
        }
    }
}

@Composable
internal fun WeekDayCellView(
    day: WeekDayCell,
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = ShiftTheme.colors
    val blue = MaterialTheme.colorScheme.primary
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .testTag("calendar_day_cell")
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(day.dayLetter, color = c.ter, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(50))
                .background(
                    when {
                        selected -> blue
                        day.closed -> c.surfaceVar // §3.4 closed-day cell — muted fill
                        else -> Color.Transparent
                    },
                ).then(if (day.isToday && !selected) Modifier.border(1.5.dp, blue, RoundedCornerShape(50)) else Modifier)
                .then(if (day.closed) Modifier.testTag("calendar_closed_day") else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                day.dateLabel,
                color =
                    when {
                        selected -> Color.White
                        day.closed -> c.ter
                        else -> c.ink
                    },
                fontSize = 14.sp,
                fontWeight = if (day.isToday) FontWeight.Bold else FontWeight.Medium,
            )
        }
        Box(
            Modifier.size(5.dp).clip(RoundedCornerShape(50)).background(if (day.hasShifts) blue else Color.Transparent),
        )
    }
}
