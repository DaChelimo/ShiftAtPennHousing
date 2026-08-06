'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { createClient } from '../lib/supabase/client';

import { DevClockCard } from './DevClockCard';
import { Avatar } from './ui/Avatar';
import { Icon, type IconName } from './ui/Icon';
import { LogoMark, Wordmark } from './ui/Logo';

export type WorkerNavItem = {
  href: string;
  label: string;
  testId: string;
  icon: IconName;
};

export type WorkerShellUser = {
  name: string;
  email: string;
  homeHouseId: string;
};

function prettifyHouse(id: string): string {
  if (!id) return 'House';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Theme mirrors AppShell: read from <html data-theme>, flipped by the toggle.
function subscribeTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
function getThemeSnapshot(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function getThemeServerSnapshot(): 'light' | 'dark' {
  return 'light';
}

// The worker portal shell. Deliberately leaner than the admin AppShell: no house
// switcher, no HMOD pill, no admin bell. A worker only ever acts as themselves, so
// the chrome is a brand + primary nav + account menu. Dual-role users (a worker who
// also builds schedules) get a "Switch to admin console" link back into /(app).
export function WorkerShell({
  user,
  nav,
  hasAdminSurface = false,
  updatesCount = 0,
  devClock = null,
  children,
}: {
  user: WorkerShellUser;
  nav: WorkerNavItem[];
  hasAdminSurface?: boolean;
  updatesCount?: number;
  devClock?: { offsetSeconds: number } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setUserOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [userOpen]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('shift-theme', next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div
      data-testid="worker-shell"
      className={`shell ${navCollapsed ? 'nav-collapsed' : ''}`.trim()}
    >
      <header className="hdr">
        <button
          type="button"
          className="hdr-menu"
          onClick={() => setNavCollapsed((c) => !c)}
          aria-label="Toggle navigation"
          aria-expanded={!navCollapsed}
        >
          <Icon name="menu" size={20} />
        </button>
        <Link href="/home" className="hdr-brand">
          <LogoMark size={32} variant="reversed" />
          <Wordmark />
        </Link>

        <div className="grow" />

        {devClock && <DevClockCard offsetSeconds={devClock.offsetSeconds} />}

        <button
          type="button"
          className="icon-btn hdr-icon"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title="Toggle theme"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>

        <Link
          href="/home/updates"
          data-testid="worker-bell"
          className="hdr-bell"
          aria-label={updatesCount > 0 ? `Updates, ${updatesCount} pending` : 'Updates'}
          title="Updates"
        >
          <Icon name="bell" size={18} />
          {updatesCount > 0 && (
            <span data-testid="worker-bell-count" className="bell-count">
              {updatesCount}
            </span>
          )}
        </Link>

        <div className="hdr-user-wrap" ref={userRef}>
          <button
            type="button"
            className="hdr-user"
            onClick={() => setUserOpen((o) => !o)}
            aria-label="Account menu"
            aria-expanded={userOpen}
          >
            <Avatar name={user.name} size={32} color="#0061FC" />
          </button>
          {userOpen && (
            <div className="user-menu">
              <div className="user-menu-head">
                <Avatar name={user.name} size={36} />
                <div className="col">
                  <b>{user.name}</b>
                  <span className="t-meta">Student Worker · {prettifyHouse(user.homeHouseId)}</span>
                </div>
              </div>
              {hasAdminSurface && (
                <Link
                  href="/dashboard"
                  data-testid="switch-to-admin"
                  className="user-item"
                  onClick={() => setUserOpen(false)}
                >
                  Switch to admin console
                </Link>
              )}
              <Link
                href="/welcome"
                data-testid="view-landing-page"
                className="user-item"
                onClick={() => setUserOpen(false)}
              >
                About Shift
              </Link>
              <button type="button" onClick={signOut} data-testid="sign-out" className="user-item">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="nav" aria-label="Primary">
        <div className="nav-group">
          <div className="nav-group-label">Me</div>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testId}
              className={`nav-item ${isActive(pathname, item.href) ? 'is-active' : ''}`.trim()}
              title={item.label}
              onClick={() => setNavCollapsed(true)}
            >
              <Icon name={item.icon} size={18} />
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="nav-foot">
          <div className="t-meta" style={{ padding: '0 16px' }}>
            {prettifyHouse(user.homeHouseId)}
          </div>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
