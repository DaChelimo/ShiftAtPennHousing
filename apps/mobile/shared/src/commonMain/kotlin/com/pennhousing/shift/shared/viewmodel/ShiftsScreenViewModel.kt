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
import com.pennhousing.shift.shared.shifts.dropOptionsFor
import com.pennhousing.shift.shared.shifts.evaluateClaimCap
import com.pennhousing.shift.shared.shifts.hoursBetween
import com.pennhousing.shift.shared.shifts.isClaimable
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
        ShiftsUiState(
            selectedTab = tab,
            myShifts = buildMyShiftsTab(workerShifts),
            homeOpen = buildHomeOpenShiftsTab(openFeed),
            otherHouses = buildOtherHousesTab(openFeed),
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

    /**
     * Optimistic local pickup: move an open shift into the worker's week as a
     * this-week TEMP_PICKUP (cross-house iff it is not the home house). The server
     * write (§5.3) is out of scope here, exactly as `drop`/`reclaim` are optimistic
     * local section moves (decision #13). The pure decision surface still gates it
     * via [claimable] / [claimCap] in the UI before this is called.
     */
    fun claim(shift: OpenShift) {
        val picked =
            MyShift(
                id = shift.id,
                house = shift.house,
                start = shift.start,
                end = shift.end,
                kind = AssignmentKind.TEMP_PICKUP,
                crossHouse = !shift.homeHouse,
            )
        workerShifts = workerShifts + picked
        openFeed = openFeed.filterNot { it.id == shift.id }
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    fun drop(shiftId: String) {
        workerShifts = applyTemporaryDrop(workerShifts, shiftId)
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }

    fun reclaim(shiftId: String) {
        workerShifts = reclaimDroppedShift(workerShifts, shiftId)
        _uiState.value = snapshot(_uiState.value.selectedTab)
    }
}
