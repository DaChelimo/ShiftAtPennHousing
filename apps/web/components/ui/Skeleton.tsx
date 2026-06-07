import type { CSSProperties } from 'react';

// Shimmering loading placeholder. Square by default (Carbon); compose several to
// sketch a card/row while data loads.
export function Skeleton({
  w = '100%',
  h = 14,
  r = 0,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  style?: CSSProperties;
}) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}
