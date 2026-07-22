package com.pennhousing.shift.shared.preferences

import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals

class PreferenceDeadlineTest {
    @Test
    fun endOfDayIsLastInstantOfTheNyDayInUtc() {
        // 2026-08-26 in NY is EDT (UTC-4), so 23:59:59.999 NY = 03:59:59.999Z next day.
        assertEquals("2026-08-26T03:59:59.999Z", nyEndOfDayIso(LocalDate(2026, 8, 25)))
    }

    @Test
    fun winterDateUsesTheEstOffset() {
        // 2026-01-15 in NY is EST (UTC-5), so 23:59:59.999 NY = 04:59:59.999Z next day.
        assertEquals("2026-01-16T04:59:59.999Z", nyEndOfDayIso(LocalDate(2026, 1, 15)))
    }
}
