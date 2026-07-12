// Desk Assistant — escalation routing engine (V1_SCOPE §4.2). Pure: no Supabase,
// no clock. The da-route Edge Function snapshots live duty state (reusing the
// existing resolve_hmod_on_duty / resolve_rsm_for_house / project-administrator
// config) and the current season/day/time, then calls resolveRoute here.
//
// This is the §10.1 seam: the ROUTING RULES are data (routing_rules table, seeded
// with a placeholder ladder). The real tier ladder + season/day/time windows +
// leave fallbacks replace the seed without touching this engine.
//
// The student-manager tier is CSMOD (not "ASMOD", which does not exist).

export type RoutingTier = 'desk_sm' | 'csmod' | 'rsm' | 'hmod' | 'project_admin';
export type DayType = 'weekday' | 'weekend';
export type Season = 'academic' | 'summer';

// Escalation ladder, lowest to terminal. An unfilled tier falls UP to the next one;
// project_admin is the terminal contact (mirrors the phase-07 terminal-contact rule).
export const TIER_LADDER: readonly RoutingTier[] = [
  'desk_sm',
  'csmod',
  'rsm',
  'hmod',
  'project_admin',
];

export interface RoutingRule {
  ruleId: string;
  issueType: string;
  tier: RoutingTier;
  dayType: 'any' | DayType;
  /** NY wall-clock 'HH:MM' inclusive start, or null = all day. */
  windowStart: string | null;
  /** NY wall-clock 'HH:MM' exclusive end, or null = all day. */
  windowEnd: string | null;
  seasonScope: 'any' | Season;
  priority: number; // lower wins
  active: boolean;
}

export interface RouteContext {
  issueType: string;
  dayType: DayType;
  /** NY wall-clock 'HH:MM' (24h, zero-padded). */
  timeHHMM: string;
  season: Season;
}

/** Who currently fills each tier slot (null = unfilled / on leave with no cover). */
export interface DutySnapshot {
  deskSm: string | null;
  csmod: string | null;
  rsm: string | null;
  hmod: string | null;
  projectAdmin: string | null;
}

export interface RouteDecision {
  /** The matched rule, or null when no rule matched and the default applied. */
  ruleId: string | null;
  /** Tier the matched rule (or default) specified. */
  matchedTier: RoutingTier;
  /** Tier actually resolved to after walking up past unfilled slots. */
  resolvedTier: RoutingTier;
  /** Resolved person; null only if even the terminal slot is empty. */
  userId: string | null;
  /** Tiers walked from matchedTier to resolvedTier (inclusive). */
  fallbackChain: RoutingTier[];
}

// Default when no rule matches: send to the HMOD (the current catch-all). This is a
// safe placeholder; the real default comes with the §10.1 ladder.
const DEFAULT_TIER: RoutingTier = 'hmod';

function withinWindow(rule: RoutingRule, timeHHMM: string): boolean {
  if (rule.windowStart === null || rule.windowEnd === null) return true;
  const { windowStart: s, windowEnd: e } = rule;
  // Normal window s <= t < e; overnight window (s > e) wraps midnight.
  return s <= e ? timeHHMM >= s && timeHHMM < e : timeHHMM >= s || timeHHMM < e;
}

function ruleMatches(rule: RoutingRule, ctx: RouteContext): boolean {
  return (
    rule.active &&
    rule.issueType === ctx.issueType &&
    (rule.seasonScope === 'any' || rule.seasonScope === ctx.season) &&
    (rule.dayType === 'any' || rule.dayType === ctx.dayType) &&
    withinWindow(rule, ctx.timeHHMM)
  );
}

function slotFor(snapshot: DutySnapshot, tier: RoutingTier): string | null {
  switch (tier) {
    case 'desk_sm':
      return snapshot.deskSm;
    case 'csmod':
      return snapshot.csmod;
    case 'rsm':
      return snapshot.rsm;
    case 'hmod':
      return snapshot.hmod;
    case 'project_admin':
      return snapshot.projectAdmin;
    default:
      return null;
  }
}

/**
 * Resolve the current contact for a situation. Picks the highest-priority matching
 * rule (lowest `priority`; ties broken by ruleId for determinism), then walks the
 * ladder upward from that tier to the first filled slot, ending at the terminal
 * project_admin. If nothing is filled, userId is null (the EF logs a warning).
 */
export function resolveRoute(
  ctx: RouteContext,
  rules: readonly RoutingRule[],
  snapshot: DutySnapshot,
): RouteDecision {
  const matches = rules
    .filter((r) => ruleMatches(r, ctx))
    .sort(
      (a, b) => a.priority - b.priority || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0),
    );

  const chosen = matches[0] ?? null;
  const matchedTier = chosen?.tier ?? DEFAULT_TIER;

  const startIdx = TIER_LADDER.indexOf(matchedTier);
  const fallbackChain: RoutingTier[] = [];
  let userId: string | null = null;
  let resolvedTier: RoutingTier = matchedTier;
  for (let i = startIdx; i < TIER_LADDER.length; i += 1) {
    const tier = TIER_LADDER[i]!;
    fallbackChain.push(tier);
    const slot = slotFor(snapshot, tier);
    if (slot !== null) {
      userId = slot;
      resolvedTier = tier;
      break;
    }
    resolvedTier = tier;
  }

  return { ruleId: chosen?.ruleId ?? null, matchedTier, resolvedTier, userId, fallbackChain };
}
