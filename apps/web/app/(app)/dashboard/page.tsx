import './dashboard.css';

import { canViewOtherHouses, resolveCalendarHouse } from '@shift/core';
import Link from 'next/link';

import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Icon, type IconName } from '../../../components/ui/Icon';
import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { Tag } from '../../../components/ui/Tag';
import {
  adminHouseId,
  getSessionUser,
  isAdmin,
  isHouseAdmin,
  isRsm,
  isScheduleAdmin,
  isStudentManager,
  isWorker,
} from '../../../lib/auth';
import { isProjectAdministrator } from '../../../lib/data/config';
import { getDashboard, type DashboardModel, type DeskShift } from '../../../lib/data/dashboard';
import { getOnDutyHmodId, getShellHouses } from '../../../lib/data/hmod';
import { simNow } from '../../../lib/time/simClock';

// ===========================================================================
// Dashboard — where every manager lands after signing in.
//
// It is deliberately NOT a summary of the app. It answers three questions in a
// fixed order, because that is the order a manager actually has them:
//
//   1. Is the desk covered right now?      → the live strip across the top
//   2. Is there anything I have to do?     → the ranked action queue
//   3. How is the week tracking?           → the right rail
//
// Nothing here is a new capability. Every row links to the page that already owns
// that concern, so the dashboard stays a router with context attached rather than
// a fourth place to do the same job. All aggregation is in lib/data/dashboard.ts.
// ===========================================================================

function firstName(full: string): string {
  const n = full.trim().split(/\s+/)[0];
  return n || 'there';
}

