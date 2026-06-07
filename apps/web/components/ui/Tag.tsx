import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export type TagKind =
  | 'gray'
  | 'blue'
  | 'green'
  | 'purple'
  | 'teal'
  | 'amber'
  | 'red'
  | 'magenta'
  | 'outline';

// Status pill. The shift-state palette maps onto these kinds — see
// components/ui/shiftState.ts + design/DESIGN_TOKENS.md. Always pair color with
// the text label (and an icon where it carries meaning); never color alone.
export function Tag({
  kind = 'gray',
  icon,
  dot = false,
  className = '',
  children,
}: {
  kind?: TagKind;
  icon?: IconName;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`tag tag-${kind} ${className}`.trim()}>
      {dot && <span className="tag-dot" />}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

// The 8px filled "cross-house pickup" dot atom (BEH §11 / design-brief §4).
export function PickupDot({ title = 'Cross-house pickup' }: { title?: string }) {
  return <span className="pickup-dot" title={title} aria-label={title} role="img" />;
}
