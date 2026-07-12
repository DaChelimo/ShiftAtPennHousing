// Desk Assistant Phase F/F0 — pin the Deno pages/delivery mirror to core.

import { describe, expect, it } from 'vitest';

import * as mirror from '../../../../supabase/functions/_shared/desk-assistant-pages.ts';
import * as core from '../../src/desk-assistant/index.js';

const draftInput: core.PageDraftInput = {
  issueType: 'facilities',
  fields: {
    location: 'Harnwell 3rd floor',
    whatWasTried: 'checked the valve',
    callbackNumber: '215-555-0000',
    buildingScope: 'isolated',
    shiftEndTime: '11pm',
  },
  houseName: 'Harnwell',
  authorName: 'Sam',
  recipientLabel: 'the Housing Manager on Duty',
};

describe('pages mirror parity', () => {
  it('constants match', () => {
    expect(mirror.DEFAULT_HANDOFF_ADAPTER).toBe(core.DEFAULT_HANDOFF_ADAPTER);
    expect(mirror.CRITICAL_ALERT_SOUND).toBe(core.CRITICAL_ALERT_SOUND);
    expect(mirror.ANDROID_FULLSCREEN_CHANNEL).toBe(core.ANDROID_FULLSCREEN_CHANNEL);
    expect(mirror.PAGE_DRAFT_SYSTEM_PROMPT).toBe(core.PAGE_DRAFT_SYSTEM_PROMPT);
    expect([...mirror.PAGE_REMINDER_SCHEDULE_MINUTES]).toEqual([
      ...core.PAGE_REMINDER_SCHEDULE_MINUTES,
    ]);
  });

  it('required + missing fields agree', () => {
    for (const issue of ['fire', 'facilities', 'access', 'equipment', 'general', 'unknown']) {
      expect(mirror.requiredFieldsFor(issue)).toEqual(core.requiredFieldsFor(issue));
      expect(mirror.missingFields(issue, { location: 'x' })).toEqual(
        core.missingFields(issue, { location: 'x' }),
      );
    }
  });

  it('adapter formatting agrees', () => {
    expect(mirror.formatForNotification(draftInput)).toEqual(
      core.formatForNotification(draftInput),
    );
    expect(mirror.formatForLegacyPager(draftInput)).toBe(core.formatForLegacyPager(draftInput));
    expect(mirror.formatForAdapter('legacy_pager', draftInput)).toBe(
      core.formatForAdapter('legacy_pager', draftInput),
    );
  });

  it('alert presentation agrees across platforms + capability', () => {
    for (const platform of ['ios', 'android', 'web'] as const) {
      for (const cap of [true, false]) {
        expect(mirror.resolvePageAlertPresentation(platform, cap)).toEqual(
          core.resolvePageAlertPresentation(platform, cap),
        );
      }
    }
  });

  it('reminder cadence agrees', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    for (let n = 0; n < 5; n += 1) {
      expect(mirror.pageReminderDelayMinutes(n)).toBe(core.pageReminderDelayMinutes(n));
      expect(mirror.nextPageReminderAt(now, n).toISOString()).toBe(
        core.nextPageReminderAt(now, n).toISOString(),
      );
    }
  });
});
