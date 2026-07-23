package com.pennhousing.shift.ui.house

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pennhousing.shift.shared.house.HouseGridBlock
import com.pennhousing.shift.shared.house.HouseOption
import com.pennhousing.shift.ui.kit.ButtonVariant
import com.pennhousing.shift.ui.kit.HouseBadge
import com.pennhousing.shift.ui.kit.ShiftBottomSheet
import com.pennhousing.shift.ui.kit.ShiftButton
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.theme.ShiftTheme

/** The house switcher (cross-house view): pick any house to read its schedule. */
@Composable
internal fun HousePickerSheet(
    houses: List<HouseOption>,
    selectedHouseId: String?,
    homeHouseId: String?,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = ShiftTheme.colors
    ShiftBottomSheet(onDismiss = onDismiss, title = "View a house") {
        Column(
            Modifier.fillMaxWidth().testTag("house_picker_sheet"),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            houses.forEach { house ->
                val selected = house.id == selectedHouseId
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f) else c.surface)
                        .border(1.dp, if (selected) MaterialTheme.colorScheme.primary else c.divider, RoundedCornerShape(12.dp))
                        .clickable { onPick(house.id) }
                        .padding(horizontal = 13.dp, vertical = 12.dp)
                        .testTag("house_picker_option"),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    HouseBadge(house.name.take(1), c.surfaceVar, c.ink)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(house.name, color = c.ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold)
                            if (house.id == homeHouseId) {
                                Text(
                                    "Your house",
                                    color = MaterialTheme.colorScheme.primary,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                        Text(house.deskPhone?.let { "Desk · $it" } ?: "No desk phone", color = c.sec, fontSize = 12.sp)
                    }
                    if (selected) {
                        Icon(
                            ShiftIcons.Check,
                            contentDescription = "Selected",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The §11.4 contact sheet: who covers the run + a call affordance (the worker's
 * phone via the full-directory ruling; the desk phone as the fallback line).
 */
@Composable
internal fun ContactSheet(
    block: HouseGridBlock,
    deskPhone: String?,
    deskHouseName: String?,
    onDismiss: () -> Unit,
) {
    val row = block
    val c = ShiftTheme.colors
    val context = LocalContext.current
    val name = row.workerName ?: "This shift"
    val tint = row.workerColorOrNull()
    val badgeBg = tint?.color ?: c.surfaceVar
    val badgeFg = tint?.onColor ?: c.ink
    // The float-in case: the person's own house is not the desk they're standing at, and
    // that is exactly what someone tapping the block needs to know.
    val houseLine =
        when {
            row.workerHouseName == null -> deskHouseName
            deskHouseName != null && !row.workerHouseName.equals(deskHouseName, ignoreCase = true) ->
                "${row.workerHouseName} (at $deskHouseName)"
            else -> row.workerHouseName
        }
    ShiftBottomSheet(onDismiss = onDismiss, title = "Shift details") {
        Column(
            Modifier.fillMaxWidth().testTag("contact_sheet"),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // The shift itself: what slot was tapped.
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.timeLabel,
                    style = ShiftTheme.type.monoTime,
                    color = c.ink,
                    modifier = Modifier.testTag("contact_time"),
                )
                Text(row.durationLabel(), color = c.sec, fontSize = 13.sp)
            }

            // The person on it, as a card.
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(c.surfaceVar)
                    .border(1.dp, c.divider, RoundedCornerShape(14.dp))
                    .padding(14.dp)
                    .testTag("contact_person_card"),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    HouseBadge(name.take(1), badgeBg, badgeFg)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            name,
                            color = c.ink,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.testTag("contact_name"),
                        )
                        houseLine?.let {
                            Text(it, color = c.sec, fontSize = 13.5.sp, modifier = Modifier.testTag("contact_house"))
                        }
                    }
                }
                ContactDetailRow(
                    icon = ShiftIcons.Phone,
                    value = row.workerPhone ?: "No phone on file",
                    muted = row.workerPhone == null,
                    tag = "contact_phone",
                )
                ContactDetailRow(
                    icon = ShiftIcons.Mail,
                    value = row.workerEmail ?: "No email on file",
                    muted = row.workerEmail == null,
                    tag = "contact_email",
                )
            }

            row.workerPhone?.let { phone ->
                ShiftButton(
                    "Call $name",
                    onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.dialable()}"))) },
                    modifier = Modifier.fillMaxWidth().testTag("contact_call_button"),
                    icon = ShiftIcons.Phone,
                    fullWidth = true,
                )
            }
            row.workerEmail?.let { email ->
                ShiftButton(
                    "Email $name",
                    onClick = { context.startActivity(emailIntent(email, row.timeLabel)) },
                    modifier = Modifier.fillMaxWidth().testTag("contact_email_button"),
                    variant = ButtonVariant.Outlined,
                    icon = ShiftIcons.Mail,
                    fullWidth = true,
                )
            }
            deskPhone?.let { phone ->
                ShiftButton(
                    "Call the desk · $phone",
                    onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.dialable()}"))) },
                    modifier = Modifier.fillMaxWidth().testTag("contact_call_desk"),
                    variant = ButtonVariant.Outlined,
                    fullWidth = true,
                )
            }
        }
    }
}

/** One labelled contact line (phone / email) inside the person card. */
@Composable
internal fun ContactDetailRow(
    icon: ImageVector,
    value: String,
    muted: Boolean,
    tag: String,
) {
    val c = ShiftTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null, tint = if (muted) c.ter else c.sec, modifier = Modifier.size(16.dp))
        Text(
            value,
            color = if (muted) c.ter else c.ink,
            fontSize = 14.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.testTag(tag),
        )
    }
}

/** Strip spacing so `tel:` gets a clean number for the dialer to prefill. */
internal fun String.dialable(): String = filterNot { it.isWhitespace() || it == '(' || it == ')' || it == '-' }

/**
 * ACTION_SENDTO on a `mailto:` uri — resolves ONLY to email apps (ACTION_SEND would also
 * offer every share target), with the tapped shift prefilled as the subject so the
 * recipient has context. Nothing is sent: the compose window opens for the worker.
 */
internal fun emailIntent(
    email: String,
    timeLabel: String,
): Intent =
    Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).apply {
        putExtra(Intent.EXTRA_EMAIL, arrayOf(email))
        putExtra(Intent.EXTRA_SUBJECT, "Shift on $timeLabel")
    }

// ===================================================================
// Manager actions on a vacant seat (BSpec §2.2 add-a-worker / §6.6 force-trigger).
// Shown only when the signed-in user is a manager on their OWN house (state.canManage).
// ===================================================================
