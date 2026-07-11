// Core business logic — pure TypeScript, zero Supabase SDK imports.
// Phase 00: placeholder export. Logic is added per phase.

export const CORE_VERSION = '0.0.0';

export * from './admin-override/index.js';
export * from './ai-schedule/index.js';
export * from './break-claim/index.js';
export * from './break-phases/index.js';
export * from './cap-modification/index.js';
export * from './eligibility/index.js';
export * from './eligibility/cross-house.js';
export * from './firing/index.js';
export * from './float-lookup/index.js';
export * from './force-trigger/index.js';
export * from './hmod-context/index.js';
export * from './hours/index.js';
export * from './inbox/index.js';
export * from './notifications/index.js';
export * from './orchestrator/index.js';
// Operating Seasons compiler. Targeted re-export: ChainStep (orchestrator) and
// CapEnforcement (cap-modification) already exist under those names, so we omit
// them from the star to avoid ambiguous re-exports.
export {
  compileSeason,
  generateUniversalFloatRoutes,
  SeasonCompileError,
} from './operating-seasons/index.js';
export * from './break-authoring/index.js';
export type {
  IsoDate,
  SchedulingMode,
  StaffingBand,
  SeasonInput,
  HouseWindowInput,
  FloatWindowInput,
  SeasonAuthoringInput,
  CompiledHouse,
  CompiledRoute,
  CompiledPhase,
  CompiledPeriod,
  CompiledSeason,
} from './operating-seasons/index.js';
export * from './permanent-ops/index.js';
export * from './preferences/index.js';
export * from './scheduling/phase1Grouping.js';
export * from './scheduling/scheduleBuilderCard.js';
export * from './time/index.js';
