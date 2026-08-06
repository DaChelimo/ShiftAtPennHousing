import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { HmodRotor } from '../../../../components/rotor/HmodRotor';
import { Notification } from '../../../../components/ui/Notification';
import { PageHead } from '../../../../components/ui/PageHead';
import { getSessionUser, isHouseAdmin } from '../../../../lib/auth';
import { getRotorData } from '../../../../lib/data/rotor';

export const metadata: Metadata = { title: 'Admin - Rotor' };

// §2.5 HMOD rotor admin — HM/BM only.
export default async function RotorPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHead
        eyebrow="Manage"
        title="HMOD rotor"
        sub="One Housing Manager On Duty per week, planned by HMs/BMs (§2.5)."
      />
      {isHouseAdmin(user) ? (
        await renderRotor()
      ) : (
        <Notification kind="warning" title="Managers only" testId="rotor-unauthorized">
          Only Housing Managers and Building Managers may plan the HMOD rotor.
        </Notification>
      )}
    </div>
  );
}

async function renderRotor() {
  const { weeks, candidates, assignments } = await getRotorData();
  return <HmodRotor weeks={weeks} candidates={candidates} assignments={assignments} />;
}
