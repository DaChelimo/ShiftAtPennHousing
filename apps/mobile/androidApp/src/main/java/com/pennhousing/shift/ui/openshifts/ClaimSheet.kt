package com.pennhousing.shift.ui.openshifts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.data.PermanentPickupScope
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.CLAIM_SUCCESS_TOAST
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.ClaimMeter
import com.pennhousing.shift.shared.shifts.OpenShiftCardState
import com.pennhousing.shift.shared.shifts.OpenShiftRow
import com.pennhousing.shift.shared.shifts.PICKUP_SUCCESS_TOAST_GENERIC
import com.pennhousing.shift.shared.shifts.PartialClaimPlan
import com.pennhousing.shift.shared.shifts.claimMeter
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.permanentPickupToast
import com.pennhousing.shift.shared.shifts.subOpenShiftFor
import com.pennhousing.shift.shared.shifts.toRow
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.ui.house.durationLabel
import com.pennhousing.shift.ui.kit.BannerTone
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftBanner
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The claim / pick-up sheet (worker-app.html `ClaimSheet`): a shift summary, the
 * "this brings your week to Xh of Yh" hours meter, and the §5.3 cap gating. A
 * soft-cap claim shows a warning banner with a single "Claim anyway" button
 * (`soft_cap_confirm_button`) that claims immediately — one tap, no second
 * confirm step; a break hard-cap claim disables the confirm entirely. On
 * confirm the sheet dismisses and the screen shows the `claim_success` toast —
 * the picked-up shift is already in My Shifts (the optimistic
 * [ShiftsScreenViewModel.claim], decision #13).
 *
 * T2-10 — an opening that coalesces several 30-min blocks gains a "How much can you
 * cover?" block-range slider (default: the whole opening, so the Maestro 02 whole-claim
 * path is unchanged). The hours meter + cap gating recompute from the SELECTED span,
 * and confirm claims only the selected blocks ([onConfirmed] receives the effective —
 * whole or sub — open shift). This applies to BOTH weekly openings and PERMANENT
 * pickups — a permanent pickup can take just a sub-range of the recurring slot (§8.4.3).
 */
