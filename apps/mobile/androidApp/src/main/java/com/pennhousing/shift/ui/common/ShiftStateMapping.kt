package com.pennhousing.shift.ui.common

import com.pennhousing.shift.shared.shifts.MyShiftCardState
import com.pennhousing.shift.shared.shifts.OpenShiftCardState
import com.pennhousing.shift.ui.kit.ShiftState
import com.pennhousing.shift.ui.openshifts.ClaimSheet

internal fun MyShiftCardState.toKitState(): ShiftState =
    when (this) {
        MyShiftCardState.SCHEDULED -> ShiftState.SCHEDULED
        MyShiftCardState.PICKUP_HOME -> ShiftState.PICKUP_HOME
        MyShiftCardState.PICKUP_CROSS -> ShiftState.PICKUP_CROSS
        MyShiftCardState.FLOAT_OUT -> ShiftState.FLOAT_OUT
        MyShiftCardState.PENDING_FLOAT -> ShiftState.PENDING_FLOAT
        MyShiftCardState.BREAK_SHIFT -> ShiftState.BREAK
        MyShiftCardState.DROPPED -> ShiftState.DROPPED
    }

// ===================================================================
// Open Shifts — one tab, "My House" / "Others" sub-tabs (§5.6 Tabs 2+3).
// ===================================================================

internal fun OpenShiftCardState.toKitState(): ShiftState =
    when (this) {
        OpenShiftCardState.OPEN -> ShiftState.OPEN
        OpenShiftCardState.UNPICKABLE -> ShiftState.UNPICKABLE
        OpenShiftCardState.PERMANENT -> ShiftState.PERMANENT
    }

// ===================================================================
// Claim flow (§5.3 / §5.4) — the design `ClaimSheet`.
// ===================================================================
