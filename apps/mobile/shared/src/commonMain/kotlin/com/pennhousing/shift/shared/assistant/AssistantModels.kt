package com.pennhousing.shift.shared.assistant

// Desk Assistant (mobile) — the pure decision surface (V1_SCOPE §4). Mirrors the
// da-ask Edge Function response shape. The network call itself is the data/UI layer
// (scoped out of tests, like phases 07-12's HTTP layer); this holds the tested logic.

enum class AssistantRole { USER, ASSISTANT }

data class Citation(val documentId: String, val sourceRef: String)

data class AssistantRoute(
    val resolvedTier: String,
    val tierLabel: String? = null,
    val contactName: String? = null,
)

/** The da-ask result, fed to the ViewModel by the data layer. */
data class AskResult(
    val content: String,
    val citations: List<Citation> = emptyList(),
    val deferred: Boolean = false,
    val route: AssistantRoute? = null,
    val lifeSafety: String? = null,
)

data class AssistantMessage(
    val id: String,
    val role: AssistantRole,
    val content: String,
    val citations: List<Citation> = emptyList(),
    val deferred: Boolean = false,
    val route: AssistantRoute? = null,
    val lifeSafety: String? = null,
) {
    /** Life-safety preamble is shown as a loud banner above the answer (§8 rule 2). */
    val showSafetyBanner: Boolean get() = role == AssistantRole.ASSISTANT && lifeSafety != null

    /** A deferred (ungrounded) answer offers the routing card + "draft a page" (§4.2/§4.3). */
    val offersPageDraft: Boolean get() = role == AssistantRole.ASSISTANT && deferred
}
