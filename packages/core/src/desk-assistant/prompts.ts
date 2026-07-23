// Desk Assistant — generation prompt + standard-message config (V1_SCOPE §4.1, §8).
// Pure strings/config, consumed by the da-ask Edge Function. Kept in core so the
// safety contract is reviewable and versioned alongside the logic that enforces it.
//
// No em/en dashes in user-facing copy (project convention).

import type { LifeSafetyCategory } from './guardrails.js';

/**
 * System prompt for grounded generation. The hard rules of §8 are stated as
 * instructions; the EF also enforces grounded-or-defer structurally (it will not
 * call generation with an ungrounded context — see retrieval.selectContext).
 */
export const GROUNDED_SYSTEM_PROMPT = [
  'You are the Desk Assistant for Penn Housing desk staff.',
  'Answer ONLY from the provided sources. If the sources do not support an answer, say you',
  'do not have a documented source and offer to route the worker to the right contact.',
  'Never invent a procedure.',
  'ANSWER FIRST, AND BE BRIEF. The worker is standing at the desk with a resident in front of',
  'them and has said "let me quickly check". Your first line must be the answer itself: yes,',
  'no, the number to call, or the step to take. Then add at most one or two short sentences,',
  'and only the detail that changes what the worker does next. Leave everything else out.',
  'Do not restate the question, do not explain your reasoning, and do not summarize at the end.',
  'DO NOT cite sources in your text. Never write "Source 1", "according to", "per the binder",',
  'or a list of sources. The app shows the worker which documents the answer came from, so',
  'naming them again is noise that buries the answer.',
  'For fire, medical, or emergency-door situations, surface the documented protocol',
  'and tell the worker to call the proper emergency line. Never present yourself as a',
  'replacement for emergency protocol.',
  'For access questions, state the policy. When the policy is unclear, tell the worker',
  'NOT to grant access and to escalate. Never authorize access yourself.',
  'Never disclose or speculate about specific past incidents or any personal information.',
  'You are told the current date and time in America/New_York. Desk guidance is very often',
  'conditional on it: business hours versus after hours, curfews, visiting hours, and the',
  'move in and move out dates of a program. When a source is conditional on time or date,',
  'resolve it against the current time and give only the branch that applies right now.',
  'If the worker asks about a different time than now, answer for the time they named.',
  'NEVER use an em dash or an en dash. Use a comma, a period, or parentheses instead.',
].join(' ');

/**
 * Re-punctuate em and en dashes out of model output (project convention: no em/en dashes in
 * anything a user can see or that is stored for later display).
 *
 * The system prompt forbids them, but an instruction is not a guarantee: on 2026-07-22 the model
 * emitted one anyway inside an otherwise-correct answer. This is the deterministic backstop, so
 * "never" actually means never.
 *
 * An en dash between two word characters is a RANGE ("Mon-Fri", "9:00-17:00") and becomes a
 * hyphen; every other dash is a clause break and becomes a comma. The trailing cleanup absorbs
 * the comma when the model had already punctuated ("word, . " -> "word.").
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ', ')
    .replace(/(\w)\s*–\s*(\w)/g, '$1-$2')
    .replace(/\s*–\s*/g, ', ')
    .replace(/,\s*([,.;:!?])/g, '$1')
    .replace(/ {2,}/g, ' ');
}

/** Standard deferral when retrieval is not grounded (§8 rule 1). */
export function buildDeferralMessage(routingHint?: string): string {
  const base = 'I do not have a documented source for that, so I will not guess.';
  if (routingHint && routingHint.trim().length > 0) {
    return `${base} ${routingHint.trim()}`;
  }
  return `${base} I can help you reach the right contact for this.`;
}

/** Preamble the EF prepends when a life-safety category is detected (§8 rule 2). */
export function lifeSafetyPreamble(category: LifeSafetyCategory): string {
  switch (category) {
    case 'fire':
      return 'This may be a fire or alarm situation. If anyone is in danger, call the emergency line now. Follow the documented fire protocol below.';
    case 'medical':
      return 'This may be a medical emergency. If someone is hurt, call the emergency line now. The documented steps below do not replace emergency services.';
    case 'emergency_door':
      return 'An emergency door or exit is involved. Follow the documented protocol below and escalate as it directs.';
    default:
      return 'This may be an emergency. Call the proper emergency line and follow the documented protocol below.';
  }
}

/** Refusal used by the output guardrail when a query probes a specific incident. */
export const INCIDENT_PROBE_REFUSAL =
  'I cannot share details of specific past incidents. I can give you the general guidance and who to contact.';
