package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * A living catalog of the reskin foundation — every token + component, in one
 * scrollable screen. NOT a shipped screen; it exists for Android Studio `@Preview`
 * (light + dark) and as a compile-time exercise of the whole kit. Feature screens
 * are intentionally NOT built here (foundation only).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ComponentGallery(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        GroupTitle("Buttons")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ShiftButton("Filled", {}, variant = ButtonVariant.Filled)
            ShiftButton("Tonal", {}, variant = ButtonVariant.Tonal)
            ShiftButton("Outlined", {}, variant = ButtonVariant.Outlined)
            ShiftButton("Text", {}, variant = ButtonVariant.Text)
            ShiftButton("Decline", {}, variant = ButtonVariant.Destructive)
            ShiftButton("Drop", {}, variant = ButtonVariant.DestructiveFilled)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ShiftButton("Small", {}, size = ButtonSize.Sm)
            ShiftButton("Medium", {}, size = ButtonSize.Md)
            ShiftButton("Large", {}, size = ButtonSize.Lg, icon = ShiftIcons.Check)
        }

        GroupTitle("Status pills")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatePill(ShiftState.FLOAT_OUT)
            StatePill(ShiftState.FLOAT_IN)
            StatePill(ShiftState.PERMANENT)
            StatePill(ShiftState.ALLIED)
            StatePill(ShiftState.ACK)
            StatePill(ShiftState.UNPICKABLE)
            PendingTag()
        }

        GroupTitle("Worker state legend")
        StateLegend()

        GroupTitle("Shift cards")
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ShiftCard(ShiftState.SCHEDULED, "H", "09:00 – 13:00", houseName = "Harnwell", durationLabel = "4h", onClick = {})
            ShiftCard(
                ShiftState.FLOAT_OUT,
                "Q",
                "21:00 – 23:00",
                eyebrow = "Today",
                houseName = "Harnwell",
                destination = "Quad",
                durationLabel = "2h",
                onClick = {},
            )
            ShiftCard(ShiftState.PENDING_FLOAT, "Q", "21:00 – 23:00", houseName = "Harnwell", destination = "Quad", onClick = {})
            ShiftCard(ShiftState.PICKUP_HOME, "H", "13:00 – 15:00", houseName = "Harnwell", onClick = {})
            ShiftCard(ShiftState.FLOAT_IN, "H", "18:00 – 20:00", houseName = "from Quad", onClick = {})
            ShiftCard(ShiftState.BREAK, "H", "10:00 – 14:00", houseName = "Harnwell", durationLabel = "4h")
            ShiftCard(ShiftState.ACK, "Q", "21:00 – 23:00", houseName = "Quad")
            ShiftCard(ShiftState.DROPPED, "H", "15:00 – 17:00", houseName = "Harnwell")
            ShiftCard(ShiftState.ALLIED, "L", "22:00 – 24:00", houseName = "Lauder")
            ShiftCard(ShiftState.SCHEDULED, "H", "09:00 – 11:00", houseName = "Harnwell", active = true, onClick = {})
        }

        GroupTitle("Open shifts")
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OpenShiftCard(
                ShiftState.OPEN,
                "H",
                "16:00 – 18:00",
                eyebrow = "Wed · Jun 3",
                houseName = "Harnwell",
                actionLabel = "Claim",
                onAction = {},
            )
            OpenShiftCard(
                ShiftState.PERMANENT,
                "Q",
                "Every Wed · 18:00 – 20:00",
                houseName = "Quad",
                meta = "8 weeks remaining",
                actionLabel = "Pick up",
                actionVariant = ButtonVariant.Tonal,
                onAction = {},
            )
            OpenShiftCard(ShiftState.UNPICKABLE, "H", "14:00 – 16:00", houseName = "Harnwell", meta = "Locked — within 2h of start")
        }

        GroupTitle("Sections & rows")
        ShiftSection("Picked up", isEmpty = false, count = 1) {
            ShiftCard(ShiftState.PICKUP_HOME, "H", "13:00 – 15:00", houseName = "Harnwell")
        }
        ShiftSection("Dropped", isEmpty = true) {}
        Column {
            KeyValueRow("Weekly soft cap", value = "20h")
            KeyValueRow("Break hard cap", value = "40h", last = true)
        }

        GroupTitle("Controls")
        var seg by remember { mutableIntStateOf(0) }
        SegmentedControl(listOf("My House", "Other Houses"), seg, { seg = it })
        var on by remember { mutableStateOf(true) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ShiftSwitch(on, { on = it })
            DurationChip("2h")
            DurationChip("30m", tone = DurationTone.Blue)
            CountBadge(3)
        }

        GroupTitle("Feedback")
        ShiftBanner(
            "You're needed at Quad",
            body = "Float starts in 2h 14m. Acknowledge before 20:50.",
            tone = BannerTone.Warning,
            actionLabel = "View",
            onAction = {},
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CountdownChip("Respond by 20:50 · 06:11")
            CountdownChip("02:30 left", tone = CountdownTone.Urgent)
            CountdownChip("Deadline passed", tone = CountdownTone.Passed)
        }
        ShiftToast("Shift claimed", tone = ToastTone.Success, icon = ShiftIcons.Check)
        SkeletonShiftCard()
        EmptyState("All caught up", ShiftIcons.Bell, body = "No action needed right now.")
    }
}

@Composable
private fun GroupTitle(text: String) {
    Text(text, color = ShiftTheme.colors.ink, fontSize = 18.sp, fontWeight = FontWeight.Bold)
}

/** Chrome preview — the M3 large top bar + NavigationBar around the gallery. */
@Composable
fun ChromeShowcase() {
    var tab by remember { mutableIntStateOf(0) }
    Scaffold(
        topBar = {
            ShiftTopBar(
                title = "My Shifts",
                context = "This week · Jun 1 – 7",
                avatarInitial = "A",
                actions = { ShiftIconButton(ShiftIcons.Bell, {}, badgeCount = 2, contentDescription = "Updates") },
            )
        },
        bottomBar = {
            ShiftBottomNav(
                items = WorkerNavItems.mapIndexed { i, it -> if (i == 3) it.copy(badge = 2) else it },
                selectedIndex = tab,
                onSelect = { tab = it },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxWidth().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ShiftCard(ShiftState.SCHEDULED, "H", "09:00 – 13:00", houseName = "Harnwell", durationLabel = "4h", onClick = {})
            ShiftCard(ShiftState.FLOAT_OUT, "Q", "21:00 – 23:00", houseName = "Harnwell", destination = "Quad", onClick = {})
        }
    }
}

@Preview(name = "Gallery · Light", heightDp = 2200)
@Composable
private fun GalleryLightPreview() {
    ShiftTheme(darkTheme = false) { ComponentGallery() }
}

@Preview(name = "Gallery · Dark", heightDp = 2200)
@Composable
private fun GalleryDarkPreview() {
    ShiftTheme(darkTheme = true) { ComponentGallery() }
}

@Preview(name = "Chrome · Light")
@Composable
private fun ChromeLightPreview() {
    ShiftTheme(darkTheme = false) { ChromeShowcase() }
}

@Preview(name = "Chrome · Dark")
@Composable
private fun ChromeDarkPreview() {
    ShiftTheme(darkTheme = true) { ChromeShowcase() }
}
