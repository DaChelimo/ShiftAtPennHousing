package com.pennhousing.shift.shared.auth

/**
 * Per-field login form errors. A `null` field means that field has no problem;
 * [hasError] is the form-level "is anything wrong" flag (TEST_PLAN §3.1). The
 * exact message text is an implementation choice — only presence/absence is
 * specified.
 */
data class FormErrors(
    val email: String?,
    val password: String?,
) {
    val hasError: Boolean get() = email != null || password != null
}

/**
 * Pure, synchronous field validation (TEST_PLAN §3.1):
 * - blank/whitespace-only email ⇒ email error;
 * - non-blank email with no `@` ⇒ email error;
 * - blank/whitespace-only password ⇒ password error;
 * - a field with no problem ⇒ that field's error is `null`.
 */
object LoginFormValidator {
    fun validate(
        email: String,
        password: String,
    ): FormErrors {
        val emailError =
            when {
                email.isBlank() -> "Enter your email."
                !email.contains('@') -> "Enter a valid email address."
                else -> null
            }
        val passwordError = if (password.isBlank()) "Enter your password." else null
        return FormErrors(email = emailError, password = passwordError)
    }
}
