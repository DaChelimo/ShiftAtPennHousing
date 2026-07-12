// Desk Assistant — page critical-field requirements (V1_SCOPE §4.3). Pure,
// data-driven. Each issue type declares the critical fields a complete page needs;
// the assistant asks only for what is missing. This is a §10.1/§4.3 seam: the real
// taxonomy + field set replaces this placeholder without engine changes.

export interface FieldSpec {
  key: string;
  label: string;
  /** The question the assistant asks when this field is missing. */
  prompt: string;
}

// Every page needs these, regardless of issue type.
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

// Issue-specific additions (placeholder taxonomy).
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

/** The full ordered field set required for a page of this issue type. */
export function requiredFieldsFor(issueType: string): FieldSpec[] {
  return [...BASE_FIELDS, ...(ISSUE_FIELDS[issueType] ?? ISSUE_FIELDS.general!)];
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

/** Fields still missing from `collected` for a complete page. */
export function missingFields(issueType: string, collected: Record<string, unknown>): FieldSpec[] {
  return requiredFieldsFor(issueType).filter((f) => isBlank(collected[f.key]));
}

export function isPageComplete(issueType: string, collected: Record<string, unknown>): boolean {
  return missingFields(issueType, collected).length === 0;
}
