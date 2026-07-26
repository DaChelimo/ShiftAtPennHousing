<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# apps/web/ — Next.js Admin and Worker Portal

Everything above this line is managed by Next.js tooling; leave it alone. Everything below is
this project's guidance, and assumes you have read the root `AGENTS.md`.

This is the **admin** surface (SM / RSM / HM / BM / admin) plus a worker portal. The mobile
app is worker-only, so any manager-facing capability lands here first.

## Cross-house write paths

The elevated tier (HM, BM, RSM) may modify **any** house's schedule; SM is own-house
everywhere. This is easy to get wrong, because the acting admin's own house is rarely the
house being edited.

**Always target the viewed house, never the actor's own:**

- Pages: `writeHouseId(user, requested, validHouseIds)` (schedule-builder, preferences).
- Actions: `canBuildForHouse(user, houseId)` (builder publish, override `authorizeForBlocks`,
  force-trigger).

Both live in `lib/auth.ts`. The house switcher unlock and `canViewOtherHouses` take an
`isScheduleAdmin` flag (hm/bm/rsm). The force-trigger EF and validator take an
`isScheduleAdmin` initiator flag.

**People admin, HM leave, and weekly cap stay own-house** for hm/bm/rsm, gated by
`user_has_house_admin_role`. Do not widen that branch. The top-level `admin` role is the one
exception. See `supabase/AGENTS.md` for the full predicate table.

`/admin/operations` and `/admin/launch` are admin-gated (`isAdmin`).

## House context

House context persists across navigation via `?house=` on every nav link. People and Hours
follow cross-house selection **only** for an admin or an on-duty HMOD.

The house tab is the **Excel-style week grid** (`buildHouseGridWeek`, frozen rail). This is
settled; do not reintroduce the day-roster layout. If the grid renders sparse chips, suspect
the PostgREST 1000-row cap, not the layout.

## Known traps

- **PostgREST `db-max-rows` is 1000.** A query that silently truncates looks like a UI bug (a
  float appearing to no-op on acknowledge). Use bounded views for feeds.
- **URI too long:** a `.in()` filter with a few hundred ids returns HTTP 414. Use the shared
  `selectByBlockIdChunks` helper.
- **Edge runtime down means silent write no-ops.** If a write succeeds in-app but never lands
  in the DB, check `supabase_edge_runtime` (Exit 255); fix with `docker start edge_runtime`.
- **Rebuild `@shift/shared` after regenerating `database.types.ts`**, or the build fails on
  stale types.
- SM builder snapshots go through the service client deliberately; the switcher is the real
  gate.

## Size ceilings

`components/builder/ScheduleBuilder.tsx` (~1,570 lines) is over the 600-line ceiling and
quarantined: do not grow it. New surface goes in a new file, and when you make a substantial
change inside it, extract the section you touched on your way out. `KnowledgeIntake.tsx` and
`SeasonEditor.tsx` are approaching the same territory.

## Parity

`lib/workerColor.ts` has a Kotlin mirror at `apps/mobile/shared/.../house/WorkerColors.kt`. A
worker's colour is a pure hash of their `user_id` with no storage anywhere, so drift silently
recolours people on one platform only. `WorkerColorsTest` pins the Kotlin copy against
reference vectors generated from this file. If you change either, change
`docs/design/worker-colors.md` and both copies.

## Testing

Playwright for e2e. Playwright reuses a foreign server already on `:3000`; pin the port
explicitly (`PORT=3100 E2E_BASE_URL=... pnpm e2e:file`). Quad fixtures age out, so a suite
that passed last month may need fixture dates refreshed before you treat a failure as a
regression.
