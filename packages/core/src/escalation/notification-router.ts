import { toZonedTime } from 'date-fns-tz';

import type { NotificationRecipient } from '../orchestrator/types.js';

type ResolveNotificationTargetInput = {
  blockStartAt: Date;
  escalationFiredAt: Date;
  blockHouseId: string;
  hmWorkingHoursStart: string;
  hmWorkingHoursEnd: string;
  timezone: string;
};

function parseTimeOfDay(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (match === null) {
    throw new Error(`invalid time of day: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`invalid time of day: ${value}`);
  }

  return (hours * 60 + minutes) * 60 * 1000;
}

function isWeekdayDuringHours(
  instant: Date,
  hmWorkingHoursStart: string,
  hmWorkingHoursEnd: string,
  timezone: string,
): boolean {
  const local = toZonedTime(instant, timezone);
  const day = local.getDay();

  if (day === 0 || day === 6) {
    return false;
  }

  const localMs =
    ((local.getHours() * 60 + local.getMinutes()) * 60 + local.getSeconds()) * 1000 +
    local.getMilliseconds();

  return (
    localMs >= parseTimeOfDay(hmWorkingHoursStart) && localMs < parseTimeOfDay(hmWorkingHoursEnd)
  );
}

export function resolveNotificationTarget(
  params: ResolveNotificationTargetInput,
): NotificationRecipient {
  const firedDuringHmHours = isWeekdayDuringHours(
    params.escalationFiredAt,
    params.hmWorkingHoursStart,
    params.hmWorkingHoursEnd,
    params.timezone,
  );
  const blockDuringHmHours = isWeekdayDuringHours(
    params.blockStartAt,
    params.hmWorkingHoursStart,
    params.hmWorkingHoursEnd,
    params.timezone,
  );

  return firedDuringHmHours && blockDuringHmHours ? 'hm' : 'hmod';
}
