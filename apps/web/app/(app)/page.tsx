import Link from 'next/link';

import { canBuildSchedule, getSessionUser, isHouseAdmin } from '../../lib/auth';
import { getMyShifts } from '../../lib/data/myShifts';

// Dashboard. Every signed-in user sees their own published shifts (§4.3 Phase 3:
// "Workers can see their assignments"); admins additionally get entry points to the
// builder and house-administration tools.
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (user === null) return null; // the layout already redirected

  const shifts = await getMyShifts(user.userId);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-6 py-8">
      <section>
        <h1 className="text-lg font-semibold tracking-tight">My shifts</h1>
        <ul data-testid="my-shifts" className="mt-3 space-y-2">
          {shifts.length === 0 ? (
            <li className="text-sm text-zinc-500">No published shifts yet.</li>
          ) : (
            shifts.map((shift) => (
              <li
                key={shift.assignmentId}
                className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
              >
                <span className="font-medium">{shift.label}</span>
                <span className="ml-2 text-zinc-500">({shift.houseId})</span>
              </li>
            ))
          )}
        </ul>
      </section>

      {(canBuildSchedule(user) || isHouseAdmin(user)) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Administration
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {canBuildSchedule(user) && (
              <Link
                href="/schedule-builder"
                className="rounded-lg border border-black/10 p-4 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              >
                Schedule builder
                <p className="mt-1 font-normal text-zinc-500">Build and publish the week.</p>
              </Link>
            )}
            {isHouseAdmin(user) && (
              <>
                <Link
                  href="/admin/leave"
                  className="rounded-lg border border-black/10 p-4 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Leave
                  <p className="mt-1 font-normal text-zinc-500">Submit HM/BM leave.</p>
                </Link>
                <Link
                  href="/admin/rotor"
                  className="rounded-lg border border-black/10 p-4 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  HMOD rotor
                  <p className="mt-1 font-normal text-zinc-500">Plan the weekly HMOD.</p>
                </Link>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
