package com.pennhousing.shift.ui.swaps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.swaps.SwapRow
import com.pennhousing.shift.shared.viewmodel.SwapsTab
import com.pennhousing.shift.shared.viewmodel.SwapsUiState
import com.pennhousing.shift.ui.common.PageTitle
import com.pennhousing.shift.ui.common.SpecTab
import com.pennhousing.shift.ui.kit.EmptyState
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

@Composable
internal fun SwapsTabContent(
    state: SwapsUiState,
    onSelectTab: (SwapsTab) -> Unit,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
    onVoidSwap: (String) -> Unit,
) {
    val tabIndex =
        when (state.selectedTab) {
            SwapsTab.ALL -> 0
            SwapsTab.INCOMING -> 1
            SwapsTab.OUTGOING -> 2
        }
    Column(Modifier.fillMaxSize().background(ShiftTheme.colors.bg).testTag("swaps_screen")) {
        PageTitle("Swaps")
        SecondaryTabRow(selectedTabIndex = tabIndex) {
            SpecTab("All (${state.allCount})", "swaps_subtab_all", state.selectedTab == SwapsTab.ALL) {
                onSelectTab(SwapsTab.ALL)
            }
            SpecTab("Incoming (${state.incomingCount})", "swaps_subtab_incoming", state.selectedTab == SwapsTab.INCOMING) {
                onSelectTab(SwapsTab.INCOMING)
            }
            SpecTab("Outgoing (${state.outgoingCount})", "swaps_subtab_outgoing", state.selectedTab == SwapsTab.OUTGOING) {
                onSelectTab(SwapsTab.OUTGOING)
            }
        }
        when (state.selectedTab) {
            SwapsTab.ALL -> AllSwapsList(state.feed.all, onAcceptSwap, onRejectSwap, onVoidSwap)
            SwapsTab.INCOMING -> IncomingSwapsList(state.feed.incoming, onAcceptSwap, onRejectSwap)
            SwapsTab.OUTGOING -> OutgoingSwapsList(state.feed.outgoing, onVoidSwap)
        }
    }
}

/** The "All" list — incoming + outgoing merged, soonest-deadline first. Each row renders
 * its direction's actions (incoming → Accept/Decline, outgoing → Cancel). */
@Composable
internal fun AllSwapsList(
    rows: List<SwapRow>,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
    onVoidSwap: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(top = 40.dp)) {
            EmptyState(
                title = "No swaps yet",
                icon = ShiftIcons.Refresh,
                body = "Swaps you receive or propose show up here, soonest first.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("swaps_all_list"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(rows, key = { _, it -> it.swapId }) { i, row ->
            val prev = rows.getOrNull(i - 1)
            if (row.groupId != null && row.groupId != prev?.groupId) {
                Text(
                    "Proposed together · ${row.groupSize} people",
                    color = ShiftTheme.colors.sec,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp).testTag("swaps_group_header"),
                )
            }
            if (row.incoming) IncomingSwapCard(row, onAcceptSwap, onRejectSwap) else OutgoingSwapCard(row, onVoidSwap)
        }
    }
}

@Composable
internal fun IncomingSwapsList(
    rows: List<SwapRow>,
    onAcceptSwap: (String) -> Unit,
    onRejectSwap: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(top = 40.dp)) {
            EmptyState(
                title = "No incoming swaps",
                icon = ShiftIcons.Refresh,
                body = "When a housemate proposes a swap with you, it shows up here to accept or decline.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("swaps_incoming_list"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(rows, key = { it.swapId }) { row -> IncomingSwapCard(row, onAcceptSwap, onRejectSwap) }
    }
}

@Composable
internal fun OutgoingSwapsList(
    rows: List<SwapRow>,
    onVoidSwap: (String) -> Unit,
) {
    if (rows.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(top = 40.dp)) {
            EmptyState(
                title = "No outgoing swaps",
                icon = ShiftIcons.Refresh,
                body = "Swaps you propose (from a shift on My Shifts) wait here until your housemate responds.",
            )
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("swaps_outgoing_list"),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(rows, key = { _, it -> it.swapId }) { i, row ->
            // Co-created legs (decision 2026-06-15) get one "Proposed together" header.
            val prev = rows.getOrNull(i - 1)
            if (row.groupId != null && row.groupId != prev?.groupId) {
                Text(
                    "Proposed together · ${row.groupSize} people",
                    color = ShiftTheme.colors.sec,
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp).testTag("swaps_group_header"),
                )
            }
            OutgoingSwapCard(row, onVoidSwap)
        }
    }
}