@Composable
internal fun ClaimSheet(
    shift: OpenShift,
    vm: ShiftsScreenViewModel,
    currentWeeklyHours: Double,
    onConfirmed: (OpenShift, String) -> Unit,
    onDismiss: () -> Unit,
    loadPermanentScope: suspend (OpenShift) -> PermanentPickupScope? = { null },
) {
    val c = ShiftTheme.colors
    val claimable = vm.claimable(shift)
    val row = remember(shift, claimable) { shift.toRow(claimable) }
    val permanent = row.state == OpenShiftCardState.PERMANENT
    // Dry-run the `permanent-pickup` EF so the confirm can show "Picking up N of M weeks ·
    // K skipped" (§8.4.3). Null until loaded / on the demo path → the plain recurring note.
    var permanentScope by remember(shift) { mutableStateOf<PermanentPickupScope?>(null) }
    LaunchedEffect(shift, permanent) {
        if (permanent) permanentScope = loadPermanentScope(shift)
    }

    // §5.3 partial claim (T2-10) — block indexes on the opening's grid, [from, to).
    val blockCount = shift.blockIds.size
    var rangeFrom by remember(shift) { mutableIntStateOf(0) }
    var rangeTo by remember(shift) { mutableIntStateOf(blockCount) }
    val claimPlan = vm.planClaimRange(shift, rangeFrom, rangeTo)
    // The shift the confirm actually claims: the SELECTED span (§5.3) — for BOTH a weekly
    // opening and a permanent pickup (a permanent pickup can take a sub-range of the slot).
    val effective = if (claimPlan.wholeShift) shift else subOpenShiftFor(shift, claimPlan)

    // Meter + cap gating recompute from the SELECTED span (§5.3).
    // The cap for the week THIS shift lands in, from the server snapshot. The open feeds
    // carry their own week offset, so it is the shift, not the shown week, that decides.
    val cap = vm.capFor(shift)
    val meter =
        remember(shift, claimPlan, currentWeeklyHours, cap) {
            claimMeter(currentWeeklyHours, hoursBetween(effective.start, effective.end), cap)
        }
    val overHard = meter.verdict == ClaimCapVerdict.HARD_CAP_BLOCKED
    val overSoft = meter.verdict == ClaimCapVerdict.SOFT_CAP_WARNING

    ShiftBottomSheet(onDismiss = onDismiss, title = if (permanent) "Pick up permanently" else "Claim shift") {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            // Shift summary — badge + mono time + house · duration · day.
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                HouseBadge(
                    row.houseInitial,
                    if (permanent) c.permanent.tint else c.surfaceVar,
                    if (permanent) c.permanent.deep else c.ink,
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(row.timeLabel, style = ShiftTheme.type.monoTimeHero.copy(fontSize = 20.sp), color = c.ink)
                    Text("${row.houseName} · ${row.durationLabel} · ${row.dayLabel}", color = c.sec, fontSize = 13.5.sp)
                }
            }

            if (permanent) PermanentRecurringNote(row, permanentScope)

            // §5.3 partial pickup — shown for BOTH weekly and permanent openings (>1 block),
            // so a permanent pickup can take just a sub-range of the recurring slot (§8.4.3).
            if (blockCount > 1) {
                ClaimRangeSelector(
                    plan = claimPlan,
                    blockCount = blockCount,
                    rangeFrom = rangeFrom,
                    rangeTo = rangeTo,
                    onRange = { from, to ->
                        rangeFrom = from
                        rangeTo = to
                    },
                )
            }

            ClaimHoursMeter(meter)

            if (overSoft) {
                ShiftBanner(
                    title = meter.overCapTitle,
                    body = "Allowed this period, but your manager sees the overage.",
                    tone = BannerTone.Warning,
                    modifier = Modifier.testTag("soft_cap_warning_modal"),
                )
            }
            if (overHard) {
                ShiftBanner(
                    title = "Over the ${meter.capLabel} limit, can't claim",
                    body = "This period has a hard cap. Drop another shift first.",
                    tone = BannerTone.Error,
                )
            }

            // Confirms the claim: permanent pickup of the WHOLE slot → "Picked up X of Y
            // weeks" from the dry-run scope; a sub-range pickup or unknown scope → the
            // generic confirmation; a weekly claim → the claim toast.
            val confirm = {
                val scope = permanentScope
                val message =
                    when {
                        permanent && claimPlan.wholeShift && scope != null ->
                            permanentPickupToast(
                                weeksPickedUp = scope.weeksPickedUp,
                                totalWeeks = scope.totalWeeksInScope,
                                weeksSkipped = scope.weeksSkipped,
                            )
                        permanent -> PICKUP_SUCCESS_TOAST_GENERIC
                        else -> CLAIM_SUCCESS_TOAST
                    }
                onConfirmed(effective, message)
                onDismiss()
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ShiftButton("Cancel", onDismiss, modifier = Modifier.weight(1f), variant = ButtonVariant.Outlined)
                if (overSoft) {
                    // One tap claims immediately — no second confirm step.
                    ShiftButton(
                        "Claim anyway",
                        onClick = confirm,
                        modifier = Modifier.weight(1f).testTag("soft_cap_confirm_button"),
                    )
                } else {
                    ShiftButton(
                        // The duration ("Claim 1h"), not the range — the half-width
                        // button truncates "Claim 17:30 - 19:00" (emulator-verified);
                        // the selected range is already shown in the selector above.
                        when {
                            permanent && !claimPlan.wholeShift -> "Pick up ${claimPlan.durationLabel}"
                            permanent -> "Confirm pickup"
                            !claimPlan.wholeShift -> "Claim ${claimPlan.durationLabel}"
                            else -> "Claim shift"
                        },
                        onClick = confirm,
                        modifier = Modifier.weight(1f).testTag("claim_confirm_button"),
                        enabled = !overHard,
                    )
                }
            }
        }
    }
}

