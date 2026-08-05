/**
 * Non-blocking domain hint for the login email field. Mirrors
 * `LoginFormValidator.domainWarning` in the mobile shared module
 * (apps/mobile/shared/.../auth/LoginFormValidator.kt) so a worker who types
 * `@atsys.upenn.edu` / `@atnursing.upenn.edu` (the pre-migration Penn subdomains) sees
 * the same steer on web as on the app. Never blocks sign-in — the account may
 * legitimately use a different domain.
 *
 * Waits for a "." in the domain part before warning (so "andrew@u" does not flash a
 * warning mid-keystroke), and is case-insensitive.
 */
export function domainWarning(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at === -1) return null;

  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.')) return null;

  const lower = trimmed.toLowerCase();
  if (lower.endsWith('@upenn.edu') || lower.endsWith('@gmail.com')) return null;

  return 'Your email should most likely end with @upenn.edu or @gmail.com, but mostly @upenn.edu.';
}
