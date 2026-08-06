package com.pennhousing.shift.ui.onboarding

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationManagerCompat
import com.pennhousing.shift.shared.onboarding.NotificationPriming
import com.pennhousing.shift.ui.kit.ButtonSize
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/*
 * The notification ask (Android) — the platform rendering for the shared
 * `NotificationPriming` decision + copy. See that file for WHY this is an inline row rather
 * than the blocking first-run modal it replaced (2026-08-03, BSpec §20.2).
 *
 * Two callers:
 *   - the STANDING row, pinned above the My-Shifts schedule while alerts are off;
 *   - the CONTEXTUAL row, shown once each after a claim and after a swap or hand-off is sent.
 *
 * Both render [NotificationNudgeRow]; only the copy and the gating differ.
 */

/**
 * Per-device flags for the notification ask. Shares the `onboarding` SharedPreferences file
 * (these are UX flags), under keys that never collide with any tour's seen-key set.
 */
object NotificationPrefs {
    private const val PREFS = "onboarding"

    /** Whether the once-per-install contextual row for [key] has already been shown. */
    fun hasAsked(
        context: Context,
        key: String,
    ): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(key, false)

    fun markAsked(
        context: Context,
        key: String,
    ) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(key, true)
            .apply()
    }

    /**
     * Whether the worker actually receives pushes right now. Uses
     * `areNotificationsEnabled()` rather than the raw permission check so a worker who turned
     * alerts off in system settings (possible on every API level) is offered them again,
     * which is the point of a row that persists until alerts are on.
     */
    fun granted(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    /**
     * Whether a POST_NOTIFICATIONS system dialog would actually surface: only on API 33+ (the
     * permission is a no-op runtime grant below that) and only while it is not already
     * granted. Android silently ignores the request after two denials, which is exactly why
     * the row falls back to [openNotificationSettings] rather than firing a dead request.
     */
    fun osCanPrompt(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

    /** Deep-link to this app's notification settings, for when the OS dialog is spent. */
    fun openNotificationSettings(context: Context) {
        val intent =
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
    }
}

/** Live notification state plus the one action the rows need. */
class NotificationNudgeState(
    val granted: Boolean,
    val osCanPrompt: Boolean,
    val onConfirm: () -> Unit,
)

/**
 * Remember the notification state and wire the confirm action: fire the real OS dialog while
 * it can still surface, and deep-link to app settings once it cannot. [refreshToken] is any
 * value that should force a re-read (the app passes the current tab, so returning to My
 * Shifts after a trip to system settings picks up the grant).
 */
@Composable
fun rememberNotificationNudge(refreshToken: Any? = null): NotificationNudgeState {
    val context = LocalContext.current
    var reads by remember { mutableStateOf(0) }
    val granted = remember(reads, refreshToken) { NotificationPrefs.granted(context) }
    val canPrompt = remember(reads, refreshToken) { NotificationPrefs.osCanPrompt(context) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Whatever the worker chose, re-read: a grant retires the row, a denial leaves it.
            reads += 1
        }
    return NotificationNudgeState(
        granted = granted,
        osCanPrompt = canPrompt,
        onConfirm = {
            if (canPrompt && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                NotificationPrefs.openNotificationSettings(context)
            }
        },
    )
}

/**
 * The ask itself: a single-line row with a bell, the benefit, and one clear action on the
 * right. Deliberately NOT dismissible and deliberately not a scrim: it costs nothing to
 * scroll past, which is what lets it stay until alerts are actually on.
 */
@Composable
fun NotificationNudgeRow(
    body: String,
    state: NotificationNudgeState,
    modifier: Modifier = Modifier,
    tag: String = "notification_nudge",
) {
    val c = ShiftTheme.colors
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(c.surface)
            .padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            ShiftIcons.Bell,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(18.dp),
        )
        Text(
            body,
            color = c.ink,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )
        ShiftButton(
            text = NotificationPriming.confirmLabel(state.osCanPrompt),
            onClick = state.onConfirm,
            variant = ButtonVariant.Filled,
            size = ButtonSize.Sm,
            modifier = Modifier.testTag("${tag}_confirm"),
        )
    }
}
