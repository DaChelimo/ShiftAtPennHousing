# Admin Web — Design Reference (Claude Design export)

`admin-web.html` is the **visual source of truth** for reskinning the HM/SM admin web
app (Phase 13b). It is a **reference spec, not shipped code** — the app is Next.js +
React on the IBM Carbon design system; nothing here is bundled or iframed.

## This is a reskin, not a rebuild

The web app already exists and is tested (Phase 13b: proxy auth, drag schedule builder,
leave+mailto, HMOD rotor, live-schedule override; **29 Vitest + Playwright E2E green**).
Each screen's "done" = matches `admin-web.html` **and** the existing tests stay green.

Key existing surfaces (don't break their contracts):

- `app/` — routes/pages (Next 16: `proxy.ts` instead of middleware; async params/cookies)
- `components/` — shared UI; `lib/` — logic incl. `scheduleBuilderCard.ts`
- `e2e/` — Playwright; plus Vitest unit tests
- RLS note: SM can't read `users`/`user_roles`, so the builder snapshots via the service client

## How it gets implemented

1. Extract a reconciled `DESIGN_TOKENS` spec from the CSS → Carbon theme overrides /
   tokens (brand `#0061FC`, near-black neutral, the load-bearing shift-state colors).
2. Build the shared component layer first (app shell, nav, the shift-state legend,
   cards/tags, tables, modals), then reskin screen-by-screen against existing routes.
3. Verify each step: `next build`, Vitest, Playwright — all green.

HTML→React is a faithful **translation** of tokens/layout, expressed in idiomatic
Carbon components — not a literal port of the exported markup.
