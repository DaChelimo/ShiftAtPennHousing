package com.pennhousing.shift.shared.viewmodel

import com.pennhousing.shift.shared.model.House
import com.pennhousing.shift.shared.model.PendingFloat
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

/**
 * Float-request carousel ViewModel — the local accept/decline → advance machine that
 * backs the My-Shifts blue card stack. Accept and Decline are the SAME local move
 * (the host POSTs the EF); `allHandled` flips true only when the LAST float is resolved.
 */
class FloatCarouselViewModelTest {
    private fun at(iso: String): Instant = Instant.parse(iso)
    private val now = at("2026-01-15T14:00:00-05:00")
    private val dubois = House("dubois", "DuBois")
    private val harnwell = House("harnwell", "Harnwell")

    private val later = PendingFloat("f-later", dubois, at("2026-01-15T18:00:00-05:00"), at("2026-01-15T20:00:00-05:00"), 4)
    private val sooner = PendingFloat("f-sooner", harnwell, at("2026-01-15T15:30:00-05:00"), at("2026-01-15T18:00:00-05:00"), 5)

    @Test
    fun initial_state_is_closest_first_and_not_handled() {
        val vm = FloatCarouselViewModel(listOf(later, sooner), now)
        val s = vm.uiState.value
        assertEquals(listOf("f-sooner", "f-later"), s.cards.map { it.floatId })
        assertEquals(2, s.total)
        assertFalse(s.allHandled)
    }

    @Test
    fun resolving_advances_and_completes_on_the_last() {
        val vm = FloatCarouselViewModel(listOf(later, sooner), now)
        vm.acknowledge("f-sooner")
        vm.uiState.value.let {
            assertEquals(listOf("f-later"), it.cards.map { c -> c.floatId })
            assertFalse(it.allHandled)
        }
        vm.decline("f-later")
        vm.uiState.value.let {
            assertTrue(it.cards.isEmpty())
            assertTrue(it.allHandled)
        }
    }

    @Test
    fun resolve_is_idempotent() {
        val vm = FloatCarouselViewModel(listOf(sooner), now)
        vm.resolve("f-sooner")
        vm.resolve("f-sooner")
        assertTrue(vm.uiState.value.allHandled)
        assertTrue(vm.uiState.value.cards.isEmpty())
    }

    @Test
    fun no_floats_is_never_handled() {
        val vm = FloatCarouselViewModel(emptyList(), now)
        assertEquals(0, vm.uiState.value.total)
        assertFalse(vm.uiState.value.allHandled)
    }
}
