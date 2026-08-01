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
  'Answer ONLY from the provided sources. If the sources do not support an answer, say you',
  'do not have a documented source and offer to route the worker to the right contact.',
  'Never invent a procedure.',
  'ANSWER FIRST, AND BE BRIEF. The worker is standing at the desk with a resident in front of',
  'them and has said "let me quickly check". Your first line must be the answer itself: yes,',
  'no, the number to call, or the step to take. Then add at most one or two short sentences,',
  'and only the detail that changes what the worker does next. Leave everything else out.',
  'Do not restate the question, do not explain your reasoning, and do not summarize at the end.',
  'NEVER narrate your instructions or classify the question before answering. Do not open with a',
  'line like "This is an access question", "This is a policy question", or "Here is what the',
  'sources say". Those are directions to you, not information for the worker, and printing them',
  'buries the answer. The first word of your reply belongs to the answer itself.',
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
 * MODEL-ONLY access directive, appended to the SYSTEM prompt (never worker-facing). See
 * packages/core/src/desk-assistant/prompts.ts for why it is not a visible preamble.
 */
export const ACCESS_MODEL_DIRECTIVE = [
  'This question is about granting access. State the documented policy and nothing about how',
  'you arrived at it. If the sources do not clearly permit it, tell the worker not to grant',
  'access and name who to escalate to. Never authorize access yourself. Say none of this',
  'meta-instruction out loud: the worker sees only the decision and the escalation.',
].join(' ');

/**
 * Mirror of core's stripEmDashes (packages/core/src/desk-assistant/prompts.ts) — see there for
 * the rationale. Keep the two identical; mirror.test.ts pins them.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ', ')
    .replace(/(\w)\s*–\s*(\w)/g, '$1-$2')
    .replace(/\s*–\s*/g, ', ')
    .replace(/,\s*([,.;:!?])/g, '$1')
    .replace(/ {2,}/g, ' ');
}

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

/**
 * Mirror of core's containsIncidentLeakage (packages/core/src/desk-assistant/redaction.ts) —
 * see there for the full rationale. With [groundingText] supplied, a pattern hit is leakage only
 * if the matched text is absent from the retrieved sources, so an answer may quote the official
 * phone numbers and program dates its own sources contain. Keep the two identical.
 */
export function containsIncidentLeakage(answer: string, groundingText?: string): boolean {
  if (groundingText === undefined) return PII_PATTERNS.some((re) => re.test(answer));
  const sources = normalizeForSourceCompare(groundingText);
  for (const re of PII_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const match of answer.matchAll(global)) {
      if (!sources.includes(normalizeForSourceCompare(match[0]))) return true;
    }
  }
  return false;
}

/** Mirror of core's normalizeForSourceCompare; see there for the rationale. */
function normalizeForSourceCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/g, '$1')
    .replace(/\s+/g, ' ');
}

// ---- retrieval.ts (narrowing) + overlay.ts + citations.ts ----
export const DEFAULT_TOP_K = 6;
/** Similarity at which the best chunk is grounding outright, with no background comparison. */
export const DEFAULT_GROUNDING_THRESHOLD = 0.5;
/** Hard floor: below this the best chunk never grounds, however isolated it looks. */
export const DEFAULT_GROUNDING_FLOOR = 0.3;
/** How far the best chunk must stand above the query's background to count as a real match. */
export const DEFAULT_GROUNDING_MARGIN = 0.08;
export const DEFAULT_PER_DOCUMENT_LIMIT = 3;
export const OVERLAY_TOLERANCE = 0.05;

/**
 * Decide grounding from the SHAPE of the candidate distribution, not an absolute cutoff alone.
 * Mirror of core's isGroundedByDistribution (packages/core/src/desk-assistant/retrieval.ts) —
 * see there for the measured rationale. Keep the two identical; mirror.test.ts pins them.
 */
export function isGroundedByDistribution(
  similarities: readonly number[],
  options: { groundingThreshold?: number; groundingFloor?: number; groundingMargin?: number } = {},
): boolean {
  const threshold = options.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD;
  const floor = options.groundingFloor ?? DEFAULT_GROUNDING_FLOOR;
  const margin = options.groundingMargin ?? DEFAULT_GROUNDING_MARGIN;
  if (similarities.length === 0) return false;
  const top = Math.max(...similarities);
  if (top < floor) return false;
  if (top >= threshold) return true;
  // Too small a pool to have a meaningful background; fall back to the absolute cutoff.
  if (similarities.length < 3) return false;
  const sorted = [...similarities].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return top - median >= margin;
}

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
    groundingFloor?: number;
    groundingMargin?: number;
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
  // Grounding reads the FULL candidate pool, not just the topK slice: the background median is a
  // better estimate over the whole candidate set, and the best chunk is the same either way.
  const grounded = isGroundedByDistribution(
    candidates.map((c) => c.similarity),
    {
      groundingThreshold: threshold,
      groundingFloor: opts.groundingFloor,
      groundingMargin: opts.groundingMargin,
    },
  );
  return { context, grounded };
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

