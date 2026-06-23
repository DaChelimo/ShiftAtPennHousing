package com.pennhousing.shift.ui.theme

import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.pennhousing.shift.shared.settings.ThemeChoice

/**
 * Persists the in-app appearance choice (System / Light / Dark) so the toggle survives
 * relaunch — the "host concern" the shared `Settings` model defers to the platform.
 *
 * The token palettes already resolve from [isSystemInDarkTheme]; this stores the user's
 * override and resolves it to the [ShiftTheme] `darkTheme` flag. The in-session source of
 * truth is the `SettingsViewModel` (so an in-app toggle re-themes live); this durable
 * mirror seeds that VM at launch and is what login / loading read before a VM exists.
 */
object ThemePrefs {
    private const val PREFS = "appearance"
    private const val KEY = "theme_choice"

    fun read(context: Context): ThemeChoice =
        when (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)) {
            "light" -> ThemeChoice.LIGHT
            "dark" -> ThemeChoice.DARK
            else -> ThemeChoice.SYSTEM
        }

    fun write(
        context: Context,
        choice: ThemeChoice,
    ) {
        val raw =
            when (choice) {
                ThemeChoice.LIGHT -> "light"
                ThemeChoice.DARK -> "dark"
                ThemeChoice.SYSTEM -> "system"
            }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, raw).apply()
    }
}

/** Resolve a [ThemeChoice] to dark/light, deferring to the OS appearance for SYSTEM. */
@Composable
fun ThemeChoice.resolveDark(): Boolean =
    when (this) {
        ThemeChoice.LIGHT -> false
        ThemeChoice.DARK -> true
        ThemeChoice.SYSTEM -> isSystemInDarkTheme()
    }

/** The persisted choice resolved to dark/light — for chrome shown before a VM exists. */
@Composable
fun rememberPersistedDarkTheme(): Boolean {
    val context = LocalContext.current
    val choice = remember { ThemePrefs.read(context) }
    return choice.resolveDark()
}
