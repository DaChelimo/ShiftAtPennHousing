// Desk Assistant — page fields + draft adapters + critical-alert presentation.
// VERBATIM mirror of packages/core/src/desk-assistant/{page-fields,page-draft,
// delivery}.ts (Deno cannot import the workspace). Pinned by
// packages/core/tests/desk-assistant/pages-mirror.test.ts. Update both sides together.

// ---- page-fields.ts ----
export interface FieldSpec {
  key: string;
  label: string;
  prompt: string;
}

const BASE_FIELDS: FieldSpec[] = [
  {
    key: 'location',
    label: 'Location',
    prompt: 'Where is this happening (building and specific area)?',
  },
  {
    key: 'whatWasTried',
    label: 'What was tried',
    prompt: 'What have you already tried or checked?',
  },
  {
    key: 'callbackNumber',
    label: 'Callback number',
    prompt: 'What is the best number to reach you at the desk?',
  },
];

const ISSUE_FIELDS: Record<string, FieldSpec[]> = {
  fire: [
    {
      key: 'buildingScope',
      label: 'Building-wide or isolated',
      prompt: 'Is this building-wide or limited to one room or area?',
    },
  ],
  facilities: [
    {
      key: 'buildingScope',
      label: 'Building-wide or isolated',
      prompt: 'Is this building-wide or limited to one room or area?',
    },
    { key: 'shiftEndTime', label: 'Shift end time', prompt: 'When does your shift end?' },
  ],
  access: [
    {
      key: 'whoIsRequesting',
      label: 'Who is requesting access',
      prompt: 'Who is asking for access, and for what?',
    },
  ],
  equipment: [
    { key: 'equipmentName', label: 'Equipment', prompt: 'Which equipment or system is affected?' },
  ],
  general: [],
};

export function requiredFieldsFor(issueType: string): FieldSpec[] {
  return [...BASE_FIELDS, ...(ISSUE_FIELDS[issueType] ?? ISSUE_FIELDS.general!)];
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

export function missingFields(issueType: string, collected: Record<string, unknown>): FieldSpec[] {
  return requiredFieldsFor(issueType).filter((f) => isBlank(collected[f.key]));
}

export function isPageComplete(issueType: string, collected: Record<string, unknown>): boolean {
  return missingFields(issueType, collected).length === 0;
}

// ---- page-draft.ts ----
export type HandoffAdapter = 'app_notification' | 'legacy_pager';
export const DEFAULT_HANDOFF_ADAPTER: HandoffAdapter = 'app_notification';

export interface PageDraftInput {
  issueType: string;
  fields: Record<string, string>;
  houseName: string;
  authorName: string;
  recipientLabel: string;
}

export const PAGE_DRAFT_SYSTEM_PROMPT = [
  'You draft a concise, complete desk page for a housing manager.',
  'Use only the provided fields. State the issue, the location, whether it is building-wide',
  'or isolated when known, what was already tried, and the callback number.',
  'Be factual and brief. Do not invent details. Do not use em dashes or en dashes.',
].join(' ');

function fieldLines(input: PageDraftInput): string[] {
  const specs = requiredFieldsFor(input.issueType);
  const lines: string[] = [];
  for (const spec of specs) {
    const value = input.fields[spec.key];
    if (value !== undefined && String(value).trim() !== '') {
      lines.push(`${spec.label}: ${String(value).trim()}`);
    }
  }
  return lines;
}

export function formatForNotification(input: PageDraftInput): { title: string; body: string } {
  const title = `Desk page: ${input.issueType} at ${input.houseName}`;
  const body = [
    `From ${input.authorName} (${input.houseName} desk), for ${input.recipientLabel}.`,
    ...fieldLines(input),
  ].join('\n');
  return { title, body };
}

export function formatForLegacyPager(input: PageDraftInput): string {
  const parts = [
    `PAGE ${input.houseName} ${input.issueType}`,
    ...fieldLines(input).map((l) => l.replace(/\n/g, ' ')),
    `cc ${input.recipientLabel}`,
  ];
  return parts.join(' | ');
}

export function formatForAdapter(adapter: HandoffAdapter, input: PageDraftInput): string {
  if (adapter === 'legacy_pager') return formatForLegacyPager(input);
  const { title, body } = formatForNotification(input);
  return `${title}\n${body}`;
}

// ---- delivery.ts ----
export const CRITICAL_ALERT_SOUND = 'desk_page_critical';
export const ANDROID_FULLSCREEN_CHANNEL = 'desk_page_critical';

export type AlertPlatform = 'ios' | 'android' | 'web';

export interface PageAlertPresentation {
  push: boolean;
  undismissable: boolean;
  sound: string | null;
  iosInterruptionLevel?: 'critical' | 'time-sensitive';
  androidChannel?: string;
  androidFullScreenIntent?: boolean;
  webInAppBanner?: boolean;
  degraded: boolean;
}

export function resolvePageAlertPresentation(
  platform: AlertPlatform,
  hasCriticalCapability: boolean,
): PageAlertPresentation {
  if (platform === 'web') {
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

export const PAGE_REMINDER_SCHEDULE_MINUTES = [2, 5, 10] as const;

export function pageReminderDelayMinutes(priorReminderCount: number): number {
  const i = Math.min(Math.max(priorReminderCount, 0), PAGE_REMINDER_SCHEDULE_MINUTES.length - 1);
  return PAGE_REMINDER_SCHEDULE_MINUTES[i]!;
}

export function nextPageReminderAt(now: Date, priorReminderCount: number): Date {
  return new Date(now.getTime() + pageReminderDelayMinutes(priorReminderCount) * 60_000);
}
