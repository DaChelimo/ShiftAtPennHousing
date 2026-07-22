package com.pennhousing.shift.shared.preferences

import com.pennhousing.shift.shared.shifts.NEW_YORK
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.toInstant

/**
 * The preference-submission deadline an SM/HM/BM sets (BSpec §4.2). A deadline "date"
 * means end-of-day in America/New_York (invariant #6): the last instant of that NY day.
 * Mirrors the web `nyEndOfDayIso` so both platforms send the server the same timestamptz.
 * The server (set_preference_deadline RPC) enforces deadline <= the period's start date.
 */
fun nyEndOfDayIso(date: LocalDate): String =
    LocalDateTime(date, LocalTime(23, 59, 59, 999_000_000)).toInstant(NEW_YORK).toString()
