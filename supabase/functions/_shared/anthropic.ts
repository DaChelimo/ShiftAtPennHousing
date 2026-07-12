// Desk Assistant — Claude client (Deno). Deploy-time secret ANTHROPIC_API_KEY;
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
