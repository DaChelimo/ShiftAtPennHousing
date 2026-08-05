import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LogoMark, Wordmark } from '../components/ui/Logo';
import { getSessionUser, hasAdminSurface } from '../lib/auth';
import { DOCS_URL } from '../lib/env';
import './landing.css';

// Public landing page. A signed-in visitor is sent straight to their shell; only a
// signed-out visitor sees marketing content. Content mirrors the docs site's own
// landing page (apps/docs/src/pages/index.astro) — same copy, same three reader
// paths — restyled in the product's own design language instead of the docs
// site's, and with a Log in CTA in place of "Getting started".
export default async function LandingPage() {
  const user = await getSessionUser();
  if (user !== null) {
    redirect(hasAdminSurface(user) ? '/dashboard' : '/home');
  }

  const routes = [
    {
      href: `${DOCS_URL}/workers`,
      eyebrow: "I'm a student worker",
      title: 'Work the desk',
      body: 'Pick up shifts, drop what you cannot work, swap with a colleague, and answer a float. Five verbs, thirteen short pages.',
    },
    {
      href: `${DOCS_URL}/managers`,
      eyebrow: "I'm a manager",
      title: 'Build and respond',
      body: 'Turn preferences into a staffed week, publish it, and handle a desk that is about to be empty without guessing who to call.',
    },
    {
      href: `${DOCS_URL}/system`,
      eyebrow: 'I want to understand it',
      title: 'How it decides',
      body: 'The coverage ladder, the float selection rule, hours attribution, and the roles that constrain all three.',
    },
  ];

  const capabilities = [
    [
      'Builds from preferences',
      'Workers paint their week; the builder fills seats against it, with or without AI assistance.',
    ],
    [
      'Covers gaps automatically',
      'An unclaimed block is broadcast, then floated, then escalated to a person. No one has to be watching.',
    ],
    [
      'Moves staff between houses',
      'A desk that would be empty is covered from a house with staff to spare, without emptying that house.',
    ],
    [
      'Tracks hours as they move',
      'Weekly totals, soft and hard caps, and hours worked at another house, counted once.',
    ],
  ];

  return (
    <div className="landing">
      <header className="landing-topline">
        <div className="landing-brand">
          <LogoMark size={22} />
          <Wordmark />
        </div>
        <nav className="landing-nav" aria-label="Sections">
          <a href={`${DOCS_URL}/workers`}>Workers</a>
          <a href={`${DOCS_URL}/managers`}>Managers</a>
          <a href={`${DOCS_URL}/system`}>How it works</a>
          <Link href="/login" className="landing-nav-login" data-testid="landing-login">
            Log in
          </Link>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <p className="landing-badge">Penn Residential Housing</p>
          <h1 className="landing-title">Every desk covered, and a record of how.</h1>
          <p className="landing-lede">
            Shift schedules and staffs the front desks of thirteen college houses. It replaces the
            weekly coverage scramble: the group chat at 9pm, the manager calling down a list, and
            the desk that turns out to have been empty since ten.
          </p>
          <p className="landing-lede">
            Workers see and change their own week from their phone. Managers build a term of
            schedules from stated availability, and get paged only when the system has genuinely run
            out of options. When a desk would be empty, it looks for someone already on shift nearby
            before anyone pays for a guard.
          </p>
          <div className="landing-actions">
            <Link
              href="/login"
              className="landing-button landing-button-primary"
              data-testid="landing-login-cta"
            >
              Log in
            </Link>
            <a href={DOCS_URL} className="landing-button">
              Read the user guide
            </a>
          </div>
        </section>

        <section className="landing-routes" aria-label="Choose your path">
          {routes.map((route) => (
            <a key={route.href} className="landing-route" href={route.href}>
              <span className="landing-eyebrow">{route.eyebrow}</span>
              <span className="landing-route-title">{route.title}</span>
              <span className="landing-route-body">{route.body}</span>
              <span className="landing-route-go" aria-hidden="true">
                Read the section
              </span>
            </a>
          ))}
        </section>

        <section className="landing-strip" aria-label="What it does">
          <h2 className="landing-strip-title">What it does</h2>
          <div className="landing-strip-grid">
            {capabilities.map(([title, body]) => (
              <div key={title} className="landing-strip-item">
                <span className="landing-strip-item-title">{title}</span>
                <span className="landing-strip-item-body">{body}</span>
              </div>
            ))}
          </div>
        </section>

        <footer className="landing-foot">
          <p>
            This site is the product. The <a href={DOCS_URL}>user guide</a> describes what Shift
            does; it is not a policy document, and it is not the engineering specification.
          </p>
        </footer>
      </main>
    </div>
  );
}
