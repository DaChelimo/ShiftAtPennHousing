// Desk Assistant — intake proposer (INTAKE_PLAN Phase 2). Pure: the prompt + the
// output schema + a strict validator. The da-assistant-propose Edge Function makes the
// Claude call; core owns everything testable so the parser is unit-tested and the EF
// stays thin.
//
// The proposer reads normalized text and returns: document-level metadata, the section
// 7.2 raw-vs-lesson redaction split, and a per-item classification that drives the
// temporal + duty design (section 4a): each item is a durable rule, a dated announcement
// with a validity window, or a fact that belongs in structured data (an hm_leave) and
// should NOT be indexed as prose.

import { validateWindow, type EffectiveWindow, type Temporality } from './temporal.js';
import type { DeskRole, Sensitivity, SourceType } from './types.js';

export type ItemKind = 'durable_rule' | 'dated_announcement' | 'structured_leave';

export interface ProposedItem {
  /** The rule / announcement text, cleaned. */
  content: string;
  kind: ItemKind;
  window: EffectiveWindow;
  /**
   * For `structured_leave` only: a human note telling the operator this maps to the
   * existing hm_leave path and should be entered there, not indexed. Null otherwise.
   */
  routingNote: string | null;
}

export interface ProposedDoc {
  title: string;
  sourceType: SourceType;
  sourceRef: string;
  /**
   * null = shared/cross-house; a non-empty array = the houses it applies to. The
   * proposer only ever guesses at most one house (see proposeSystemPrompt); an
   * operator may broaden or narrow the set in the review step before approving.
   */
  houseScope: string[] | null;
  sensitivity: Sensitivity;
  allowedRoles: DeskRole[];
  items: ProposedItem[];
  /** Section 7.2 split for incident-derived sources; both optional. */
  representations: { rawRecord?: string; deIdentifiedLesson?: string };
}

const SOURCE_TYPES: readonly SourceType[] = [
  'hm_guide',
  'house_binder',
  'summer_binder',
  'incident_lesson',
  'app_guide',
  'fixture',
];
const SENSITIVITIES: readonly Sensitivity[] = ['general', 'internal', 'restricted'];
const ROLES: readonly DeskRole[] = ['sw', 'sm', 'hm', 'bm', 'rsm', 'admin'];
const KINDS: readonly ItemKind[] = ['durable_rule', 'dated_announcement', 'structured_leave'];
const TEMPORALITIES: readonly Temporality[] = ['durable', 'until_superseded', 'expires'];

/**
 * Instruction for the propose pass. `anchorDate` (the source's own date) is injected so
 * relative dates resolve absolutely. Claude must return strict JSON matching ProposedDoc.
 */
