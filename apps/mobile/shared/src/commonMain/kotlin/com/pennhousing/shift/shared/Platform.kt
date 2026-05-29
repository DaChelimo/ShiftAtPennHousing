package com.pennhousing.shift.shared

/** The runtime platform name; implemented per target (see Platform.android.kt / Platform.ios.kt). */
expect fun platformName(): String
