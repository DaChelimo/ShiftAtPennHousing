import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // KB intake (apps/web/lib/actions/kbIntake.ts uploadForIntake) posts the raw
    // file straight through a Server Action. The Next.js default (1MB) rejects
    // any real scanned PDF outright with a 413 before the action body even runs.
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};

export default nextConfig;
