import './floaters.css';

import { Notification } from '../../../components/ui/Notification';
import { PageHead } from '../../../components/ui/PageHead';
import { canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getManagerFloaters } from '../../../lib/data/floaters';
import { simNow } from '../../../lib/time/simClock';

// Harnwell pilot workstream E — the floaters view. Web new route (per the plan: a new
// screen, not grown into an existing component). Gated on user_can_build_schedule
// (B4), same as the schedule builder and the calendar override editor that creates
// these floats.
function fmtRange(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const day = start.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
  return `${day}, ${time(start)} - ${time(end)}`;
}

export default async function FloatersPage() {
  const user = await getSessionUser();
  if (user === null) return null;

  if (!canBuildSchedule(user)) {
    return (
      <div className="page">
        <PageHead eyebrow="Harnwell" title="Floaters" />
        <Notification kind="info" title="Managers only">
          The floaters view is available to Student Managers and Housing Managers.
        </Notification>
      </div>
    );
  }

  const now = await simNow();
  const rows = await getManagerFloaters(now);

  return (
    <div className="page">
      <PageHead
        eyebrow="Harnwell"
        title="Floaters"
        sub="Every worker currently floated out to another house, this week's window."
      />

      {rows.length === 0 ? (
        <Notification kind="info" title="Nobody is floating">
          No Harnwell workers are currently floated out to another house.
        </Notification>
      ) : (
        <table className="tbl" data-testid="floaters-table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Destination</th>
              <th>When</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.floatId} data-testid="floaters-row" data-state={r.state}>
                <td>{r.workerName}</td>
                <td>{r.destinationHouseName}</td>
                <td>{fmtRange(r.startAt, r.endAt)}</td>
                <td>
                  <span
                    className={`floater-state floater-state-${r.state}`}
                    data-testid="floaters-state"
                  >
                    {r.state === 'awaiting_confirmation' ? 'Awaiting confirmation' : 'Confirmed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
