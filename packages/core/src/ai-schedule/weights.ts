// AI Schedule Agent — the single tuning surface for the scorer.
//
// Every soft objective is weighted here and nowhere else. The dominance
// relationship that matters: leaving a FILLABLE seat empty must outweigh
// any single preference gain, so coverage always wins (scorer.test.ts
// pins this as a regression).

export const AI_SCORE_WEIGHTS = {
  // Preference satisfaction (per assigned block).
  preferredBlock: 3,
  availableBlock: 1,

  // Target-hours fit (per hour of deviation; workers with a null target
  // are skipped entirely).
  underTargetPerHour: -2,
  overTargetPerHour: -3,

  // Shift-length quality (per contiguous run).
  idealRunBonus: 2, // 2h..5h
  shortRunPenalty: -4, // <= 1h (mirrors the ONE_HOUR_SHIFT warning)
  longRunPenaltyPerHour: -2, // per hour beyond 6h in one run

  // Contiguity: fragmented days.
  extraRunPenalty: -1.5, // per run beyond the first in a worker-day

  // Fairness: spread of desirable blocks and of hours-vs-target.
  fairnessPreferredSpread: -1, // * population stddev of preferred-block counts
  fairnessHoursSpread: -0.5, // * population stddev of (hours - target)

  // Coverage (per open seat).
  fillableUnfilledSeat: -25, // dominates everything else by design
  unfillableUnfilledSeat: -2, // surfaced, mildly penalized
} as const;
