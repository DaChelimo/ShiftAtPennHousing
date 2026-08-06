import type { Metadata } from 'next';
import Link from 'next/link';

import { Card } from '../../../components/ui/Card';
import { Icon } from '../../../components/ui/Icon';
import { PageHead } from '../../../components/ui/PageHead';
import { Tag, type TagKind } from '../../../components/ui/Tag';
import { getSessionUser } from '../../../lib/auth';
import { getWorkerHomeSummary } from '../../../lib/data/worker/home';
import { simNow } from '../../../lib/time/simClock';

export const metadata: Metadata = { title: 'Home' };

function firstName(full: string): string {
  const n = full.trim().split(/\s+/)[0];
  return n || 'there';
}

type StatusChip = { label: string; kind: TagKind } | null;

// Worker home. Greeting + entry points to the built flows, each with a live status
// chip so the worker sees at a glance whether there is something to act on.
export default async function WorkerHomePage() {
  const user = await getSessionUser();
  if (user === null) return null; // layout redirected

  const summary = await getWorkerHomeSummary(user.userId, await simNow());

  const prefChip: StatusChip =
    summary.preferences.state === 'open'
      ? { label: 'Open now', kind: 'blue' }
      : summary.preferences.state === 'submitted'
        ? { label: 'Submitted', kind: 'green' }
        : summary.preferences.state === 'closed'
          ? { label: 'Closed', kind: 'gray' }
          : null;

  const prefDesc =
    summary.preferences.state === 'open'
      ? summary.preferences.deadlineLabel
        ? `Submissions are open. Due ${summary.preferences.deadlineLabel}.`
        : 'Submissions are open. Paint your weekly availability.'
      : summary.preferences.state === 'submitted'
        ? 'You have submitted. Adjust any time before the deadline.'
        : summary.preferences.state === 'closed'
          ? 'The window has closed. Your choices are read-only.'
          : 'No preference window is open right now.';

  const breakChip: StatusChip =
    summary.breaks.state === 'claim_open'
      ? { label: 'Claim open', kind: 'green' }
      : summary.breaks.state === 'upcoming'
        ? { label: 'Upcoming', kind: 'blue' }
        : null;

  const breakDesc =
    summary.breaks.state === 'claim_open'
      ? `${summary.breaks.breakName}: claim window is open now.`
      : summary.breaks.state === 'upcoming'
        ? `${summary.breaks.breakName} is coming up.`
        : 'No break scheduled. Break shifts appear here when one is declared.';

  const cards = [
    {
      href: '/home/preferences',
      icon: 'check' as const,
      title: 'Semester preferences',
      desc: prefDesc,
      chip: prefChip,
      testId: 'home-card-preferences',
    },
    {
      href: '/home/breaks',
      icon: 'calendar' as const,
      title: 'Break coverage',
      desc: breakDesc,
      chip: breakChip,
      testId: 'home-card-breaks',
    },
  ];

  return (
    <div className="page">
      <PageHead
        eyebrow="Your desk"
        title={`Hi ${firstName(user.name)}`}
        sub="Everything you can do from your phone, now on the web."
      />
      <div className="worker-cardgrid" data-testid="home-cards">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} data-testid={c.testId} className="worker-card-link">
            <Card pad className="worker-card">
              <div className="worker-card-icon">
                <Icon name={c.icon} size={22} />
              </div>
              <div className="col gap-1">
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <div className="t-h2">{c.title}</div>
                  {c.chip && <Tag kind={c.chip.kind}>{c.chip.label}</Tag>}
                </div>
                <div className="t-helper">{c.desc}</div>
              </div>
              <div className="worker-card-go">
                <Icon name="arrowRight" size={18} />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
