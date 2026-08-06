# Edge Functions — @shift/core is vendored, not imported across the repo

Five functions run pure logic from `@shift/core`. They import it from a **committed,
generated copy inside this directory**, `_shared/core/`:

| Function            | imports from `../_shared/core/`                     |
| ------------------- | --------------------------------------------------- |
| `force-trigger`     | `force-trigger/index.js`, `float-lookup/index.js`   |
| `orchestrator-tick` | `orchestrator/evaluate.js`, `float-lookup/index.js` |
| `permanent-drop`    | `permanent-ops/drop-scope.js`                       |
| `permanent-pickup`  | `permanent-ops/pickup-evaluator.js`                 |
| `create-swap`       | `swaps/eligibility.js`                              |

## After changing packages/core/src, re-vendor

```bash
pnpm vendor:core        # builds @shift/core, regenerates supabase/functions/_shared/core
```

Commit the regenerated files with your change. CI runs `pnpm vendor:core:check` and fails
the build if the vendored tree is stale, missing, or has orphaned files, so a forgotten
re-vendor cannot ship functions that silently run the previous logic.

`_shared/core/` is generated. Do not hand-edit it; edit `packages/core/src` and re-run.

## Why vendored, and why committed

These functions used to reach core with a **dynamic** import of a path outside the
functions tree:

```ts
await import('../../../packages/core/dist/orchestrator/evaluate.js'); // DO NOT reintroduce
```

That works under `supabase start`, because the local edge runtime bind-mounts the literal
specifiers it discovers. It does **not** survive `supabase functions deploy`. The deploy
bundler follows **static** relative imports only, and `packages/core/dist` is both outside
the function directory and gitignored — so the deploy reported success and shipped a bundle
with no core in it. Every invocation then died at runtime with:

```
Module not found: file:///var/tmp/sb-compile-edge-runtime/packages/core/dist/orchestrator/evaluate.js
```

Confirmed against the deployed `orchestrator-tick` on 2026-08-05: the bundle contained only
`index.ts` and `floatLookup.ts`. The orchestrator scanned 0 blocks and fired 0 steps for the
entire time it was deployed, so the broadcast → float → Allied escalation chain, no-ack
float voiding, swap expiry and the coverage ladder were all inert. `force-trigger`, the
manual override for exactly that situation, was broken by the same cause.

So: the imports are **static**, the code lives **inside** `supabase/functions/`, and the
vendored output is **committed**. That last point is deliberate — a gitignored build
artifact that had to exist at deploy time is precisely what caused the outage, so leaving
this one gitignored would rebuild the same trap. The deployed bundle is now a function of
the repository alone.

## Two constraints on the vendored code

- **No bare specifiers.** Deno cannot resolve `date-fns-tz` (core's only runtime dependency)
  from a vendored file. Nothing reachable from these six entrypoints imports it today, and
  `scripts/vendor-core-into-functions.mjs` fails loudly if that ever changes rather than
  shipping a bundle that dies on boot.
- **No sourcemaps.** `packages/core/tsconfig.json` sets `sourceMap: false`. With a sourcemap
  the edge runtime relocates a compiled module back to its `src` original via the map's
  `sources` and then fails to resolve the `src` siblings.

The vendored tree carries the `.d.ts` alongside each `.js`, so the call sites keep real
types rather than degrading to `any`.
