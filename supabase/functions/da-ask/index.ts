// Desk Assistant — da-ask Edge Function (V1_SCOPE §4.1, §7.3, §8).
//
// Thin orchestration over the SQL retrieval RPC + the ask-time mirror + Voyage +
// Claude. Pipeline is pinned in docs/desk-assistant/BUILD_PLAN.md §3:
//   authenticate -> guardrails -> embed -> match_kb_chunks -> narrow ->
//   grounded? generate : defer -> persist -> respond.
// Scope filtering lives entirely in match_kb_chunks (da_can_read_item); this
// function never re-implements the matrix.

import { claudeComplete } from '../_shared/anthropic.ts';
import { fetchAppNow } from '../_shared/clock.ts';
import {
  nyParts,
  resolveRoute,
  snapshotDutyState,
  tierLabel,
  type RoutingRule,
} from '../_shared/desk-assistant-routing.ts';
import {
  buildCitations,
  buildDeferralMessage,
  classifyQuery,
  containsIncidentLeakage,
  detectLifeSafety,
  GROUNDED_SYSTEM_PROMPT,
  INCIDENT_PROBE_REFUSAL,
  lifeSafetyPreamble,
  looksLikeIncidentProbe,
  mentionsAccessDecision,
  narrowContext,
  nyDate,
  resolveAsOfDate,
  type Candidate,
} from '../_shared/desk-assistant.ts';
import { authenticate, edgeHandler, jsonResponse, readObjectBody } from '../_shared/swap-http.ts';
import { toVectorLiteral, voyageEmbed } from '../_shared/voyage.ts';

interface MatchRow {
  chunk_id: string;
  document_id: string;
  content: string;
  source_ref: string;
  house_scope: string | null;
  source_updated_at: string | null;
  similarity: number;
}

