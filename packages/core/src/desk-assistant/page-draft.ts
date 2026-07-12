// Desk Assistant — page assembly + handoff adapters (V1_SCOPE §4.3, §7.4). Pure.
//
// Two handoff adapters ship; DEFAULT_HANDOFF_ADAPTER is the flip-point for the §10.4
// decision (locked to app_notification 2026-07-10). No em/en dashes in output.

import { requiredFieldsFor } from './page-fields.js';

export type HandoffAdapter = 'app_notification' | 'legacy_pager';
export const DEFAULT_HANDOFF_ADAPTER: HandoffAdapter = 'app_notification';

export interface PageDraftInput {
  issueType: string;
  fields: Record<string, string>;
  houseName: string;
  authorName: string;
  /** Human label for the resolved recipient tier (from routing.tierLabel). */
  recipientLabel: string;
}

/** System prompt for the optional Claude assembly pass (used by da-draft-page). */
export const PAGE_DRAFT_SYSTEM_PROMPT = [
  'You draft a concise, complete desk page for a housing manager.',
  'Use only the provided fields. State the issue, the location, whether it is building-wide',
  'or isolated when known, what was already tried, and the callback number.',
  'Be factual and brief. Do not invent details. Do not use em dashes or en dashes.',
].join(' ');

// Ordered "Label: value" lines for the fields present, in the issue's field order.
function fieldLines(input: PageDraftInput): string[] {
  const specs = requiredFieldsFor(input.issueType);
  const lines: string[] = [];
  for (const spec of specs) {
    const value = input.fields[spec.key];
    if (value !== undefined && String(value).trim() !== '') {
      lines.push(`${spec.label}: ${String(value).trim()}`);
    }
  }
  return lines;
}

/** App-notification format: a title + a multi-line body. */
export function formatForNotification(input: PageDraftInput): { title: string; body: string } {
  const title = `Desk page: ${input.issueType} at ${input.houseName}`;
  const body = [
    `From ${input.authorName} (${input.houseName} desk), for ${input.recipientLabel}.`,
    ...fieldLines(input),
  ].join('\n');
  return { title, body };
}

/** Legacy-pager format: a single compact block the worker pastes into the pager channel. */
export function formatForLegacyPager(input: PageDraftInput): string {
  const parts = [
    `PAGE ${input.houseName} ${input.issueType}`,
    ...fieldLines(input).map((l) => l.replace(/\n/g, ' ')),
    `cc ${input.recipientLabel}`,
  ];
  return parts.join(' | ');
}

/** Format a draft for the chosen adapter (string form used by da-send-page). */
export function formatForAdapter(adapter: HandoffAdapter, input: PageDraftInput): string {
  if (adapter === 'legacy_pager') return formatForLegacyPager(input);
  const { title, body } = formatForNotification(input);
  return `${title}\n${body}`;
}
