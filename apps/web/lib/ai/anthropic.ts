// Anthropic transport for the AI schedule agent — the ONLY file that
// imports the SDK. The core loop (@shift/core ai-schedule) is pure and
// speaks ScheduleLlmRequest/Response; this adapter moves bytes.
//
// Sonnet 5 / Opus 4.8 API rules honored here: no temperature/top_p/top_k
// (non-default values 400), no thinking param (adaptive is the default and
// counts against max_tokens), no assistant prefill; structured outputs via
// output_config.format json_schema so the proposal shape is guaranteed.

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
