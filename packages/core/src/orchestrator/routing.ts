import { resolveNotificationTarget } from '../escalation/notification-router.js';

import type { NotificationRecipient, ResolveNotificationRecipientInput } from './types.js';

const TIMEZONE = 'America/New_York';
const HM_START = '08:00';
const HM_END = '17:00';

export function resolveNotificationRecipient(
  input: ResolveNotificationRecipientInput,
): NotificationRecipient {
  return resolveNotificationTarget({
    blockStartAt: input.blockStartAt,
    escalationFiredAt: input.now,
    blockHouseId: '',
    hmWorkingHoursStart: HM_START,
    hmWorkingHoursEnd: HM_END,
    timezone: TIMEZONE,
  });
}
