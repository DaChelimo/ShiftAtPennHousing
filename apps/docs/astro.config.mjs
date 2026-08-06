// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'

// Static docs site for Shift@PennHousing.
// Deliberately standalone: its own build, its own styling, deployed independently
// of apps/web so a docs deploy can never break the product app.
//
// It shares a domain with the product app through Vercel microfrontends path
// routing (microfrontends.json in apps/web): shiftatpenn.com/guide/* is served by
// THIS deployment straight off the CDN, everything else by apps/web. `base` is
// what makes that work — every page and every emitted asset lives under /guide,
// so the one routing rule covers the whole site and nothing can collide with the
// app's own /_next paths. Internal links go through withBase() in src/href.ts.
export default defineConfig({
  site: 'https://shiftatpenn.com',
  base: '/guide',
  // `base` rewrites the URLs Astro emits but does NOT nest the build output, so a
  // default build writes dist/workers/index.html while linking to /guide/workers/.
  // Vercel forwards the full path to this deployment (microfrontends routing does
  // not strip the prefix), so the files have to physically sit under guide/.
  // outDir does that; Vercel's Output Directory stays `dist`. Pagefind then indexes
  // dist/guide as its own site root (see the build script), which is what makes its
  // result URLs line up: it prepends the base it infers from the bundle's own URL.
  outDir: './dist/guide',
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark-dimmed' },
    },
    // Anchor links on every heading. Astro already slugs heading ids.
    rehypePlugins: [
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          headingProperties: { tabIndex: -1 },
          properties: { class: 'heading-anchor', ariaHidden: 'true', tabIndex: -1 },
          content: { type: 'text', value: '#' },
        },
      ],
    ],
  },
  devToolbar: { enabled: false },
  vite: {
    build: {
      // Pagefind writes its bundle into dist/guide/ after Astro finishes (see the
      // build script's --output-path), so the import has to survive the client
      // build untouched.
      rollupOptions: { external: ['/guide/pagefind/pagefind.js'] },
    },
  },
})
