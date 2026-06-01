export interface AckCadenceConfig {
  reminder6hEnabled: boolean;
  reminder6hOffsetMinutes: number | null;
  reminder2hEnabled: boolean;
  reminder2hOffsetMinutes: number | null;
}

export interface AckReminderOffset {
  minutesBeforeDeadline: number;
  mandatory: boolean;
  label: string;
}

export interface AckCadenceSnapshot {
  offsets: AckReminderOffset[];
}

export interface AckReminderScheduleInput {
  ackDeadline: Date;
  assignedAt: Date;
  snapshot: AckCadenceSnapshot;
}

export interface AckReminderSlot {
  scheduledFor: Date;
  minutesBeforeDeadline: number;
  mandatory: boolean;
  label: string;
}

export interface FloatAckState {
  status: 'pending' | 'acknowledged' | 'declined' | 'voided' | 'completed';
  acknowledgedAt: Date | null;
  declinedAt: Date | null;
}

export interface LegacyAckReminderScheduleInput {
  floatStartAt: Date;
  ackDeadlineOffsetMinutes: number;
  configuredOffsets: {
    offset6h: number | null;
    offset2h: number | null;
  };
  floatCreatedAt: Date;
}
