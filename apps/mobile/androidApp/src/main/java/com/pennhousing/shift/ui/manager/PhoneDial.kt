package com.pennhousing.shift.ui.manager

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Open the dialer on [number], pre-filled but NOT dialled.
 *
 * `ACTION_DIAL`, deliberately, not `ACTION_CALL`. `ACTION_CALL` places the call immediately and
 * needs the `CALL_PHONE` permission; `ACTION_DIAL` needs no permission and leaves the manager one
 * deliberate tap away from connecting. On the Respond sheet that matters: an accidental brush
 * against "Call Allied" should not silently start a call at 22:00.
 *
 * Best-effort. A device with no dialer (a tablet) throws `ActivityNotFoundException`, which is not
 * worth crashing the app over: the number is already visible on the button, so the manager can
 * still act.
 */
internal fun dialPhoneNumber(
    context: Context,
    number: String,
) {
    val cleaned = number.trim()
    if (cleaned.isEmpty()) return
    runCatching {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$cleaned")))
    }
}
