package com.pennhousing.shift

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.remember
import com.pennhousing.shift.shared.samples.DemoData
import com.pennhousing.shift.shared.viewmodel.AckDeclineViewModel
import com.pennhousing.shift.shared.viewmodel.ShiftsScreenViewModel
import com.pennhousing.shift.ui.ShiftsApp
import kotlin.time.Clock

/**
 * Phase 13a — Android host for the worker Shifts screen.
 *
 * Builds the shared ViewModels from a deterministic [DemoData] snapshot anchored
 * to the wall-clock `now` (the UI is allowed to read the clock — the no-clock rule
 * is for the pure decision surface, which takes `now` as a parameter). With a
 * configured backend the snapshot would instead come from
 * `WorkerShiftsRepository.observeWorkerWeek(...)` and the toast from
 * `observeNotifications(...)`; that live wiring needs the auth/session layer,
 * which is out of phase-13a scope.
 */
class MainActivity : ComponentActivity() {
    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* best-effort; push is optional */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        maybeRequestNotificationPermission()

        val now = Clock.System.now()
        val snapshot = DemoData.snapshot(now)
        val pendingFloat = DemoData.pendingFloat(now)

        setContent {
            val shiftsVm = remember { ShiftsScreenViewModel(snapshot.myShifts, snapshot.openShifts, now) }
            val ackVm = remember { AckDeclineViewModel(pendingFloat, now) }
            ShiftsApp(
                shiftsVm = shiftsVm,
                ackVm = ackVm,
                currentWeeklyHours = DemoData.DEMO_WEEKLY_HOURS,
            )
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
