package com.pennhousing.shift.shared.assistant

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The bubble used to render the model's Markdown source verbatim, so a worker read literal
 * `**11:00 p.m.:**` mid-answer. These pin the small grammar that replaced that.
 */
class AssistantMarkdownTest {
    private fun spansOf(raw: String) = parseAssistantMarkdown(raw).single().spans

    @Test
    fun bold_becomes_a_styled_span_and_the_markers_disappear() {
        val spans = spansOf("Guests must leave by **10:00 pm**.")
        assertEquals(listOf("Guests must leave by ", "10:00 pm", "."), spans.map { it.text })
        assertEquals(listOf(false, true, false), spans.map { it.bold })
        assertFalse(spans.any { it.text.contains("*") })
    }

    @Test
    fun italic_and_inline_code_are_styled() {
        assertTrue(spansOf("that is *not* allowed").single { it.text == "not" }.italic)
        assertTrue(spansOf("call `215-898-7208` now").single { it.text == "215-898-7208" }.code)
    }

    @Test
    fun bullet_lines_are_flagged_and_lose_their_marker() {
        val lines = parseAssistantMarkdown("- day visitors ok\n- no overnight guests")
        assertTrue(lines.all { it.bullet })
        assertEquals(listOf("day visitors ok", "no overnight guests"), lines.map { it.spans.single().text })
    }

    @Test
    fun headings_collapse_to_a_bold_line_rather_than_showing_hashes() {
        val line = parseAssistantMarkdown("## Escalation").single()
        assertEquals("Escalation", line.spans.single().text)
        assertTrue(line.spans.single().bold)
        assertFalse(line.bullet)
    }

    @Test
    fun an_unmatched_delimiter_stays_literal_instead_of_styling_the_rest_of_the_line() {
        // A runaway toggle would have italicised everything after the asterisk.
        val spans = spansOf("2 * 3 rooms and a stray ` tick")
        assertEquals("2 * 3 rooms and a stray ` tick", spans.joinToString("") { it.text })
        assertFalse(spans.any { it.italic || it.code })
    }

    @Test
    fun underscores_inside_identifiers_survive_untouched() {
        val spans = spansOf("check home_house_id on the record")
        assertEquals("check home_house_id on the record", spans.joinToString("") { it.text })
        assertFalse(spans.any { it.italic || it.bold })
    }

    @Test
    fun blank_lines_are_preserved_so_paragraph_spacing_survives() {
        val lines = parseAssistantMarkdown("Yes.\n\nGuests must leave by 10 pm.")
        assertEquals(3, lines.size)
        assertEquals("", lines[1].spans.single().text)
    }

    @Test
    fun a_plain_answer_round_trips_unchanged() {
        val raw = "No. Guests are not allowed after 10:00 pm."
        assertEquals(raw, parseAssistantMarkdown(raw).single().spans.single().text)
    }
}