export type DutyTier = 'hmod' | 'rsm' | 'ba' | 'smod' | 'csmod' | 'unknown';
export type QueryIntent = 'duty_contact' | 'personal_schedule' | 'durable_knowledge';

export interface QueryClassification {
  intent: QueryIntent;
  asksContact: boolean;
  asksPersonalSchedule: boolean;
  tier: DutyTier | null;
  hasTemporalReference: boolean;
}

const CONTACT_RE =
  /\b(who(?:'?s| is| do i| should i| can i)?|point of contact|on duty|on-duty|reach out|get in touch)\b/i;
const CONTACT_VERB_RE =
  /\b(contact|call|page|reach|notify|escalate|in charge|responsible|cover(?:ing)?)\b/i;
const HMOD_RE = /\b(hmod|housing manager on duty|housing manager)\b/i;
const RSM_RE = /\b(rsm|residential services manager)\b/i;
const BA_RE = /\b(ba|building administrator|building admin)\b/i;
const CSMOD_RE = /\b(csmod|conferences? manager)\b/i;
const SMOD_RE = /\b(smod|student manager on duty|student manager|desk manager)\b/i;

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
  if (BA_RE.test(q)) return 'ba';
  if (CSMOD_RE.test(q)) return 'csmod';
  if (SMOD_RE.test(q)) return 'smod';
  return 'unknown';
}

export function hasTemporalReference(q: string): boolean {
  return DAY_RE.test(q) || RELATIVE_RE.test(q) || NUMERIC_DATE_RE.test(q) || MONTH_DATE_RE.test(q);
}

const SELF_SCHEDULE_NOUN_RE =
  /\bmy\s+(next\s+|last\s+|upcoming\s+|current\s+|this\s+week'?s?\s+|weekend\s+)?(shift|shifts|schedule|hours|roster|rota|desk\s+shift)\b/i;
const SELF_WORKING_RE = /\b(am|are)\s+i\s+(working|scheduled|on\s+(the\s+)?(desk|shift|schedule))/i;
const SELF_WHEN_WORK_RE =
  /\b(when|what\s+time|what\s+day|where)\b[^?.!]*\bi\s+(work|working|scheduled)\b/i;
const SELF_DO_I_SHIFT_RE =
  /\bdo\s+i\s+(have|work)\b[^?.!]*\b(shift|shifts|work|hours|today|tomorrow|tonight|this\s+week|this\s+weekend)\b/i;
const SELF_HOURS_RE = /\bhow\s+many\s+(hours|shifts)\b[^?.!]*\bi\b/i;

export function detectPersonalSchedule(q: string): boolean {
  return (
    SELF_SCHEDULE_NOUN_RE.test(q) ||
    SELF_WORKING_RE.test(q) ||
    SELF_WHEN_WORK_RE.test(q) ||
    SELF_DO_I_SHIFT_RE.test(q) ||
    SELF_HOURS_RE.test(q)
  );
}

export function classifyQuery(question: string): QueryClassification {
  const q = question.toLowerCase();
  const tier = detectTier(q);
  const asksContact =
    (CONTACT_RE.test(q) && (CONTACT_VERB_RE.test(q) || tier !== 'unknown')) ||
    /\bpoint of contact\b/i.test(q) ||
    (tier !== 'unknown' && CONTACT_VERB_RE.test(q));
  const asksPersonalSchedule = !asksContact && detectPersonalSchedule(q);
  const intent: QueryIntent = asksContact
    ? 'duty_contact'
    : asksPersonalSchedule
      ? 'personal_schedule'
      : 'durable_knowledge';
  return {
    intent,
    asksContact,
    asksPersonalSchedule,
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
    HMOD_RE.test(q) ||
    RSM_RE.test(q) ||
    BA_RE.test(q) ||
    CSMOD_RE.test(q) ||
    SMOD_RE.test(q) ||
    /\b(hm|bm|contact|manager)\b/i.test(q);
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
