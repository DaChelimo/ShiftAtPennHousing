// Desk Assistant — query classification + as-of date resolution (INTAKE_PLAN section 4a.3).
// Pure, no clock: the caller passes today's NY date. Date math is done in UTC so it is
// DST-safe (date-only, no wall-clock interval arithmetic; project invariant #6).
//
// Purpose: route a worker's question to the right subsystem. "Who is the HMOD next
// Tuesday" is a DUTY question -> resolve against live structured state as of that date
// (resolveRoute + resolve_hmod_on_duty), NOT the vector store. "Can other-house residents
// sign out a cart" is DURABLE knowledge -> RAG. Misclassification degrades to retrieval +
// defer, never a fabricated contact.

export type DutyTier = 'hmod' | 'rsm' | 'sm' | 'unknown';
export type QueryIntent = 'duty_contact' | 'durable_knowledge';

export interface QueryClassification {
  intent: QueryIntent;
  /** Whether the question asks who to contact / who is on duty. */
  asksContact: boolean;
  /** Best-guess tier the contact question targets, or null if not a contact question. */
  tier: DutyTier | null;
  /** Whether the question carries a date reference needing as-of resolution. */
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

/** Best-guess duty tier named in the question (or 'unknown' if a contact q with no tier). */
function detectTier(q: string): DutyTier {
  if (HMOD_RE.test(q)) return 'hmod';
  if (RSM_RE.test(q)) return 'rsm';
  if (SM_RE.test(q)) return 'sm';
  return 'unknown';
}

export function hasTemporalReference(q: string): boolean {
  return DAY_RE.test(q) || RELATIVE_RE.test(q) || NUMERIC_DATE_RE.test(q) || MONTH_DATE_RE.test(q);
}

/**
 * Classify a question. A contact question needs BOTH a who/contact cue and either a
 * contact verb or a named duty tier, so "who can sign out a cart" (a who-question that
 * is really procedural) does not misroute to the duty tool.
 */
export function classifyQuery(question: string): QueryClassification {
  const q = question.toLowerCase();
  const tier = detectTier(q);
  const asksContact =
    (CONTACT_RE.test(q) && (CONTACT_VERB_RE.test(q) || tier !== 'unknown')) ||
    /\bpoint of contact\b/i.test(q) ||
    // a named duty tier with a contact verb ("should I reach the RSM", "page the HMOD")
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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Resolve a date reference in the question to a NY-local calendar date (YYYY-MM-DD),
 * relative to `todayIso` (today's NY date, supplied by the caller). Returns null when the
 * question names no date, in which case the caller uses today. Bare weekday names resolve
 * to the NEXT occurrence on or after tomorrow ("who is on Tuesday" means the coming
 * Tuesday), matching how staff read a forward-looking schedule question.
 */
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
    if (delta === 0) delta = 7; // "on Tuesday" asked on a Tuesday means next Tuesday
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

/**
 * Detect a worker trying to ASSERT a fact ("the HM next Tuesday is Mary"). The assistant
 * must never persist such an assertion (INTAKE_PLAN section 4a.3 #5); this lets it steer
 * to verifying against the duty tool instead of accepting the claim.
 */
export function looksLikeFactAssertion(question: string): boolean {
  const q = question.toLowerCase();
  const namesTier =
    HMOD_RE.test(q) || RSM_RE.test(q) || SM_RE.test(q) || /\b(hm|bm|contact|manager)\b/i.test(q);
  const assertShape = /\b(is|will be|are|=)\b\s+[a-z][a-z'.-]+/i.test(q) && !/\bwho\b/i.test(q);
  return namesTier && assertShape;
}
