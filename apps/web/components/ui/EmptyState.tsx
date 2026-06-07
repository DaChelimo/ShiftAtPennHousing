import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export type EmptyTone = 'calm' | 'neutral' | 'error';

// Empty / error placeholder. `calm` (green) for "all clear" states — the action
// inbox's quiet hero (§6.4); `neutral` for nothing-yet; `error` for failures.
export function EmptyState({
  icon = 'checkCircle',
  title,
  desc,
  action,
  tone = 'calm',
}: {
  icon?: IconName;
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  tone?: EmptyTone;
}) {
  return (
    <div className={`empty empty-${tone}`}>
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <div className="t-h2">{title}</div>
      {desc && (
        <div className="t-helper" style={{ maxWidth: 360, textAlign: 'center' }}>
          {desc}
        </div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// Convenience: an error-toned empty state with a sensible default icon.
export function ErrorState({
  title = 'Something went wrong',
  desc,
  action,
}: {
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return <EmptyState icon="warn" tone="error" title={title} desc={desc} action={action} />;
}
