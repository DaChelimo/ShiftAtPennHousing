import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const docs = defineCollection({
  loader: glob({ base: './src/content/docs', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    /** Page H1 and sidebar label source. */
    title: z.string(),
    /** SKETCH.md §9.3: the first sentence states what the page is for. */
    description: z.string(),
    /** Shown on section overview cards; falls back to description. */
    summary: z.string().optional(),
    /** Set on the three section overview pages. */
    overview: z.boolean().default(false),
    /** Marks a page as still a stub, so the shell can say so honestly. */
    draft: z.boolean().default(false),
    /** Estimated read time in minutes, used by /getting-started. */
    minutes: z.number().optional(),
  }),
});

export const collections = { docs };
