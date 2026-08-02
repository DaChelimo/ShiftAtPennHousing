// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'

// Static docs site for Shift@PennHousing.
// Deliberately standalone: its own build, its own styling, deployed independently
// of apps/web so a docs deploy can never break the product app.
export default defineConfig({
  site: 'https://shift-guide.example.edu',
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
      // Pagefind writes its bundle into dist/ after Astro finishes, so the import
      // has to survive the client build untouched.
      rollupOptions: { external: ['/pagefind/pagefind.js'] },
    },
  },
})
