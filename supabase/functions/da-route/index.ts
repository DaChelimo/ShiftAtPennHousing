// Desk Assistant — da-route Edge Function (V1_SCOPE §4.2). Thin wrapper: snapshot
// live duty state + season/day/time, evaluate the routing_rules ladder, resolve the
// current contact. Reads duty state; never writes an assignment.

import { fetchAppNow } from '../_shared/clock.ts';
import {
  nyParts,
  resolveRoute,
  snapshotDutyState,
  tierLabel,
  type RoutingRule,
} from '../_shared/desk-assistant-routing.ts';
import { authenticate, edgeHandler, jsonResponse, readObjectBody } from '../_shared/swap-http.ts';

interface RuleRow {
  rule_id: string;
  issue_type: string;
  tier: RoutingRule['tier'];
  day_type: RoutingRule['dayType'];
  window_start: string | null;
  window_end: string | null;
  season_scope: RoutingRule['seasonScope'];
  priority: number;
  active: boolean;
}

Deno.serve(
  edgeHandler('da-route', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { supabase, userId } = auth;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;
    const issueType = typeof parsed.body.issueType === 'string' ? parsed.body.issueType : 'general';

    const { data: profile } = await supabase
      .from('users')
      .select('home_house_id')
      .eq('user_id', userId)
      .single();
    const houseId = (profile as { home_house_id?: string } | null)?.home_house_id ?? null;
    if (houseId === null) return jsonResponse({ error: 'no home house for user' }, 400);

    const now = await fetchAppNow(supabase);
    const atISO = now.toISOString();

    const { data: ruleRows, error: rulesErr } = await supabase
      .from('routing_rules')
      .select('*')
      .eq('active', true);
    if (rulesErr)
      return jsonResponse({ error: 'rules_load_failed', detail: rulesErr.message }, 500);

    const rules: RoutingRule[] = (ruleRows as RuleRow[]).map((r) => ({
      ruleId: r.rule_id,
      issueType: r.issue_type,
      tier: r.tier,
      dayType: r.day_type,
      windowStart: r.window_start ? r.window_start.slice(0, 5) : null,
      windowEnd: r.window_end ? r.window_end.slice(0, 5) : null,
      seasonScope: r.season_scope,
      priority: r.priority,
      active: r.active,
    }));

    const snapshot = await snapshotDutyState(supabase, atISO, houseId);
    const { dayType, timeHHMM, season } = nyParts(now);
    const decision = resolveRoute({ issueType, dayType, timeHHMM, season }, rules, snapshot);

    // Resolve the contact's display info (name/phone) if we landed on a person.
    let contact: { userId: string; name: string | null; phone: string | null } | null = null;
    if (decision.userId !== null) {
      const { data: person } = await supabase
        .from('users')
        .select('user_id, name, phone')
        .eq('user_id', decision.userId)
        .maybeSingle();
      const p = person as { user_id: string; name: string | null; phone: string | null } | null;
      if (p) contact = { userId: p.user_id, name: p.name, phone: p.phone };
    } else {
      console.warn(
        `da-route: no contact resolved for issue=${issueType} house=${houseId} at=${atISO}`,
      );
    }

    return jsonResponse({
      issueType,
      matchedTier: decision.matchedTier,
      resolvedTier: decision.resolvedTier,
      tierLabel: tierLabel(decision.resolvedTier),
      ruleId: decision.ruleId,
      fallbackChain: decision.fallbackChain,
      contact,
      resolvedAt: atISO,
    });
  }),
);
