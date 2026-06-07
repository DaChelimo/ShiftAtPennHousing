import type { ButtonHTMLAttributes } from 'react';

import { Icon, type IconName } from './Icon';

export type ButtonKind = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'lg';

type ButtonProps = {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  full?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

// Primary / secondary / tertiary / ghost / danger buttons. Square (no radius),
// 40px tall (sm 32 / lg 48), with optional leading/trailing icons.
export function Button({
  kind = 'primary',
  size = 'md',
  icon,
  iconRight,
  full = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${kind} btn-${size} ${full ? 'btn-full' : ''} ${className}`.trim()}
      {...rest}
    >
      {icon && <Icon name={icon} size={16} />}
      {children != null && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={16} />}
    </button>
  );
}

type IconButtonProps = {
  icon: IconName;
  size?: number;
  label: string;
  active?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

// Square 40px icon-only button. `label` is required for accessibility (aria-label + title).
export function IconButton({
  icon,
  size = 16,
  label,
  active = false,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
