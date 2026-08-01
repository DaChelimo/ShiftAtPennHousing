package com.pennhousing.shift.shared.ack

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * Push → full-screen Float Acknowledgment routing (T2-13 / D1) — PURE.
 *
 * The phase-12 `dispatch-push` Edge Function sends DATA-ONLY FCM messages:
 * `{ notification_id, type, payload: "<json>" }` where the float-assignment
 * payload carries `kind = 'float_assigned'`, `float_id`, and optional
 * title/body. Both platforms route a tapped push (or an external deep link)
 * through these helpers, so the link grammar and the data-message display
 * mapping are tested once. FCM credentials remain deploy-config — the deep
 * link itself is exercisable locally (`adb shell am start -d <link>`).
 */

const val FLOAT_ACK_SCHEME: String = "pennshift"
const val FLOAT_ACK_HOST: String = "float-ack"

/** The canonical deep link that opens the full-screen ack for [floatId]. */
fun floatAckDeepLink(floatId: String): String = "$FLOAT_ACK_SCHEME://$FLOAT_ACK_HOST/$floatId"

/**
 * Parse a deep link back to its float id, or null when [uri] is not a
 * float-ack link (wrong scheme/host, blank id). Scheme/host match
 * case-insensitively; a trailing slash / query / fragment is tolerated.
 */
fun parseFloatAckDeepLink(uri: String?): String? {
    if (uri == null) return null
    val prefix = "$FLOAT_ACK_SCHEME://$FLOAT_ACK_HOST/"
    if (uri.length <= prefix.length) return null
    if (!uri.substring(0, prefix.length).equals(prefix, ignoreCase = true)) return null
    val id =
        uri
            .substring(prefix.length)
            .substringBefore('?')
            .substringBefore('#')
            .trim('/')
    return id.ifBlank { null }
}

/** What a delivered DATA push should display + route to. */
data class PushDisplay(
    val title: String,
    val body: String,
    /** Non-null → tapping the notification deep-links into the full-screen ack. */
    val floatId: String?,
)

private val pushJson = Json { ignoreUnknownKeys = true }

/**
 * Map a `dispatch-push` DATA message (`type` + the stringified `payload`) to its
 * display + routing. A `float_assigned` payload routes to the ack surface via its
 * `float_id`; anything else is informational. Falls back to generic copy when the
 * payload is missing/unparseable — a delivered push must never display blank.
 */
fun pushDisplayFromData(
    type: String?,
    payloadJson: String?,
    appName: String = "SHIFT",
): PushDisplay {
    val payload =
        payloadJson?.let { raw ->
            runCatching { pushJson.decodeFromString<JsonObject>(raw) }.getOrNull()
        }
    fun field(key: String): String? = payload?.get(key)?.jsonPrimitive?.content
    val isFloat = field("kind") == "float_assigned"
    val floatId = if (isFloat) field("float_id") else null
    return PushDisplay(
        title = field("title") ?: if (isFloat) "Float assignment" else appName,
        body =
            field("body")
                ?: field("message")
                ?: if (floatId != null) "You've been floated. Tap to acknowledge." else (type ?: ""),
        floatId = floatId,
    )
}
