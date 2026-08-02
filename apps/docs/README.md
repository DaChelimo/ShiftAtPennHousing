# @shift/docs — the Shift user guide site

A standalone static site. Its own build, its own styling, deployed independently of
`apps/web` so a docs deploy can never break the product app.

- **What the site is and what is on each page:** `docs/user-guide-site/SKETCH.md`
- **How it looks:** `docs/user-guide-site/DESIGN.md` (the authority; the CSS here
  implements it and should not invent values)

## Commands

```bash
pnpm --filter @shift/docs dev          # localhost:4321
pnpm --filter @shift/docs build        # astro build, then the Pagefind index
pnpm --filter @shift/docs preview      # serve dist, the only way to test search
pnpm --filter @shift/docs type-check   # astro check
```

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

## Build status

39 doc pages plus the landing page, zero broken internal links, `astro check` clean.
32 pages are structured stubs (`draft: true`). The 8 written are the landing page,
`/getting-started`, the three section overviews, `/workers/your-week`, `/system/floating`,
and `/managers/coverage`.
