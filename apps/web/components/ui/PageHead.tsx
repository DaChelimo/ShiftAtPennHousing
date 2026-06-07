import type { ReactNode } from 'react';

// Page header: eyebrow + title + sub-text on the left, actions on the right.
export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="col gap-1">
        {eyebrow && <span className="t-eyebrow">{eyebrow}</span>}
        <h1 className="t-h1">{title}</h1>
        {sub && <div className="t-helper">{sub}</div>}
      </div>
      {actions && <div className="row gap-2">{actions}</div>}
    </div>
  );
}
