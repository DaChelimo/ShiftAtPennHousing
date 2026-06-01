# Shift@PennHousing — Admin web app (Next.js)

The desktop SM/HM administrative surface (phase-13b): the schedule builder
(`BEHAVIORAL_SPECIFICATION.md §4.3`), HM/BM leave management (`§2.6`), and the
HMOD rotor (`§2.5`). It is the web sibling of the worker mobile app (phase-13a).

Per `AGENTS.md`, the **pure decision logic** lives in `packages/core`
(`scheduling/scheduleBuilderCard.ts` — Phase-1/Phase-2 card view-model) and is
unit-pinned by Vitest; this app is the **thin wrapper** that renders it and wires
it to Supabase. The data/persistence layer (how the snapshot reaches the card, how
a click writes a draft) is the web analogue of the Edge/HTTP layer phases 07–12
scoped out — exercised by the Playwright E2E (`e2e/`) against a seeded local stack.

## Routes

| Route               | Access             | Purpose                                                                    |
| ------------------- | ------------------ | -------------------------------------------------------------------------- |
| `/login`            | public             | Supabase email/password sign-in.                                           |
| `/`                 | any signed-in user | Dashboard: the user's published shifts + admin entry points.               |
| `/schedule-builder` | SM/HM/BM           | Desktop-only drag-picker, Phase-1/2 card, manual override, publish.        |
| `/admin/leave`      | HM/BM              | Submit leave (replacement picker w/ cycle prevention) + pre-filled mailto. |
| `/admin/rotor`      | HM/BM              | Weekly HMOD rotor (one HMOD/week).                                         |

Auth is gated by `proxy.ts` (Next 16's renamed Middleware): unauthenticated requests
to a protected prefix redirect to `/login`. Finer role checks run in-page so the
`§2.6` "leave-unauthorized" notice renders rather than redirects.

## Environment

| Var                             | Notes                                                               |
| ------------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL. Defaults to the local stack.                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (browser-safe). Defaults to the well-known local key.      |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server-only**; used for `publish_schedule` and cross-house reads. |

Local-stack defaults live in `lib/env.ts`, so `next build` and a local
`supabase start` work with no `.env`. Set real values in deployed environments.

## Develop

```bash
pnpm dev          # next dev (http://localhost:3000)
pnpm build        # production build
pnpm type-check   # tsc --noEmit
pnpm lint         # eslint
pnpm e2e          # Playwright (needs a seeded local Supabase — see e2e/README.md)
```
