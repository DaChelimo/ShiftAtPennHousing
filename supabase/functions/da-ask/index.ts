// Desk Assistant — da-ask Edge Function (V1_SCOPE §4.1, §7.3, §8).
//
// Thin orchestration over the SQL retrieval RPC + the ask-time mirror + Voyage +
// Claude. Pipeline is pinned in docs/desk-assistant/BUILD_PLAN.md §3:
//   authenticate -> guardrails -> embed -> match_kb_chunks -> narrow ->
//   grounded? generate : defer -> persist -> respond.
// Scope filtering lives entirely in match_kb_chunks (da_can_read_item); this
// function never re-implements the matrix.
//
// Every SUCCESSFUL reply (any branch that reaches a `content` to answer with) is now an
// SSE stream: `meta` (citations/deferred/route/safety, known before generation) once,
// then one or more `delta` (text) frames, then `done` (messageId) — or `retract`
// (content) + `done` if the leakage guardrail trips mid-stream. Pre-generation failures
// (bad request, auth, retrieval/embedding errors, unconfigured) stay plain JSON error
// responses, exactly as before — clients only enter SSE-parsing mode on a 200
// `text/event-stream` response. See `apps/web/lib/assistant/streamTypes.ts` for the
// mirrored client-side event union.

import { claudeStream, claudeToolLoop, type ToolSpec } from '../_shared/anthropic.ts';
import { fetchAppNow } from '../_shared/clock.ts';
import {
  nyParts,
  resolveRoute,
  snapshotDutyState,
  tierLabel,
  type RoutingRule,
} from '../_shared/desk-assistant-routing.ts';
import {
  ACCESS_MODEL_DIRECTIVE,
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
  stripEmDashes,
  type Candidate,
} from '../_shared/desk-assistant.ts';
import { createSseStream } from '../_shared/sse.ts';
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

// ---- personal-schedule branch (get_my_shifts tool) ----

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCHEDULE_WINDOW_DAYS = 62; // bound the resolver query span

// Add `days` to a YYYY-MM-DD calendar date (UTC math, DST-safe: date-only, project #6).
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) + days * 86400000;
  const dt = new Date(ms);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
