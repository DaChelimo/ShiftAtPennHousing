export type AdminRole = 'sw' | 'sm' | 'hm' | 'bm';
export type CapEnforcement = 'soft' | 'hard';
export type CapHours = 20 | 40;
export type CapSetting = { hoursCap: CapHours; capEnforcement: CapEnforcement };

export type DayProfile =
  | 'regular_school_year'
  | 'winter_break'
  | 'thanksgiving'
  | 'fall_break'
  | 'spring_break'
  | 'spring_fling';

export type CapModificationAuthResult =
  | { authorized: true }
  | { authorized: false; reason: 'role_not_permitted' };

export type CapChangeEffectInput = {
  previousCap: CapSetting;
  newCap: CapSetting;
  existingWorkers: { workerId: string; scheduledHours: number }[];
  pendingFloats: { floatId: string; workerId: string; status: 'pending' | 'acknowledged' }[];
};

export type CapChangeEffect = {
  overCapWorkers: string[];
  unassignedWorkers: string[];
  honoredFloats: string[];
  voidedFloats: string[];
};
