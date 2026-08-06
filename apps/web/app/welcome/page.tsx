import { LandingContent } from '../../components/LandingContent';
import { getSessionUser } from '../../lib/auth';
import '../landing.css';

// Always-on marketing page: unlike `/`, this never redirects a signed-in visitor.
// It's the in-app path back to the landing page, reachable from the account menu
// in AppShell / WorkerShell, for a user who is already signed in.
export default async function WelcomePage() {
  const user = await getSessionUser();
  return <LandingContent loggedIn={user !== null} />;
}
