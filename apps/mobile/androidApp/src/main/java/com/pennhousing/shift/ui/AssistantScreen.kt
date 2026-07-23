package com.pennhousing.shift.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pennhousing.shift.shared.assistant.AssistantMessage
import com.pennhousing.shift.shared.assistant.AssistantPrompts
import com.pennhousing.shift.shared.assistant.AssistantRole
import com.pennhousing.shift.shared.assistant.AssistantStreamEvent
import com.pennhousing.shift.shared.assistant.Citation
import com.pennhousing.shift.shared.assistant.parseAssistantMarkdown
import com.pennhousing.shift.shared.data.AssistantRepository
import com.pennhousing.shift.shared.data.WorkerBackend
import com.pennhousing.shift.shared.viewmodel.AssistantViewModel
import com.pennhousing.shift.ui.kit.ShiftIcons
import com.pennhousing.shift.ui.kit.shimmer
import com.pennhousing.shift.ui.theme.ShiftTheme
import kotlinx.coroutines.launch

/**
 * Desk Assistant chat (V1_SCOPE §4). Native Compose UI over the shared, tested
 * [AssistantViewModel] — this file owns the (untested, data/UI-layer) network call via
 * [AssistantRepository], mirroring how the Shifts screen's host keeps writes outside the
 * pure ViewModel. An empty thread shows a short intro + [AssistantPrompts.starters] chips;
 * a live thread renders left/right bubbles with citation chips, a life-safety banner, and
 * an escalation tag when the answer routed to a duty contact.
 */
