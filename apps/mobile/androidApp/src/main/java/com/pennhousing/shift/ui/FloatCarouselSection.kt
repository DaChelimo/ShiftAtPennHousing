package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.ack.FloatRequestCard
import com.pennhousing.shift.shared.viewmodel.FloatCarouselUiState
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/** The brand blue (#0061FC) — the float card is intentionally this exact swatch in both
 *  themes so the request is unmistakable (white text on solid brand blue). */
private val FloatCardBlue = Color(0xFF0061FC)

/**
 * The My-Shifts float-request carousel (§7.1) — a prominent brand-blue card stack that
 * sits directly under the "This week — Xh" chip (both Week and Day modes) so an
 * outstanding float can't be missed in the Updates feed. One full-width card per
 * pending float, SORTED closest-start first; swipe advances to the next. Accept/Decline
 * live on the card (primary action); tapping the body opens the full ack hero for
 * detail. When the last one is resolved the stack collapses and the host snackbars.
 *
 * Pure-blue by request (white bold/medium text) — it intentionally overrides the
 * theme surface to stand out. The data + accept/decline machine are the shared
 * [FloatCarouselUiState] / FloatCarouselViewModel; this is the thin Compose skin.
 */
@Composable
fun FloatRequestCarousel(
    state: FloatCarouselUiState,
    onAccept: (String) -> Unit,
    onDecline: (String) -> Unit,
    onOpenDetail: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val cards = state.cards
    if (cards.isEmpty()) return

    val pagerState = rememberPagerState(pageCount = { cards.size })

    Column(
        modifier = modifier.fillMaxWidth().testTag("float_carousel"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        HorizontalPager(
            state = pagerState,
            pageSpacing = 10.dp,
            contentPadding = PaddingValues(horizontal = 16.dp),
        ) { page ->
            // Guard: the page count shrinks as cards resolve; clamp defensively.
            val card = cards.getOrNull(page) ?: cards.last()
            FloatRequestCardView(
                card = card,
                position = page + 1,
                total = cards.size,
                onAccept = { onAccept(card.floatId) },
                onDecline = { onDecline(card.floatId) },
                onOpenDetail = { onOpenDetail(card.floatId) },
            )
        }
        if (cards.size > 1) {
            PagerDots(count = cards.size, selected = pagerState.currentPage)
        }
    }
}

@Composable
private fun FloatRequestCardView(
    card: FloatRequestCard,
    position: Int,
    total: Int,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onOpenDetail: () -> Unit,
) {
    val blue = FloatCardBlue
    val white = Color.White
    val white80 = Color.White.copy(alpha = 0.82f)

    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(blue)
                .clickable(onClick = onOpenDetail)
                .padding(18.dp)
                .testTag("float_card"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                Icon(ShiftIcons.FloatOut, contentDescription = null, tint = white, modifier = Modifier.size(18.dp))
                Text(
                    "FLOAT REQUEST",
                    color = white,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp,
                )
            }
            if (total > 1) {
                Text("$position of $total", color = white80, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        Text(
            "You're needed at ${card.destinationName}",
            color = white,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon(ShiftIcons.Clock, contentDescription = null, tint = white80, modifier = Modifier.size(16.dp))
            Text(
                "${card.whenLabel} · ${card.rangeLabel}",
                color = white,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Text(
            "${card.startsInLabel} · ${card.durationLabel}",
            color = white80,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )

        if (card.respondable) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // Accept — solid white pill, blue label (primary).
                FloatCardButton(
                    text = "Accept",
                    icon = ShiftIcons.Check,
                    container = white,
                    content = blue,
                    border = false,
                    onClick = onAccept,
                    modifier = Modifier.weight(1f).testTag("float_card_accept"),
                )
                // Decline — outlined white (secondary).
                FloatCardButton(
                    text = "Decline",
                    icon = ShiftIcons.Close,
                    container = Color.Transparent,
                    content = white,
                    border = true,
                    onClick = onDecline,
                    modifier = Modifier.weight(1f).testTag("float_card_decline"),
                )
            }
        } else {
            Text(
                "This float has been reassigned to another worker.",
                color = white80,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun FloatCardButton(
    text: String,
    icon: ImageVector,
    container: Color,
    content: Color,
    border: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .heightIn(min = 44.dp)
                .clip(RoundedCornerShape(12.dp))
                .then(if (border) Modifier.border(1.5.dp, Color.White.copy(alpha = 0.7f), RoundedCornerShape(12.dp)) else Modifier)
                .background(container)
                .clickable(onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(7.dp))
        Text(text, color = content, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PagerDots(
    count: Int,
    selected: Int,
) {
    Row(
        Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { i ->
            val active = i == selected
            Box(
                Modifier
                    .padding(horizontal = 3.dp)
                    .size(if (active) 8.dp else 6.dp)
                    .clip(CircleShape)
                    .background(
                        if (active) FloatCardBlue else ShiftTheme.colors.outline,
                    ),
            )
        }
    }
}
