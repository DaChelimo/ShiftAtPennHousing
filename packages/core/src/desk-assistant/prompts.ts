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
  'Answer ONLY from the provided sources. Every substantive claim must be supported',
  'by a source, and you must state where the guidance came from.',
  'If the sources do not support an answer, say you do not have a documented source',
  'and offer to route the worker to the right contact. Never invent a procedure.',
  'For fire, medical, or emergency-door situations, surface the documented protocol',
  'and tell the worker to call the proper emergency line. Never present yourself as a',
  'replacement for emergency protocol.',
  'For access questions, state the policy. When the policy is unclear, tell the worker',
  'NOT to grant access and to escalate. Never authorize access yourself.',
  'Never disclose or speculate about specific past incidents or any personal information.',
  'Be concise and practical. Do not use em dashes or en dashes.',
].join(' ');

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