@Composable
fun AssistantScreen(
    vm: AssistantViewModel,
    onBack: () -> Unit,
    repository: AssistantRepository = WorkerBackend.assistantRepository,
) {
    val c = ShiftTheme.colors
    val state by vm.uiState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    fun submit(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || state.loading) return
        vm.onUserSubmitted(trimmed)
        input = ""
        vm.onStreamStart()
        scope.launch {
            runCatching {
                repository.askStream(trimmed).collect { event ->
                    when (event) {
                        is AssistantStreamEvent.Meta ->
                            vm.onStreamMeta(event.citations, event.deferred, event.route, event.lifeSafety)
                        is AssistantStreamEvent.Delta -> vm.onStreamDelta(event.text)
                        is AssistantStreamEvent.Retract -> vm.onStreamRetract(event.content)
                        is AssistantStreamEvent.Done -> vm.onStreamDone()
                        is AssistantStreamEvent.Failed -> vm.onError(event.message)
                    }
                }
            }.onFailure { vm.onError(it.message ?: "Couldn't reach Snoopy. Try again.") }
        }
    }

    LaunchedEffect(state.messages.size, state.loading, state.messages.lastOrNull()?.content) {
        val lastIndex = state.messages.size - 1
        if (lastIndex >= 0) listState.animateScrollToItem(lastIndex)
    }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 10.dp, end = 16.dp, top = 10.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(50))
                    .background(c.surfaceVar)
                    .clickable(onClick = onBack)
                    .testTag("assistant_back"),
                contentAlignment = Alignment.Center,
            ) {
                Icon(ShiftIcons.ChevronLeft, contentDescription = "Back", tint = c.sec, modifier = Modifier.size(16.dp))
            }
            Text("Ask Snoopy", color = c.ink, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (state.isEmpty) {
                AssistantEmptyState(onPrompt = ::submit)
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().testTag("assistant_message_list"),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(state.messages, key = { it.id }) { message ->
                        val isStreamingPlaceholder =
                            state.loading && message.content.isEmpty() && message.id == state.messages.last().id
                        AssistantBubble(message, showShimmer = isStreamingPlaceholder)
                    }
                }
            }
        }
        state.error?.let {
            Text(
                it,
                color = c.danger.accent,
                fontSize = 12.5.sp,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        AssistantInputBar(
            value = input,
            onValueChange = { input = it },
            onSend = { submit(input) },
            enabled = !state.loading,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AssistantEmptyState(onPrompt: (String) -> Unit) {
    val c = ShiftTheme.colors
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(c.today),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ShiftIcons.Sparkle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
        }
        Text(
            "Ask a desk question",
            modifier = Modifier.padding(top = 16.dp),
            color = c.ink,
            fontSize = 19.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            "Answers are grounded in the official documentation and current duty schedule.",
            modifier = Modifier.padding(top = 4.dp),
            color = c.sec,
            fontSize = 14.sp,
            lineHeight = 19.sp,
        )
        FlowRow(
            modifier = Modifier.padding(top = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AssistantPrompts.starters.forEach { prompt ->
                Text(
                    prompt,
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(c.surface)
                            .border(1.dp, c.divider, RoundedCornerShape(999.dp))
                            .clickable { onPrompt(prompt) }
                            .padding(horizontal = 14.dp, vertical = 10.dp)
                            .testTag("assistant_starter_prompt"),
                    color = c.ink,
                    fontSize = 13.5.sp,
                )
            }
        }
    }
}

@Composable
private fun AssistantBubble(
    message: AssistantMessage,
    showShimmer: Boolean = false,
) {
    val c = ShiftTheme.colors
    val isUser = message.role == AssistantRole.USER
    Row(
        Modifier.fillMaxWidth().testTag("assistant_bubble_${message.id}"),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            Modifier.widthIn(max = 300.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
        ) {
            if (!isUser && message.showSafetyBanner) {
                Row(
                    Modifier
                        .padding(bottom = 6.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(c.danger.tint)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(ShiftIcons.Warning, contentDescription = null, tint = c.danger.accent, modifier = Modifier.size(16.dp))
                    Text(message.lifeSafety.orEmpty(), color = c.danger.deep, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Box(
                Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (isUser) MaterialTheme.colorScheme.primary else c.surface)
                    .let { if (isUser) it else it.border(1.dp, c.divider, RoundedCornerShape(16.dp)) }
                    .padding(horizontal = 14.dp, vertical = 11.dp),
            ) {
                if (showShimmer) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.width(160.dp).height(12.dp).shimmer())
                        Box(Modifier.width(110.dp).height(12.dp).shimmer())
                    }
                } else {
                    MarkdownAnswer(
                        content = message.content,
                        color = if (isUser) MaterialTheme.colorScheme.onPrimary else c.ink,
                    )
                }
            }
            if (!isUser && message.citations.isNotEmpty()) {
                SourcesBar(message.citations)
            }
            message.route?.let { route ->
                Text(
                    "Routed to: ${route.tierLabel ?: route.resolvedTier}",
                    modifier = Modifier.padding(top = 6.dp),
                    color = c.sec,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

/**
 * Render an answer's Markdown instead of printing its source. Parsing is the shared
 * [parseAssistantMarkdown] so this and the SwiftUI bubble cannot drift.
 */
@Composable
private fun MarkdownAnswer(
    content: String,
    color: Color,
) {
    val lines = remember(content) { parseAssistantMarkdown(content) }
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        lines.forEach { line ->
            // Spans join into ONE AnnotatedString so the line still wraps as a single
            // paragraph rather than breaking at every style change.
            val annotated =
                buildAnnotatedString {
                    line.spans.forEach { span ->
                        withStyle(
                            SpanStyle(
                                fontWeight = if (span.bold) FontWeight.SemiBold else null,
                                fontStyle = if (span.italic) FontStyle.Italic else null,
                                fontFamily = if (span.code) FontFamily.Monospace else null,
                            ),
                        ) {
                            append(span.text)
                        }
                    }
                }
            if (line.bullet) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("•", color = color, fontSize = 14.5.sp, lineHeight = 20.sp)
                    Text(annotated, color = color, fontSize = 14.5.sp, lineHeight = 20.sp)
                }
            } else {
                Text(annotated, color = color, fontSize = 14.5.sp, lineHeight = 20.sp)
            }
        }
    }
}

/**
 * Where an answer came from, kept out of the way (BSpec §17.3). Collapsed it is one quiet row;
 * tapping reveals the document names, each clipped to a single line. Binder titles are long, so
 * rendering them inline pushed the answer itself off screen.
 */
@Composable
private fun SourcesBar(citations: List<Citation>) {
    val c = ShiftTheme.colors
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.padding(top = 6.dp)) {
        Row(
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .clickable { expanded = !expanded }
                .testTag("assistant_sources_toggle")
                .padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                ShiftIcons.ChevronRight,
                contentDescription = null,
                tint = c.ter,
                modifier = Modifier.size(12.dp).rotate(if (expanded) 90f else 0f),
            )
            Text(
                if (citations.size == 1) "1 source" else "${citations.size} sources",
                color = c.ter,
                fontSize = 11.5.sp,
            )
        }
        if (expanded) {
            Column(
                Modifier.padding(top = 2.dp).testTag("assistant_sources_list"),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                citations.forEach { citation ->
                    Text(
                        citation.sourceRef,
                        color = c.ter,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun AssistantInputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    enabled: Boolean,
) {
    val c = ShiftTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            Modifier
                .weight(1f)
                .clip(RoundedCornerShape(999.dp))
                .background(c.surfaceVar)
                .border(1.dp, c.divider, RoundedCornerShape(999.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) {
                    Text("Ask a desk question...", color = c.ter, fontSize = 14.5.sp)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    modifier = Modifier.fillMaxWidth().testTag("assistant_input"),
                    singleLine = true,
                    textStyle = TextStyle(color = c.ink, fontSize = 14.5.sp),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                )
            }
        }
        val canSend = enabled && value.isNotBlank()
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(if (canSend) MaterialTheme.colorScheme.primary else c.surfaceVar)
                .let { if (canSend) it.clickable(onClick = onSend) else it }
                .testTag("assistant_send"),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                ShiftIcons.Send,
                contentDescription = "Send",
                tint = if (canSend) MaterialTheme.colorScheme.onPrimary else c.ter,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}
