import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // KB intake (apps/web/lib/actions/kbIntake.ts uploadForIntake) posts the raw
    // file straight through a Server Action. The Next.js default (1MB) rejects
    // any real scanned PDF outright with a 413 before the action body even runs.
    serverActions: {
      bodySizeLimit: '20mb',
    },
    // Default dynamic staleTime is 0, so every client-side nav (including tab
    // switches under the always-dynamic (app) layout, which reads cookies via
    // getSessionUser) re-fetches the whole RSC tree and re-runs every DB round
    // trip in AppLayout. 30s lets the router reuse a just-rendered shell/page
    // when the SW flips between tabs, without going stale for a real session
    // change (role/house edits land on the next natural revalidation).
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