// Map active routing_rules rows into the pure engine's RoutingRule shape. Shared by the
// duty-contact answer branch and the not-grounded defer path.
function mapRoutingRules(rows: Array<Record<string, unknown>> | null): RoutingRule[] {
  return (rows ?? []).map((r) => ({
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
}

Deno.serve(
  edgeHandler('da-ask', async (req) => {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const { supabase, userId } = auth;

    const parsed = await readObjectBody(req);
    if (!parsed.ok) return parsed.response;
    const question = typeof parsed.body.question === 'string' ? parsed.body.question.trim() : '';
    if (question === '') return jsonResponse({ error: 'question is required' }, 400);
    const surface = typeof parsed.body.surface === 'string' ? parsed.body.surface : 'web';
    const conversationId =
      typeof parsed.body.conversationId === 'string' ? parsed.body.conversationId : null;

    // Requester house context for the conversation row (scope is enforced in SQL).
    const { data: profile } = await supabase
      .from('users')
      .select('home_house_id')
      .eq('user_id', userId)
      .single();
    const houseId = (profile as { home_house_id?: string } | null)?.home_house_id ?? null;
    if (houseId === null) return jsonResponse({ error: 'no home house for user' }, 400);

    // Ensure a conversation row.
    let convId = conversationId;
    if (convId === null) {
      const { data: conv, error: convErr } = await supabase
        .from('da_conversations')
        .insert({ user_id: userId, house_id: houseId, surface })
        .select('conversation_id')
        .single();
      if (convErr)
        return jsonResponse({ error: 'conversation_create_failed', detail: convErr.message }, 500);
      convId = (conv as { conversation_id: string }).conversation_id;
    }

    const insertMessage = async (
      role: 'user' | 'assistant',
      content: string,
      citations: unknown[] = [],
      deferred = false,
    ): Promise<string | null> => {
      const { data, error } = await supabase
        .from('da_messages')
        .insert({ conversation_id: convId, role, content, citations, deferred })
        .select('message_id')
        .single();
      if (error) return null;
      return (data as { message_id: string }).message_id;
    };

    await insertMessage('user', question);

    // §8 output guardrail: a probe for a specific past incident is refused up front,
    // before any retrieval or generation (raw incidents are never indexed anyway).
    if (looksLikeIncidentProbe(question)) {
      const messageId = await insertMessage('assistant', INCIDENT_PROBE_REFUSAL, [], false);
      return jsonResponse({
        conversationId: convId,
        messageId,
        content: INCIDENT_PROBE_REFUSAL,
        citations: [],
        deferred: false,
        safety: { lifeSafety: null, access: false, incidentProbe: true },
      });
    }

    const lifeSafety = detectLifeSafety(question);
    const access = mentionsAccessDecision(question);

    // As-of resolution (INTAKE_PLAN section 4a): today's NY date, or a date the question
    // names ("next Tuesday", "7/14"). Drives both the duty snapshot and the temporal
    // retrieval filter, so an expired announcement cannot ground an answer.
    const now = await fetchAppNow(supabase);
    const todayNy = nyDate(now);
    const asOfDate = resolveAsOfDate(question, todayNy) ?? todayNy;

    // Duty-contact questions ("who is the HMOD next Tuesday") resolve against live
    // structured duty state AS OF the asked date -- never the vector store. HMOD/RSM are
    // leave-aware and as-of-date capable; the SM tier has no resolver and walks up the
    // ladder (documented boundary, INTAKE_PLAN section 4a.5). Life-safety still flows to
    // the grounded protocol path.
    const classification = classifyQuery(question);
    if (classification.intent === 'duty_contact' && lifeSafety === null) {
      try {
        // Neutral mid-day ET instant so the rotor's Friday-08:00 boundary resolves on the
        // asked calendar date regardless of DST.
        const asOfTs = `${asOfDate}T16:00:00Z`;
        const { data: ruleRows } = await supabase
          .from('routing_rules')
          .select('*')
          .eq('active', true);
        const rules = mapRoutingRules(ruleRows as Array<Record<string, unknown>> | null);
        const snapshot = await snapshotDutyState(supabase, asOfTs, houseId);
        const { dayType, timeHHMM, season } = nyParts(new Date(asOfTs));
        const route = resolveRoute(
          { issueType: access ? 'access' : 'general', dayType, timeHHMM, season },
          rules,
          snapshot,
        );
        let personName: string | null = null;
        if (route.userId !== null) {
          const { data: person } = await supabase
            .from('users')
            .select('name')
            .eq('user_id', route.userId)
            .maybeSingle();
          personName = (person as { name?: string } | null)?.name ?? null;
        }
        const whenLabel = asOfDate === todayNy ? 'right now' : `for ${asOfDate}`;
        const tier = tierLabel(route.resolvedTier);
        const content =
          route.userId !== null
            ? `${tier[0]!.toUpperCase()}${tier.slice(1)} ${whenLabel} for your house is ` +
              `${personName ?? 'on duty'}. Want me to draft a page to them?`
            : `I could not resolve a named on-duty contact ${whenLabel}. This escalates to ` +
              `${tier}. Want me to draft a page?`;
        const messageId = await insertMessage('assistant', content, [], false);
        return jsonResponse({
          conversationId: convId,
          messageId,
          content,
          citations: [],
          deferred: false,
          route,
          asOf: asOfDate,
          safety: { lifeSafety, access, incidentProbe: false, dutyContact: true },
        });
      } catch (_err) {
        // Duty resolution is best-effort; on any error fall through to RAG.
      }
    }

    const voyageKey = Deno.env.get('VOYAGE_API_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (voyageKey === undefined || anthropicKey === undefined) {
      return jsonResponse(
        { error: 'assistant_unconfigured', detail: 'VOYAGE_API_KEY / ANTHROPIC_API_KEY not set' },
        503,
      );
    }

    // Embed the question and retrieve scope-filtered candidates.
    let candidates: Candidate[];
    try {
      const [queryEmbedding] = await voyageEmbed([question], {
        apiKey: voyageKey,
        inputType: 'query',
      });
      const { data, error } = await supabase.rpc('match_kb_chunks', {
        p_user_id: userId,
        p_query_embedding: toVectorLiteral(queryEmbedding!),
        p_top_k: 24,
        p_as_of: asOfDate,
      });
      if (error) return jsonResponse({ error: 'retrieval_failed', detail: error.message }, 500);
      candidates = (data as MatchRow[]).map((r) => ({
        chunkId: r.chunk_id,
        documentId: r.document_id,
        content: r.content,
        sourceRef: r.source_ref,
        houseScope: r.house_scope,
        similarity: r.similarity,
        sourceUpdatedAt: r.source_updated_at ?? undefined,
      }));
    } catch (err) {
      return jsonResponse(
        { error: 'embedding_failed', detail: err instanceof Error ? err.message : String(err) },
        502,
      );
    }

    const { context, grounded } = narrowContext(candidates, { requesterHouseId: houseId });

    // Not grounded -> defer with a LIVE routing hint (Phase E): resolve the current
    // contact from the routing rules + duty snapshot and name the tier.
    if (!grounded) {
      let hint: string | undefined;
      let route: ReturnType<typeof resolveRoute> | null = null;
      try {
        const asOfTs = `${asOfDate}T16:00:00Z`;
        const { data: ruleRows } = await supabase
          .from('routing_rules')
          .select('*')
          .eq('active', true);
        const rules = mapRoutingRules(ruleRows as Array<Record<string, unknown>> | null);
        const snapshot = await snapshotDutyState(supabase, asOfTs, houseId);
        const { dayType, timeHHMM, season } = nyParts(new Date(asOfTs));
        const issueType = access ? 'access' : 'general';
        route = resolveRoute({ issueType, dayType, timeHHMM, season }, rules, snapshot);
        hint = `I can route this to ${tierLabel(route.resolvedTier)}.`;
      } catch (_err) {
        hint = undefined; // routing is best-effort on the defer path
      }
      const content = buildDeferralMessage(hint);
      const messageId = await insertMessage('assistant', content, [], true);
      return jsonResponse({
        conversationId: convId,
        messageId,
        content,
        citations: [],
        deferred: true,
        route,
        safety: { lifeSafety, access, incidentProbe: false },
      });
    }

    // Grounded generation. Preambles (life-safety / access) lead the answer.
    const preambles: string[] = [];
    if (lifeSafety) preambles.push(lifeSafetyPreamble(lifeSafety));
    if (access)
      preambles.push(
        'This is an access question. State the policy from the sources. If it is unclear, do not grant access and escalate.',
      );

    const contextBlock = context
      .map((c, i) => `[Source ${i + 1}] (${c.sourceRef})\n${c.content}`)
      .join('\n\n');
    const userContent =
      `${preambles.length ? preambles.join(' ') + '\n\n' : ''}` +
      `Question: ${question}\n\nSources:\n${contextBlock}\n\n` +
      'Answer using only these sources and state which source supports the answer.';

    let answer: string;
    try {
      answer = await claudeComplete({
        apiKey: anthropicKey,
        system: GROUNDED_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (err) {
      return jsonResponse(
        { error: 'generation_failed', detail: err instanceof Error ? err.message : String(err) },
        502,
      );
    }

    // §8 output guardrail (defense in depth): if the generated answer somehow carries
    // incident-identifying PII, fail closed rather than return it.
    if (containsIncidentLeakage(answer)) {
      const messageId = await insertMessage('assistant', INCIDENT_PROBE_REFUSAL, [], false);
      return jsonResponse({
        conversationId: convId,
        messageId,
        content: INCIDENT_PROBE_REFUSAL,
        citations: [],
        deferred: false,
        safety: { lifeSafety, access, incidentProbe: false, leakageBlocked: true },
      });
    }

    const finalAnswer = preambles.length ? `${preambles.join(' ')}\n\n${answer}` : answer;
    const citations = buildCitations(context);
    const messageId = await insertMessage('assistant', finalAnswer, citations, false);

    return jsonResponse({
      conversationId: convId,
      messageId,
      content: finalAnswer,
      citations,
      deferred: false,
      safety: { lifeSafety, access, incidentProbe: false },
    });
  }),
);
