import type { CSSProperties } from 'react';

// Simple geometric line-icon set on a 16px grid (Carbon-flavored). A handful are
// filled (overflow / dot / warnFill); the rest are 1.4px strokes.
export const ICONS = {
  calendar: 'M5 1v2M11 1v2M2 4h12v10H2zM2 7h12',
  grid: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  bell: 'M8 1.5a4 4 0 0 0-4 4v3l-1.5 2h11L12 8.5v-3a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0',
  user: 'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 14a5.5 5.5 0 0 1 11 0',
  chevDown: 'M3 6l5 5 5-5',
  chevRight: 'M6 3l5 5-5 5',
  chevLeft: 'M10 3L5 8l5 5',
  chevUp: 'M3 10l5-5 5 5',
  close: 'M3 3l10 10M13 3L3 13',
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM11 11l3 3',
  add: 'M8 2v12M2 8h12',
  warn: 'M8 1.5L15 14H1zM8 6v4M8 11.5v.5',
  warnFill: 'M8 1L15 14H1z',
  check: 'M3 8.5l3.5 3.5L13 4.5',
  checkCircle: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM5 8l2 2 4-4',
  phone:
    'M3 2h3l1.5 4-2 1a8 8 0 0 0 3.5 3.5l1-2 4 1.5v3a1 1 0 0 1-1 1A11 11 0 0 1 2 3a1 1 0 0 1 1-1z',
  overflow: 'M8 3.2a.8.8 0 1 0 0-.1zM8 8.4a.8.8 0 1 0 0-.1zM8 13.6a.8.8 0 1 0 0-.1z',
  settings:
    'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M13 3l-1.4 1.4M4.4 11.6L3 13',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  drag: 'M6 3h.01M10 3h.01M6 8h.01M10 8h.01M6 13h.01M10 13h.01',
  menu: 'M2 4h12M2 8h12M2 12h12',
  clock: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5',
  arrowRight: 'M2 8h11M9 4l4 4-4 4',
  people:
    'M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 14a4.5 4.5 0 0 1 9 0M11 8a2.2 2.2 0 0 0 0-4.4M14.5 14a3.7 3.7 0 0 0-3-3.6',
  inbox: 'M2 2h12v12H2zM2 9h3l1.5 2h3L13 9h1',
  layers: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  power: 'M8 2v6M4.5 4.5a5 5 0 1 0 7 0',
  edit: 'M11 2l3 3-8 8H3v-3zM10 3l3 3',
  trash: 'M2 4h12M5 4V2h6v2M4 4l1 10h6l1-10',
  filter: 'M2 3h12l-4.5 6v4l-3 1.5V9z',
  send: 'M2 8l12-5-5 12-2.5-4.5z',
  shield: 'M8 1.5l5 2v4c0 3-2 5.5-5 7-3-1.5-5-4-5-7v-4z',
  swap: 'M4 4h8l-2-2M12 12H4l2 2',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3',
  dot: 'M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  hours: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13zM8 5v3.2L10 10',
  doc: 'M4 1h6l3 3v11H4zM10 1v3h3',
  copy: 'M6 6h8v8H6zM3 11V3a1 1 0 0 1 1-1h7',
} as const;

export type IconName = keyof typeof ICONS;

const FILLED: ReadonlySet<IconName> = new Set<IconName>(['overflow', 'dot', 'warnFill']);

export function Icon({
  name,
  size = 16,
  className = '',
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const d = ICONS[name];
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <path
        d={d}
        stroke={filled ? 'none' : 'currentColor'}
        fill={filled ? 'currentColor' : 'none'}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
