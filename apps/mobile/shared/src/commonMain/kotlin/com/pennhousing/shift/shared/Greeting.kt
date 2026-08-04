package com.pennhousing.shift.shared

/** Minimal shared-logic sample proving the KMP wiring end-to-end across Android and iOS. */
class Greeting {
    fun greet(): String = "SHIFT running on ${platformName()}"
}
