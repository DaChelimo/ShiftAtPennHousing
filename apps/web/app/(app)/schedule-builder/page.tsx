import { redirect } from 'next/navigation';

import { ScheduleBuilder } from '../../../components/builder/ScheduleBuilder';
import { adminHouseId, canBuildSchedule, getSessionUser } from '../../../lib/auth';
import { getBuilderData } from '../../../lib/data/scheduleBuilder';

// §4.3 schedule builder — SM/HM/BM only. Workers (sw) are bounced to the dashboard.
export default async function ScheduleBuilderPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');
  if (!canBuildSchedule(user)) redirect('/');

  const data = await getBuilderData(adminHouseId(user));
  return <ScheduleBuilder data={data} />;
}
