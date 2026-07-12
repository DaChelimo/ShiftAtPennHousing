// Desk Assistant — ask-time mirror of packages/core/src/desk-assistant/*.
//
// Deno cannot import the pnpm workspace, so the small slice of pure logic da-ask
// needs at runtime is mirrored here VERBATIM from core. The core modules are the
// contract and their Vitest is the test of record; this file is pinned to them by
// packages/core/tests/desk-assistant/mirror.test.ts (it reads this file's text and
// asserts the constants/regex sources match). Update BOTH sides together.
//
// Mirrors: prompts.ts, guardrails.ts, retrieval.ts (narrowing only — scope
// filtering happens in SQL via match_kb_chunks), citations.ts.

// ---- prompts.ts ----
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

export function buildDeferralMessage(routingHint?: string): string {
  const base = 'I do not have a documented source for that, so I will not guess.';
  if (routingHint && routingHint.trim().length > 0) {
    return `${base} ${routingHint.trim()}`;
  }
  return `${base} I can help you reach the right contact for this.`;
}

export type LifeSafetyCategory = 'fire' | 'medical' | 'emergency_door';

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

export const INCIDENT_PROBE_REFUSAL =
  'I cannot share details of specific past incidents. I can give you the general guidance and who to contact.';

// ---- guardrails.ts (regex sources copied verbatim) ----
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

export function detectLifeSafety(text: string): LifeSafetyCategory | null {
  for (const { category, re } of LIFE_SAFETY_PATTERNS) {
    if (re.test(text)) return category;
  }
  return null;
}

const ACCESS_RE =
  /\b(access|let\s+\w+\s+in|unlock|key|keys|grant|allow\s+(entry|in)|contractor|vendor|perimeter|door code|badge|fob)\b/i;

export function mentionsAccessDecision(text: string): boolean {
  return ACCESS_RE.test(text);
}

const INCIDENT_PROBE_RE =
  /\b(what happened|tell me about|the (other day|incident|time)|last (week|night|time)|who (got|was)|that student who|the case where)\b/i;

export function looksLikeIncidentProbe(text: string): boolean {
  return INCIDENT_PROBE_RE.test(text);
}

// ---- redaction.ts (output guardrail only) ----
// Mirror of PII_PATTERNS in packages/core redaction.ts. Used by da-ask to scan a
// generated answer for incident-identifying PII before returning (defense in depth).
const PII_PATTERNS: RegExp[] = [
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b(room|rm|apt|apartment|suite|unit)\s*#?\s*\d+/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
  /\bnamed\s+[A-Z][a-z]+/,
];

export function containsIncidentLeakage(answer: string): boolean {
  return PII_PATTERNS.some((re) => re.test(answer));
}

// ---- retrieval.ts (narrowing) + overlay.ts + citations.ts ----
export const DEFAULT_TOP_K = 6;
export const DEFAULT_GROUNDING_THRESHOLD = 0.5;
export const DEFAULT_PER_DOCUMENT_LIMIT = 3;
export const OVERLAY_TOLERANCE = 0.05;

export interface Candidate {
  chunkId: string;
  documentId: string;
  content: string;
  sourceRef: string;
  houseScope: string | null;
  similarity: number;
  /** Parent source updated_at; recency tiebreak on a near-similarity tie (parity: core). */
  sourceUpdatedAt?: string;
}

export interface RankedChunk extends Candidate {
  rank: number;
}

function overlayBoost(
  houseScope: string | null,
  homeHouseId: string | null,
  tolerance: number,
): number {
  return houseScope !== null && homeHouseId !== null && houseScope === homeHouseId ? tolerance : 0;
}

