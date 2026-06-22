import type {
  AdminRole,
  CapChangeEffect,
  CapChangeEffectInput,
  CapModificationAuthResult,
  CapSetting,
  DayProfile,
} from './types.js';

const SOFT_20: CapSetting = { hoursCap: 20, capEnforcement: 'soft' };
const HARD_40: CapSetting = { hoursCap: 40, capEnforcement: 'hard' };
const HARD_BREAK_PROFILES = new Set<DayProfile>([
  'winter_break',
  'thanksgiving',
  'fall_break',
  'spring_break',
]);

export function canModifyCap(role: AdminRole): CapModificationAuthResult {
  // §9.3 cap modification is HM/BM authority; §2.3a grants the RSM all HM powers.
  return role === 'hm' || role === 'bm' || role === 'rsm'
    ? { authorized: true }
    : { authorized: false, reason: 'role_not_permitted' };
}

export function resolveDefaultCap(dayProfiles: DayProfile[]): CapSetting {
  return dayProfiles.some((profile) => HARD_BREAK_PROFILES.has(profile)) ? HARD_40 : SOFT_20;
}

export function resolveEffectiveCap(input: {
  default: CapSetting;
  override: CapSetting | null;
}): CapSetting {
  return input.override ?? input.default;
}

export function assessCapChangeEffect(input: CapChangeEffectInput): CapChangeEffect {
  return {
    overCapWorkers: input.existingWorkers
      .filter((worker) => worker.scheduledHours > input.newCap.hoursCap)
      .map((worker) => worker.workerId),
    unassignedWorkers: [],
    honoredFloats: input.pendingFloats.map((pendingFloat) => pendingFloat.floatId),
    voidedFloats: [],
  };
}

export type {
  AdminRole,
  CapChangeEffect,
  CapChangeEffectInput,
  CapEnforcement,
  CapHours,
  CapModificationAuthResult,
  CapSetting,
  DayProfile,
} from './types.js';
