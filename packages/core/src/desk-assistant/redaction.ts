// Desk Assistant — incident redaction config + validators (V1_SCOPE §7.2). Pure.
//
// The redact-incident script sends a raw incident to Claude with
// REDACTION_SYSTEM_PROMPT and gets back either a de-identified LESSON or a
// "no lesson" verdict. validateLesson is a defense-in-depth check that the returned
// lesson carries no identifying specifics before it is indexed. containsIncidentLeakage
// is the retrieval-side output guardrail used by da-ask on generated answers.

export type RedactionDecision =
  | { kind: 'no_lesson'; reason: string }
  | { kind: 'lesson'; lesson: string };

/**
 * Instruction for the ingestion classify + de-identify pass. Claude must return
 * strict JSON: {"kind":"lesson","lesson":"..."} or {"kind":"no_lesson","reason":"..."}.
 */
export const REDACTION_SYSTEM_PROMPT = [
  'You de-identify housing desk incident records into reusable guidance.',
  'Read the raw incident. Decide ONE of:',
  '1. If there is a generalizable operational lesson that helps staff handle similar',
  'situations, return {"kind":"lesson","lesson":"<the lesson>"}. The lesson must state',
  'only the general rule or takeaway. It must contain NO names, NO room or apartment',
  'numbers, NO dates, NO email addresses or phone numbers, NO student identifiers, and',
  'must not describe the specific incident.',
  '2. If the incident is disciplinary, conduct-related, medical, or otherwise private,',
  'or has no generalizable lesson, return {"kind":"no_lesson","reason":"<short reason>"}.',
  'Return ONLY the JSON object, nothing else. Do not use em dashes or en dashes.',
].join(' ');

// Shared high-precision PII / specificity patterns. Kept deliberately narrow to
// avoid false positives on legitimate policy text.
const PII_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'email', re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i },
  { label: 'phone', re: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { label: 'room_number', re: /\b(room|rm|apt|apartment|suite|unit)\s*#?\s*\d+/i },
  {
    label: 'explicit_date',
    re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  },
  { label: 'numeric_date', re: /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/ },
  { label: 'named_person', re: /\bnamed\s+[A-Z][a-z]+/ },
];

/** Validate a candidate lesson before indexing. ok=false lists the violations. */
export function validateLesson(lesson: string): { ok: true } | { ok: false; violations: string[] } {
  const violations = PII_PATTERNS.filter((p) => p.re.test(lesson)).map((p) => p.label);
  if (lesson.trim().length === 0) violations.push('empty');
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/** Output guardrail: does a generated answer contain incident-identifying PII? */
export function containsIncidentLeakage(answer: string): boolean {
  return PII_PATTERNS.some((p) => p.re.test(answer));
}

/** Validate + narrow an untrusted parsed Claude response into a RedactionDecision. */
export function parseRedactionDecision(raw: unknown): RedactionDecision | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === 'lesson' && typeof obj.lesson === 'string') {
    return { kind: 'lesson', lesson: obj.lesson };
  }
  if (obj.kind === 'no_lesson' && typeof obj.reason === 'string') {
    return { kind: 'no_lesson', reason: obj.reason };
  }
  return null;
}
