// Anthropic transport for the AI schedule agent — the ONLY file that
// imports the SDK. The core loop (@shift/core ai-schedule) is pure and
// speaks ScheduleLlmRequest/Response; this adapter moves bytes.
//
// Sonnet 5 / Opus 4.8 API rules honored here: no temperature/top_p/top_k
// (non-default values 400), no assistant prefill; structured outputs via
// output_config.format json_schema so the proposal shape is guaranteed.
//
// Thinking is explicitly DISABLED. Sonnet 5 runs adaptive thinking by
// default, and thinking tokens count against max_tokens — a live run
// against this exact adapter hit stop_reason: "max_tokens" (thinking alone
// exhausted an 8000-token budget) before any JSON reached the response.
// Each per-day proposal is a small, structurally constrained extraction
// task (a handful of worker/slot pairs), not open-ended reasoning, and the
// propose/repair loop already gives the model concrete feedback across
// calls — so disabling thinking keeps calls fast and the JSON always
// lands, rather than raising the budget and hoping thinking stays under it.

import Anthropic from '@anthropic-ai/sdk';
import type { ScheduleLlm, ScheduleLlmRequest, ScheduleLlmResponse } from '@shift/core';

import { AI_SCHEDULE_MODEL, ANTHROPIC_API_KEY } from '../env';

export function createAnthropicScheduleLlm(): ScheduleLlm {
  if (ANTHROPIC_API_KEY === '') {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to the web server environment.');
  }
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 3 });

  return {
    async complete(req: ScheduleLlmRequest): Promise<ScheduleLlmResponse> {
      const msg = await client.messages.create({
        model: AI_SCHEDULE_MODEL,
        max_tokens: req.maxOutputTokens,
        thinking: { type: 'disabled' },
        // Stable system prompt first + cache marker: every per-day call in a
        // run shares the prefix, so propose/repair calls read the cache.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: { type: 'json_schema', schema: req.responseSchema } },
      });

      if (msg.stop_reason === 'refusal') {
        throw new Error('The model declined this request. Try generating again.');
      }
      if (msg.stop_reason === 'max_tokens') {
        // Never parse truncated JSON.
        throw new Error('The model response was cut off. Try generating again.');
      }
      const text = msg.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return { json: JSON.parse(text) as unknown };
    },
  };
}
