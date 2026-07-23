package com.pennhousing.shift.shared.assistant

// Desk Assistant — the small slice of Markdown the answer bubble understands.
//
// The model writes Markdown whether or not we ask it to, and both bubbles used to render the
// raw source, so a worker saw literal `**11:00 p.m.:**` and `- ` in the middle of an answer.
// Parsing lives HERE, in commonMain, rather than once in Swift and once in Kotlin: a drifting
// second copy is exactly the failure mode the per-worker colour palette already has to guard
// against, and this is cheaper to keep honest with one set of tests.
//
// Deliberately tiny. Answers are meant to be one to three sentences (BSpec §17.3b), so the
// grammar covers what actually shows up: bold, italic, inline code, bullets, and headings.
// Everything else is passed through as text.

/** One inline run of an answer line, with the emphasis that applies to it. */
data class MarkdownSpan(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val code: Boolean = false,
)

/** One rendered line. A [bullet] line is drawn with a leading glyph and a hanging indent. */
data class MarkdownLine(
    val spans: List<MarkdownSpan>,
    val bullet: Boolean = false,
)

private val BULLET_MARKERS = listOf("- ", "* ", "• ", "+ ")

/**
 * Parse [raw] into lines of styled spans.
 *
 * Underscore emphasis (`_italic_`, `__bold__`) is NOT supported, on purpose: underscores turn up
 * inside identifiers the assistant legitimately quotes (`home_house_id`, file names), and
 * mangling those is a worse failure than missing a rare underscore emphasis. Asterisk and
 * backtick delimiters only take effect when a closing delimiter exists later on the same line,
 * so an arithmetic `2 * 3` or a lone backtick stays literal instead of italicising the remainder.
 */
fun parseAssistantMarkdown(raw: String): List<MarkdownLine> =
    raw.replace("\r\n", "\n").split("\n").map { line -> parseLine(line.trimEnd()) }

private fun parseLine(line: String): MarkdownLine {
    val trimmed = line.trimStart()

    // Headings collapse to a bold line: the bubble has no type scale to step through.
    if (trimmed.startsWith("#")) {
        val text = trimmed.trimStart('#').trimStart()
        if (text.isNotEmpty()) {
            return MarkdownLine(parseInline(text).map { it.copy(bold = true) })
        }
    }

    val marker = BULLET_MARKERS.firstOrNull { trimmed.startsWith(it) }
    if (marker != null) {
        return MarkdownLine(parseInline(trimmed.removePrefix(marker)), bullet = true)
    }
    return MarkdownLine(parseInline(line))
}

private fun parseInline(text: String): List<MarkdownSpan> {
    val spans = mutableListOf<MarkdownSpan>()
    val buf = StringBuilder()
    var i = 0

    fun flush() {
        if (buf.isNotEmpty()) {
            spans += MarkdownSpan(buf.toString())
            buf.clear()
        }
    }

    fun emit(
        inner: String,
        bold: Boolean = false,
        italic: Boolean = false,
        code: Boolean = false,
    ) {
        if (inner.isNotEmpty()) spans += MarkdownSpan(inner, bold, italic, code)
    }

    while (i < text.length) {
        val rest = text.length - i
        val boldOpen = rest >= 2 && text.startsWith("**", i)
        val close =
            when {
                boldOpen -> text.indexOf("**", i + 2)
                text[i] == '*' -> text.indexOf('*', i + 1)
                text[i] == '`' -> text.indexOf('`', i + 1)
                else -> -1
            }

        when {
            boldOpen && close > i + 1 -> {
                flush()
                emit(text.substring(i + 2, close), bold = true)
                i = close + 2
            }
            !boldOpen && text[i] == '*' && close > i -> {
                flush()
                emit(text.substring(i + 1, close), italic = true)
                i = close + 1
            }
            text[i] == '`' && close > i -> {
                flush()
                emit(text.substring(i + 1, close), code = true)
                i = close + 1
            }
            else -> {
                buf.append(text[i])
                i += 1
            }
        }
    }
    flush()
    return if (spans.isEmpty()) listOf(MarkdownSpan("")) else spans
}
