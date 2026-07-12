// Dev-seeding: simulated worker preferences — public type surface.
//
// PURE + deterministic: given the same (blocks, roster, periodId, config) it produces
// the same preferences every time. No DB, no clock, no SDK. The web action snapshots
// the roster + template-week blocks, calls generateWorkerPreferences, and writes the
// result through the admin_seed_preferences RPC. Mirrors the compiler/float-lookup
// pure-core contract.

// One 30-minute block of a house's template week. weekday/minuteOfDay are resolved
// upstream via `blockWeekSlot` (the tz-aware seam), so this module never parses ISO.
export type PrefGenBlock = {
  blockId: string;
  weekday: number; // NY weekday, 0 = Mon .. 6 = Sun (matches blockWeekSlot)
  minuteOfDay: number; // minutes since NY midnight, [0, 1440)
};

export type PrefGenConfig = {
  // Global run seed; combined with (periodId, userId) so two runs of the same period
  // reproduce exactly, yet different periods diverge.
  seed: string;
  // The period profile's default_hours_cap. Sampled targets are clamped to this so the
  // period_targets_enforce_hours_cap trigger never rejects the seed.
  capHours: number;
};

// Only `preferred`/`cannot` are ever emitted: the painter persists only those two, and
// both read sides (buildInitialGrid, AiRosterWorker.prefs) collapse available/none to
// the sparse default. An explicit `available` row would be dead weight.
export type GeneratedPrefStatus = 'preferred' | 'cannot';

export type GeneratedPrefEntry = {
  blockId: string;
  status: GeneratedPrefStatus;
};

export type GeneratedWorkerPrefs = {
  userId: string;
  targetHours: number;
  optedOut: boolean;
  // Sparse: absence of a blockId means `available`. Empty when optedOut.
  entries: GeneratedPrefEntry[];
};
