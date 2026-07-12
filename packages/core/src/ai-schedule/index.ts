// AI Schedule Agent — public entry. All exported names are Ai-prefixed
// (or clearly namespaced) to keep the core barrel free of ambiguous
// re-exports.

export type {
  AiAssignment,
  AiCandidate,
  AiPrefStatus,
  AiProgressEvent,
  AiRosterWorker,
  AiScheduleBlock,
  AiScheduleInput,
  AiScheduleOptions,
  AiScheduleResult,
  AiScoreBreakdown,
  AiUnfilledSeat,
  AiValidationResult,
  AiViolation,
  AiViolationCode,
  AiViolationSeverity,
  ScheduleLlm,
  ScheduleLlmRequest,
  ScheduleLlmResponse,
} from './types.js';
export { buildGrid, hoursByWorker, splitRuns } from './grid.js';
export type { AiGrid, AiGridDay, AiRun } from './grid.js';
export { normalizeAssignments, validateCandidate, validateWithGrid } from './validator.js';
export { AI_SCORE_WEIGHTS } from './weights.js';
export { scoreCandidate, scoreWithGrid } from './scorer.js';
export {
  AI_MAX_OUTPUT_TOKENS,
  AI_PERSPECTIVES,
  AI_PLAN_JSON_SCHEMA,
  AI_PROPOSAL_JSON_SCHEMA,
  AI_WEEKDAY_LABELS,
  buildPlanPrompt,
  buildPlanSystemPrompt,
  buildProposePrompt,
  buildRepairPrompt,
  buildSystemPrompt,
  parsePlan,
  parseProposal,
} from './prompt.js';
export type { AiPerspective } from './prompt.js';
export { AI_SCHEDULE_DEFAULTS, pruneToFeasible, runAiSchedule } from './loop.js';
