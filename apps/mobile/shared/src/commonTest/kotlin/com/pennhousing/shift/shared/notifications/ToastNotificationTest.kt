package com.pennhousing.shift.shared.notifications

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Regression for the 2026-07-29 defect: the in-app toast never fired, for any
 * notification, on either platform.
 *
 * `observeNotifications` streams realtime INSERTs on `notifications` and the old mapping
 * read `row["title"]`. That is not a column. Every producer writes its copy inside
 * `payload`, so the mapping returned null every single time and the toast was dead code
 * from the day it shipped.
 */
class ToastNotificationTest {
    private fun row(json: String): JsonObject = Json.decodeFromString(JsonObject.serializer(), json)

    @Test
    fun readsTitleAndBodyFromPayload() {
        // The exact row shape `notify_shift_opened` (migration 20260729000013) writes.
        val toast =
            toastFromNotificationRow(
                row(
                    """
                    {
                      "notification_id": "11111111-1111-4111-8111-111111111111",
                      "recipient_user_id": "22222222-2222-4222-8222-222222222222",
                      "type": "shift_opened",
                      "delivered_at": null,
                      "acknowledged_at": null,
                      "payload": {
                        "kind": "open_shift",
                        "house_id": "harnwell",
                        "title": "A shift just opened up",
                        "body": "Harnwell needs cover on Wed, Jul 29, 19:00 to 20:00. Open the app to claim it."
                      }
                    }
                    """,
                ),
            )

        assertEquals("A shift just opened up", toast?.title)
        assertEquals(
            "Harnwell needs cover on Wed, Jul 29, 19:00 to 20:00. Open the app to claim it.",
            toast?.body,
        )
    }

    @Test
    fun fallsBackToMessageWhenBodyAbsent() {
        val toast = toastFromNotificationRow(
            row("""{ "type": "broadcast", "payload": { "title": "Heads up", "message": "Desk needs cover." } }"""),
        )
        assertEquals("Desk needs cover.", toast?.body)
    }

    @Test
    fun bodyIsEmptyRatherThanNullWhenNeitherPresent() {
        val toast = toastFromNotificationRow(
            row("""{ "type": "broadcast", "payload": { "title": "Heads up" } }"""),
        )
        assertEquals("", toast?.body)
    }

    @Test
    fun stillReadsAFlattenedRow() {
        // The demo fixtures and any future flattened producer.
        val toast = toastFromNotificationRow(
            row("""{ "title": "Flat title", "body": "Flat body" }"""),
        )
        assertEquals("Flat title", toast?.title)
        assertEquals("Flat body", toast?.body)
    }

    @Test
    fun payloadWinsOverTopLevel() {
        val toast = toastFromNotificationRow(
            row("""{ "title": "outer", "payload": { "title": "inner", "body": "b" } }"""),
        )
        assertEquals("inner", toast?.title)
    }

    @Test
    fun noTitleAnywhereYieldsNoToast() {
        // A row with nothing displayable must stay silent rather than flash an empty bar.
        assertNull(
            toastFromNotificationRow(
                row("""{ "type": "ack_reminder", "payload": { "float_id": "abc" } }"""),
            ),
        )
    }
}
