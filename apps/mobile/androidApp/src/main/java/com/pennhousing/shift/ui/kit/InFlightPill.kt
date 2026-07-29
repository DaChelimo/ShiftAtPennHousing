package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The "we are doing this right now" pill that stands in for a card's action while its
 * write is in flight (shifts/PendingWrites.kt).
 *
 * It replaces the button rather than sitting next to it, on purpose: the whole reason
 * the optimistic path was removed is that a worker who is shown a result they have not
 * got taps again. There is nothing to tap here.
 *
 * A spinner plus a word, not a spinner alone: a bare spinner on a shift card does not
 * say whether it is claiming, dropping, or loading something unrelated.
 */
@Composable
fun InFlightPill(
    label: String,
    modifier: Modifier = Modifier,
) {
    val c = ShiftTheme.colors
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(c.surfaceVar)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .semantics { contentDescription = label }
            .testTag("in_flight_pill"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(12.dp),
            strokeWidth = 1.5.dp,
            color = c.sec,
        )
        Text(label, color = c.sec, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
    }
}
