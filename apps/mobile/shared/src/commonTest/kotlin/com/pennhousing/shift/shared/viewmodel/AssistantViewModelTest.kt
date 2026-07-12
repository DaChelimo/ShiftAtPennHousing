package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.assistant.AskResult
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
    fun a_grounded_result_appends_a_cited_answer_and_clears_loading() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("how do I get a spare key")
        vm.onResult(
            AskResult(
                content = "Retrieve it from the key cabinet after verifying the resident.",
                citations = listOf(Citation("d1", "Harnwell summer binder, keys section")),
            ),
        )
        val s = vm.uiState.value
        assertEquals(2, s.messages.size)
        val answer = s.messages[1]
        assertEquals(AssistantRole.ASSISTANT, answer.role)
        assertEquals(1, answer.citations.size)
        assertFalse(answer.offersPageDraft)
        assertFalse(answer.showSafetyBanner)
        assertFalse(s.loading)
    }

    @Test
    fun a_deferred_result_offers_a_page_draft_with_the_route() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("who do I call about a broken elevator")
        vm.onResult(
            AskResult(
                content = "I do not have a documented source for that.",
                deferred = true,
                route = AssistantRoute(resolvedTier = "hmod", tierLabel = "the Housing Manager on Duty"),
            ),
        )
        val answer = vm.uiState.value.messages[1]
        assertTrue(answer.offersPageDraft)
        assertEquals("the Housing Manager on Duty", answer.route?.tierLabel)
    }

    @Test
    fun a_life_safety_result_shows_the_safety_banner() {
        val vm = AssistantViewModel()
        vm.onUserSubmitted("there is smoke on floor 3")
        vm.onResult(AskResult(content = "Follow the fire protocol.", lifeSafety = "fire"))
        assertTrue(vm.uiState.value.messages[1].showSafetyBanner)
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
        vm.onResult(AskResult(content = "ok"))
        vm.onUserSubmitted("q2")
        assertNull(vm.uiState.value.error)
    }
}
