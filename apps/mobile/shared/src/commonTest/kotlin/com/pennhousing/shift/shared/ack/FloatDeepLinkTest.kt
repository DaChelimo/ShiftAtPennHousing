package com.pennhousing.shift.shared.ack

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * T2-13 — push → full-screen ack routing: the deep-link grammar and the
 * dispatch-push DATA-message display mapping, tested once for both platforms.
 */
class FloatDeepLinkTest {
    @Test fun deep_link_round_trips_the_float_id() {
        val link = floatAckDeepLink("f-123")
        assertEquals("pennshift://float-ack/f-123", link)
        assertEquals("f-123", parseFloatAckDeepLink(link))
    }

    @Test fun parse_tolerates_query_fragment_trailing_slash_and_case() {
        assertEquals("abc", parseFloatAckDeepLink("pennshift://float-ack/abc/"))
        assertEquals("abc", parseFloatAckDeepLink("pennshift://float-ack/abc?src=push"))
        assertEquals("abc", parseFloatAckDeepLink("pennshift://float-ack/abc#x"))
        assertEquals("abc", parseFloatAckDeepLink("PENNSHIFT://FLOAT-ACK/abc"))
    }

    @Test fun parse_rejects_foreign_links_and_blank_ids() {
        assertNull(parseFloatAckDeepLink(null))
        assertNull(parseFloatAckDeepLink("https://float-ack/abc"))
        assertNull(parseFloatAckDeepLink("pennshift://other/abc"))
        assertNull(parseFloatAckDeepLink("pennshift://float-ack/"))
        assertNull(parseFloatAckDeepLink("pennshift://float-ack"))
    }

    // ----- dispatch-push DATA-message display (the previously-dropped shape) -----

    @Test fun float_assigned_payload_maps_to_routed_display() {
        val d =
            pushDisplayFromData(
                type = "personal_shift",
                payloadJson = """{"kind":"float_assigned","float_id":"f-9","title":"Float — Quad","body":"Cover Quad."}""",
            )
        assertEquals("Float — Quad", d.title)
        assertEquals("Cover Quad.", d.body)
        assertEquals("f-9", d.floatId)
    }

    @Test fun float_assigned_without_copy_gets_ack_fallbacks() {
        val d = pushDisplayFromData("personal_shift", """{"kind":"float_assigned","float_id":"f-9"}""")
        assertEquals("Float assignment", d.title)
        assertEquals("You've been floated. Tap to acknowledge.", d.body)
        assertEquals("f-9", d.floatId)
    }

    @Test fun non_float_payload_displays_but_does_not_route() {
        val d = pushDisplayFromData("broadcast", """{"title":"Hi","body":"All-hands."}""")
        assertEquals("Hi", d.title)
        assertEquals("All-hands.", d.body)
        assertNull(d.floatId)
    }

    @Test fun unparseable_payload_never_displays_blank() {
        val d = pushDisplayFromData("ack_reminder", "{not json")
        assertEquals("Shift@PennHousing", d.title)
        assertEquals("ack_reminder", d.body)
        assertNull(d.floatId)
        val empty = pushDisplayFromData(null, null)
        assertEquals("Shift@PennHousing", empty.title)
        assertNull(empty.floatId)
    }
}
