package com.pennhousing.shift.shared.viewmodel

import androidx.lifecycle.ViewModel
import com.pennhousing.shift.shared.model.AssignmentKind
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.OpenShift
import com.pennhousing.shift.shared.shifts.ClaimCapVerdict
import com.pennhousing.shift.shared.shifts.DropOptions
import com.pennhousing.shift.shared.shifts.DropPlan
import com.pennhousing.shift.shared.shifts.HomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.MyShiftsTab
import com.pennhousing.shift.shared.shifts.OtherHousesTab
import com.pennhousing.shift.shared.shifts.applyTemporaryDrop
import com.pennhousing.shift.shared.shifts.buildHomeOpenShiftsTab
import com.pennhousing.shift.shared.shifts.buildMyShiftsTab
import com.pennhousing.shift.shared.shifts.buildOtherHousesTab
import com.pennhousing.shift.shared.shifts.coalesceMyShifts
import com.pennhousing.shift.shared.shifts.coalesceOpenShifts
import com.pennhousing.shift.shared.shifts.PartialDropPlan
import com.pennhousing.shift.shared.shifts.blockIndexAt
import com.pennhousing.shift.shared.shifts.dropOptionsFor
import com.pennhousing.shift.shared.shifts.evaluateClaimCap
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.isClaimable
import com.pennhousing.shift.shared.shifts.planPartialDrop
import com.pennhousing.shift.shared.shifts.planTemporaryDrop
import com.pennhousing.shift.shared.shifts.reclaimDroppedShift
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.time.Instant

enum class ShiftsTab { MY_SHIFTS, OPEN_HOME, OPEN_OTHER }

data class ShiftsUiState(
    val selectedTab: ShiftsTab,
    val myShifts: MyShiftsTab,
    val homeOpen: HomeOpenShiftsTab,
    val otherHouses: OtherHousesTab,
)

/**
 * Phase 13a — the Shifts-screen ViewModel (BEHAVIORAL_SPECIFICATION.md §5.6).
 *
 * A thin `StateFlow` wrapper over the pure `shifts/` decision surface, in the
 * shape of the existing [MainViewModel]: it constructs and emits synchronously
 * (no `viewModelScope`, no launched coroutines), so it runs on the JVM host test
 * target without an Android runtime (tests/PHASE_13a/TEST_PLAN.md). `now` is the
 * screen's load instant, injected once at construction (decision #17).
 *
 * The data layer (Supabase fetch + Realtime, see `data/`) constructs the
 * snapshot; this ViewModel only decides over it. `drop`/`reclaim` are optimistic
 * local section moves (decision #13); server reconciliation is out of scope.
 */
class ShiftsScreenViewModel(
    myShifts: List<MyShift>,
    openShifts: List<OpenShift>,
    private val now: Instant,
    initialTab: ShiftsTab = ShiftsTab.MY_SHIFTS,
) : ViewModel() {
    private var workerShifts: List<MyShift> = myShifts
    private var openFeed: List<OpenShift> = openShifts

    private val _uiState = MutableStateFlow(snapshot(initialTab))
    val uiState: StateFlow<ShiftsUiState> = _uiState.asStateFlow()

    private fun snapshot(tab: ShiftsTab): ShiftsUiState =
        // The stores stay PER-BLOCK (the live read models are one row per 30-min
        // block); coalescing at presentation time merges each contiguous same-shift
        // run into one displayed card carrying its constituent blockIds.
        ShiftsUiState(
            selectedTab = tab,
            myShifts = buildMyShiftsTab(coalesceMyShifts(workerShifts)),
            homeOpen = buildHomeOpenShiftsTab(coalesceOpenShifts(openFeed)),
            otherHouses = buildOtherHousesTab(coalesceOpenShifts(openFeed)),
        )

    fun selectTab(tab: ShiftsTab) {
        // Tab data is unchanged by selection — only the selected tab moves.
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    fun claimable(shift: OpenShift): Boolean = isClaimable(shift, now)

    fun claimCap(
        shift: OpenShift,
        currentWeeklyHours: Double,
        breakProfile: Boolean,
    ): ClaimCapVerdict = evaluateClaimCap(currentWeeklyHours, hoursBetween(shift.start, shift.end), breakProfile)

    fun dropOptions(
        shift: MyShift,
        breakProfile: Boolean,
    ): DropOptions = dropOptionsFor(shift, breakProfile)

    fun planDrop(
        shift: MyShift,
        dropFromNow: Boolean,
    ): DropPlan = planTemporaryDrop(shift, dropFromNow, now)

    /** §5.2 partial drop: plan blocks [fromBlock, toBlock) of the displayed card. */
    fun planDropRange(
        shift: MyShift,
        fromBlock: Int,
        toBlock: Int,
    ): PartialDropPlan = planPartialDrop(shift, fromBlock, toBlock, now)

    /** The block index containing `now` (mid-shift "drop from now"), or null. */
    fun dropFromNowIndex(shift: MyShift): Int? = blockIndexAt(shift, now)

    /**
     * Optimistic local pickup: move an open shift into the worker's week as a
     * this-week TEMP_PICKUP (cross-house iff it is not the home house). The server
     * write (§5.3) is out of scope here, exactly as `drop`/`reclaim` are optimistic
     * local section moves (decision #13). The pure decision surface still gates it
     * via [claimable] / [claimCap] in the UI before this is called.
     */
    fun claim(shift: OpenShift) {
        // [shift] is the DISPLAYED (coalesced) card: its blockIds cover every
        // constituent vacant block, so all of them leave the feed and the picked-up
        // span carries them for the live per-block claim writes.
        val claimedIds = shift.blockIds.toSet()
        val picked =
            MyShift(
                id = shift.id,
                house = shift.house,
                start = shift.start,
                end = shift.end,
                kind = AssignmentKind.TEMP_PICKUP,
                crossHouse = !shift.homeHouse,
                blockIds = shift.blockIds,
            )
        workerShifts = workerShifts + picked
        openFeed = openFeed.filterNot { it.id in claimedIds }
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    fun drop(shiftId: String) {
        workerShifts = applyTemporaryDrop(workerShifts, displayedBlockIds(shiftId))
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * §5.2 partial drop: flag only the selected blocks; the remaining blocks
     * re-coalesce into their own card(s) (a middle drop leaves two), and the
     * dropped run re-coalesces into one dropped-still-open card.
     */
    fun dropBlocks(blockIds: List<String>) {
        workerShifts = applyTemporaryDrop(workerShifts, blockIds.toSet())
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    fun reclaim(shiftId: String) {
        workerShifts = reclaimDroppedShift(workerShifts, displayedBlockIds(shiftId))
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    /**
     * Resolve a displayed card id to the block ids it covers: the UI hands back the
     * coalesced card's id (its first block), but the store is per-block, so the
     * optimistic move must flag every constituent row. An id with no coalesced match
     * (already a single block) falls back to itself.
     */
    private fun displayedBlockIds(shiftId: String): Set<String> =
        coalesceMyShifts(workerShifts).firstOrNull { it.id == shiftId }?.blockIds?.toSet() ?: setOf(shiftId)
}
