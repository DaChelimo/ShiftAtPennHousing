/**
 * The guide is served under a base path (`/guide`) on the shared shiftatpenn.edu
 * domain, but every internal link is authored root-absolute ("/workers/hours")
 * because that is what reads naturally in MDX and in nav.ts.
 *
 * withBase() closes that gap at render time. It lives in the components that
 * accept an href (Card, Related, Term, Link, Sidebar, DocsLayout, the landing
 * page) rather than in the content, so the ~50 authored links stay base-agnostic
 * and the deploy path can change in one place.
 *
 * Astro exposes the configured base as import.meta.env.BASE_URL, with a trailing
 * slash. Strip it so the join never produces a double slash.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

export function withBase(path: string): string {
  // Absolute URLs, protocol-relative URLs, in-page anchors, and mailto: links are
  // not ours to rewrite. Only a single leading slash means "root of the guide".
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${BASE}${path}`;
}
