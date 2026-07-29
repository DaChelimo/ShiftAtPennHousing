package com.pennhousing.shift.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.R
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.rememberPersistedDarkTheme
import kotlinx.coroutines.delay

/**
 * In-app continuation of the cold-start splash. MainActivity's `installSplashScreen()` shows
 * the OS splash (Theme.ShiftPennHousing.Splash, background only) and releases it the instant
 * Compose attaches; this composable then shows the full "SHIFT AT PENN" horizontal lockup.
 *
 * This does NOT use `windowSplashScreenAnimatedIcon`: that slot is sized/masked for a small
 * square icon and clips or oddly rescales a wide wordmark image, so the lockup is rendered
 * here instead, once Compose can lay it out properly. The background color matches the
 * native splash theme exactly (same @color/splash_background), so there is no visible seam.
 *
 * It stays up until the app has something REAL to show (see `MainActivity`): the login
 * screen, or the signed-in worker's own week. It used to hand off after a fixed 450ms to a
 * skeleton loading screen, which read as: brand splash, then a stray loading state, then the
 * content. One continuous splash is the whole point of having one.
 *
 * [caption] names what is being waited on when the wait is the worker's own doing ("Signing
 * you in"); it is null on a cold launch, where there is nothing to say beyond the brand. The
 * caption and spinner fade in only after [PROGRESS_AFTER_MS], so a fast launch shows a
 * clean, still splash and never a flash of loading chrome.
 */
private const val PROGRESS_AFTER_MS = 600L

@Composable
fun SplashOverlay(caption: String? = null) {
    var showProgress by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(PROGRESS_AFTER_MS)
        showProgress = true
    }

    // Self-themed: the splash renders above (and before) the app's own theme scope.
    ShiftTheme(darkTheme = rememberPersistedDarkTheme()) {
        SplashBody(caption = caption, showProgress = showProgress)
    }
}

@Composable
private fun SplashBody(
    caption: String?,
    showProgress: Boolean,
) {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(colorResource(R.color.splash_background))
                .testTag("splash_screen"),
        contentAlignment = Alignment.Center,
    ) {
        // R.drawable.splash_lockup resolves to drawable/ (light) or drawable-night/ (dark)
        // automatically via the resource qualifier system.
        Image(
            painter = painterResource(R.drawable.splash_lockup),
            contentDescription = null,
            modifier = Modifier.width(220.dp),
        )
        // Below the lockup, without moving it: the mark stays exactly where the OS splash
        // left it, so the handoff is invisible.
        if (showProgress) {
            Column(
                modifier = Modifier.fillMaxSize().padding(bottom = 72.dp),
                verticalArrangement = Arrangement.Bottom,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                if (caption != null) {
                    Text(
                        caption,
                        modifier = Modifier.padding(top = 12.dp),
                        color = ShiftTheme.colors.sec,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}
