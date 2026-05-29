package com.pennhousing.shift.shared

import kotlin.test.Test
import kotlin.test.assertTrue

class GreetingTest {
    @Test
    fun greetingMentionsTheApp() {
        assertTrue(Greeting().greet().contains("Shift@PennHousing"))
    }
}
