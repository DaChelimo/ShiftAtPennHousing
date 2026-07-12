package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.theme.ShiftTheme
import com.pennhousing.shift.ui.theme.rememberPersistedDarkTheme

/**
 * Staggered-launch placeholder (rollout). Shown to a worker whose home house has not
 * gone live yet: they are signed in, but the app is held back until an admin switches
 * their house on. No em dashes in surfaced copy.
 */
@Composable
fun HouseNotLiveScreen(
    houseName: String,
    onSignOut: () -> Unit,
) {
    ShiftTheme(darkTheme = rememberPersistedDarkTheme()) {
        val c = ShiftTheme.colors
        Scaffold(modifier = Modifier.fillMaxSize().testTag("house_not_live")) { padding ->
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(c.bg)
                        .padding(padding)
                        .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "Shift isn't live at $houseName yet",
                    color = c.ink,
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.testTag("house_not_live_title"),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text =
                        "We're rolling Shift out house by house, and $houseName is coming soon. " +
                            "You'll be able to see your shifts, pick up open shifts, and manage " +
                            "swaps here as soon as your house goes live.",
                    color = c.sec,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))
                ShiftButton(
                    text = "Sign out",
                    onClick = onSignOut,
                    variant = ButtonVariant.Outlined,
                    fullWidth = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
