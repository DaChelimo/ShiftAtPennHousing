# @shift/docs — the Shift user guide site

A standalone static site. Its own build, its own styling, deployed independently of
`apps/web` so a docs deploy can never break the product app.

It shares a domain with the product app: `shiftatpenn.edu/guide/*` is served by this
deployment, everything else by `apps/web`. Vercel does that routing on its network
(`apps/web/microfrontends.json`), so the two stay independently deployable. See
[Serving under /guide](#serving-under-guide) before touching links or the build.

- **What the site is and what is on each page:** `docs/user-guide-site/SKETCH.md`
- **How it looks:** `docs/user-guide-site/DESIGN.md` (the authority; the CSS here
  implements it and should not invent values)

## Commands

```bash
pnpm --filter @shift/docs dev          # localhost:4321/guide
pnpm --filter @shift/docs build        # astro build, then the Pagefind index
pnpm --filter @shift/docs preview      # serve dist, the only way to test search
pnpm --filter @shift/docs type-check   # astro check
```

Note the `/guide` in those URLs. The dev server serves the site under the base path
too, so `http://localhost:4321/` is a 404 by design.

Search is Pagefind, which indexes `dist/` **after** Astro finishes. There is no index in
`astro dev`, so the search dialog says so instead of failing silently.

## Where things live

| Path                      | What it is                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `src/styles/tokens.css`   | DESIGN.md §2 colour and §3 type tokens, light and dark            |
| `src/styles/base.css`     | Reset, type scale, the three-column frame (§4)                    |
| `src/components/`         | The §5 component set, one file each                               |
| `src/mdx-components.ts`   | Makes every component ambient in MDX, so pages need no imports    |
| `src/nav.ts`              | The SKETCH.md §3 page map: sidebar order, grouping, reading order |
| `src/href.ts`             | `withBase()`, which puts every internal link under `/guide`       |
| `src/content/docs/**`     | The pages themselves, MDX, one file per route                     |
| `src/pages/index.astro`   | The landing page, which gets its own treatment (§1)               |
| `src/assets/screenshots/` | The pitch set, copied from `docs/pitch/screenshots/`              |

## Authoring a page

Frontmatter is validated by `src/content.config.ts`:

```mdx
---
title: 'Dropping a shift'
description: 'One sentence stating what the page is for. It becomes the lede.'
minutes: 6
draft: true # remove when the page is actually written
---
```

Every §5 component is available without importing it: `Callout`, `Card`, `CardGrid`,
`Figure`, `FlowStrip`, `Ladder`, `Related`, `StateCard`, `StateList`, `Steps`, `Table`,
`Tabs`, `Term`, `UI`.

Two rules that are easy to break:

1. **The critical callout (`<Callout critical>`) is permitted on one page only**, currently
   `/managers/coverage`. DESIGN.md §6: the moment a second page uses it, the first one
   stops working.
2. **No em dashes or en dashes in anything a reader sees.** This matches the product's own
   copy rule (AGENTS.md).

Adding a page means adding both the MDX file and its entry in `src/nav.ts`.

### Linking to another page

Write links root-absolute, as if the guide were at the domain root:

```mdx
See [Hours, caps, and attribution](/system/hours-rules).
```

`withBase()` adds the `/guide` prefix at render time, so content never hardcodes the
deploy path. It is applied inside the components that take an href (`Card`, `Related`,
`Term`, `Link`), inside `Sidebar` / `DocsLayout` / the landing page, and via the `a`
mapping in `src/mdx-components.ts`.

**One trap.** That `a` mapping only catches links markdown generates. A literal
lowercase `<a href="/...">` written inside a component's children (under `<Steps>`, in a
`<span class="step-note">`) is JSX, bypasses the mapping, and ships a link that 404s in
production while looking fine in `astro dev`. Use `<Link href="/...">` there instead.

## Serving under /guide

`astro.config.mjs` sets `base: '/guide'` and `outDir: './dist/guide'`. Both are needed
and for different reasons:

- `base` rewrites the URLs Astro emits.
- `outDir` nests the actual files, because Vercel forwards the full path to this
  deployment. Path routing does not strip the prefix, so a file has to physically exist
  at `guide/workers/hours/index.html`. Vercel's Output Directory stays `dist`.

Pagefind then indexes `dist/guide` as its own site root, so its result URLs are
site-relative and it re-adds the base it infers from the bundle's own URL. Indexing
`dist` instead produces `/guide/guide/...` links from search results.

To move the guide to a different path, change `base`, `outDir`, the `paths` in
`apps/web/microfrontends.json`, the `guide` exclusion in `apps/web/proxy.ts`, and
`NEXT_PUBLIC_DOCS_URL`. Nothing in `src/content/` needs to change.

## Build status

39 doc pages plus the landing page, zero broken internal links, `astro check` clean.
32 pages are structured stubs (`draft: true`). The 8 written are the landing page,
`/getting-started`, the three section overviews, `/workers/your-week`, `/system/floating`,
and `/managers/coverage`.
