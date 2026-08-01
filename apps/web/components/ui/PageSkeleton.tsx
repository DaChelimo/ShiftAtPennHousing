import type { CSSProperties } from 'react';

import { Skeleton } from './Skeleton';

// Shared loading skeletons for route-level `loading.tsx` files.
//
// Why these exist: a route with no `loading.tsx` has no Suspense boundary, so Next
// holds the OLD page on screen until the new one's server render finishes. Measured
// on this app: clicking to /admin/people left the previous page up for 792 ms with no
// feedback at all, while /calendar (which had a loading.tsx) painted its shimmer at
// 174 ms. The data does not arrive any sooner either way -- what changes is whether
// the click registers instantly.
//
// These mirror the real page chrome (page-head, then body) closely enough that the
// swap to real content is not a visible jolt. They are deliberately coarse: a skeleton
// that tracks every detail of a page becomes a second copy of that page to maintain.

// The eyebrow + title + optional sub-text block every page opens with (see PageHead).
function HeadSkeleton({ sub = true, actions = 0 }: { sub?: boolean; actions?: number }) {
  return (
    <div className="page-head">
      <div className="col gap-1">
        <Skeleton w={64} h={10} />
        <Skeleton w={200} h={24} />
        {sub && <Skeleton w={320} h={12} />}
      </div>
      {actions > 0 && (
        <div className="row gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} w={112} h={36} />
          ))}
        </div>
      )}
    </div>
  );
}

export type PageSkeletonProps = {
  /** Matches the page's own max-width so the shimmer occupies the same column. */
  maxWidth?: number;
  /** Show the sub-text line under the title. */
  sub?: boolean;
  /** Number of header action buttons to sketch. */
  actions?: number;
  /** Body shape. */
  variant?: 'table' | 'cards' | 'form' | 'plain';
  /** Row / card count for the body. */
  rows?: number;
  style?: CSSProperties;
};

/**
 * Route-level loading shell: page header plus a body sketch.
 *
 * `variant` picks the body shape:
 * - `table`  a filter bar plus evenly spaced rows (People, Hours, Config, Launch)
 * - `cards`  stacked cards (Leave, Rotor, Cap, worker feeds)
 * - `form`   a narrow stack of labelled fields (Preferences, Operations editor)
 * - `plain`  one large block (Assistant, Knowledge, anything bespoke)
 */
export function PageSkeleton({
  maxWidth,
  sub = true,
  actions = 0,
  variant = 'cards',
  rows = 4,
  style,
}: PageSkeletonProps) {
  return (
    <div
      className="page"
      style={{ ...(maxWidth === undefined ? {} : { maxWidth }), ...style }}
      aria-busy="true"
      aria-label="Loading"
    >
      <HeadSkeleton sub={sub} actions={actions} />
      {variant === 'table' && (
        <div className="col gap-2" style={{ marginTop: 16 }}>
          <Skeleton w={280} h={36} style={{ marginBottom: 6 }} />
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} w="100%" h={44} />
          ))}
        </div>
      )}
      {variant === 'cards' && (
        <div className="col gap-3" style={{ marginTop: 16 }}>
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} w="100%" h={104} />
          ))}
        </div>
      )}
      {variant === 'form' && (
        <div className="col gap-3" style={{ marginTop: 16 }}>
          {Array.from({ length: rows }, (_, i) => (
            <div className="col gap-1" key={i}>
              <Skeleton w={140} h={11} />
              <Skeleton w="100%" h={38} />
            </div>
          ))}
          <Skeleton w={128} h={40} style={{ marginTop: 4 }} />
        </div>
      )}
      {variant === 'plain' && (
        <div style={{ marginTop: 16 }}>
          <Skeleton w="100%" h={420} />
        </div>
      )}
    </div>
  );
}
