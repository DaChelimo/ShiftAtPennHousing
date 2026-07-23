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

/**
 * Output guardrail: does a generated answer contain incident-identifying PII?
 *
 * When [groundingText] (the concatenated retrieved sources) is supplied, a pattern hit only
 * counts as leakage if the matched text does NOT appear in those sources. An answer may repeat
 * anything its own grounded sources already say: that content has already passed the scope and
 * sensitivity gates in `da_can_read_item`, so echoing it discloses nothing new. What this is
 * meant to catch is specifics the model produced from somewhere OTHER than the sources, which
 * is the actual incident-leakage risk (V1_SCOPE §7.2).
 *
 * Without this narrowing the guardrail fails closed on the corpus's most important answers.
 * Verified on 2026-07-22: "There is a flood in the building right now. What is the escalation
 * procedure?" was retracted in full, because the correct answer must quote Facilities on
 * 215-898-7208 and the CSMOD on 445-221-3453, and the bare `phone` pattern fires on both.
 * Program date ranges ("May 31, 2026 to August 8, 2026") tripped `explicit_date` the same way.
 *
 * Called with no [groundingText] the behaviour is unchanged (any hit is leakage), which is what
 * [validateLesson] and the redact-incident ingestion path still want.
 */
export function containsIncidentLeakage(answer: string, groundingText?: string): boolean {
  if (groundingText === undefined) return PII_PATTERNS.some((p) => p.re.test(answer));
  const sources = normalizeForSourceCompare(groundingText);
  for (const p of PII_PATTERNS) {
    const global = new RegExp(
      p.re.source,
      p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`,
    );
    for (const match of answer.matchAll(global)) {
      if (!sources.includes(normalizeForSourceCompare(match[0]))) return true;
    }
  }
  return false;
}

/**
 * Fold the spelling differences that make a faithfully-copied specific look invented.
 * Month names collapse to their three-letter prefix so an answer's "Aug 8" still matches a
 * source's "August 8" (observed 2026-07-22: that exact mismatch retracted a correct answer),
 * and runs of whitespace collapse so a line break inside a source does not break the match.
 */
function normalizeForSourceCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/g, '$1')
    .replace(/\s+/g, ' ');
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
