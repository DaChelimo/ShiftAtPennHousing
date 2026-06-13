package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.Dimens
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme

/**
 * The worker-app bottom sheet (worker-app.html `Sheet`) — the M3
 * [ModalBottomSheet] with the brand 28dp top radius, a custom grabber, the brand
 * scrim, and an optional header (title + close). This IS the dialog pattern in the
 * design; confirmations are [ShiftConfirmSheet]s. (Android uses the M3 modal sheet;
 * iOS uses a native `.sheet` with detents + grabber — the native-chrome difference.)
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalComposeUiApi::class)
@Composable
fun ShiftBottomSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable () -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier,
        sheetState = state,
        shape = ShiftShapes.sheet,
        containerColor = ShiftTheme.colors.surface,
        scrimColor = ShiftTheme.colors.scrim,
        dragHandle = { Grabber() },
    ) {
        if (title != null) SheetHeader(title, onDismiss)
        Column(
            Modifier
                .fillMaxWidth()
                // The modal sheet is its own window — re-enable resource-id testTags
                // so Maestro's `id:` selectors see the sheet's controls.
                .semantics { testTagsAsResourceId = true }
                .padding(horizontal = 18.dp)
                .padding(top = 8.dp, bottom = 28.dp),
        ) {
            content()
        }
    }
}

@Composable
private fun Grabber() {
    Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(width = Dimens.grabberWidth, height = Dimens.grabberHeight)
                .background(ShiftTheme.colors.outline, ShiftShapes.pill),
        )
    }
}

@Composable
private fun SheetHeader(
    title: String,
    onClose: () -> Unit,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(start = 18.dp, end = 14.dp, top = 6.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(title, color = c.ink, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        Box(
            Modifier
                .size(30.dp)
                .clip(ShiftShapes.pill)
                .background(c.surfaceVar)
                .clickable(onClick = onClose),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ShiftIcons.Close, contentDescription = "Close", tint = c.sec, modifier = Modifier.size(16.dp))
        }
    }
}

/**
 * A confirm-in-a-sheet (drop / decline, etc.). [confirmVariant] is typically
 * [ButtonVariant.DestructiveFilled] for destructive confirms or
 * [ButtonVariant.Filled] otherwise.
 */
@Composable
fun ShiftConfirmSheet(
    title: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    body: String? = null,
    cancelLabel: String = "Cancel",
    confirmVariant: ButtonVariant = ButtonVariant.Filled,
) {
    ShiftBottomSheet(onDismiss = onDismiss, modifier = modifier, title = title) {
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (body != null) Text(body, color = ShiftTheme.colors.sec, fontSize = 15.sp, lineHeight = 21.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ShiftButton(cancelLabel, onDismiss, modifier = Modifier.weight(1f), variant = ButtonVariant.Outlined)
                ShiftButton(confirmLabel, onConfirm, modifier = Modifier.weight(1f), variant = confirmVariant)
            }
        }
    }
}

/**
 * A centered alert dialog (M3 [AlertDialog]) with brand shape/colors, for the rare
 * cases that want a dialog rather than a sheet.
 */
@Composable
fun ShiftAlertDialog(
    title: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    text: String? = null,
    dismissLabel: String? = "Cancel",
    confirmVariant: ButtonVariant = ButtonVariant.Filled,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        shape = ShiftShapes.card,
        containerColor = ShiftTheme.colors.surface,
        title = { Text(title, fontSize = 19.sp, fontWeight = FontWeight.Bold) },
        text = text?.let { msg -> { Text(msg, color = ShiftTheme.colors.sec, fontSize = 15.sp) } },
        confirmButton = { ShiftButton(confirmLabel, onConfirm, variant = confirmVariant, size = ButtonSize.Sm) },
        dismissButton =
            if (dismissLabel != null) {
                { ShiftButton(dismissLabel, onDismiss, variant = ButtonVariant.Text, size = ButtonSize.Sm) }
            } else {
                null
            },
    )
}
