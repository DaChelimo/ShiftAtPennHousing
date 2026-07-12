// Cost estimation for an AI schedule run from real token usage.
//
// Published per-million-token prices (input / output). Cache reads bill at
// ~0.1x input and cache writes at ~1.25x input. We use standard (not intro)
// Sonnet pricing so the shown cost is never an under-estimate.

export type ScheduleUsage = {
  calls: number;
  inputTokens: number; // uncached input (the API's input_tokens)
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

type ModelPricing = { inputPerMTok: number; outputPerMTok: number };

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

// Fall back to Opus-tier pricing (the most expensive current tier) so an
// unknown model never under-reports.
const FALLBACK: ModelPricing = { inputPerMTok: 5, outputPerMTok: 25 };

export function estimateCostUsd(model: string, usage: ScheduleUsage): number {
  const p = PRICING[model] ?? FALLBACK;
  const billedInputTokens =
    usage.inputTokens + usage.cacheReadTokens * 0.1 + usage.cacheCreationTokens * 1.25;
  const inputCost = (billedInputTokens / 1_000_000) * p.inputPerMTok;
  const outputCost = (usage.outputTokens / 1_000_000) * p.outputPerMTok;
  return inputCost + outputCost;
}

export function emptyUsage(): ScheduleUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}
