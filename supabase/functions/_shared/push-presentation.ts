// How a staffing notification should PRESENT on a device. Pure: no I/O, no clock.
//
// WHY THIS EXISTS
// ---------------
// `dispatch-push` used to send a DATA-ONLY FCM message: `{ notification_id, type,
// payload }` with no `notification` block, no `apns` config, no `android` config, no
// priority and no sound. Android survived that because AppFirebaseMessagingService
// rebuilds a local notification from the data map. **iOS displayed nothing at all** —
// its AppDelegate only implements `willPresent`, which fires for notifications APNs was
// asked to display, and APNs was never asked. So every iOS push in this system has been
// silently dropped, for workers as well as managers.
//
// This module supplies the missing presentation. It deliberately mirrors the client's
// own precedence rules in `apps/mobile/shared/.../ack/FloatDeepLink.kt`
// (`pushDisplayFromData`): an explicit `title` / `body` in the payload always wins, so
// a sender that already worded the alert keeps its wording on every surface.
//
// The critical-alert vocabulary (sound name, Android channel, iOS interruption levels)
// is REUSED from `desk-assistant-pages.ts` rather than reinvented; that subsystem
// already models undismissable pages and has the degraded-mode fallbacks worked out.

import { ANDROID_FULLSCREEN_CHANNEL, CRITICAL_ALERT_SOUND } from './desk-assistant-pages.ts';

// Notification types where a missed alert means a desk goes unstaffed. These get
// high-priority delivery, a sound, and (on Android) the full-screen-intent channel.
const URGENT_TYPES = new Set(['hmod_urgent', 'allied_page']);

// Types the worker experiences as time-critical but not desk-empty critical.
const TIME_SENSITIVE_TYPES = new Set(['ack_reminder', 'personal_shift', 'shift_reminder']);

const DEFAULT_TITLE: Record<string, string> = {
  hmod_urgent: 'Allied coverage needed',
  allied_page: 'Call the desk for Allied coverage',
  ack_reminder: 'Acknowledgment reminder',
  broadcast: 'Open shift available',
  personal_shift: 'Shift update',
  swap_request: 'Swap request',
  hm_leave_notice: 'Leave or coverage change',
  sw_permanent_removal_alert: 'You were removed from a recurring slot',
};

const APP_NAME = 'SHIFT';

export type PushUrgency = 'urgent' | 'time_sensitive' | 'normal';

export interface PushPresentation {
  title: string;
  body: string;
  urgency: PushUrgency;
  sound: string | null;
  androidChannel: string | null;
  androidFullScreenIntent: boolean;
  iosInterruptionLevel: 'time-sensitive' | 'active';
}

function field(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// Human wording for an Allied coverage request, built from the payload the ladder
// writes (house, window, rung). Falls back gracefully when a key is absent, because a
// legacy row predating migration 20260729000010 carries fewer keys.
function alliedBody(payload: unknown): string {
  const house = field(payload, 'house_id');
  const start = field(payload, 'block_start_at');
  const housePart = house === null ? 'A desk' : `${house.charAt(0).toUpperCase()}${house.slice(1)}`;
  if (start === null) return `${housePart} needs Allied coverage. Open Shift to respond.`;
  const time = new Date(start);
  const label = Number.isNaN(time.getTime())
    ? null
    : new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(time);
  return label === null
    ? `${housePart} needs Allied coverage. Open Shift to respond.`
    : `${housePart} needs Allied coverage from ${label}. Open Shift to respond.`;
}

export function resolvePushPresentation(type: string, payload: unknown): PushPresentation {
  // Sender-supplied wording always wins, matching the client's own precedence.
  const explicitTitle = field(payload, 'title');
  const explicitBody = field(payload, 'body') ?? field(payload, 'message');

  const urgent = URGENT_TYPES.has(type);
  const timeSensitive = TIME_SENSITIVE_TYPES.has(type);

  const title = explicitTitle ?? DEFAULT_TITLE[type] ?? APP_NAME;
  const body =
    explicitBody ??
    (urgent
      ? alliedBody(payload)
      : type === 'ack_reminder'
        ? 'You have a float assignment waiting on your acknowledgment.'
        : 'Open Shift for details.');

  return {
    title,
    body,
    urgency: urgent ? 'urgent' : timeSensitive ? 'time_sensitive' : 'normal',
    // A silent urgent alert is the same as no alert. Everything else stays quiet by
    // default so the app does not train people to ignore it.
    sound: urgent ? CRITICAL_ALERT_SOUND : null,
    androidChannel: urgent ? ANDROID_FULLSCREEN_CHANNEL : null,
    // Full-screen intent puts an urgent alert over the lock screen. NOT used for
    // anything else; it is the loudest affordance Android has.
    androidFullScreenIntent: urgent,
    // `critical` needs an Apple entitlement that has not been granted yet, so urgent
    // degrades to `time-sensitive`, which still breaks through a Focus mode. Raise this
    // to 'critical' only once the entitlement is live (see docs/manager-app/SPEC.md §3).
    iosInterruptionLevel: urgent || timeSensitive ? 'time-sensitive' : 'active',
  };
}

// The FCM message envelope. Both `android` and `apns` blocks are always included:
// Firebase applies whichever matches the receiving device, so `dispatch-push` still
// does not need to branch on `push_tokens.platform` (the phase-12 decision stands).
export function buildFcmMessage(
  presentation: PushPresentation,
  data: Record<string, string>,
): Record<string, unknown> {
  return {
    data,
    notification: { title: presentation.title, body: presentation.body },
    android: {
      priority: presentation.urgency === 'normal' ? 'normal' : 'high',
      notification: {
        ...(presentation.androidChannel === null ? {} : { channelId: presentation.androidChannel }),
        ...(presentation.sound === null ? {} : { sound: presentation.sound }),
        ...(presentation.androidFullScreenIntent ? { visibility: 'public' } : {}),
      },
    },
    apns: {
      headers: {
        // 10 = deliver immediately. 5 = may be throttled or delayed by the system,
        // which is wrong for anything a person is expected to act on.
        'apns-priority': presentation.urgency === 'normal' ? '5' : '10',
      },
      payload: {
        aps: {
          alert: { title: presentation.title, body: presentation.body },
          sound: presentation.sound ?? 'default',
          'interruption-level': presentation.iosInterruptionLevel,
        },
      },
    },
  };
}
