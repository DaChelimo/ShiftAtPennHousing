import { redirect } from 'next/navigation';

import { LandingContent } from '../components/LandingContent';
import { getSessionUser, hasAdminSurface } from '../lib/auth';
import './landing.css';

// Public landing page. A signed-in visitor is sent straight to their shell; only a
// signed-out visitor sees marketing content here. A signed-in visitor who wants to
// see this page anyway can reach it at /welcome, which renders the same content
// without the redirect.
export default async function LandingPage() {
  const user = await getSessionUser();
  if (user !== null) {
    redirect(hasAdminSurface(user) ? '/dashboard' : '/home');
  }

  return <LandingContent />;
}
