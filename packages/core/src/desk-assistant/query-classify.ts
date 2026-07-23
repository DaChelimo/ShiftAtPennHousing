// Desk Assistant — query classification + as-of date resolution (INTAKE_PLAN section 4a.3).
// Pure, no clock: the caller passes today's NY date. Date math is done in UTC so it is
// DST-safe (date-only, no wall-clock interval arithmetic; project invariant #6).
//
// Purpose: route a worker's question to the right subsystem. "Who is the HMOD next
// Tuesday" is a DUTY question -> resolve against live structured state as of that date
// (resolveRoute + resolve_hmod_on_duty), NOT the vector store. "Can other-house residents
// sign out a cart" is DURABLE knowledge -> RAG. Misclassification degrades to retrieval +
// defer, never a fabricated contact.

// Duty tiers a contact question can name (reference_duty_hierarchy_roles). 'smod' and
// 'csmod' are reached via a shared duty phone (the caller surfaces the number, no person
// resolution); 'ba' is the Building Administrator (resolved as the leave-aware bm).
export type DutyTier = 'hmod' | 'rsm' | 'ba' | 'smod' | 'csmod' | 'unknown';
export type QueryIntent = 'duty_contact' | 'personal_schedule' | 'durable_knowledge';

export interface QueryClassification {
  intent: QueryIntent;
  /** Whether the question asks who to contact / who is on duty. */
  asksContact: boolean;
  /**
   * Whether the question asks about the WORKER'S OWN schedule ("what's my next
   * shift", "am I working this weekend", "how many hours do I have this week").
   * These resolve against live assignment data via the get_my_shifts tool, not RAG.
   */
  asksPersonalSchedule: boolean;
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
const BA_RE = /\b(ba|building administrator|building admin)\b/i;
const CSMOD_RE = /\b(csmod|conferences? manager)\b/i;
const SMOD_RE = /\b(smod|student manager on duty|student manager|desk manager)\b/i;

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
  if (BA_RE.test(q)) return 'ba';
  if (CSMOD_RE.test(q)) return 'csmod';
  if (SMOD_RE.test(q)) return 'smod';
  return 'unknown';
}

export function hasTemporalReference(q: string): boolean {
  return DAY_RE.test(q) || RELATIVE_RE.test(q) || NUMERIC_DATE_RE.test(q) || MONTH_DATE_RE.test(q);
}

// Personal-schedule cues: the worker asking about their OWN shifts/hours. Anchored on a
// first-person subject ("my"/"I") AND a schedule noun/verb so a policy question that
// merely says "I" ("how do I reset the printer") does not misroute. Kept deliberately
// tight — a false negative degrades to RAG + defer, the same safe fallback as before.
const SELF_SCHEDULE_NOUN_RE =
  /\bmy\s+(next\s+|last\s+|upcoming\s+|current\s+|this\s+week'?s?\s+|weekend\s+)?(shift|shifts|schedule|hours|roster|rota|desk\s+shift)\b/i;
const SELF_WORKING_RE = /\b(am|are)\s+i\s+(working|scheduled|on\s+(the\s+)?(desk|shift|schedule))/i;
const SELF_WHEN_WORK_RE =
  /\b(when|what\s+time|what\s+day|where)\b[^?.!]*\bi\s+(work|working|scheduled)\b/i;
const SELF_DO_I_SHIFT_RE =
  /\bdo\s+i\s+(have|work)\b[^?.!]*\b(shift|shifts|work|hours|today|tomorrow|tonight|this\s+week|this\s+weekend)\b/i;
const SELF_HOURS_RE = /\bhow\s+many\s+(hours|shifts)\b[^?.!]*\bi\b/i;

/** Whether the question is about the asker's own schedule/hours (get_my_shifts tool). */
export function detectPersonalSchedule(q: string): boolean {
  return (
    SELF_SCHEDULE_NOUN_RE.test(q) ||
    SELF_WORKING_RE.test(q) ||
    SELF_WHEN_WORK_RE.test(q) ||
    SELF_DO_I_SHIFT_RE.test(q) ||
    SELF_HOURS_RE.test(q)
  );
}

/**
 * Classify a question. A contact question needs BOTH a who/contact cue and either a
 * contact verb or a named duty tier, so "who can sign out a cart" (a who-question that
 * is really procedural) does not misroute to the duty tool. Contact takes precedence
 * over personal-schedule ("who covers my shift" stays a contact question); a personal
 * schedule cue that is NOT a contact question routes to the get_my_shifts tool.
 */
export function classifyQuery(question: string): QueryClassification {
  const q = question.toLowerCase();
  const tier = detectTier(q);
  const asksContact =
    (CONTACT_RE.test(q) && (CONTACT_VERB_RE.test(q) || tier !== 'unknown')) ||
    /\bpoint of contact\b/i.test(q) ||
    // a named duty tier with a contact verb ("should I reach the RSM", "page the HMOD")
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
    HMOD_RE.test(q) ||
    RSM_RE.test(q) ||
    BA_RE.test(q) ||
    CSMOD_RE.test(q) ||
    SMOD_RE.test(q) ||
    /\b(hm|bm|contact|manager)\b/i.test(q);
  const assertShape = /\b(is|will be|are|=)\b\s+[a-z][a-z'.-]+/i.test(q) && !/\bwho\b/i.test(q);
  return namesTier && assertShape;
}
