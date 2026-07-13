// Desk Assistant — routing engine mirror + duty-snapshot I/O (V1_SCOPE §4.2).
//
// The pure engine (resolveRoute, TIER_LADDER, types) is a VERBATIM mirror of
// packages/core/src/desk-assistant/routing.ts, pinned by
// packages/core/tests/desk-assistant/routing-mirror.test.ts. snapshotDutyState is
// the I/O half: it reuses the EXISTING duty SQL (resolve_hmod_on_duty,
// resolve_rsm_for_house, the project-administrator config) and never forks it.

// Minimal structural client type (like _shared/clock.ts) so this file imports
// nothing and can be pulled into the core Vitest parity test unchanged.
interface QueryClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
}

export type RoutingTier = 'desk_sm' | 'csmod' | 'rsm' | 'hmod' | 'ba' | 'project_admin';
export type DayType = 'weekday' | 'weekend';
export type Season = 'academic' | 'summer';

export const TIER_LADDER: readonly RoutingTier[] = [
  'desk_sm',
  'csmod',
  'rsm',
  'hmod',
  'ba',
  'project_admin',
];

export interface RoutingRule {
  ruleId: string;
  issueType: string;
  tier: RoutingTier;
  dayType: 'any' | DayType;
  windowStart: string | null;
  windowEnd: string | null;
  seasonScope: 'any' | Season;
  priority: number;
  active: boolean;
}

export interface RouteContext {
  issueType: string;
  dayType: DayType;
  timeHHMM: string;
  season: Season;
}

export interface DutySnapshot {
  deskSm: string | null;
  csmod: string | null;
  rsm: string | null;
  hmod: string | null;
  ba: string | null;
  projectAdmin: string | null;
}

export interface RouteDecision {
  ruleId: string | null;
  matchedTier: RoutingTier;
  resolvedTier: RoutingTier;
  userId: string | null;
  fallbackChain: RoutingTier[];
}

const DEFAULT_TIER: RoutingTier = 'hmod';

function withinWindow(rule: RoutingRule, timeHHMM: string): boolean {
  if (rule.windowStart === null || rule.windowEnd === null) return true;
  const { windowStart: s, windowEnd: e } = rule;
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
    case 'ba':
      return snapshot.ba;
    case 'project_admin':
      return snapshot.projectAdmin;
    default:
      return null;
  }
}

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

// ---- I/O: build the live context + duty snapshot -------------------------

/** NY wall-clock parts for `at`. */
export function nyParts(at: Date): { dayType: DayType; timeHHMM: string; season: Season } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = parts.weekday ?? 'Mon';
  const dayType: DayType = weekday === 'Sat' || weekday === 'Sun' ? 'weekend' : 'weekday';
  const hh = (parts.hour ?? '00').padStart(2, '0');
  const mm = (parts.minute ?? '00').padStart(2, '0');
  const month = Number(parts.month ?? '1');
  // PLACEHOLDER season (V1_SCOPE §10.1): June-August = summer. Real season comes
  // from operating_calendar state when the ladder lands.
  const season: Season = month >= 6 && month <= 8 ? 'summer' : 'academic';
  return { dayType, timeHHMM: `${hh === '24' ? '00' : hh}:${mm}`, season };
}

/**
 * Snapshot the live duty slots. Reuses existing duty SQL; the BA slot resolves the
 * leave-aware Building Manager for the house (reference_duty_hierarchy_roles), so the
 * walk-up rsm -> hmod -> ba surfaces the BA when the upper tiers are on leave. csmod /
 * deskSm stay null here: SMOD / CSMOD are reached via a shared duty phone (routed by the
 * caller), not resolved to a person.
 */
export async function snapshotDutyState(
  supabase: QueryClient,
  atISO: string,
  houseId: string,
): Promise<DutySnapshot> {
  const [{ data: hmod }, { data: rsm }, { data: ba }, { data: adminCfg }] = await Promise.all([
    supabase.rpc('resolve_hmod_on_duty', { p_at: atISO }),
    supabase.rpc('resolve_rsm_for_house', { p_house_id: houseId, p_at: atISO }),
    supabase.rpc('resolve_ba_for_house', { p_house_id: houseId, p_at: atISO }),
    supabase
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'project_administrator_user_id')
      .maybeSingle(),
  ]);
  const projectAdmin = (adminCfg as { config_value?: string } | null)?.config_value ?? null;
  return {
    deskSm: null,
    csmod: null,
    rsm: (rsm as string | null) ?? null,
    hmod: (hmod as string | null) ?? null,
    ba: (ba as string | null) ?? null,
    projectAdmin,
  };
}

// Tier labels (reference_duty_hierarchy_roles). SMOD = Student Manager on Duty (summer
// first contact for access issues); CSMOD = Conferences Manager on Duty (conference
// guests) -- NOT a student manager; BA = Building Administrator (above the HM).
export function tierLabel(tier: RoutingTier): string {
  switch (tier) {
    case 'desk_sm':
      return 'the Student Manager on Duty (SMOD)';
    case 'csmod':
      return 'the Conferences Manager on Duty (CSMOD)';
    case 'rsm':
      return 'the Residential Services Manager';
    case 'hmod':
      return 'the Housing Manager on Duty';
    case 'ba':
      return 'the Building Administrator';
    case 'project_admin':
      return 'the project administrator';
    default:
      return 'the on-duty contact';
  }
}
