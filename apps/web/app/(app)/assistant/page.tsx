import { redirect } from 'next/navigation';

import { AssistantView } from './AssistantView';

import { getSessionUser } from '@/lib/auth';

function prettifyHouse(id: string): string {
  if (!id) return 'your house';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// Desk Assistant, mounted inside the admin AppShell (menu bar + header). The
// grounded chatbot itself lives client-side in AssistantView; this server page
// just resolves the greeting + house context. The standalone /assistant/desk
// kiosk keeps its own bare-chrome layout for the physical desk monitor.
export default async function AssistantPage() {
  const user = await getSessionUser();
  if (user === null) redirect('/login');

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  return <AssistantView firstName={firstName} houseName={prettifyHouse(user.homeHouseId)} />;
}