/**
 * The §5.3 "How much can you cover?" block-range selector (T2-10): a stepped range
 * slider over the opening's 30-min blocks with a live "17:30 - 19:00 · 1h 30m"
 * summary. Defaults to the whole opening.
 */
@Composable
internal fun ClaimRangeSelector(
    plan: PartialClaimPlan,
    blockCount: Int,
    rangeFrom: Int,
    rangeTo: Int,
    onRange: (Int, Int) -> Unit,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 11.dp)
            .testTag("claim_range_selector"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("How much can you cover?", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        Text(
            "${plan.rangeLabel} · ${plan.durationLabel}" + if (plan.wholeShift) " · whole shift" else "",
            style = ShiftTheme.type.monoTime.copy(fontSize = 13.5.sp),
            color = c.ink,
            modifier = Modifier.testTag("claim_range_label"),
        )
        RangeSlider(
            value = rangeFrom.toFloat()..rangeTo.toFloat(),
            onValueChange = { range ->
                val from = range.start.toInt().coerceIn(0, blockCount - 1)
                val to = range.endInclusive.toInt().coerceIn(from + 1, blockCount)
                onRange(from, to)
            },
            valueRange = 0f..blockCount.toFloat(),
            steps = (blockCount - 1).coerceAtLeast(0),
        )
    }
}

/** The "this brings your week to {after}h of {cap}h" meter + progress bar (§5.3 caps). */
@Composable
internal fun ClaimHoursMeter(meter: ClaimMeter) {
    val c = ShiftTheme.colors
    val overHard = meter.verdict == ClaimCapVerdict.HARD_CAP_BLOCKED
    val overSoft = meter.verdict == ClaimCapVerdict.SOFT_CAP_WARNING
    val emphasis =
        when {
            overHard -> c.danger.accent
            overSoft -> c.pending
            else -> c.ink
        }
    val barColor = if (overHard) {
        c.danger.accent
    } else if (overSoft) {
        c.pending
    } else {
        MaterialTheme.colorScheme.primary
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("This brings your week to", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Text(
                "${meter.afterLabel} of ${meter.capLabel}",
                style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
                color = emphasis,
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(50))
                .background(c.surfaceVar),
        ) {
            // Where you are now (ghost), then where this claim takes you (colored).
            Box(
                Modifier
                    .fillMaxWidth(meter.currentFraction.toFloat())
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(c.ink.copy(alpha = 0.22f)),
            )
            Box(
                Modifier
                    .fillMaxWidth(meter.afterFraction.toFloat())
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(50))
                    .background(barColor),
            )
        }
    }
}

/**
 * The recurring-slot note shown when picking up a permanent opening (design `ClaimSheet`).
 * When the `permanent-pickup` dry-run [scope] has resolved, it also shows the §8.4.3
 * "Picking up N of M weeks · K skipped" line so the worker sees how the slot lands against
 * their caps + existing shifts before committing; before that (or on the demo path) only
 * the plain recurring summary shows.
 */
@Composable
internal fun PermanentRecurringNote(
    row: OpenShiftRow,
    scope: PermanentPickupScope?,
) {
    val c = ShiftTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(c.permanent.tint)
            .padding(horizontal = 13.dp, vertical = 12.dp)
            .testTag("permanent_recurring_note"),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text("Recurring · ${row.dayLabel} · ${row.timeLabel}", color = c.permanent.deep, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        row.meta?.let { Text("Repeats weekly: $it.", color = c.sec, fontSize = 12.5.sp) }
        scope?.let {
            val skipped = if (it.weeksSkipped > 0) " · ${it.weeksSkipped} skipped" else ""
            Text(
                "Picking up ${it.weeksPickedUp} of ${it.totalWeeksInScope} weeks$skipped",
                color = c.permanent.deep,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.testTag("permanent_pickup_scope"),
            )
        }
    }
}

// ===================================================================
// Tab 3 — Open Shifts in Other Houses (§5.6 Tab 3).
// ===================================================================
