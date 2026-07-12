// Desk Assistant — critical-alert presentation + reminder cadence (BUILD_PLAN §4a).
// Pure; clock injected. Decides how a page alert presents per platform and how it
// re-notifies until responded. The actual push extends dispatch-push; this is the
// decision layer it consumes.

/** Unique, disruptive-but-not-annoying sound asset (bundled per platform). */
export const CRITICAL_ALERT_SOUND = 'desk_page_critical';
/** Android notification channel configured for full-screen-intent delivery. */
export const ANDROID_FULLSCREEN_CHANNEL = 'desk_page_critical';

export type AlertPlatform = 'ios' | 'android' | 'web';

export interface PageAlertPresentation {
  /** Whether a push is sent (false on web -> in-app banner instead). */
  push: boolean;
  /** Respond-only: cannot be swiped away. */
  undismissable: boolean;
  sound: string | null;
  iosInterruptionLevel?: 'critical' | 'time-sensitive';
  androidChannel?: string;
  androidFullScreenIntent?: boolean;
  webInAppBanner?: boolean;
  /** True when we could not deliver the full critical experience (entitlement absent, web). */
  degraded: boolean;
}

/**
 * Resolve how a critical page alert presents. `hasCriticalCapability` = the platform
 * has the entitlement/channel for the full undismissable experience (iOS critical
 * alert entitlement, Android full-screen-intent channel). Absent -> degrade to the
 * most prominent still-available form (never a hard failure).
 */
export function resolvePageAlertPresentation(
  platform: AlertPlatform,
  hasCriticalCapability: boolean,
): PageAlertPresentation {
  if (platform === 'web') {
    // Web has reduced push/interruption support (V1_SCOPE §3): block in-app instead.
    return { push: false, undismissable: true, sound: null, webInAppBanner: true, degraded: true };
  }
  if (platform === 'ios') {
    return hasCriticalCapability
      ? {
          push: true,
          undismissable: true,
          sound: CRITICAL_ALERT_SOUND,
          iosInterruptionLevel: 'critical',
          degraded: false,
        }
      : {
          push: true,
          undismissable: false,
          sound: CRITICAL_ALERT_SOUND,
          iosInterruptionLevel: 'time-sensitive',
          degraded: true,
        };
  }
  // android
  return hasCriticalCapability
    ? {
        push: true,
        undismissable: true,
        sound: CRITICAL_ALERT_SOUND,
        androidChannel: ANDROID_FULLSCREEN_CHANNEL,
        androidFullScreenIntent: true,
        degraded: false,
      }
    : {
        push: true,
        undismissable: false,
        sound: CRITICAL_ALERT_SOUND,
        androidChannel: ANDROID_FULLSCREEN_CHANNEL,
        androidFullScreenIntent: false,
        degraded: true,
      };
}

// Re-notification cadence: escalating delays until the page is responded to. Minutes
// between successive reminders; the last value repeats. (At-least-once, like the
// existing push system; a response stops the sweep.)
export const PAGE_REMINDER_SCHEDULE_MINUTES = [2, 5, 10] as const;

export function pageReminderDelayMinutes(priorReminderCount: number): number {
  const i = Math.min(Math.max(priorReminderCount, 0), PAGE_REMINDER_SCHEDULE_MINUTES.length - 1);
  return PAGE_REMINDER_SCHEDULE_MINUTES[i]!;
}

/** The next reminder instant given how many have already fired. */
export function nextPageReminderAt(now: Date, priorReminderCount: number): Date {
  return new Date(now.getTime() + pageReminderDelayMinutes(priorReminderCount) * 60_000);
}