function weekdayName(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY_NAMES[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** "2026-07-21" -> "July 21, 2026". The input is already an NY calendar date, so no tz math. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_NAMES[m! - 1]} ${d}, ${y}`;
}

const GET_MY_SHIFTS_TOOL: ToolSpec = {
  name: 'get_my_shifts',
  description:
    "Look up the current worker's OWN shifts (scheduled, claimed, floated-in, or " +
    'dropped-still-open) between two calendar dates, inclusive, in America/New_York. ' +
    'Returns a list of coalesced shift spans, each with the house, start and end time ' +
    '(ISO 8601), a kind, and the number of hours. Use it to answer any question about ' +
    "the worker's own schedule or hours. It only ever returns the asking worker's shifts.",
  input_schema: {
    type: 'object',
    properties: {
      from_date: {
        type: 'string',
        description: 'Start of the range, YYYY-MM-DD (America/New_York calendar date).',
      },
      to_date: {
        type: 'string',
        description: 'End of the range, inclusive, YYYY-MM-DD.',
      },
    },
    required: ['from_date', 'to_date'],
  },
};

interface ShiftSpanRow {
  house_name: string;
  start_at: string;
  end_at: string;
  kind: string;
  cross_house: boolean;
  hours: number;
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

/**
 * A branch whose full text is already known synchronously (duty-contact, incident-probe
 * refusal, not-grounded defer) — emits the whole SSE sequence in one go: `meta`, one
 * `delta` carrying the complete string, then `done`.
 */
function respondOnce(opts: {
  conversationId: string;
  messageId: string | null;
  content: string;
  citations: unknown[];
  deferred: boolean;
  route?: unknown;
  safety: Record<string, unknown>;
}): Response {
  const { response, send, close } = createSseStream();
  send({
    t: 'meta',
    conversationId: opts.conversationId,
    citations: opts.citations,
    deferred: opts.deferred,
    route: opts.route ?? null,
    safety: opts.safety,
  });
  send({ t: 'delta', text: opts.content });
  send({ t: 'done', messageId: opts.messageId });
  close();
  return response;
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
    //
    // Cost audit F-17 flagged "the users table being read twice (:201, :342)" as a minor
    // redundancy. On inspection the two reads are NOT the same query: this one resolves
    // the REQUESTER's home house, the other resolves the name of whoever the duty
    // routing landed on, which is usually a different person. They cannot be collapsed.
    // `name` is added here only so the routing branch can skip its own lookup in the one
    // case where the two do coincide (the router resolves to the asker).
    const { data: profile } = await supabase
      .from('users')
      .select('home_house_id, name')
      .eq('user_id', userId)
      .single();
    const requesterName = (profile as { name?: string } | null)?.name ?? null;
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
      return respondOnce({
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
      // SMOD / CSMOD are reached via a shared duty phone (no person resolution): surface
      // the tier guidance + the configured duty phone; the desk knows who to call
      // (reference_duty_hierarchy_roles). No ladder walk for these.
      if (classification.tier === 'smod' || classification.tier === 'csmod') {
        const isSmod = classification.tier === 'smod';
        const { data: cfg } = await supabase
          .from('system_config')
          .select('config_value')
          .eq('config_key', isSmod ? 'smod_duty_phone' : 'csmod_duty_phone')
          .maybeSingle();
        const phone = (cfg as { config_value?: string } | null)?.config_value ?? null;
        const label = isSmod ? tierLabel('desk_sm') : tierLabel('csmod');
        const guide = isSmod
          ? `In summer, reach ${label} first for this.`
          : `For conference and event guests, reach ${label}.`;
        const content = phone
          ? `${guide} Call the duty phone: ${phone}.`
          : `${guide} The duty phone number is on the IC phone list.`;
        const messageId = await insertMessage('assistant', content, [], false);
        return respondOnce({
          conversationId: convId,
          messageId,
          content,
          citations: [],
          deferred: false,
          safety: {
            lifeSafety,
            access,
            incidentProbe: false,
            dutyContact: true,
            tier: classification.tier,
          },
        });
      }
      try {
        // Neutral mid-day ET instant so the rotor's Friday-08:00 boundary resolves on the
        // asked calendar date regardless of DST.
        const asOfTs = `${asOfDate}T16:00:00Z`;
        const { data: ruleRows } = await supabase
          .from('routing_rules')
          .select('*')
          .eq('active', true);
        const loadedRules = mapRoutingRules(ruleRows as Array<Record<string, unknown>> | null);
        const { dayType, timeHHMM, season } = nyParts(new Date(asOfTs));
        const issueType = access ? 'access' : 'general';
        // If the question NAMES a person tier (hmod/rsm/ba), start the ladder walk there
        // (walking up only if it is unfilled) instead of the routing-rule default. A
        // generic "who is the contact" (tier unknown) uses the configured rules, whose
        // default hmod then walks up to the BA when the HM/RSM are on leave.
        const named =
          classification.tier === 'hmod' ||
          classification.tier === 'rsm' ||
          classification.tier === 'ba';
        const rules = named
          ? [
              {
                ruleId: 'q-named-tier',
                issueType,
                tier: classification.tier as 'hmod' | 'rsm' | 'ba',
                dayType: 'any' as const,
                windowStart: null,
                windowEnd: null,
                seasonScope: 'any' as const,
                priority: -1,
                active: true,
              },
            ]
          : loadedRules;
        const snapshot = await snapshotDutyState(supabase, asOfTs, houseId);
        const route = resolveRoute({ issueType, dayType, timeHHMM, season }, rules, snapshot);
        let personName: string | null = null;
        if (route.userId === userId) {
          // The router landed on the asker; their name came back with the house lookup.
          personName = requesterName;
        } else if (route.userId !== null) {
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
        return respondOnce({
          conversationId: convId,
          messageId,
          content,
          citations: [],
          deferred: false,
          route,
          safety: { lifeSafety, access, incidentProbe: false, dutyContact: true },
        });
      } catch (_err) {
        // Duty resolution is best-effort; on any error fall through to RAG.
      }
    }

    // Personal-schedule questions ("what's my next shift", "am I working this weekend",
    // "how many hours do I have this week") resolve against the worker's OWN live
    // assignment data via the get_my_shifts tool -- never the vector store. This is the
    // gap that made those questions defer to a human. The user_id passed to the resolver
    // is the AUTHENTICATED token subject, never a model-supplied value. No leakage scan
    // here: schedule answers legitimately contain dates/times, and the data is the
    // worker's own (the incident-PII guardrail is for KB-retrieved text).
    if (classification.intent === 'personal_schedule' && lifeSafety === null) {
      const anthropicKey = Deno.env.get('CLAUDE_AI_CHATBOT_DESK_ASSISTANT');
      if (anthropicKey === undefined) {
        return jsonResponse(
          { error: 'assistant_unconfigured', detail: 'CLAUDE_AI_CHATBOT_DESK_ASSISTANT not set' },
          503,
        );
      }

      const dispatch = async (_name: string, input: Record<string, unknown>): Promise<string> => {
        // Validate + bound the range; default to a 14-day forward window on bad input.
        let from = typeof input.from_date === 'string' ? input.from_date : '';
        let to = typeof input.to_date === 'string' ? input.to_date : '';
        if (!ISO_DATE_RE.test(from)) from = todayNy;
        if (!ISO_DATE_RE.test(to)) to = addDays(from, 14);
        if (to < from) to = from;
        if (to > addDays(from, MAX_SCHEDULE_WINDOW_DAYS))
          to = addDays(from, MAX_SCHEDULE_WINDOW_DAYS);
        const { data, error } = await supabase.rpc('assistant_my_shifts', {
          p_user_id: userId,
          p_from: from,
          p_to: to,
        });
        if (error) return `Tool error: ${error.message}`;
        const rows = (data as ShiftSpanRow[]).map((r) => ({
          house: r.house_name,
          start: r.start_at,
          end: r.end_at,
          kind: r.kind,
          hours: Number(r.hours),
          cross_house: r.cross_house,
        }));
        return JSON.stringify({ range: { from, to }, shifts: rows });
      };

      const system = [
        'You are the Desk Assistant for Penn Housing desk staff.',
        "Answer the worker's question about THEIR OWN shift schedule using only the",
        'get_my_shifts tool results. State shift dates, times, and house plainly, in',
        'America/New_York. Convert ISO timestamps to a friendly form (e.g. "Mon Jul 14,',
        '3:00 to 7:00 PM at Harnwell"). If the tool returns no shifts in the range, say',
        'plainly that they have no shifts scheduled in that period. Never invent shifts',
        'or hours. Be concise. Do not use em dashes or en dashes.',
      ].join(' ');
      const userMessage =
        `Today is ${todayNy} (${weekdayName(todayNy)}) in America/New_York. ` +
        `The worker asked: "${question}". Use get_my_shifts to look up their schedule, ` +
        'then answer. If they did not name a range, look at the next 14 days.';

      let answer = '';
      try {
        answer = await claudeToolLoop({
          apiKey: anthropicKey,
          system,
          userMessage,
          tools: [GET_MY_SHIFTS_TOOL],
          dispatch,
        });
      } catch (_err) {
        answer = '';
      }
      if (answer.trim() === '') {
        answer =
          'I could not read your schedule just now. Please try again, or check the My Shifts tab.';
      }
      const messageId = await insertMessage('assistant', answer, [], false);
      return respondOnce({
        conversationId: convId,
        messageId,
        content: answer,
        citations: [],
        deferred: false,
        safety: { lifeSafety, access, incidentProbe: false, personalSchedule: true },
      });
    }

    const voyageKey = Deno.env.get('VOYAGE_API_KEY');
    const anthropicKey = Deno.env.get('CLAUDE_AI_CHATBOT_DESK_ASSISTANT');
    if (voyageKey === undefined || anthropicKey === undefined) {
      return jsonResponse(
        {
          error: 'assistant_unconfigured',
          detail: 'VOYAGE_API_KEY / CLAUDE_AI_CHATBOT_DESK_ASSISTANT not set',
        },
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
      return respondOnce({
        conversationId: convId,
        messageId,
        content,
        citations: [],
        deferred: true,
        route,
        safety: { lifeSafety, access, incidentProbe: false },
      });
    }

    // Grounded generation — real token streaming.
    //
    // TWO kinds of framing, deliberately kept apart (2026-07-30):
    //   * `preambles` are WORKER-FACING. Only life-safety qualifies: "call the emergency line
    //     now" is something the person at the desk must read. These lead the answer as an
    //     initial synthetic delta (static safe text, not model output, so they never need the
    //     leakage check below) and are persisted with the message.
    //   * `systemDirectives` are MODEL-ONLY. The access rule shapes HOW the answer is written;
    //     it is not information for the worker. It goes on the SYSTEM prompt, never the user
    //     turn and never the stream. Putting it in the visible list is what made every access
    //     answer open by classifying itself and reciting its own instructions, which is
    //     exactly the meta-narration BSpec §17.3b forbids. mirror.test.ts pins the split.
    const preambles: string[] = [];
    if (lifeSafety) preambles.push(lifeSafetyPreamble(lifeSafety));
    const systemDirectives: string[] = [];
    if (access) systemDirectives.push(ACCESS_MODEL_DIRECTIVE);
    const systemPrompt = systemDirectives.length
      ? `${GROUNDED_SYSTEM_PROMPT} ${systemDirectives.join(' ')}`
      : GROUNDED_SYSTEM_PROMPT;

    const contextBlock = context
      .map((c, i) => `[Source ${i + 1}] (${c.sourceRef})\n${c.content}`)
      .join('\n\n');
    // Current NY date AND time-of-day. Most of this corpus is time-conditional (the whole
    // escalation flowchart splits on business hours vs. after hours, and guest policy splits
    // on day vs. overnight), so without the clock the model cannot pick the right branch.
    // `now` comes from app_now() via fetchAppNow, i.e. the dev sim clock, NOT the wall clock,
    // so time travel on the web dev-clock card moves the assistant's "now" too.
    const { timeHHMM: nowTimeNy } = nyParts(now);
    // BOTH the spelled and ISO forms of today deliberately appear here. The leakage guardrail
    // below treats a date absent from this message as un-sourced, and the model writes prose
    // ("July 21, 2026") even when handed an ISO string, which intermittently retracted correct
    // answers. Naming both forms makes either phrasing grounded.
    const userContent =
      `${preambles.length ? preambles.join(' ') + '\n\n' : ''}` +
      `Right now it is ${weekdayName(todayNy)}, ${longDate(todayNy)} (${todayNy}), ` +
      `at ${nowTimeNy} in America/New_York.\n\n` +
      `Question: ${question}\n\nSources:\n${contextBlock}\n\n` +
      'Answer using only these sources. Lead with the answer itself and keep it short. ' +
      'Do not name or number the sources in your reply.';

    const citations = buildCitations(context);
    const { response, send, close } = createSseStream();
    send({
      t: 'meta',
      conversationId: convId,
      citations,
      deferred: false,
      route: null,
      safety: { lifeSafety, access, incidentProbe: false },
    });
    if (preambles.length) send({ t: 'delta', text: `${preambles.join(' ')}\n\n` });

    // Not awaited — the response (and its ReadableStream) is returned to the caller
    // below while this keeps writing to it. §8 output guardrail (defense in depth): ran
    // on the FULL text before streaming existed; here it runs on the growing buffer
    // after every delta so a leak is caught within a token or two instead of never being
    // checked at all. If it trips: stop consuming further deltas, `retract` (the client
    // replaces the whole message with the refusal), and persist ONLY the refusal — the
    // leaked text is never written to `da_messages` and, past the retract, never shown.
    (async () => {
      let answer = '';
      // How much of the SANITIZED answer has already gone out. Dashes are re-punctuated over the
      // whole answer and only the diff is streamed, so every dash is judged with full context.
      let sentLen = 0;
      let leaked = false;
      const pushClean = (text: string): void => {
        if (text.length > sentLen) {
          send({ t: 'delta', text: text.slice(sentLen) });
          sentLen = text.length;
        }
      };
      try {
        for await (const delta of claudeStream({
          apiKey: anthropicKey,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          // Headroom over the 1024 default. claude-sonnet-5 runs ADAPTIVE THINKING when the
          // request omits `thinking`, and thinking tokens are charged against max_tokens, so
          // a long procedural answer (the after-hours escalation path lists five Building
          // Administrators with two numbers each) can run out mid-list on the default.
          maxTokens: 2048,
        })) {
          answer += delta;
          // Pass the WHOLE user message, not just contextBlock: everything in it is either
          // retrieved source text, the worker's own question, or the clock line we injected, so
          // echoing any of it discloses nothing. Leakage is a specific that came from NONE of
          // those. Passing only contextBlock retracted answers that merely restated today's
          // date, because the clock line lives outside the sources.
          if (containsIncidentLeakage(answer, userContent)) {
            leaked = true;
            break;
          }
          // Hold back a dash sitting at the very end: alone it looks like a clause break
          // ("Mon–" becomes "Mon, ") but the next token may reveal a range ("Mon–Fri" becomes
          // "Mon-Fri"). Waiting one chunk keeps the already-sent prefix stable either way.
          pushClean(stripEmDashes(answer.replace(/[—–]\s*$/, '')));
        }
        // Release whatever the trailing-dash hold-back kept out of the stream.
        if (!leaked) pushClean(stripEmDashes(answer));
      } catch (err) {
        send({ t: 'error', message: err instanceof Error ? err.message : String(err) });
        close();
        return;
      }

      if (leaked) {
        const messageId = await insertMessage('assistant', INCIDENT_PROBE_REFUSAL, [], false);
        send({ t: 'retract', content: INCIDENT_PROBE_REFUSAL });
        send({ t: 'done', messageId });
        close();
        return;
      }

      // Persist exactly what was streamed, dashes already re-punctuated: `da_messages` is
      // replayed into the thread on reload, so an unsanitized row would resurrect them.
      const cleanAnswer = stripEmDashes(answer);
      const finalAnswer = preambles.length
        ? `${preambles.join(' ')}\n\n${cleanAnswer}`
        : cleanAnswer;
      const messageId = await insertMessage('assistant', finalAnswer, citations, false);
      send({ t: 'done', messageId });
      close();
    })();

    return response;
  }),
);
