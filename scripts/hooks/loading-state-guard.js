#!/usr/bin/env node
// PostToolUse(Write) advisory: a new apps/web route (`page.tsx`) with no sibling
// `loading.tsx` leaves the OLD page frozen on screen with zero feedback until the new
// page's full server render finishes.
//
// WHY THIS IS A HOOK AND NOT A PARAGRAPH
//
// Measured directly (perf audit, 2026-07-29): clicking to /admin/people, which had no
// loading.tsx, left the previous page on screen for 792ms with nothing happening.
// /calendar, which had one, painted its shimmer at 174ms. The data was not any
// faster either way -- what changed is whether the click registered at all. At the
// time this was measured, 29 of 32 routes in apps/web had no loading state. That is
// not one oversight, it is the default outcome of adding a route and not thinking
// about the gap -- which is exactly the shape a hook exists for.
//
// ADVISORY, NOT BLOCKING, deliberately: some routes genuinely do not need one (an
// instant redirect, a client-only page with no server fetch, a dev-only gallery). A
// hook cannot make that judgment call, so it surfaces the gap and lets the agent
// decide, matching file-size-guard.js's pattern for the same reason.
//
// Fires only on Write (new files), not Edit, so editing an existing page.tsx that was
// deliberately left without a loading.tsx does not nag on every subsequent touch.

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    process.exit(0);
  }

  if (payload.tool_name !== 'Write') process.exit(0);

  const input = payload.tool_input || {};
  const filePath = input.file_path || '';
  if (!filePath) process.exit(0);

  // Only apps/web routes. Not `error.tsx`/`layout.tsx` -- this is specifically about
  // the Suspense boundary a `loading.tsx` provides during a server-render navigation.
  if (!/apps[\\/]web[\\/]app[\\/].*[\\/]page\.tsx$/.test(filePath)) process.exit(0);

  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const dir = path.dirname(abs);
  const loadingPath = path.join(dir, 'loading.tsx');

  if (fs.existsSync(loadingPath)) process.exit(0);

  const rel = path.relative(process.cwd(), abs) || filePath;
  const message =
    `${rel} has no sibling loading.tsx. Without one, clicking to this route leaves ` +
    `the PREVIOUS page frozen on screen with no feedback until the server render ` +
    `finishes -- measured as long as 792ms of dead air on this app. Add a ` +
    `loading.tsx using PageSkeleton (components/ui/PageSkeleton.tsx) so the click ` +
    `registers instantly with a shimmer, even though the data itself arrives no ` +
    `sooner. If this route genuinely does not need one (instant redirect, no server ` +
    `fetch), say so in one line rather than silently leaving the gap.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    }),
  );
}

main();
