import type { IconName } from './Icon';
import type { TagKind } from './Tag';

// ============================================================================
// The LOAD-BEARING shift-state contract (design-brief §4 / DESIGN_TOKENS.md).
// The live calendar encodes coverage mechanism in color — but never color alone:
// every state pairs a color with a text label (and an icon where it carries
// meaning). This is the single source the legend + every shift card references.
// ============================================================================

export type ShiftStateKey =
  | 'scheduled'
  | 'float-in'
  | 'float-out'
  | 'pending'
  | 'allied'
  | 'break'
  | 'vacant'
  | 'permanent'
  | 'over';

export interface ShiftStateMeta {
  key: ShiftStateKey;
  /** The text tag shown on the card — never rely on color alone. */
  label: string;
  /** Status-pill kind (Tag). */
  tagKind: TagKind;
  /** Legend swatch class (.lg-*). */
  swatch: string;
  /** Optional leading icon for the tag. */
  icon?: IconName;
  description: string;
}

export const SHIFT_STATES: ShiftStateMeta[] = [
  {
    key: 'scheduled',
    label: 'Scheduled',
    tagKind: 'gray',
    swatch: 'lg-sched',
    description: 'Home-house worker on their own desk.',
  },
  {
    key: 'float-in',
    label: 'Float-in',
    tagKind: 'green',
    swatch: 'lg-float',
    icon: 'arrowRight',
    description: 'A worker floated in from another desk (shows their home house).',
  },
  {
    key: 'float-out',
    label: 'Float-out',
    tagKind: 'purple',
    swatch: 'lg-out',
    icon: 'arrowRight',
    description: 'On a personal calendar: you are away covering another desk.',
  },
  {
    key: 'pending',
    label: 'Pending',
    tagKind: 'amber',
    swatch: 'lg-pending',
    icon: 'clock',
    description: 'Force-triggered float not yet acknowledged by the worker.',
  },
  {
    key: 'allied',
    label: 'Allied',
    tagKind: 'teal',
    swatch: 'lg-allied',
    icon: 'shield',
    description: 'External Allied Security coverage.',
  },
  {
    key: 'break',
    label: 'Break',
    tagKind: 'amber',
    swatch: 'lg-break',
    description: 'A short/winter break shift (golden border).',
  },
  {
    key: 'vacant',
    label: 'Open',
    tagKind: 'outline',
    swatch: 'lg-gap',
    description: 'A one-time coverage gap.',
  },
  {
    key: 'permanent',
    label: 'Permanent opening',
    tagKind: 'magenta',
    swatch: 'lg-perm',
    description: 'The recurring slot owner permanently dropped it.',
  },
  {
    key: 'over',
    label: 'Over-cap',
    tagKind: 'red',
    swatch: 'lg-over',
    icon: 'warn',
    description: 'Over-cap / blocked / urgent (needs Allied).',
  },
];

export const SHIFT_STATE_BY_KEY: Record<ShiftStateKey, ShiftStateMeta> = Object.fromEntries(
  SHIFT_STATES.map((s) => [s.key, s]),
) as Record<ShiftStateKey, ShiftStateMeta>;
