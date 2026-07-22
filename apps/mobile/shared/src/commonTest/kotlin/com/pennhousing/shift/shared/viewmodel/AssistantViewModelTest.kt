package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.assistant.AssistantRole
import com.pennhousing.shift.shared.assistant.AssistantRoute
import com.pennhousing.shift.shared.assistant.Citation
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AssistantViewModelTest {
    @Test
    fun submitting_a_question_appends_it_and_enters_loading() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("how do I log a package")
        val s = vm.uiState.value
        assertEquals(1, s.messages.size)
        assertEquals(AssistantRole.USER, s.messages[0].role)
        assertTrue(s.loading)
        assertFalse(s.isEmpty)
    }

    @Test
    fun blank_input_is_ignored() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("   ")
        assertTrue(vm.uiState.value.isEmpty)
        assertFalse(vm.uiState.value.loading)
    }

    @Test
    fun re_entrant_submit_while_loading_is_ignored() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("first")
        vm.onUserSubmitted("second")
        assertEquals(1, vm.uiState.value.messages.size)
    }

    @Test
    fun stream_start_appends_an_empty_placeholder() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("how do I get a spare key")
        vm.onStreamStart()
        val s = vm.uiState.value
        assertEquals(2, s.messages.size)
        assertEquals(AssistantRole.ASSISTANT, s.messages[1].role)
        assertEquals("", s.messages[1].content)
        assertTrue(s.loading)
    }

    @Test
    fun deltas_accumulate_onto_the_placeholder_in_order() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("how do I get a spare key")
        vm.onStreamStart()
        vm.onStreamDelta("Retrieve it ")
        vm.onStreamDelta("from the key cabinet.")
        assertEquals("Retrieve it from the key cabinet.", vm.uiState.value.messages[1].content)
    }

    @Test
    fun a_grounded_stream_carries_citations_and_clears_loading_on_done() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("how do I get a spare key")
        vm.onStreamStart()
        vm.onStreamMeta(
            citations = listOf(Citation("d1", "Harnwell summer binder, keys section")),
            deferred = false,
            route = null,
            lifeSafety = null,
        )
        vm.onStreamDelta("Retrieve it from the key cabinet after verifying the resident.")
        vm.onStreamDone()
        val s = vm.uiState.value
        val answer = s.messages[1]
        assertEquals(1, answer.citations.size)
        assertFalse(answer.offersPageDraft)
        assertFalse(answer.showSafetyBanner)
        assertFalse(s.loading)
    }

    @Test
    fun a_deferred_stream_offers_a_page_draft_with_the_route() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("who do I call about a broken elevator")
        vm.onStreamStart()
        vm.onStreamMeta(
            citations = emptyList(),
            deferred = true,
            route = AssistantRoute(resolvedTier = "hmod", tierLabel = "the Housing Manager on Duty"),
            lifeSafety = null,
        )
        vm.onStreamDelta("I do not have a documented source for that.")
        vm.onStreamDone()
        val answer = vm.uiState.value.messages[1]
        assertTrue(answer.offersPageDraft)
        assertEquals("the Housing Manager on Duty", answer.route?.tierLabel)
    }

    @Test
    fun a_life_safety_stream_shows_the_safety_banner() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("there is smoke on floor 3")
        vm.onStreamStart()
        vm.onStreamMeta(citations = emptyList(), deferred = false, route = null, lifeSafety = "fire")
        vm.onStreamDelta("Follow the fire protocol.")
        vm.onStreamDone()
        assertTrue(vm.uiState.value.messages[1].showSafetyBanner)
    }

    @Test
    fun a_retract_replaces_partial_text_and_clears_grounded_metadata() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("what happened in room 204 last week")
        vm.onStreamStart()
        vm.onStreamMeta(
            citations = listOf(Citation("d1", "some source")),
            deferred = false,
            route = null,
            lifeSafety = null,
        )
        vm.onStreamDelta("Sure, the incident at room 204 involv")
        vm.onStreamRetract("I can't help with that.")
        vm.onStreamDone()
        val answer = vm.uiState.value.messages[1]
        assertEquals("I can't help with that.", answer.content)
        assertTrue(answer.citations.isEmpty())
        assertFalse(answer.deferred)
        assertFalse(vm.uiState.value.loading)
    }

    @Test
    fun an_error_clears_loading_and_keeps_the_user_message() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("anything")
        vm.onError("The assistant is not configured yet.")
        val s = vm.uiState.value
        assertEquals(1, s.messages.size)
        assertEquals(AssistantRole.USER, s.messages[0].role)
        assertFalse(s.loading)
        assertEquals("The assistant is not configured yet.", s.error)
    }

    @Test
    fun a_new_submit_clears_a_prior_error() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("q1")
        vm.onError("boom")
        vm.onStreamStart()
        vm.onStreamDelta("ok")
        vm.onStreamDone()
        vm.onUserSubmitted("q2")
        assertNull(vm.uiState.value.error)
    }
}