/** NY hour-of-day greeting — matched to the sim clock, not the server's clock. */
function greeting(nowLabel: string): string {
  const hour = Number(nowLabel.slice(0, 2));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function DeskChip({ shift }: { shift: DeskShift }) {
  const isFloat = shift.homeHouse !== null && !shift.vacant;
  return (
    <div
      className={`dash-desk ${shift.vacant ? 'is-vacant' : ''} ${isFloat ? 'is-float' : ''}`.trim()}
      data-testid="dash-desk-chip"
      data-vacant={shift.vacant}
    >
      <div className="col" style={{ minWidth: 0 }}>
        <span className="dash-desk-name">
          {shift.vacant ? 'Nobody on this seat' : (shift.workerName ?? 'Unnamed')}
        </span>
        <span className="dash-desk-time">
          {shift.rangeLabel}
          {isFloat && ` · floated in from ${shift.homeHouse}`}
        </span>
      </div>
    </div>
  );
}

/** The live strip. This is the only element on the page allowed to be loud. */
function RightNow({ model }: { model: DashboardModel }) {
  const { desk } = model;
  const staffed = desk.onNow.filter((s) => !s.vacant);
  const vacant = desk.onNow.filter((s) => s.vacant);

  const status = desk.closedToday
    ? { dot: 'is-idle', text: 'Closed today' }
    : !desk.hasBlocks
      ? { dot: 'is-idle', text: 'No schedule generated for this week' }
      : vacant.length > 0
        ? {
            dot: 'is-gap',
            text: `${vacant.length} seat${vacant.length === 1 ? '' : 's'} unstaffed`,
          }
        : staffed.length > 0
          ? { dot: '', text: 'Desk covered' }
          : { dot: 'is-idle', text: 'Desk closed right now' };

  return (
    <Card className="dash-now dash-full" data-testid="dash-right-now">
      <div>
        <div className="dash-now-label">
          <span className={`dash-live-dot ${status.dot}`.trim()} />
          On the desk now, {model.nowLabel} · {status.text}
        </div>
        {desk.onNow.length === 0 ? (
          <div className="t-helper">
            {desk.closedToday
              ? `${model.houseName} is closed today, so no one is scheduled.`
              : 'Nothing is scheduled at this moment.'}
          </div>
        ) : (
          <div className="dash-desk-list">
            {desk.onNow.map((s) => (
              <DeskChip key={s.id} shift={s} />
            ))}
          </div>
        )}
      </div>

      <div className="dash-next" data-testid="dash-next-up">
        <div className="t-eyebrow">Coming up</div>
        {desk.nextUp.length === 0 ? (
          <div className="t-helper">Nothing else in the next 12 hours.</div>
        ) : (
          desk.nextUp.map((s) => (
            <div className="dash-next-row" key={s.id}>
              <span className="dash-next-time">{s.rangeLabel.slice(0, 5)}</span>
              <span className={`dash-next-who ${s.vacant ? 'is-vacant' : ''}`.trim()}>
                {s.vacant ? 'Unfilled' : (s.workerName ?? 'Unnamed')}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function ActionQueue({ model }: { model: DashboardModel }) {
  return (
    <section data-testid="dash-actions">
      <div className="dash-sec-head">
        <h2>Needs you</h2>
        {model.actions.length > 0 && (
          <Link className="dash-sec-link" href="/inbox">
            Action inbox <Icon name="arrowRight" size={13} />
          </Link>
        )}
      </div>
      <Card>
        {model.actions.length === 0 ? (
          <div style={{ padding: 'var(--sp-6) 0' }}>
            <EmptyState
              title="Nothing needs you right now"
              desc="No open coverage requests, no unfilled seats in the next 24 hours, and no unread notifications."
            />
          </div>
        ) : (
          <div className="dash-actions">
            {model.actions.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className={`dash-action sev-${a.severity}`}
                data-testid="dash-action"
                data-severity={a.severity}
              >
                <span className="dash-action-icon">
                  <Icon name={a.icon} size={17} />
                </span>
                <span className="col">
                  <span className="dash-action-title">{a.title}</span>
                  <span className="dash-action-detail">{a.detail}</span>
                  {a.meta && <span className="dash-action-meta">{a.meta}</span>}
                </span>
                <span className="dash-action-cta">
                  {a.cta} <Icon name="arrowRight" size={13} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function RailCard({
  icon,
  title,
  children,
  testId,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Card className="dash-rail-card" data-testid={testId}>
      <div className="dash-rail-head">
        <span className="dash-rail-icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="t-label">{title}</span>
      </div>
      {children}
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ house?: string }>;
}) {
  const user = await getSessionUser();
  if (user === null) return null; // the layout already redirected

  const { house } = await searchParams;
  const now = await simNow();

  // Same house resolution as the calendar (§2.5): the switcher's selection is
  // honored for anyone allowed to leave their own house, and silently ignored for
  // everyone else. The dashboard is read-only, so this is a VIEW gate; nothing on
  // this page writes.
  const [onDutyId, isProjectAdmin, validHouses] = await Promise.all([
    getOnDutyHmodId(now),
    isProjectAdministrator(user.userId),
    getShellHouses(),
  ]);
  const viewHouse = resolveCalendarHouse({
    requested: house ?? null,
    homeHouse: adminHouseId(user),
    canViewOthers: canViewOtherHouses({
      isOnDutyHmod: onDutyId === user.userId,
      isProjectAdmin,
      isRsm: isRsm(user),
      isScheduleAdmin: isScheduleAdmin(user),
      isStudentManager: isStudentManager(user),
    }),
    validHouseIds: validHouses.map((h) => h.id),
  });

  const model = await getDashboard(user, viewHouse, now);
  const houseQuery = `?house=${encodeURIComponent(viewHouse)}`;

  const jumps: { href: string; icon: IconName; label: string; sub: string }[] = [
    {
      href: `/calendar${houseQuery}`,
      icon: 'calendar',
      label: 'Live calendar',
      sub: 'Fill a seat, override, force a float',
    },
    {
      href: `/schedule-builder${houseQuery}`,
      icon: 'grid',
      label: 'Schedule builder',
      sub: 'Build and publish the week',
    },
    {
      href: `/admin/preferences${houseQuery}`,
      icon: 'check',
      label: 'Preferences',
      sub: 'Who has submitted, who has not',
    },
    {
      href: '/inbox',
      icon: 'shield',
      label: 'Action inbox',
      sub: 'Every Allied request and its outcome',
    },
  ];
  if (isHouseAdmin(user)) {
    jumps.push({
      href: `/admin/people${houseQuery}`,
      icon: 'people',
      label: 'People',
      sub: 'Hire, transfer, roles',
    });
    jumps.push({
      href: '/admin/rotor',
      icon: 'swap',
      label: 'HMOD rotor',
      sub: 'Plan who is on duty',
    });
  }
  if (isAdmin(user)) {
    jumps.push({
      href: '/admin/operations',
      icon: 'settings',
      label: 'Operations',
      sub: 'Seasons, windows, staffing bands',
    });
  }

  const prefs = model.preferences;
  const prefPct =
    prefs === null || prefs.total === 0 ? 0 : Math.round((prefs.submitted / prefs.total) * 100);

  return (
    <div className="page">
      <PageHead
        eyebrow={
          <>
            {model.houseName} · {model.todayLabel}
          </>
        }
        title={`${greeting(model.nowLabel)}, ${firstName(user.name)}`}
        sub="Everything that needs a decision today, and where to make it."
        actions={
          <Link className="btn btn-primary" href={`/calendar${houseQuery}`}>
            <Icon name="calendar" size={16} />
            <span>Open the calendar</span>
          </Link>
        }
      />

      {/* A failed read must never render as a quiet night (the coverage lesson). */}
      {model.degraded.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-5)' }}>
          <Notification kind="warning" title="Some of this page could not load">
            {model.degraded.join(', ')} did not respond, so anything below that depends on{' '}
            {model.degraded.length === 1 ? 'it' : 'them'} may be incomplete. Treat a quiet section
            as unknown, not as all clear.
          </Notification>
        </div>
      )}

      <div className="dash">
        <RightNow model={model} />

        <div className="dash-main">
          <ActionQueue model={model} />

          <section data-testid="dash-jump">
            <div className="dash-sec-head">
              <h2>Jump to</h2>
            </div>
            <div className="dash-jump">
              {jumps.map((j) => (
                <Link key={j.href} href={j.href} className="dash-jump-card">
                  <span className="dash-jump-icon">
                    <Icon name={j.icon} size={16} />
                  </span>
                  <span className="col">
                    <span className="dash-jump-label">{j.label}</span>
                    <span className="dash-jump-sub">{j.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="dash-rail">
          <RailCard icon="user" title="HMOD on duty" testId="dash-hmod">
            <div className="dash-metric" style={{ fontSize: 20, fontWeight: 500 }}>
              {model.hmodIsYou ? 'You are' : (model.hmodName ?? 'Unresolved')}
            </div>
            <div className="dash-metric-sub">
              {model.hmodName === null
                ? 'No rotor entry covers this moment. Urgent coverage falls through to the project administrator.'
                : model.hmodIsYou
                  ? 'Urgent coverage escalations route to you until the Friday 08:00 handover.'
                  : 'Until the Friday 08:00 handover.'}
            </div>
            {isHouseAdmin(user) && (
              <div style={{ marginTop: 'var(--sp-4)' }}>
                <Link className="dash-sec-link" href="/admin/rotor">
                  Plan the rotor <Icon name="arrowRight" size={13} />
                </Link>
              </div>
            )}
          </RailCard>

          <RailCard icon="calendar" title="This week" testId="dash-week">
            <div className="dash-kv">
              <span className="dash-kv-key">Unfilled seats</span>
              <span className="dash-kv-val">{model.desk.weekGapCount}</span>
            </div>
            <div className="dash-kv">
              <span className="dash-kv-key">Unfilled in 24h</span>
              <span className="dash-kv-val">{model.desk.urgentGaps.length}</span>
            </div>
            <div className="dash-kv">
              {/* getManagerFloaters is scoped to initiated_by = 'force_triggered', so
                  this is manager-directed floats only, NOT automated float lookups. */}
              <span className="dash-kv-key">Manager-directed floats</span>
              <span className="dash-kv-val">{model.floatersOut}</span>
            </div>
            {model.hours !== null && (
              <>
                <div className="dash-kv">
                  <span className="dash-kv-key">Hours scheduled</span>
                  <span className="dash-kv-val">{Math.round(model.hours.totalHours)}h</span>
                </div>
                <div className="dash-kv">
                  <span className="dash-kv-key">At the {model.hours.cap}h cap</span>
                  <span className="dash-kv-val row gap-2" style={{ alignItems: 'center' }}>
                    {model.hours.atCap}
                    {model.hours.enforcement === 'hard' && <Tag kind="amber">Hard</Tag>}
                  </span>
                </div>
              </>
            )}
          </RailCard>

          {prefs !== null && (
            <RailCard icon="check" title="Preferences" testId="dash-preferences">
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <span className="dash-metric" style={{ fontSize: 22 }}>
                  {prefs.submitted}/{prefs.total}
                </span>
                <Tag kind={prefs.status === 'open' ? 'blue' : 'gray'}>
                  {prefs.status === 'open'
                    ? 'Open'
                    : prefs.status === 'published'
                      ? 'Published'
                      : prefs.status === 'closed'
                        ? 'Closed'
                        : 'No deadline set'}
                </Tag>
              </div>
              <div className="dash-meter">
                <div
                  className={`dash-meter-fill ${prefPct === 100 ? 'is-done' : ''}`.trim()}
                  style={{ width: `${prefPct}%` }}
                />
              </div>
              <div className="dash-metric-sub">
                {prefs.periodName}
                {prefs.deadlineLabel && ` · due ${prefs.deadlineLabel}`}
              </div>
            </RailCard>
          )}

          {isWorker(user) && (
            <RailCard icon="hours" title="Your next shifts" testId="dash-my-shifts">
              {model.myShifts.length === 0 ? (
                <div className="t-helper">You have no upcoming published shifts.</div>
              ) : (
                model.myShifts.map((s) => (
                  <div className="dash-kv" key={s.assignmentId}>
                    <span className="dash-kv-key">{s.label}</span>
                    <span className="dash-kv-val">{s.houseId}</span>
                  </div>
                ))
              )}
              <div style={{ marginTop: 'var(--sp-4)' }}>
                <Link className="dash-sec-link" href="/home/shifts">
                  Open the worker view <Icon name="arrowRight" size={13} />
                </Link>
              </div>
            </RailCard>
          )}
        </div>
      </div>
    </div>
  );
}
