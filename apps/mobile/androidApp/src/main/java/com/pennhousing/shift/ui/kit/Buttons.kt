package com.pennhousing.shift.ui.kit

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.ui.theme.Dimens
import com.pennhousing.shift.ui.theme.Motion
import com.pennhousing.shift.ui.theme.ShiftShapes
import com.pennhousing.shift.ui.theme.ShiftTheme

/** worker-app.html `Btn` kinds. */
enum class ButtonVariant { Filled, Tonal, Outlined, Text, Destructive, DestructiveFilled, Success }

/** worker-app.html `Btn` sizes (heights 34 / 44 / 52). */
enum class ButtonSize { Sm, Md, Lg }

/**
 * The canonical worker-app button. Filled is the primary blue; tonal is the soft
 * blue container; outlined/text are the low-emphasis variants; the two destructive
 * variants are used in the drop / decline confirms. Press = scale(0.97) (no color
 * change), matching the design. Flat by design — no Material elevation.
 */
@Composable
fun ShiftButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Filled,
    size: ButtonSize = ButtonSize.Md,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    fullWidth: Boolean = false,
    /**
     * Work is in flight: an inline spinner takes the icon's place. The label stays the
     * caller's, so the button both SAYS what is happening ("Signing in…") and shows movement
     * while it does. A button that only changes its words reads as a button that did nothing.
     * Pair with `enabled = false` to also block a second tap.
     */
    loading: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val height =
        when (size) {
            ButtonSize.Sm -> Dimens.buttonHeightSm
            ButtonSize.Md -> Dimens.buttonHeightMd
            ButtonSize.Lg -> Dimens.buttonHeightLg
        }
    val labelSize = when (size) {
        ButtonSize.Sm -> 14.sp
        ButtonSize.Md -> 16.sp
        ButtonSize.Lg -> 17.sp
    }
    val iconSize = if (size == ButtonSize.Sm) Dimens.iconSm else Dimens.icon
    val hPad = if (size == ButtonSize.Sm) 14.dp else 20.dp
    val shape = if (size == ButtonSize.Sm) ShiftShapes.buttonSmall else ShiftShapes.button

    val base =
        modifier
            .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
            .heightIn(min = height)
            .pressScale(interaction, Motion.PRESS_SCALE_BUTTON)
    val contentPad = PaddingValues(horizontal = if (variant == ButtonVariant.Text) 8.dp else hPad)

    val label: @Composable () -> Unit = {
        Row(
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement
                .spacedBy(7.dp),
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(iconSize),
                    strokeWidth = 2.dp,
                    color = LocalContentColor.current,
                )
            } else if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(iconSize))
            }
            Text(text, fontSize = labelSize, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }

    val flat = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp, 0.dp, 0.dp)

    when (variant) {
        ButtonVariant.Outlined ->
            OutlinedButton(
                onClick = onClick,
                modifier = base,
                enabled = enabled,
                shape = shape,
                interactionSource = interaction,
                contentPadding = contentPad,
                border = BorderStroke(Dimens.outlineStroke, ShiftTheme.colors.outline),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = ShiftTheme.colors.ink),
                content = { label() },
            )
        ButtonVariant.Text ->
            TextButton(
                onClick = onClick,
                modifier = base,
                enabled = enabled,
                shape = shape,
                interactionSource = interaction,
                contentPadding = contentPad,
                content = { label() },
            )
        else ->
            Button(
                onClick = onClick,
                modifier = base,
                enabled = enabled,
                shape = shape,
                interactionSource = interaction,
                contentPadding = contentPad,
                elevation = flat,
                colors = variant.colors(),
                content = { label() },
            )
    }
}

@Composable
private fun ButtonVariant.colors(): ButtonColors {
    val c = ShiftTheme.colors
    return when (this) {
        ButtonVariant.Filled -> ButtonDefaults.buttonColors(
            containerColor = MaterialBlue(),
            contentColor = androidx.compose.ui.graphics.Color.White,
        )
        ButtonVariant.Tonal -> ButtonDefaults.buttonColors(containerColor = BlueContainer(), contentColor = c.onBlueContainer)
        ButtonVariant.Destructive -> ButtonDefaults.buttonColors(containerColor = c.danger.tint, contentColor = c.danger.accent)
        ButtonVariant.DestructiveFilled -> ButtonDefaults.buttonColors(
            containerColor = c.danger.accent,
            contentColor = androidx.compose.ui.graphics.Color.White,
        )
        ButtonVariant.Success -> ButtonDefaults.buttonColors(containerColor = c.success.tint, contentColor = c.success.accent)
        // Outlined/Text never reach here.
        else -> ButtonDefaults.buttonColors()
    }
}

@Composable private fun MaterialBlue() = androidx.compose.material3.MaterialTheme.colorScheme.primary

@Composable private fun BlueContainer() = androidx.compose.material3.MaterialTheme.colorScheme.primaryContainer
