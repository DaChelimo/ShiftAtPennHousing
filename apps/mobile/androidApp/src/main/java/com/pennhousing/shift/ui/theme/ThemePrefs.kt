package com.pennhousing.shift.ui.theme

import android.content.Context
import android.content.res.Configuration
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

/**
 * Non-Compose counterpart of [resolveDark], for the one caller that must resolve SYSTEM
 * before any composition exists: `MainActivity.onCreate`, seeding the splash's dark flag.
 *
 * Root-caused a real bug (2026-08-01): the splash previously called the `@Composable`
 * [resolveDark] via [rememberPersistedDarkTheme], which for SYSTEM defers to
 * `isSystemInDarkTheme()`. On a cold launch (and again the instant `SplashOverlay`
 * re-enters composition after sign-in), that is the FIRST composition pass for that call
 * site, and `isSystemInDarkTheme()` can resolve against a not-yet-settled
 * `LocalConfiguration` on that very first pass — so on a system-dark device the splash's
 * first (and, being a splash, ONLY meaningfully visible) frame rendered light, while
 * `ShiftsApp`/`LoginRoute` — composed at least one pass later — always saw the settled,
 * correct value. Reading [Configuration.uiMode] directly here is a plain field read against
 * the Activity's Resources, the exact same source `values-night` resource qualifiers (and so
 * the native `Theme.ShiftPennHousing.Splash`) already resolved against — no composition,
 * no timing gap, so it can never disagree with what the native splash just showed.
 */
fun ThemeChoice.resolveDark(configuration: Configuration): Boolean =
    when (this) {
        ThemeChoice.LIGHT -> false
        ThemeChoice.DARK -> true
        ThemeChoice.SYSTEM ->
            (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    }

/** The persisted choice resolved to dark/light — for chrome shown before a VM exists. */
@Composable
fun rememberPersistedDarkTheme(): Boolean {
    val context = LocalContext.current
    val choice = remember { ThemePrefs.read(context) }
    return choice.resolveDark()
}
