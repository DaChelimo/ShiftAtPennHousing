// Desk Assistant — pure core logic (V1_SCOPE §7.5). Zero Supabase imports.
// Phase A: types, scope predicate, embeddings seam.
// Phase B: chunking, retrieval ranking, citations, safety guardrails, prompts.

export * from './types.js';
export * from './scope.js';
export * from './embeddings.js';
export * from './chunking.js';
export * from './normalize.js';
export * from './temporal.js';
export * from './propose.js';
export * from './query-classify.js';
export * from './commit.js';
export * from './overlay.js';
export * from './retrieval.js';
export * from './citations.js';
export * from './guardrails.js';
export * from './prompts.js';
export * from './redaction.js';
export * from './routing.js';
export * from './page-fields.js';
export * from './page-draft.js';
export * from './delivery.js';
