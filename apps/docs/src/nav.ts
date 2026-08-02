/**
 * The page map from SKETCH.md §3, in one place.
 * Sidebar order, section grouping, and the overview card grids all read this,
 * so the site's structure cannot drift from the sketch in three directions at once.
 */

export type NavEntry = {
  /** Slug within the docs collection, e.g. "workers/your-week". */
  slug: string;
  /** Sidebar label. The page's own frontmatter title is the H1. */
  label: string;
};

export type NavSection = {
  /** The section overview page, which is a real page and the group header. */
  slug: string;
  label: string;
  /** Short line under the group header in the sidebar drawer. */
  blurb: string;
  entries: NavEntry[];
};

export const sections: NavSection[] = [
  {
    slug: 'workers',
    label: 'For Student Workers',
    blurb: 'The mobile app and the worker web portal, as one product.',
    entries: [
      { slug: 'workers/signing-in', label: 'Signing in and setting up' },
      { slug: 'workers/your-week', label: 'Your week: My Shifts' },
      { slug: 'workers/picking-up', label: 'Picking up open shifts' },
      { slug: 'workers/dropping', label: 'Dropping a shift' },
      { slug: 'workers/swapping', label: 'Swapping and handing off' },
      { slug: 'workers/floating', label: 'When you get floated' },
      { slug: 'workers/preferences', label: 'Submitting availability' },
      { slug: 'workers/breaks', label: 'Break shifts' },
      { slug: 'workers/your-house', label: 'Your house schedule and contacts' },
      { slug: 'workers/hours', label: 'Your hours' },
      { slug: 'workers/notifications', label: 'Notifications and widgets' },
      { slug: 'workers/assistant', label: 'Asking the desk assistant' },
      { slug: 'workers/web-portal', label: 'Doing all of this on the web' },
    ],
  },
  {
    slug: 'managers',
    label: 'For Managers',
    blurb: 'The web console: build ahead, respond now, administer.',
    entries: [
      { slug: 'managers/roles', label: 'Which manager are you?' },
      { slug: 'managers/building-a-schedule', label: 'Building a schedule' },
      { slug: 'managers/ai-assist', label: 'AI-assisted building' },
      { slug: 'managers/publishing', label: 'Publishing and editing' },
      { slug: 'managers/coverage', label: 'Coverage inbox and Allied' },
      { slug: 'managers/people', label: 'People: hiring, roles, transfers' },
      { slug: 'managers/hours', label: 'Hours reporting and caps' },
      { slug: 'managers/preferences-admin', label: 'Preferences and deadlines' },
      { slug: 'managers/breaks-admin', label: 'Setting up break periods' },
      { slug: 'managers/seasons', label: 'Operating seasons and calendar' },
      { slug: 'managers/knowledge-base', label: 'The knowledge base' },
      { slug: 'managers/launch', label: 'Launching a house' },
    ],
  },
  {
    slug: 'system',
    label: 'How the System Works',
    blurb: 'The concepts underneath both consoles.',
    entries: [
      { slug: 'system/concepts', label: 'Core concepts' },
      { slug: 'system/roles', label: 'Roles and the duty hierarchy' },
      { slug: 'system/calendar', label: 'The operating calendar' },
      { slug: 'system/coverage-ladder', label: 'How a shift gets covered' },
      { slug: 'system/floating', label: 'Floating: overview' },
      { slug: 'system/floating/deep-dive', label: 'Floating: the selection rule' },
      { slug: 'system/swaps-explained', label: 'How a swap resolves' },
      { slug: 'system/hours-rules', label: 'Hours, caps, and attribution' },
      { slug: 'system/notifications-rules', label: 'What triggers a notification' },
      { slug: 'system/glossary', label: 'Glossary' },
    ],
  },
];

/** Standalone pages that sit above the three sections. */
export const topLevel: NavEntry[] = [{ slug: 'getting-started', label: 'Getting started' }];

/** Flat reading order, used for the previous / next footer links. */
export const readingOrder: NavEntry[] = [
  ...topLevel,
  ...sections.flatMap((section) => [
    { slug: section.slug, label: section.label },
    ...section.entries,
  ]),
];

export function sectionOf(slug: string): NavSection | undefined {
  return sections.find((s) => slug === s.slug || slug.startsWith(`${s.slug}/`));
}
