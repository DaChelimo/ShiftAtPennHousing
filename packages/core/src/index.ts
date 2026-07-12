// Core business logic — pure TypeScript, zero Supabase SDK imports.
// Phase 00: placeholder export. Logic is added per phase.

export const CORE_VERSION = '0.0.0';

export * from './admin-override/index.js';
export * from './ai-schedule/index.js';
export * from './break-claim/index.js';
export * from './break-phases/index.js';
export * from './cap-modification/index.js';
export * from './desk-assistant/index.js';
export * from './eligibility/index.js';
export * from './eligibility/cross-house.js';
export * from './firing/index.js';
export * from './float-lookup/index.js';
export * from './force-trigger/index.js';
export * from './hmod-context/index.js';
export * from './hours/index.js';
export * from './inbox/index.js';
export * from './notifications/index.js';
// operating-seasons: named re-export only. A bare `export *` collides with
// cap-modification's `CapEnforcement` and orchestrator's `ChainStep` (each module
// defines its own). The web consumes just this public slice.
export { compileSeason } from './operating-seasons/index.js';
export type {
  FloatWindowInput,
  HouseWindowInput,
  SeasonAuthoringInput,
  SeasonInput,
} from './operating-seasons/index.js';
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
export * from './preference-generation/index.js';
export * from './preferences/index.js';
export * from './random/seeded.js';
export * from './schedule-generation/index.js';
export * from './scheduling/phase1Grouping.js';
export * from './scheduling/scheduleBuilderCard.js';
export * from './time/index.js';
export * from './worker-shifts/index.js';
export * from './worker-shifts/format.js';
export * from './worker-swaps/index.js';
export * from './worker-floats/index.js';
