package com.pennhousing.shift.shared.auth

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class LoginFormValidatorTest {
    @Test
    fun blankEmailIsError() {
        assertNotNull(LoginFormValidator.validate("", "pw-123456").email)
        assertNotNull(LoginFormValidator.validate("    ", "pw-123456").email)
    }

    @Test
    fun emailWithoutAtSignIsError() {
        assertNotNull(LoginFormValidator.validate("not-an-email", "pw-123456").email)
    }

    @Test
    fun blankPasswordIsErrorButValidEmailIsNot() {
        val e = LoginFormValidator.validate("sw@pennhousing.test", "")
        assertNotNull(e.password)
        assertNull(e.email)
    }

    @Test
    fun whitespacePasswordIsError() {
        assertNotNull(LoginFormValidator.validate("sw@pennhousing.test", "     ").password)
    }

    @Test
    fun validInputsHaveNoErrors() {
        val e = LoginFormValidator.validate("sw@pennhousing.test", "pw-123456")
        assertFalse(e.hasError)
        assertNull(e.email)
        assertNull(e.password)
    }

    @Test
    fun domainWarningIsNullForShiftAtPennAndGmail() {
        assertNull(LoginFormValidator.domainWarning("andrew@shiftatpenn.com"))
        assertNull(LoginFormValidator.domainWarning("Andrew@ShiftAtPenn.Com"))
        assertNull(LoginFormValidator.domainWarning("andrew@gmail.com"))
    }

    @Test
    fun domainWarningFiresForOtherCompleteDomains() {
        assertNotNull(LoginFormValidator.domainWarning("andrew@outlook.com"))
        assertNotNull(LoginFormValidator.domainWarning("andrew@upenn.edu"))
        assertNotNull(LoginFormValidator.domainWarning("andrew@seas.upenn.edu"))
    }

    @Test
    fun domainWarningIsNullWhileDomainIsIncompleteOrMissing() {
        assertNull(LoginFormValidator.domainWarning(""))
        assertNull(LoginFormValidator.domainWarning("andrew"))
        assertNull(LoginFormValidator.domainWarning("andrew@u"))
    }
}
