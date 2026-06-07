import type { HTMLAttributes } from 'react';

// Generic surface card (hairline border). `pad` adds the standard 16px padding.
export function Card({
  pad = false,
  className = '',
  children,
  ...rest
}: { pad?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${pad ? 'card-pad' : ''} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