export function proposeSystemPrompt(anchorDate: string, houseIds: readonly string[]): string {
  return [
    'You prepare housing-desk source documents for a knowledge base. You will receive',
    `normalized text. The source is dated ${anchorDate}; resolve every relative date`,
    '("tomorrow", "next Tuesday", "this weekend") to an absolute YYYY-MM-DD using that',
    'anchor. Return ONLY a JSON object with these fields:',
    '- title, sourceType (one of hm_guide|house_binder|summer_binder|incident_lesson|app_guide|fixture),',
    '  sourceRef (a short human citation label), houseScope (null for a shared/cross-house',
    `  document, otherwise EXACTLY one of these house ids: ${houseIds.join('|')}. Never invent`,
    '  an id, abbreviation, or house name that is not in that exact list -- if the document',
    '  names a house you cannot map to one of these ids with confidence, use null instead.',
    '  sensitivity (general|internal|restricted), allowedRoles (array; empty = all roles).',
    '- items: array. Split the document into individual facts. For each item set:',
    '  content (the rule text); kind; window {temporality, effectiveFrom, effectiveUntil};',
    '  routingNote.',
    'Classify each item:',
    '- durable_rule: a timeless procedure (window temporality "durable", both dates null).',
    '- dated_announcement: a fact true only for a period ("pro staff out 6/19", a backup',
    '  contact for a specific window). Set temporality "expires" with effectiveUntil, or',
    '  "until_superseded" for an open-ended standing note. routingNote null.',
    '- structured_leave: an HM, BM, or RSM being on leave with a replacement. Do NOT try to',
    '  index it; set routingNote telling the operator to enter it via the hm_leave path.',
    '- representations: for incident-derived content, provide deIdentifiedLesson (general',
    '  takeaway, no names/rooms/dates/PII) and rawRecord; otherwise omit both.',
    'Do not invent facts. Do not use em dashes or en dashes. Return ONLY the JSON.',
  ].join(' ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseWindow(raw: unknown): EffectiveWindow | null {
  if (!isRecord(raw)) return null;
  const temporality = raw.temporality;
  if (typeof temporality !== 'string' || !TEMPORALITIES.includes(temporality as Temporality)) {
    return null;
  }
  const from = raw.effectiveFrom;
  const until = raw.effectiveUntil;
  if (from !== null && typeof from !== 'string') return null;
  if (until !== null && typeof until !== 'string') return null;
  return {
    temporality: temporality as Temporality,
    effectiveFrom: (from as string | null) ?? null,
    effectiveUntil: (until as string | null) ?? null,
  };
}

function parseItem(raw: unknown): ProposedItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.content !== 'string' || raw.content.trim().length === 0) return null;
  if (typeof raw.kind !== 'string' || !KINDS.includes(raw.kind as ItemKind)) return null;
  const window = parseWindow(raw.window);
  if (window === null) return null;
  if (validateWindow(window).length > 0) return null;
  const routingNote = typeof raw.routingNote === 'string' ? raw.routingNote : null;
  return { content: raw.content, kind: raw.kind as ItemKind, window, routingNote };
}

/**
 * Validate + narrow an untrusted parsed Claude response into a ProposedDoc. Returns null
 * on any shape violation so the EF can retry rather than persist a malformed proposal.
 * Items that individually fail validation are dropped; a doc with zero valid items is
 * rejected (null).
 */
export function parseProposedDoc(raw: unknown): ProposedDoc | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
  if (typeof raw.sourceType !== 'string' || !SOURCE_TYPES.includes(raw.sourceType as SourceType)) {
    return null;
  }
  if (typeof raw.sourceRef !== 'string' || raw.sourceRef.trim().length === 0) return null;

  // The proposer prompt asks Claude for a single house id or null; the pipeline
  // wraps that guess into the array shape everything downstream (KbDocMeta,
  // ItemScope, the review-step house picker) uses.
  const houseScope =
    raw.houseScope === null || raw.houseScope === undefined
      ? null
      : typeof raw.houseScope === 'string'
        ? [raw.houseScope]
        : undefined;
  if (houseScope === undefined) return null;

  const sensitivity = SENSITIVITIES.includes(raw.sensitivity as Sensitivity)
    ? (raw.sensitivity as Sensitivity)
    : 'general';

  const allowedRoles = Array.isArray(raw.allowedRoles)
    ? raw.allowedRoles.filter(
        (r): r is DeskRole => typeof r === 'string' && ROLES.includes(r as DeskRole),
      )
    : [];

  if (!Array.isArray(raw.items)) return null;
  const items = raw.items.map(parseItem).filter((i): i is ProposedItem => i !== null);
  if (items.length === 0) return null;

  const rep = isRecord(raw.representations) ? raw.representations : {};
  const representations: ProposedDoc['representations'] = {};
  if (typeof rep.rawRecord === 'string') representations.rawRecord = rep.rawRecord;
  if (typeof rep.deIdentifiedLesson === 'string') {
    representations.deIdentifiedLesson = rep.deIdentifiedLesson;
  }

  return {
    title: raw.title,
    sourceType: raw.sourceType as SourceType,
    sourceRef: raw.sourceRef,
    houseScope,
    sensitivity,
    allowedRoles,
    items,
    representations,
  };
}

/** The items an operator would actually index (durable + dated), excluding structured_leave. */
export function indexableItems(doc: ProposedDoc): ProposedItem[] {
  return doc.items.filter((i) => i.kind !== 'structured_leave');
}

/** Items the operator must route to hm_leave instead of indexing. */
export function structuredLeaveItems(doc: ProposedDoc): ProposedItem[] {
  return doc.items.filter((i) => i.kind === 'structured_leave');
}
