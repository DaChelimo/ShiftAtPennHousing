// Desk Assistant — da-draft-page Edge Function (V1_SCOPE §4.3). Determines the issue
// type + required critical fields, asks only for what is missing, and (once complete)
// assembles a categorized page and resolves the recipient via the routing engine. It
// NEVER sends: sending is the separate da-send-page endpoint (structural human-in-loop).

import { claudeComplete } from '../_shared/anthropic.ts';
import { fetchAppNow } from '../_shared/clock.ts';
import {
  formatForNotification,
  missingFields,
  isPageComplete,
  PAGE_DRAFT_SYSTEM_PROMPT,
} from '../_shared/desk-assistant-pages.ts';
import {
  nyParts,
  resolveRoute,
  snapshotDutyState,
  tierLabel,
  type RoutingRule,
} from '../_shared/desk-assistant-routing.ts';
import { authenticate, edgeHandler, jsonResponse, readObjectBody } from '../_shared/swap-http.ts';

Deno.serve(
  edgeHandler('da-draft-page', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { supabase, userId } = auth;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;
    const issueType = typeof parsed.body.issueType === 'string' ? parsed.body.issueType : 'general';
    const fields = (
      typeof parsed.body.fields === 'object' && parsed.body.fields !== null
        ? parsed.body.fields
        : {}
    ) as Record<string, string>;
    const conversationId =
      typeof parsed.body.conversationId === 'string' ? parsed.body.conversationId : null;
    const draftId = typeof parsed.body.draftId === 'string' ? parsed.body.draftId : null;

    const { data: profile } = await supabase
      .from('users')
      .select('home_house_id, name')
      .eq('user_id', userId)
      .single();
    const prof = profile as { home_house_id?: string; name?: string } | null;
    const houseId = prof?.home_house_id ?? null;
    if (houseId === null) return jsonResponse({ error: 'no home house for user' }, 400);
    const { data: house } = await supabase.from('houses').select('name').eq('id', houseId).single();
    const houseName = (house as { name?: string } | null)?.name ?? houseId;

    const missing = missingFields(issueType, fields);

    // Resolve the recipient now (so the draft carries it for review + send).
    const now = await fetchAppNow(supabase);
    const { data: ruleRows } = await supabase.from('routing_rules').select('*').eq('active', true);
    const rules: RoutingRule[] = ((ruleRows as Array<Record<string, unknown>>) ?? []).map((r) => ({
      ruleId: r.rule_id as string,
      issueType: r.issue_type as string,
      tier: r.tier as RoutingRule['tier'],
      dayType: r.day_type as RoutingRule['dayType'],
      windowStart: r.window_start ? String(r.window_start).slice(0, 5) : null,
      windowEnd: r.window_end ? String(r.window_end).slice(0, 5) : null,
      seasonScope: r.season_scope as RoutingRule['seasonScope'],
      priority: r.priority as number,
      active: r.active as boolean,
    }));
    const snapshot = await snapshotDutyState(supabase, now.toISOString(), houseId);
    const { dayType, timeHHMM, season } = nyParts(now);
    const route = resolveRoute({ issueType, dayType, timeHHMM, season }, rules, snapshot);

    // Assemble the body only when complete; otherwise return the missing questions.
    let body: string | null = null;
    if (isPageComplete(issueType, fields)) {
      const draftInput = {
        issueType,
        fields,
        houseName,
        authorName: prof?.name ?? 'Desk',
        recipientLabel: tierLabel(route.resolvedTier),
      };
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (anthropicKey !== undefined) {
        try {
          body = await claudeComplete({
            apiKey: anthropicKey,
            system: PAGE_DRAFT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: JSON.stringify(draftInput) }],
          });
        } catch {
          body = null;
        }
      }
      // Deterministic fallback (or when Claude is unconfigured): use the formatter.
      if (body === null) body = formatForNotification(draftInput).body;
    }

    // Upsert the draft row.
    const row = {
      conversation_id: conversationId,
      author_user_id: userId,
      house_id: houseId,
      issue_type: issueType,
      fields,
      missing_fields: missing.map((f) => f.key),
      body,
      resolved_recipient_user_id: route.userId,
      resolved_tier: route.resolvedTier,
      status: 'draft',
      updated_at: now.toISOString(),
    };
    let savedId = draftId;
    if (draftId === null) {
      const { data, error } = await supabase
        .from('da_page_drafts')
        .insert(row)
        .select('draft_id')
        .single();
      if (error) return jsonResponse({ error: 'draft_create_failed', detail: error.message }, 500);
      savedId = (data as { draft_id: string }).draft_id;
    } else {
      const { error } = await supabase
        .from('da_page_drafts')
        .update(row)
        .eq('draft_id', draftId)
        .eq('author_user_id', userId);
      if (error) return jsonResponse({ error: 'draft_update_failed', detail: error.message }, 500);
    }

    return jsonResponse({
      draftId: savedId,
      issueType,
      complete: missing.length === 0,
      missingFields: missing, // {key,label,prompt} for the ones still needed
      body,
      recipient: {
        tier: route.resolvedTier,
        label: tierLabel(route.resolvedTier),
        userId: route.userId,
      },
    });
  }),
);
