// Desk Assistant — Claude client (Deno). Deploy-time secret CLAUDE_AI_CHATBOT_DESK_ASSISTANT;
// model from DA_GENERATION_MODEL (default claude-sonnet-5 — grounded extraction over
// supplied context does not need Opus). Callers handle a missing key with a 503.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export function generationModel(): string {
  return Deno.env.get('DA_GENERATION_MODEL') ?? 'claude-sonnet-5';
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One grounded generation call. Returns the concatenated text blocks. */
export async function claudeComplete(opts: {
  apiKey: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? generationModel(),
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: opts.messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return json.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

// ---- tool use ----
// A minimal agentic loop for the personal-schedule branch: Claude may call a tool to
// look up the worker's own shifts, we run it server-side, feed the result back, and let
// Claude phrase the final answer. Non-streaming (the answers are short) — the caller
// relays the returned text as a single SSE delta. RAG keeps its token streaming above.

export interface ToolSpec {
  name: string;
  description: string;
  // JSON Schema for the tool's input (Anthropic `input_schema`).
  input_schema: Record<string, unknown>;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface ToolLoopMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/**
 * Run a tool-use loop and return the final assistant text. `dispatch(name, input)` runs
 * the named tool server-side and returns a string result (already JSON-encoded / human
 * text). The loop is bounded by `maxTurns` (default 4) so a misbehaving model cannot
 * spin forever; if it stops for tool use past the bound, the accumulated text is returned.
 */
export async function claudeToolLoop(opts: {
  apiKey: string;
  system: string;
  userMessage: string;
  tools: ToolSpec[];
  dispatch: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxTokens?: number;
  model?: string;
  maxTurns?: number;
}): Promise<string> {
  const model = opts.model ?? generationModel();
  const maxTurns = opts.maxTurns ?? 4;
  const messages: ToolLoopMessage[] = [{ role: 'user', content: opts.userMessage }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': opts.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: opts.system,
        tools: opts.tools,
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      content: ContentBlock[];
      stop_reason: string;
    };
    const blocks = json.content ?? [];
    const textOf = (): string =>
      blocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

    if (json.stop_reason !== 'tool_use') {
      return textOf();
    }

    // Echo the assistant turn back verbatim, then answer each tool_use with a result.
    messages.push({ role: 'assistant', content: blocks });
    const toolUses = blocks.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );
    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      let content: string;
      try {
        content = await opts.dispatch(tu.name, tu.input ?? {});
      } catch (err) {
        content = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content });
    }
    messages.push({ role: 'user', content: results });
  }

  // Bound hit while still requesting tools — return whatever text the last turn had, or
  // a safe fallback the caller can surface.
  return '';
}

/**
 * Real token-by-token generation. Yields each text delta as Anthropic emits it, so the
 * caller can relay them to a client over SSE while still accumulating the full answer
 * for the post-generation guardrails (`containsIncidentLeakage`) that must see complete
 * text — see `da-ask/index.ts`'s grounded branch. Same request shape as [claudeComplete]
 * plus `stream: true`; only `content_block_delta` / `text_delta` frames carry answer
 * text, so every other Anthropic SSE event type is ignored.
 */
export async function* claudeStream(opts: {
  apiKey: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  model?: string;
}): AsyncGenerator<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? generationModel(),
      // NOTE: there is deliberately no `temperature` here. claude-sonnet-5 REMOVED the
      // sampling parameters; sending temperature/top_p/top_k returns
      // `400 temperature is deprecated for this model`. Answer-to-answer variation has to
      // be steered by the prompt, not by a sampling knob.
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: opts.messages,
      stream: true,
    }),
  });
  if (!res.ok || res.body === null) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep = buf.indexOf('\n\n');
    while (sep >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      sep = buf.indexOf('\n\n');
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine === undefined) continue;
      const payload = dataLine.slice(5).trim();
      if (payload === '' || payload === '[DONE]') continue;
      const evt = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        const text = evt.delta.text;
        if (typeof text === 'string' && text !== '') yield text;
      }
    }
  }
}
