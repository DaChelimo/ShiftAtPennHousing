import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// The e2e-lifecycle harness is its OWN vitest project, rooted here and invoked only via the root
// `pnpm e2e:lifecycle` script. It is NOT part of `pnpm --filter @shift/core test` — `tests/` is not
// a pnpm workspace package (workspace = packages/*, apps/*), and @shift/core's vitest include is
// `tests/**` relative to packages/core, so these files are never picked up there.
//
// It drives a SHARED, STATEFUL local Postgres, so it runs strictly serially in a single worker:
// no file parallelism, no concurrent tests. Each test isolates itself with a BEGIN…ROLLBACK
// transaction (see client.ts `inTx`), so order independence and re-runnability hold without resets.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    globals: true,
    environment: 'node',
    include: ['*.test.ts'],
    globalSetup: ['./globalSetup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false, shuffle: false },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 180_000, // globalSetup applies the seed
  },
});
