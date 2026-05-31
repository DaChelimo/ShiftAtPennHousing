export type BreakType =
  | 'thanksgiving'
  | 'fall_break'
  | 'spring_break'
  | 'spring_fling'
  | 'winter_break'
  | 'other';

export interface BreakClaimOffsets {
  openOffsetDays: number;
  alertOffsetDays: number;
  closeOffsetDays: number;
}

export interface BreakPeriodRef {
  breakType: BreakType;
  startDate: string;
  endDate: string;
}

export interface BreakClaimPhaseInput {
  break: BreakPeriodRef;
  offsets?: BreakClaimOffsets;
}

export interface BreakClaimBoundaries {
  openAt: Date;
  alertAt: Date;
  closeAt: Date;
}

export type BreakClaimPhase = 'pre_open' | 'claim_window' | 'open_feed';

export interface BreakCap {
  capHours: number;
  capEnforcement: 'soft' | 'hard';
}

export interface BreakNagCandidate {
  userId: string;
  hasClaimedAnyShift: boolean;
  hasIndicatedZeroHours: boolean;
}
