# S2 — Force-trigger float · NOTES (outcome)

**Status: DONE & GREEN — force-trigger works end-to-end.** The pre-existing EF-boot blocker
(below) was FIXED in a follow-on infra pass (see "EF-boot fix"). Decision 2 / audit #2.

## Results (after the EF-boot fix)

- **Core Vitest:** 597/597 (10 new `summarizeForceTrigger` cases).
- **Playwright:** full web suite **28 passed / 1 skipped** — the live force-trigger EF
  round-trip now passes (routed-to-Allied). The 1 skip is the "button absent on a
  float/allied-stage gap" case (needs a float-stage seed fixture; unrelated to the EF).
- **Repo gate:** `type-check` 5/5 · `lint` 3/3 · `build` clean.
- All 5 core-importing EFs (force-trigger, orchestrator-tick, permanent-drop/pickup,
  create-swap) now boot in the local edge runtime.

## EF-boot fix (resolves the KEY FINDING below)

Root cause: the supabase edge runtime (Deno 1.45) bind-mounts the _literal_ import
specifiers it finds; `@shift/core` source uses NodeNext `.js` specifiers against `.ts`
files, so `src/.../x.js` mounts never resolve. Fix: point the 5 EFs at `packages/core/dist/*.js`
(real `.js` whose specifiers resolve), build core with **`sourceMap: false`** (else the
runtime relocates dist modules back to `src` via the map and re-breaks), and do a **full
`supabase stop && start`** so the runtime re-analyzes imports and mounts `dist`. Operational
requirement (build core before serving/deploying; `dist` is gitignored) documented in
`supabase/functions/README.md`. Test re-enabled with a 20s timeout (the `oneshot` policy
cold-spawns a Deno worker per request).

## What shipped (the web wiring — the S2 scope)

- **Pure core** `packages/core/src/force-trigger/summary.ts` (+ barrel) — `summarizeForceTrigger`
  maps the EF response to `{ kind: 'floated'|'allied'|'mixed'|'gated'|'rejected'|'failed', floaterCount, alliedCount, reason? }`.
- **`apps/web/lib/data/coverage.ts`** — `CoverageGap.blockIds` (threads the real DB `block_id`
  onto the internal `Atom`; the synthetic gap `id` was the only id before).
- **`apps/web/lib/actions/forceTrigger.ts`** (new) — `forceTriggerFloat` POSTs to the
  force-trigger EF with the user's session token; gates `canBuildSchedule` + house match;
  `revalidatePath('/coverage')`.
- **`apps/web/components/coverage/CoverageMonitor.tsx`** — live Force-trigger button (only on
  broadcast-stage gaps) → confirm → outcome (floater(s) / Allied / winter-break gated / error);
  no revoke control (no-takeback). `router.refresh()` after a non-error outcome.
- **Seed** `supabase/seed.sql` — June `operating_calendar` rows (regular_school_year,
  float_enabled) so the EF resolves the float profile rather than gating.

## Lead reconciliations

1. **Reason-literal drift** — contract said `float_disabled`; the real EF validator emits
   **`float_not_enabled`** (validation.ts:78). Corrected the contract; the summarizer maps
   `float_not_enabled` → `gated`.
2. **Phantom test removed** — the Test Author's defensive `float_disabled` → gated case tested a
   literal the system never emits (it correctly summarizes as `rejected`); removed (the real
   `float_not_enabled` → gated case is kept and passes).

## ⚠️ KEY FINDING — force-trigger is NOT proven end-to-end (pre-existing, systemic)

The live EF round-trip fails locally: the edge-runtime worker **can't boot** the force-trigger
function. It dynamically imports packages/core **source** (`../../../packages/core/src/force-trigger/index.ts`),
whose `export * from './types.js'` Deno can't resolve (the file is `types.ts`; the `.js`
specifier is the NodeNext convention). Confirmed from the edge logs:
`worker boot error: failed to load '…/packages/core/src/force-trigger/types.js': Module not found`.
This is **systemic** — every packages/core-importing EF uses the same dynamic-import pattern
(`orchestrator-tick` included), which is exactly why the lifecycle e2e bridges the orchestrator
in TS instead of running the EF. (The local edge container had also OOM-died (exit 137) 3 days
ago; `supabase db reset` does not restart it.)

**Implication:** S2's web wiring is correct and verified up to the EF call, but force-trigger
does not yet function end-to-end in any Deno runtime (local — and likely deploy, since the
cross-dir dynamic `.ts` import is bundler-hostile too). The 2 skipped e2e cases:

- the live result round-trip (`test.skip`, this issue);
- "button absent on a float/allied-stage gap" (Test-Author skip — needs a float-stage seed fixture).

## Follow-up (HIGH — needed to make force-trigger actually work)

Make the EF→packages/core import Deno-resolvable **and** deploy-safe: e.g. a Deno import map /
`deno.json` that resolves the `.js` specifiers, or a committed/bundled build the EF imports
(`dist` is gitignored, so a raw dist-import fixes local but breaks deploy). This is a backend/infra
task affecting all core-importing EFs — out of S2's web scope, but it's the gate on force-trigger
(and the other EFs) functioning. Once fixed, un-skip the live force-trigger e2e + add an
eligible-floater seed to also assert the floater-assigned path.
