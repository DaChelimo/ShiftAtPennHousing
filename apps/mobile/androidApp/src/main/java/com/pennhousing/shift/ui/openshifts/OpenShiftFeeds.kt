package com.pennhousing.shift.ui.openshifts

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.OpenShiftCardState
import com.pennhousing.shift.shared.shifts.OpenShiftGroup
import com.pennhousing.shift.shared.shifts.OpenShiftSort
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.ui.common.ShiftCardColumn
import com.pennhousing.shift.ui.common.toKitState
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.InFlightPill
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftCard
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * One open-shift feed card, driven by the shared
 * [com.pennhousing.shift.shared.shifts.toRow]: OPEN → Claim (filled), PERMANENT →
 * Pick up (tonal), UNPICKABLE → no action + "Locked" meta (§5.4 keeps the gap
 * visible past T-2h, withholding only the action). The card root + the action carry
 * the `open_shift_card` / `claim_button` selectors.
 */
@Composable
internal fun OpenFeedCard(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    onClaim: () -> Unit,
) {
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    ShiftCard(
        state = row.state.toKitState(),
        houseInitial = row.houseInitial,
        timeLabel = row.timeLabel,
        modifier = Modifier.testTag(if (row.busy) "open_shift_card_busy" else "open_shift_card"),
        eyebrow = row.dayLabel,
        houseName = row.houseName,
        durationLabel = row.durationLabel,
        // While a claim is in flight the card says so, at its full original span, instead
        // of shrinking block by block as `claim-shift` commits each 30-minute write.
        meta = row.busyNote ?: row.meta,
        countLabel = row.countLabel,
        action =
            if (row.busy) {
                { InFlightPill(row.busyLabel.orEmpty()) }
            } else {
                row.actionLabel?.let { label ->
                    {
                        ShiftButton(
                            label,
                            onClaim,
                            modifier = Modifier.testTag("claim_button"),
                            variant = if (row.state == OpenShiftCardState.PERMANENT) ButtonVariant.Tonal else ButtonVariant.Filled,
                            size = ButtonSize.Sm,
                        )
                    }
                }
            },
    )
}

/**
 * A cross-house [group] rendered as a collapsible card: a tappable prominent header
 * (icon + title + count + a chevron that rotates when open) over its [content]. The whole
 * header toggles [onToggle]; the body animates open/closed. [sortBy] only picks the header
 * icon/accent (house vs day) so the two groupings read distinctly.
 */
@Composable
internal fun CollapsibleGroup(
    group: OpenShiftGroup,
    sortBy: OpenShiftSort,
    expanded: Boolean,
    onToggle: () -> Unit,
    content: @Composable () -> Unit,
) {
    val c = ShiftTheme.colors
    val accent = if (sortBy == OpenShiftSort.BY_HOUSE) c.pickupDot else c.permanent.accent
    val icon = if (sortBy == OpenShiftSort.BY_HOUSE) ShiftIcons.Building else ShiftIcons.Calendar
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(
            group.title,
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onToggle).testTag("group_header"),
            count = group.count,
            prominent = true,
            icon = icon,
            accent = accent,
            trailing = {
                Icon(
                    ShiftIcons.ChevronRight,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = c.ter,
                    modifier = Modifier.size(18.dp).rotate(if (expanded) 90f else 0f),
                )
            },
        )
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            content()
        }
    }
}

/**
 * The collapsed-by-default "Earlier this week" card: open shifts in the shown week that
 * have ALREADY started (greyed). Kept claimable for the edge case of a worker who just
 * worked an open shift and wants it on the books, but tucked away so it doesn't clutter
 * the live feed. Defaults CLOSED; the body renders at reduced opacity. Shared by the
 * My-House and Other-Houses feeds.
 */
@Composable
internal fun PastOpenShiftsSection(
    past: List<OpenShift>,
    vm: ShiftsScreenViewModel,
    onClaim: (OpenShift) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val c = ShiftTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionHeader(
            "Earlier this week",
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { expanded = !expanded }.testTag("past_open_section"),
            count = past.size,
            prominent = true,
            icon = ShiftIcons.Clock,
            accent = c.ter,
            trailing = {
                Icon(
                    ShiftIcons.ChevronRight,
                    contentDescription = if (expanded) "Collapse" else "Expand",
                    tint = c.ter,
                    modifier = Modifier.size(18.dp).rotate(if (expanded) 90f else 0f),
                )
            },
        )
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn() + expandVertically(),
            exit = fadeOut() + shrinkVertically(),
        ) {
            Box(Modifier.alpha(0.55f)) {
                ShiftCardColumn { past.forEach { OpenFeedCard(it, vm) { onClaim(it) } } }
            }
        }
    }
}

// ===================================================================
// Updates tab — §10.1 notifications feed + the §7 pending-float entry (Maestro 04).
// ===================================================================
