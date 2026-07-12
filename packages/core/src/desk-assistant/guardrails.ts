// Desk Assistant — safety guardrail detection (V1_SCOPE §8). Pure. These flag a
// query so the Edge Function can inject the right framing BEFORE generation:
//   §8.2 life-safety  → surface documented protocol + push to the emergency line;
//                        never position the assistant as a replacement.
//   §8.3 access       → inform-and-defer; when unsure, tell the worker NOT to grant
//                        and to escalate (the summer perimeter-door case).
// Detection is intentionally high-recall (keyword heuristics): a false positive
// just adds a safety preamble; a false negative would omit one.

export type LifeSafetyCategory = 'fire' | 'medical' | 'emergency_door';

const LIFE_SAFETY_PATTERNS: Array<{ category: LifeSafetyCategory; re: RegExp }> = [
  { category: 'fire', re: /\b(fire|smoke|alarm|burning|flames?)\b/i },
  {
    category: 'medical',
    re: /\b(medical|injur\w*|unconscious|bleeding|seizure|overdose|ambulance|hurt|collaps\w*|not breathing)\b/i,
  },
  {
    category: 'emergency_door',
    re: /\b(emergency door|emergency exit|door forced|forced (open|entry)|propped (emergency )?door)\b/i,
  },
];

/** The first life-safety category the text matches, or null. */
export function detectLifeSafety(text: string): LifeSafetyCategory | null {
  for (const { category, re } of LIFE_SAFETY_PATTERNS) {
    if (re.test(text)) return category;
  }
  return null;
}

const ACCESS_RE =
  /\b(access|let\s+\w+\s+in|unlock|key|keys|grant|allow\s+(entry|in)|contractor|vendor|perimeter|door code|badge|fob)\b/i;

/** True when the query is about granting access / who may enter (§8.3). */
export function mentionsAccessDecision(text: string): boolean {
  return ACCESS_RE.test(text);
}

// Attempts to surface a specific past incident ("what happened the other day").
// The retrieval index never contains raw incidents (§7.2), but this is the cheap
// output-side guardrail that refuses the ASK rather than relying on empty results.
const INCIDENT_PROBE_RE =
  /\b(what happened|tell me about|the (other day|incident|time)|last (week|night|time)|who (got|was)|that student who|the case where)\b/i;

export function looksLikeIncidentProbe(text: string): boolean {
  return INCIDENT_PROBE_RE.test(text);
}
