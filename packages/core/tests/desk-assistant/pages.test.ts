// Desk Assistant Phase F/F0 — page fields, draft assembly, handoff adapters,
// critical-alert presentation + reminder cadence (V1_SCOPE §4.3, §7.4; BUILD_PLAN §4a).

import { describe, expect, it } from 'vitest';

import {
  ANDROID_FULLSCREEN_CHANNEL,
  CRITICAL_ALERT_SOUND,
  DEFAULT_HANDOFF_ADAPTER,
  formatForAdapter,
  formatForLegacyPager,
  formatForNotification,
  isPageComplete,
  missingFields,
  nextPageReminderAt,
  pageReminderDelayMinutes,
  requiredFieldsFor,
  resolvePageAlertPresentation,
  type PageDraftInput,
} from '../../src/desk-assistant/index.js';

describe('page fields', () => {
  it('base fields apply to every issue type', () => {
    const keys = requiredFieldsFor('general').map((f) => f.key);
    expect(keys).toEqual(['location', 'whatWasTried', 'callbackNumber']);
  });

  it('facilities adds building scope and shift end', () => {
    const keys = requiredFieldsFor('facilities').map((f) => f.key);
    expect(keys).toContain('buildingScope');
    expect(keys).toContain('shiftEndTime');
  });

  it('missingFields lists blanks (undefined / empty / whitespace)', () => {
    const missing = missingFields('access', {
      location: 'Harnwell lobby',
      whatWasTried: '   ',
      // callbackNumber missing, whoIsRequesting missing
    });
    expect(missing.map((f) => f.key)).toEqual([
      'whatWasTried',
      'callbackNumber',
      'whoIsRequesting',
    ]);
  });

  it('isPageComplete true only when all required fields present', () => {
    expect(
      isPageComplete('access', {
        location: 'x',
        whatWasTried: 'y',
        callbackNumber: '215-555-0000',
        whoIsRequesting: 'a contractor',
      }),
    ).toBe(true);
    expect(isPageComplete('access', { location: 'x' })).toBe(false);
  });
});

describe('handoff adapters', () => {
  const input: PageDraftInput = {
    issueType: 'facilities',
    fields: {
      location: 'Harnwell 3rd floor',
      whatWasTried: 'checked the valve',
      callbackNumber: '215-555-0000',
      buildingScope: 'isolated to one room',
      shiftEndTime: '11pm',
    },
    houseName: 'Harnwell',
    authorName: 'Sam',
    recipientLabel: 'the Housing Manager on Duty',
  };

  it('default adapter is app_notification', () => {
    expect(DEFAULT_HANDOFF_ADAPTER).toBe('app_notification');
  });

  it('notification format has a title and field lines, no dashes', () => {
    const { title, body } = formatForNotification(input);
    expect(title).toContain('Harnwell');
    expect(body).toContain('Location: Harnwell 3rd floor');
    expect(body).toContain('Building-wide or isolated: isolated to one room');
    expect(`${title}${body}`).not.toMatch(/[—–]/);
  });

  it('legacy pager format is a single compact line', () => {
    const text = formatForLegacyPager(input);
    expect(text).toContain('PAGE Harnwell facilities');
    expect(text).not.toContain('\n');
    expect(text).not.toMatch(/[—–]/);
  });

  it('formatForAdapter dispatches by adapter', () => {
    expect(formatForAdapter('legacy_pager', input)).toBe(formatForLegacyPager(input));
    expect(formatForAdapter('app_notification', input)).toContain('Desk page:');
  });
});

describe('critical-alert presentation', () => {
  it('iOS with the entitlement is undismissable critical + sound', () => {
    const p = resolvePageAlertPresentation('ios', true);
    expect(p).toMatchObject({
      push: true,
      undismissable: true,
      sound: CRITICAL_ALERT_SOUND,
      iosInterruptionLevel: 'critical',
      degraded: false,
    });
  });

  it('iOS without the entitlement degrades to time-sensitive', () => {
    const p = resolvePageAlertPresentation('ios', false);
    expect(p.iosInterruptionLevel).toBe('time-sensitive');
    expect(p.undismissable).toBe(false);
    expect(p.degraded).toBe(true);
  });

  it('Android with capability uses a full-screen intent channel', () => {
    const p = resolvePageAlertPresentation('android', true);
    expect(p).toMatchObject({
      push: true,
      undismissable: true,
      androidChannel: ANDROID_FULLSCREEN_CHANNEL,
      androidFullScreenIntent: true,
      degraded: false,
    });
  });

  it('Android without capability degrades but still pushes with sound', () => {
    const p = resolvePageAlertPresentation('android', false);
    expect(p.push).toBe(true);
    expect(p.androidFullScreenIntent).toBe(false);
    expect(p.degraded).toBe(true);
  });

  it('web has no push: blocking in-app banner instead', () => {
    const p = resolvePageAlertPresentation('web', true);
    expect(p.push).toBe(false);
    expect(p.webInAppBanner).toBe(true);
    expect(p.undismissable).toBe(true);
    expect(p.degraded).toBe(true);
  });
});

describe('reminder cadence', () => {
  it('escalating delays, last repeats', () => {
    expect(pageReminderDelayMinutes(0)).toBe(2);
    expect(pageReminderDelayMinutes(1)).toBe(5);
    expect(pageReminderDelayMinutes(2)).toBe(10);
    expect(pageReminderDelayMinutes(9)).toBe(10);
  });

  it('nextPageReminderAt uses the injected clock', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(nextPageReminderAt(now, 0).toISOString()).toBe('2026-07-10T12:02:00.000Z');
    expect(nextPageReminderAt(now, 2).toISOString()).toBe('2026-07-10T12:10:00.000Z');
  });
});