// Candidates arrive already scope-filtered + similarity-ordered from match_kb_chunks.
// This applies the home-overlay precedence boost + per-document cap + topK and decides
// grounding (on RAW similarity). Mirrors selectContext MINUS the scope filter (SQL owns that).
export function narrowContext(
  candidates: readonly Candidate[],
  opts: {
    topK?: number;
    groundingThreshold?: number;
    perDocumentLimit?: number;
    requesterHouseId?: string;
    overlayTolerance?: number;
  } = {},
): { context: RankedChunk[]; grounded: boolean } {
  const topK = Math.max(1, opts.topK ?? DEFAULT_TOP_K);
  const threshold = opts.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD;
  const perDoc = Math.max(1, opts.perDocumentLimit ?? DEFAULT_PER_DOCUMENT_LIMIT);
  const homeHouse = opts.requesterHouseId ?? null;
  const tolerance = opts.overlayTolerance ?? OVERLAY_TOLERANCE;
  const effective = (c: Candidate): number =>
    c.similarity + overlayBoost(c.houseScope, homeHouse, tolerance);
  const newer = (a: Candidate, b: Candidate): number => {
    const av = a.sourceUpdatedAt ?? '';
    const bv = b.sourceUpdatedAt ?? '';
    return av === bv ? 0 : av > bv ? -1 : 1;
  };

  const sorted = [...candidates].sort(
    (a, b) =>
      effective(b) - effective(a) ||
      newer(a, b) ||
      (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
  );
  const perDocCount = new Map<string, number>();
  const picked: Candidate[] = [];
  for (const c of sorted) {
    const n = perDocCount.get(c.documentId) ?? 0;
    if (n >= perDoc) continue;
    perDocCount.set(c.documentId, n + 1);
    picked.push(c);
    if (picked.length >= topK) break;
  }
  const context = picked.map((c, i) => ({ ...c, rank: i }));
  return { context, grounded: context.some((c) => c.similarity >= threshold) };
}

export interface Citation {
  documentId: string;
  sourceRef: string;
  chunkIds: string[];
}

export function buildCitations(context: readonly RankedChunk[]): Citation[] {
  const byDoc = new Map<string, Citation>();
  for (const chunk of context) {
    const existing = byDoc.get(chunk.documentId);
    if (existing) existing.chunkIds.push(chunk.chunkId);
    else
      byDoc.set(chunk.documentId, {
        documentId: chunk.documentId,
        sourceRef: chunk.sourceRef,
        chunkIds: [chunk.chunkId],
      });
  }
  return [...byDoc.values()];
}

// ---- query-classify.ts (mirror; parity pinned by mirror.test.ts) ----
// Route a question to the duty tool (who-is-on-duty) vs RAG (durable knowledge), and
// resolve any date reference to a NY-local calendar date. Verbatim copy of
// packages/core/src/desk-assistant/query-classify.ts (Deno cannot import the workspace).

export type DutyTier = 'hmod' | 'rsm' | 'sm' | 'unknown';
export type QueryIntent = 'duty_contact' | 'durable_knowledge';

export interface QueryClassification {
  intent: QueryIntent;
  asksContact: boolean;
  tier: DutyTier | null;
  hasTemporalReference: boolean;
}

const CONTACT_RE =
  /\b(who(?:'?s| is| do i| should i| can i)?|point of contact|on duty|on-duty|reach out|get in touch)\b/i;
const CONTACT_VERB_RE =
  /\b(contact|call|page|reach|notify|escalate|in charge|responsible|cover(?:ing)?)\b/i;
const HMOD_RE = /\b(hmod|housing manager on duty|housing manager)\b/i;
const RSM_RE = /\b(rsm|residential services manager)\b/i;
const SM_RE = /\b(smod|csmod|student manager|desk manager|\bsm\b)\b/i;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`, 'i');
const RELATIVE_RE =
  /\b(today|tonight|tomorrow|this (?:week|weekend|morning|afternoon|evening)|next (?:week|weekend))\b/i;
const NUMERIC_DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/;
const MONTH_DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function detectTier(q: string): DutyTier {
  if (HMOD_RE.test(q)) return 'hmod';
  if (RSM_RE.test(q)) return 'rsm';
  if (SM_RE.test(q)) return 'sm';
  return 'unknown';
}

export function hasTemporalReference(q: string): boolean {
  return DAY_RE.test(q) || RELATIVE_RE.test(q) || NUMERIC_DATE_RE.test(q) || MONTH_DATE_RE.test(q);
}

export function classifyQuery(question: string): QueryClassification {
  const q = question.toLowerCase();
  const tier = detectTier(q);
  const asksContact =
    (CONTACT_RE.test(q) && (CONTACT_VERB_RE.test(q) || tier !== 'unknown')) ||
    /\bpoint of contact\b/i.test(q) ||
    (tier !== 'unknown' && CONTACT_VERB_RE.test(q));
  return {
    intent: asksContact ? 'duty_contact' : 'durable_knowledge',
    asksContact,
    tier: asksContact ? tier : null,
    hasTemporalReference: hasTemporalReference(q),
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function toIso(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function parseIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

export function resolveAsOfDate(question: string, todayIso: string): string | null {
  const q = question.toLowerCase();
  const todayMs = parseIso(todayIso);
  const DAY = 86400000;
  if (/\btomorrow\b/.test(q)) return toIso(todayMs + DAY);
  if (/\b(today|tonight|this (?:morning|afternoon|evening))\b/.test(q)) return todayIso;
  const dayMatch = q.match(DAY_RE);
  if (dayMatch) {
    const target = WEEKDAYS.indexOf(dayMatch[1]!.toLowerCase());
    const todayDow = new Date(todayMs).getUTCDay();
    let delta = (target - todayDow + 7) % 7;
    if (delta === 0) delta = 7;
    return toIso(todayMs + delta * DAY);
  }
  const numeric = q.match(NUMERIC_DATE_RE);
  if (numeric) {
    const parts = numeric[0].split('/').map(Number);
    const [mm, dd, yy] = parts;
    const year = yy === undefined ? new Date(todayMs).getUTCFullYear() : yy < 100 ? 2000 + yy : yy;
    return `${year}-${pad(mm!)}-${pad(dd!)}`;
  }
  const month = q.match(MONTH_DATE_RE);
  if (month) {
    const mIdx = MONTHS.indexOf(month[1]!.slice(0, 3).toLowerCase());
    const dd = Number(month[0].match(/\d{1,2}\b/)![0]);
    const year = new Date(todayMs).getUTCFullYear();
    if (mIdx >= 0) return `${year}-${pad(mIdx + 1)}-${pad(dd)}`;
  }
  return null;
}

export function looksLikeFactAssertion(question: string): boolean {
  const q = question.toLowerCase();
  const namesTier =
    HMOD_RE.test(q) || RSM_RE.test(q) || SM_RE.test(q) || /\b(hm|bm|contact|manager)\b/i.test(q);
  const assertShape = /\b(is|will be|are|=)\b\s+[a-z][a-z'.-]+/i.test(q) && !/\bwho\b/i.test(q);
  return namesTier && assertShape;
}

/** Today's NY-local calendar date (YYYY-MM-DD) for `at`, the anchor for resolveAsOfDate. */
export function nyDate(at: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(at);
}
