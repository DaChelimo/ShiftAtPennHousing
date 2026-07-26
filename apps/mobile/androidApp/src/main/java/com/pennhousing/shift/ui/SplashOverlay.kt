package com.pennhousing.shift.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.pennhousing.shift.R
import kotlinx.coroutines.delay

/**
 * In-app continuation of the cold-start splash. MainActivity's `installSplashScreen()`
 * shows the OS splash (Theme.ShiftPennHousing.Splash, background only) and releases it the
 * instant Compose attaches; this composable then shows the full "SHIFT AT PENN" horizontal
 * lockup for a short beat before handing off to real content.
 *
 * This does NOT use `windowSplashScreenAnimatedIcon`: that slot is sized/masked for a small
 * square icon and clips or oddly rescales a wide wordmark image, so the lockup is rendered
 * here instead, once Compose can lay it out properly. The background color matches the
 * native splash theme exactly (same @color/splash_background), so there is no visible seam.
 */
private const val SPLASH_MIN_VISIBLE_MS = 450L

@Composable
fun SplashOverlay(onFinished: () -> Unit) {
    LaunchedEffect(Unit) {
        delay(SPLASH_MIN_VISIBLE_MS)
        onFinished()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colorResource(R.color.splash_background)),
        contentAlignment = Alignment.Center,
    ) {
        // R.drawable.splash_lockup resolves to drawable/ (light) or drawable-night/ (dark)
        // automatically via the resource qualifier system.
        Image(
            painter = painterResource(R.drawable.splash_lockup),
            contentDescription = null,
            modifier = Modifier.width(220.dp),
        )
    }
}
