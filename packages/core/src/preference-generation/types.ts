// Persona-based preference generation — public type surface.
// Contract: docs/preference-generation/PERSONA_SPEC.md
//
// PURE + deterministic: given the same (blocks, roster, periodId, config) it produces the
// same package every time. No DB, no clock, no SDK. The caller snapshots the roster +
// template-week blocks, calls the generator, reviews the package, and only then writes it
// through the admin_seed_preferences RPC.

import type { PrefPersona } from './personas.js';

export type { PrefPersona } from './personas.js';

// One 30-minute block of a house's template week. weekday/minuteOfDay are resolved
// upstream via `blockWeekSlot` (the tz-aware seam), so this module never parses ISO.
export type PrefGenBlock = {
  blockId: string;
  weekday: number; // NY weekday, 0 = Mon .. 6 = Sun (matches blockWeekSlot)
  minuteOfDay: number; // minutes since NY midnight, [0, 1440)
  // Seats to fill at this block. Drives guarantee G1; defaults to 1 when absent.
  requiredHeadcount?: number;
};

export type PrefGenConfig = {
  // Global run seed; combined with (periodId, userId) so two runs of the same period
  // reproduce exactly, yet different periods diverge.
  seed: string;
  // The period profile's default_hours_cap. Every target is clamped to this because
  // period_targets_enforce_hours_cap REJECTS an over-cap target, and the package is
  // written in one statement, so a single bad row aborts the whole seed.
  capHours: number;
  // Clicked "no hours this period": a target row with opted_out, zero entries.
  optOutRate?: number; // default 0.07
  // Did nothing before the deadline: NO row at all. A distinct builder code path from
  // opting out, so a board with only opt-outs never exercises it.
  nonSubmitterRate?: number; // default 0.05
  // How much of the template week is allowed to attract NO interest at all. Real boards
  // have a few such blocks (the Monday 08:00 case); repairing them all away would hide
  // where the season is genuinely short of willing people. Spent on the least-wanted
  // blocks first. Default 4h.
  uncoveredBudgetHours?: number;
};

// Only `preferred`/`cannot` are ever emitted: the painter persists only those two, and
// both read sides (buildInitialGrid, AiRosterWorker.prefs) collapse available/none to the
// sparse default. An explicit `available` row would be dead weight.
export type GeneratedPrefStatus = 'preferred' | 'cannot';

export type GeneratedPrefEntry = {
  blockId: string;
  status: GeneratedPrefStatus;
};

export type GeneratedWorkerPrefs = {
  userId: string;
  targetHours: number;
  optedOut: boolean;
  // false = never submitted. The caller MUST omit these workers from the RPC payload
  // entirely; writing a row would turn a non-submitter into an opt-out.
  submitted: boolean;
  persona: PrefPersona;
  personaLabel: string;
  // Sparse: absence of a blockId means `available`. Empty unless submitted and not opted out.
  entries: GeneratedPrefEntry[];
};

export type GuaranteeResult = {
  id: 'G1' | 'G2' | 'G3' | 'G4';
  label: string;
  passed: boolean;
  detail: string;
};

export type PrefGenReport = {
  workers: number;
  submitters: number;
  optedOut: number;
  nonSubmitters: number;
  blocks: number;
  seatHours: number; // total staffing demand in the template week
  appetiteHours: number; // total targetHours across submitting workers
  personaMix: Record<string, Record<string, number>>;
  targetHistogram: { hours: number; workers: number }[];
  // Preferred-marks per block, after repair.
  minPreferredPerBlock: number;
  medianPreferredPerBlock: number;
  repairedBlocks: number;
  // Blocks deliberately left with zero interest, within the configured budget. These are
  // the slots the SM cannot fill from the board and that will fall to escalation.
  uncoveredBlocks: { weekday: number; minuteOfDay: number }[];
  uncoveredHours: number;
  uncoveredBudgetHours: number;
  // Painted availability across submitting workers, for sanity-checking the overpaint model.
  availabilityHours: { min: number; median: number; max: number };
  guarantees: GuaranteeResult[];
};

export type PrefGenPackage = {
  workers: GeneratedWorkerPrefs[];
  report: PrefGenReport;
};
