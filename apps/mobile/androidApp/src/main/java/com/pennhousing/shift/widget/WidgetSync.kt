package com.pennhousing.shift.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import androidx.glance.appwidget.updateAll
import com.pennhousing.shift.shared.model.MyShift
import com.pennhousing.shift.shared.model.PendingFloat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.time.Instant

/**
 * The Android home-screen widget data pipeline, the analogue of the iOS `WidgetSync` +
 * `WidgetSnapshotStore`. The widget is DISPLAY-ONLY: the app converts the worker's KMP
 * domain models into pre-formatted display strings and writes them to a small
 * SharedPreferences snapshot; the Glance widget reads the last-known snapshot and renders
 * it, then a tap opens the app (see [ShiftWidget]).
 *
 * Strings are formatted HERE (in the app process, America/New_York per the block-time
 * invariant) rather than in the widget, so the widget needs no date library and its output
 * always matches the app. `SimpleDateFormat` + `Calendar` are used deliberately: they are
 * available on every API level (minSdk 24), unlike `java.time` without desugaring.
 */

/** One upcoming shift row, pre-formatted (house + relative day + time range). */
data class WidgetShiftRow(val house: String, val dayLabel: String, val timeLabel: String)

/** The closest pending float, pre-formatted (destination + when). */
data class WidgetFloatRow(val destinationHouse: String, val whenLabel: String)

/** The full widget payload: a few upcoming shifts and an optional float banner. */
data class WidgetSnapshot(val upcoming: List<WidgetShiftRow>, val float: WidgetFloatRow?)

object WidgetSync {
    private const val PREFS = "shift_widget"
    private const val KEY = "snapshot_v1"
    private const val MAX_ROWS = 3
    private val ny: TimeZone = TimeZone.getTimeZone("America/New_York")

    /**
     * Rebuild the snapshot from the worker's week + pending floats and refresh every widget
     * instance. Suspends only for [ShiftWidget.updateAll]; safe to call from a
     * `LaunchedEffect`. A no-op when nothing changed still re-writes (cheap) and reloads.
     */
    suspend fun update(
        context: Context,
        myShifts: List<MyShift>,
        pendingFloats: List<PendingFloat>,
        now: Instant,
    ) {
        val nowMs = now.toEpochMilliseconds()
        val upcoming =
            myShifts
                // Own held shifts still ahead. A personally-dropped-still-open block is no
                // longer yours, so it is excluded (mirrors the iOS WidgetSync filter).
                .filter { !it.droppedStillOpen && it.end.toEpochMilliseconds() >= nowMs }
                .sortedBy { it.start.toEpochMilliseconds() }
                .take(MAX_ROWS)
                .map { row(it, nowMs) }
        val float =
            pendingFloats.minByOrNull { it.start.toEpochMilliseconds() }?.let {
                val startMs = it.start.toEpochMilliseconds()
                WidgetFloatRow(it.destinationHouse.name, "${dayLabel(startMs, nowMs)}, ${time(startMs)}")
            }
        writeSnapshot(context, WidgetSnapshot(upcoming, float))
        ShiftWidget().updateAll(context)
    }

    /** The first upcoming shift as a preview row, or null when the worker has none ahead. */
    fun firstUpcomingPreview(
        myShifts: List<MyShift>,
        now: Instant,
    ): WidgetShiftRow? {
        val nowMs = now.toEpochMilliseconds()
        return myShifts
            .filter { !it.droppedStillOpen && it.end.toEpochMilliseconds() >= nowMs }
            .minByOrNull { it.start.toEpochMilliseconds() }
            ?.let { row(it, nowMs) }
    }

    /** Whether any widget instance is currently placed on a home screen. */
    fun hasWidgetInstalled(context: Context): Boolean =
        AppWidgetManager.getInstance(context)
            .getAppWidgetIds(ComponentName(context, ShiftWidgetReceiver::class.java))
            .isNotEmpty()

    fun readSnapshot(context: Context): WidgetSnapshot? {
        val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
        return runCatching {
            val root = JSONObject(json)
            val arr = root.optJSONArray("upcoming") ?: JSONArray()
            val rows =
                (0 until arr.length()).map { i ->
                    val o = arr.getJSONObject(i)
                    WidgetShiftRow(o.optString("house"), o.optString("day"), o.optString("time"))
                }
            val float =
                root.optJSONObject("float")?.let { WidgetFloatRow(it.optString("house"), it.optString("when")) }
            WidgetSnapshot(rows, float)
        }.getOrNull()
    }

    private fun writeSnapshot(
        context: Context,
        snapshot: WidgetSnapshot,
    ) {
        val root = JSONObject()
        val arr = JSONArray()
        snapshot.upcoming.forEach {
            arr.put(JSONObject().put("house", it.house).put("day", it.dayLabel).put("time", it.timeLabel))
        }
        root.put("upcoming", arr)
        snapshot.float?.let { root.put("float", JSONObject().put("house", it.destinationHouse).put("when", it.whenLabel)) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, root.toString()).apply()
    }

    private fun row(
        shift: MyShift,
        nowMs: Long,
    ): WidgetShiftRow {
        val startMs = shift.start.toEpochMilliseconds()
        val endMs = shift.end.toEpochMilliseconds()
        return WidgetShiftRow(shift.house.name, dayLabel(startMs, nowMs), timeRange(startMs, endMs))
    }

    // ----- formatting (America/New_York, all API levels) -----

    private fun fmt(pattern: String) = SimpleDateFormat(pattern, Locale.US).apply { timeZone = ny }

    private fun time(ms: Long) = fmt("h:mm a").format(Date(ms))

    /** "6:00 - 8:00 PM"; the leading meridiem is dropped when both ends share it. */
    private fun timeRange(
        startMs: Long,
        endMs: Long,
    ): String {
        val sameMeridiem = fmt("a").format(Date(startMs)) == fmt("a").format(Date(endMs))
        val start = if (sameMeridiem) fmt("h:mm").format(Date(startMs)) else fmt("h:mm a").format(Date(startMs))
        return "$start to ${fmt("h:mm a").format(Date(endMs))}"
    }

    /** "Today" / "Tomorrow" / "Mon, Jul 14", by NY calendar day (DST-robust). */
    private fun dayLabel(
        ms: Long,
        nowMs: Long,
    ): String =
        when (Math.round((nyMidnight(ms) - nyMidnight(nowMs)) / 86_400_000.0)) {
            0L -> "Today"
            1L -> "Tomorrow"
            else -> fmt("EEE, MMM d").format(Date(ms))
        }

    private fun nyMidnight(ms: Long): Long =
        Calendar.getInstance(ny).apply {
            timeInMillis = ms
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
}
