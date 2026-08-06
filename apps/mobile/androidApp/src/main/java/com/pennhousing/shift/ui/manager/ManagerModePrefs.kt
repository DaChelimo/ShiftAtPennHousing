package com.pennhousing.shift.ui.manager

import android.content.Context
import com.pennhousing.shift.shared.manager.CachedRoleShape
import com.pennhousing.shift.shared.manager.decodeRoleShape
import com.pennhousing.shift.shared.manager.encodeRoleShape

/**
 * On-device storage for the remembered app shape (docs/manager-app/SPEC.md §5.1). The Android half
 * of [com.pennhousing.shift.shared.manager.ManagerRoleCache]; the iOS half is `UserDefaults`.
 *
 * `SharedPreferences` on purpose, matching `ThemePrefs`. The first `getSharedPreferences` on a
 * process loads the file on the calling thread and then serves from an in-memory map, so [read] on
 * the launch path is a map lookup rather than I/O. That is the whole point: the app shape has to be
 * known BEFORE the first frame, and anything asynchronous (DataStore, a database, the network) puts
 * a flip back into every launch.
 *
 * NOT A SECURITY BOUNDARY. `MODE_PRIVATE` keeps this out of other apps' reach, but a rooted device
 * can edit it freely, and that is fine because nothing here is trusted for authorization. See the
 * header on `ManagerRoleCache.kt`.
 */
internal object ManagerModePrefs {
    private const val PREFS = "manager_mode"
    private const val KEY = "role_shape"

    /** The stored shape, or null when absent, stale-versioned, or malformed. */
    fun read(context: Context): CachedRoleShape? = decodeRoleShape(prefs(context).getString(KEY, null))

    fun write(
        context: Context,
        shape: CachedRoleShape,
    ) {
        prefs(context).edit().putString(KEY, encodeRoleShape(shape)).apply()
    }

    /**
     * Forget the shape. Called on sign-out, so the next person to sign in on this phone gets a
     * cache miss and one honest slow launch rather than inheriting somebody else's tabs.
     *
     * [read] already refuses a shape belonging to a different user id, so this is belt and
     * braces. It is worth having both: the user-id check is what protects correctness, and
     * clearing is what stops a signed-out phone from carrying a record of who last used it.
     */
    fun clear(context: Context) {
        prefs(context).edit().remove(KEY).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
