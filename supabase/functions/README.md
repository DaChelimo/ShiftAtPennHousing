# Edge Functions — build prerequisite (packages/core)

Five functions run pure logic from `@shift/core` via a dynamic import of its **built
output**, NOT the TypeScript source:

| Function            | imports                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `force-trigger`     | `packages/core/dist/force-trigger/index.js`, `…/float-lookup/index.js` |
| `orchestrator-tick` | `…/orchestrator/evaluate.js`, `…/float-lookup/index.js`                |
| `permanent-drop`    | `…/permanent-ops/drop-scope.js`                                        |
| `permanent-pickup`  | `…/permanent-ops/pickup-evaluator.js`                                  |
| `create-swap`       | `…/swaps/eligibility.js`                                               |

## ⚠️ You MUST build `@shift/core` before serving or deploying functions

```bash
pnpm --filter @shift/core build      # emits packages/core/dist/*.js
supabase start                       # re-analyzes EF imports → bind-mounts dist/*.js
# (deploy) build first, then: supabase functions deploy <name>
```

`packages/core/dist` is **gitignored**, so a fresh checkout / CI must build core first.
After changing the EF↔core import paths you must run a **full `supabase stop && supabase
start`** (not just `docker restart`) — the local edge runtime bind-mounts the specific
imported files at `start` time and does not re-analyze on restart. If `dist` is missing or
the mounts are stale, the functions return **503 (worker boot error: Module not found)**.

## Why dist, not src

The functions formerly imported `packages/core/src/*.ts`. The supabase edge runtime
(Deno 1.45) bind-mounts the _literal_ import specifiers it discovers — and `@shift/core`
uses NodeNext ESM, so its source imports siblings as `./x.js` while the files on disk are
`./x.ts`. The runtime mounts `…/x.js`, which doesn't exist in `src`, so the worker can't
boot. The compiled `dist/` has real `.js` files whose `./x.js` specifiers resolve, so the
runtime mounts and loads them correctly.

Core's `dist` is also built **without sourcemaps** (`packages/core/tsconfig.json`
`sourceMap: false`): with a sourcemap the edge runtime relocates a dist module back to its
`src` original (via the map's `sources`) and then fails to resolve the `src` siblings.
