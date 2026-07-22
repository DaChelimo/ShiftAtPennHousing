package com.pennhousing.shift.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.pennhousing.shift.MainActivity

/**
 * The Android home-screen widget (Upcoming shifts) — the Glance analogue of the iOS
 * ShiftWidgets `UpcomingShiftsWidget`. Display-only: it renders the last snapshot the app
 * wrote (see [WidgetSync]) and a tap opens the app to the worker's shifts. The configurable
 * Open-shifts widget stays iOS-only for now (it needs a Glance configuration surface).
 */
class ShiftWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ShiftWidget()
}

class ShiftWidget : GlanceAppWidget() {
    override suspend fun provideGlance(
        context: Context,
        id: GlanceId,
    ) {
        val snapshot = WidgetSync.readSnapshot(context)
        provideContent { WidgetBody(snapshot) }
    }
}

// Brand tokens (mirrors ShiftTheme / iOS WidgetStyle). Glance renders in a separate
// process, so it cannot read the Compose theme; the values are inlined.
private val ink = Color(0xFF101622)
private val surface = Color(0xFFFFFFFF)
private val muted = Color(0xFF5B6472)
private val floatBg = Color(0xFFFFF1E6)
private val floatInk = Color(0xFFB4530A)

@Composable
private fun WidgetBody(snapshot: WidgetSnapshot?) {
    val context = LocalContext.current
    Column(
        modifier =
            GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(surface))
                .padding(14.dp)
                .clickable(actionStartActivity(Intent(context, MainActivity::class.java))),
    ) {
        Text(
            "Upcoming shifts",
            style = TextStyle(color = ColorProvider(muted), fontSize = 12.sp, fontWeight = FontWeight.Medium),
        )
        Spacer(GlanceModifier.height(8.dp))
        snapshot?.float?.let {
            FloatBanner(it)
            Spacer(GlanceModifier.height(8.dp))
        }
        val rows = snapshot?.upcoming.orEmpty()
        if (rows.isEmpty()) {
            Text(
                "No upcoming shifts",
                style = TextStyle(color = ColorProvider(muted), fontSize = 14.sp),
            )
        } else {
            rows.forEachIndexed { index, row ->
                if (index > 0) Spacer(GlanceModifier.height(8.dp))
                ShiftRow(row)
            }
        }
    }
}

@Composable
private fun ShiftRow(row: WidgetShiftRow) {
    Column(GlanceModifier.fillMaxWidth()) {
        Text(row.house, style = TextStyle(color = ColorProvider(ink), fontSize = 15.sp, fontWeight = FontWeight.Bold))
        Text(
            "${row.dayLabel}, ${row.timeLabel}",
            style = TextStyle(color = ColorProvider(muted), fontSize = 13.sp),
        )
    }
}

@Composable
private fun FloatBanner(float: WidgetFloatRow) {
    Column(
        GlanceModifier
            .fillMaxWidth()
            .background(ColorProvider(floatBg))
            .cornerRadius(10.dp)
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Text(
            "Float to ${float.destinationHouse}",
            style = TextStyle(color = ColorProvider(floatInk), fontSize = 13.sp, fontWeight = FontWeight.Bold),
        )
        Text(
            "${float.whenLabel}. Tap to review.",
            style = TextStyle(color = ColorProvider(floatInk), fontSize = 12.sp),
        )
    }
}
