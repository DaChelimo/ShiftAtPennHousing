'use client';

import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/EmptyState';

// Root error boundary. THE BACKSTOP, not the first line of defence.
//
// Per-route error.tsx files (inbox, calendar, schedule-builder) catch failures in their
// own page. None of them can catch a failure in a LAYOUT, because a layout renders above
// every boundary inside its own subtree. Without this file, a throw in
// app/(app)/layout.tsx or app/(worker)/layout.tsx escaped all the way to Next's built-in
// global error: a blank screen in production, and in dev an error overlay that reloads
// the document, hits the same throw on the reload, and loops about twice a second with no
// window in which to navigate away. That happened on 2026-07-29, when a stale PostgREST
// schema cache made the shell's Allied-coverage read fail on every route.
//
// The shells no longer throw for that specific read (see getShellCoverage in
// lib/data/coverage), but this exists so the NEXT unguarded layout failure renders a page
// a human can read and retry from, instead of an unbreakable reload loop.
export default function RootError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page" style={{ maxWidth: 640, paddingTop: 64 }}>
      <ErrorState
        title="Something went wrong"
        desc="This page could not be loaded. Retrying may work; if it does not, the details below help whoever looks into it."
        action={
          <Button kind="primary" onClick={reset}>
            Try again
          </Button>
        }
      />
      <pre
        className="t-mono"
        style={{
          marginTop: 24,
          padding: 12,
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          color: 'var(--st-text-secondary)',
          background: 'var(--st-layer)',
          borderRadius: 6,
        }}
      >
        {error.message}
      </pre>
    </div>
  );
}
