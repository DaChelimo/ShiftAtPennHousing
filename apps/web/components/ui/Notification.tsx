import type { ReactNode } from 'react';

import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

const ICON_FOR: Record<NotificationKind, IconName> = {
  info: 'warnFill',
  success: 'checkCircle',
  warning: 'warnFill',
  error: 'warnFill',
};

// Inline notification with a severity accent bar. Set `actionable` for the
// elevated, action-carrying variant (the Allied-procurement alert in §6.4) — pass
// its single action(s) via `actions`.
export function Notification({
  kind = 'info',
  title,
  children,
  actions,
  onClose,
  actionable = false,
}: {
  kind?: NotificationKind;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  actionable?: boolean;
}) {
  return (
    <div
      className={`notif notif-${kind} ${actionable ? 'notif-actionable' : ''}`.trim()}
      role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'}
    >
      <span className="notif-bar" />
      <Icon name={ICON_FOR[kind]} size={18} className="notif-icon" />
      <div className="notif-body">
        {title && <div className="notif-title">{title}</div>}
        {children && <div className="notif-text">{children}</div>}
      </div>
      {actions && <div className="notif-actions">{actions}</div>}
      {onClose && <IconButton icon="close" label="Dismiss" onClick={onClose} className="notif-close" />}
    </div>
  );
}
