package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.breakclaim.BreakHoursMeter
import com.pennhousing.shift.shared.breakclaim.BreakShiftRow
import com.pennhousing.shift.shared.viewmodel.BreakClaimViewModel
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.SectionHeader
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftCard
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.ShiftState
import com.pennhousing.shift.ui.kit.ShiftToast
import com.pennhousing.shift.ui.kit.ToastTone
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.delay

/**
 * Break claim picker (Phase 11) — Compose UI over the shared [BreakClaimViewModel].
 * Rebuilds worker-app.html `BreakClaimScreen`: the break-profile eyebrow, the golden
 * FCFS info card, the 40h hard-cap meter, and the list of golden break cards (Claim /
 * Drop). Selector ids match `apps/mobile/maestro/README.md`.
 */
@Composable
fun BreakClaimTabContent(
    vm: BreakClaimViewModel,
    // Live host POSTs to `break-claim` / `drop-shift` (best-effort) while the picker
    // does the optimistic local move; demo defaults to no live write. The argument is
    // the break shift's pool-row id (= its block assignment_id).
    onClaimBreak: (String) -> Unit = {},
    onDropBreak: (String) -> Unit = {},
    // Live host writes the §4.4 "no break hours" opt-out (own `break_optouts` row,
    // insert/delete) DIRECTLY via Postgrest while the picker flips its optimistic
    // opted-out state; demo defaults to no live write. Argument = the NEW opted-out state.
    onToggleBreakOptOut: (Boolean) -> Unit = {},
) {
    val state by vm.uiState.collectAsStateWithLifecycle()
    val c = ShiftTheme.colors
    var toastTick by remember { mutableIntStateOf(0) }
    var showToast by remember { mutableStateOf(false) }
    LaunchedEffectToast(toastTick) { showToast = it }

    Column(Modifier.fillMaxSize().background(c.bg).testTag("break_claim_screen")) {
        Text(
            state.profileContext,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 6.dp),
            color = c.breakShift.deep,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.05.em,
        )
        if (showToast) {
            ShiftToast(
                message = "Break shift claimed",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag("break_claim_success"),
                tone = ToastTone.Success,
                icon = ShiftIcons.Coffee,
            )
        }
        BreakInfoCard(state.infoTitle, state.infoBody)
        BreakHoursMeterView(state.list.meter)

        // §4.4 "no break hours" opt-out — the break analogue of the preferences no-hours
        // control. When opted out the worker won't be scheduled this break; the claimable
        // pool collapses to the opted-out empty state below.
        BreakOptOutToggle(
            optedOut = state.optedOut,
            onToggle = { onToggleBreakOptOut(vm.toggleOptedOut()) },
        )

        if (state.optedOut) {
            EmptyState(
                title = "No break hours",
                icon = ShiftIcons.Ban,
                body = "You won't be scheduled this break. Untick \"no break hours\" to claim shifts.",
            )
        } else if (state.list.isEmpty) {
            EmptyState(
                title = "No break shifts open",
                icon = ShiftIcons.Coffee,
                body = "Everything's claimed for now. Check back — shifts return to the pool when others drop them.",
            )
        } else {
            val house = state.list.rows.firstOrNull()?.houseName
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
            ) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SectionHeader(
                            title = if (house != null) "Claimable · $house" else "Claimable break shifts",
                            count = state.list.rows.size,
                        )
                        state.list.rows.forEach { row ->
                            BreakCard(
                                row = row,
                                onClaim = {
                                    vm.claim(row.id)
                                    onClaimBreak(row.id)
                                    toastTick++
                                },
                                onDrop = {
                                    vm.drop(row.id)
                                    onDropBreak(row.id)
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Drives the auto-dismissing "claimed" toast (worker-app.html 2.2s window). */
@Composable
private fun LaunchedEffectToast(
    tick: Int,
    setVisible: (Boolean) -> Unit,
) {
    androidx.compose.runtime.LaunchedEffect(tick) {
        if (tick > 0) {
            setVisible(true)
            delay(2200)
            setVisible(false)
        }
    }
}

/** The golden FCFS info card (worker-app.html break banner): 4dp break border + coffee. */
@Composable
private fun BreakInfoCard(
    title: String,
    body: String,
) {
    val c = ShiftTheme.colors
    Box(
        Modifier
            .fillMaxWidth()
            // IntrinsicSize.Min pins the card to its content height so the
            // fillMaxHeight accent bar below fills the ROW height, not the parent
            // Column's (unbounded) max — without it the card expands to fill the
            // whole screen and clips the hours meter + claim list off-screen (the
            // non-scrollable outer Column can't recover them). See the §13a
            // "ShiftBanner fillMaxHeight needs IntrinsicSize.Min" gotcha.
            .height(IntrinsicSize.Min)
            .padding(horizontal = 16.dp, vertical = 2.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(c.surface)
            .border(1.dp, c.divider, RoundedCornerShape(14.dp)),
    ) {
        Box(Modifier.align(Alignment.CenterStart).width(4.dp).fillMaxHeight().background(c.breakShift.accent))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Icon(ShiftIcons.Coffee, contentDescription = null, tint = c.breakShift.accent, modifier = Modifier.size(20.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, color = c.breakShift.deep, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(body, color = c.sec, fontSize = 12.5.sp, lineHeight = 17.sp)
            }
        }
    }
}

/** The "This week — Xh / 40h" hard-cap meter (golden bar; red at cap). */
@Composable
private fun BreakHoursMeterView(meter: BreakHoursMeter) {
    val c = ShiftTheme.colors
    val barColor = if (meter.atCap) c.danger.accent else c.breakShift.accent
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("break_hours_meter"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("This week", color = c.sec, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row {
                Text(
                    meter.currentLabel,
                    style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp),
                    color = if (meter.atCap) c.danger.accent else c.ink,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    " / ${meter.capLabel}",
                    style = ShiftTheme.type.monoTime.copy(fontSize = 13.sp),
                    color = c.ter,
                )
            }
        }
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(c.surfaceVar)) {
            Box(Modifier.fillMaxWidth(meter.fraction.toFloat()).height(6.dp).clip(RoundedCornerShape(50)).background(barColor))
        }
    }
}

/**
 * The §4.4 "no break hours" opt-out tick — the break analogue of the preferences
 * no-hours control (same checkbox affordance). Ticking it opts the worker out of break
 * hours; unticking opts back in. The break accent (golden) keeps it on-theme.
 */
@Composable
private fun BreakOptOutToggle(
    optedOut: Boolean,
    onToggle: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onToggle)
            .testTag("break_no_hours_toggle"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(if (optedOut) c.breakShift.accent else Color.Transparent)
                .border(1.5.dp, if (optedOut) c.breakShift.accent else c.outline, RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (optedOut) {
                Icon(ShiftIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
            }
        }
        Text("I have no hours this break", color = c.sec, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
    }
}

/** One break-shift card: the canonical BREAK card + a trailing Claim / Drop action. */
@Composable
private fun BreakCard(
    row: BreakShiftRow,
    onClaim: () -> Unit,
    onDrop: () -> Unit,
) {
    ShiftCard(
        state = ShiftState.BREAK,
        houseInitial = row.houseInitial,
        timeLabel = row.timeLabel,
        modifier = Modifier.testTag("break_shift_card"),
        houseName = row.houseName,
        durationLabel = row.durationLabel,
        meta = row.meta,
        action = {
            if (row.claimedByMe) {
                ShiftButton(
                    row.actionLabel,
                    onClick = onDrop,
                    modifier = Modifier.testTag("break_drop_button"),
                    variant = ButtonVariant.Destructive,
                    size = ButtonSize.Sm,
                )
            } else {
                // At the 40h HARD cap → Claim disabled with the at-cap label (server is
                // still authoritative — `break-claim` returns `hard_cap_exceeded`).
                ShiftButton(
                    row.actionLabel,
                    onClick = onClaim,
                    modifier = Modifier.testTag("break_claim_button"),
                    size = ButtonSize.Sm,
                    enabled = !row.claimBlocked,
                )
            }
        },
    )
}
