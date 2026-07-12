// Core business logic — pure TypeScript, zero Supabase SDK imports.
// Phase 00: placeholder export. Logic is added per phase.

export const CORE_VERSION = '0.0.0';

export * from './admin-override/index.js';
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
export * from './permanent-ops/index.js';
export * from './scheduling/phase1Grouping.js';
export * from './scheduling/scheduleBuilderCard.js';
export * from './time/index.js';
