import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @napi-rs/canvas (KB intake PDF rendering, lib/kbIntakePipeline.ts), sharp, and
  // unpdf all ship native/non-JS bindings that Turbopack's production bundler
  // cannot place in an ESM chunk ("non-ecmascript placeable asset"). Left bundled,
  // `next build` fails outright — verified nobody had a working production build
  // before this. Marking them server-external skips bundling and lets Node
  // require() them directly at runtime, which is where they were always going to
  // run anyway (all three are server-only: KB intake, image processing).
  serverExternalPackages: ['@napi-rs/canvas', 'sharp', 'unpdf'],
  // The dev-mode "N" build indicator defaults to bottom-left, where it sits on
  // top of the side nav's last item (Config). Move it out of the nav column.
  devIndicators: {
    position: 'bottom-right',
  },
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
