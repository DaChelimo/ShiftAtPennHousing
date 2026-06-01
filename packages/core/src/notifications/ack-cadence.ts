import type {
  AckCadenceConfig,
  AckCadenceSnapshot,
  AckReminderOffset,
  AckReminderScheduleInput,
  AckReminderSlot,
  FloatAckState,
  LegacyAckReminderScheduleInput,
} from './types.js';

const MINUTE_MS = 60_000;

export const ACK_DEADLINE_LEAD_MINUTES = 10;
export const MANDATORY_ACK_OFFSETS_MINUTES = [60, 30, 5] as const;
export const MANDATORY_OFFSETS_MINUTES = MANDATORY_ACK_OFFSETS_MINUTES;
export const DEFAULT_CONFIGURABLE_ACK_OFFSETS_MINUTES = {
  sixHourMinutes: 360,
  twoHourMinutes: 120,
} as const;
export const DEFAULT_CONFIGURABLE_OFFSETS_MINUTES = [360, 120] as const;

export const DEFAULT_ACK_CADENCE_CONFIG: AckCadenceConfig = {
  reminder6hEnabled: true,
  reminder6hOffsetMinutes: null,
  reminder2hEnabled: true,
  reminder2hOffsetMinutes: null,
};

function subtractMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * MINUTE_MS);
}

function labelForOffset(minutes: number): string {
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

export function ackDeadlineFromFloatStart(floatStart: Date): Date {
  return subtractMinutes(floatStart, ACK_DEADLINE_LEAD_MINUTES);
}

export function snapshotAckCadence(config: AckCadenceConfig): AckCadenceSnapshot {
  const offsets: AckReminderOffset[] = MANDATORY_ACK_OFFSETS_MINUTES.map((minutes) => ({
    minutesBeforeDeadline: minutes,
    mandatory: true,
    label: labelForOffset(minutes),
  }));

  if (config.reminder6hEnabled) {
    offsets.push({
      minutesBeforeDeadline:
        config.reminder6hOffsetMinutes ?? DEFAULT_CONFIGURABLE_ACK_OFFSETS_MINUTES.sixHourMinutes,
      mandatory: false,
      label: '6h',
    });
  }

  if (config.reminder2hEnabled) {
    offsets.push({
      minutesBeforeDeadline:
        config.reminder2hOffsetMinutes ?? DEFAULT_CONFIGURABLE_ACK_OFFSETS_MINUTES.twoHourMinutes,
      mandatory: false,
      label: '2h',
    });
  }

  return {
    offsets: offsets.sort(
      (left, right) => right.minutesBeforeDeadline - left.minutesBeforeDeadline,
    ),
  };
}

function computeScheduleFromSnapshot(input: AckReminderScheduleInput): AckReminderSlot[] {
  return input.snapshot.offsets
    .map((offset) => ({
      scheduledFor: subtractMinutes(input.ackDeadline, offset.minutesBeforeDeadline),
      minutesBeforeDeadline: offset.minutesBeforeDeadline,
      mandatory: offset.mandatory,
      label: offset.label,
    }))
    .filter((slot) => slot.scheduledFor.getTime() > input.assignedAt.getTime())
    .sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime());
}

export function computeAckReminderSchedule(input: AckReminderScheduleInput): AckReminderSlot[];
export function computeAckReminderSchedule(input: LegacyAckReminderScheduleInput): Date[];
export function computeAckReminderSchedule(
  input: AckReminderScheduleInput | LegacyAckReminderScheduleInput,
): AckReminderSlot[] | Date[] {
  if ('ackDeadline' in input) {
    return computeScheduleFromSnapshot(input);
  }

  const ackDeadline = subtractMinutes(input.floatStartAt, input.ackDeadlineOffsetMinutes);
  return computeScheduleFromSnapshot({
    ackDeadline,
    assignedAt: input.floatCreatedAt,
    snapshot: snapshotAckCadence({
      reminder6hEnabled: true,
      reminder6hOffsetMinutes: input.configuredOffsets.offset6h,
      reminder2hEnabled: true,
      reminder2hOffsetMinutes: input.configuredOffsets.offset2h,
    }),
  }).map((slot) => slot.scheduledFor);
}

export function shouldSuppressAckReminder(state: FloatAckState): boolean {
  return state.status !== 'pending' || state.acknowledgedAt !== null || state.declinedAt !== null;
}
