import type { MetadataRoute } from 'next';

// Installed-app metadata. The maskable icon is a separate cut because Android
// crops a PWA icon to a circle of 80% diameter; the mark is pulled in for it.
// Icons come from scripts/brand/build-icons.mjs. Theme colour is the paper
// ground the mark sits on, not the UI accent.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SHIFT',
    short_name: 'SHIFT',
    description:
      'Desk coverage for Penn Residential Services: schedules, floats, swaps and open shifts.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4F3F0',
    theme_color: '#F4F3F0',
    // Real /public URLs only. app/icon.png is a metadata-file route served from
    // /icon?<hash>, so it cannot be referenced by path here.
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
