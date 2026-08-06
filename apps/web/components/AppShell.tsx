'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { createClient } from '../lib/supabase/client';

import { DevClockCard } from './DevClockCard';
import { CoverageAlert } from './coverage/CoverageAlert';
import { Avatar } from './ui/Avatar';
import { Icon, type IconName } from './ui/Icon';
import { LogoMark, Wordmark } from './ui/Logo';
import { Tag } from './ui/Tag';

export type ShellHouse = { id: string; name: string };

export type NavItem = {
  href: string;
  label: string;
  testId: string;
  icon?: IconName;
  /** Side-nav group heading (Operate · Manage · System). Defaults to Operate. */
  group?: string;
};

export type ShellUser = {
  name: string;
  email: string;
  roles: string[];
  homeHouseId: string;
};

const GROUP_ORDER = ['Operate', 'Manage', 'System', 'Admin'];

const ROLE_LABEL: Record<string, string> = {
  bm: 'Building Manager',
  hm: 'Housing Manager',
  sm: 'Student Manager',
  sw: 'Student Worker',
};
const ROLE_RANK = ['bm', 'hm', 'sm', 'sw'];

function prettifyHouse(id: string): string {
  if (!id) return 'House';
  const m = /^house-(\d+)$/.exec(id);
  if (m) return `House ${String(Number(m[1]))}`;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Theme is read straight from the <html data-theme> attribute (set pre-paint by
// the layout script, flipped by the toggle below). useSyncExternalStore keeps the
// toggle icon in sync without a setState-in-effect and without hydration mismatch.
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

// House-context switcher (§2.5 / D11). Locked to the home house for an off-duty
// SM/HM/BM; the on-duty HMOD / project admin gets the full house list. The current
// house is read from `?house=` (defaulting to the home house) — the layout can't see
// page searchParams, so the client component derives it. Selecting an item merges
// `?house=<id>` into the current pathname's query (preserving `?week=`).
function HouseSwitcher({
  houses,
  homeHouseId,
  locked,
}: {
  houses: ShellHouse[];
  homeHouseId: string;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const requested = searchParams.get('house') ?? homeHouseId;
  // The active selection: an unknown id falls back to the home house for the label.
  const selectedId = houses.find((h) => h.id === requested)?.id ?? homeHouseId;
  const cur = houses.find((h) => h.id === selectedId) ?? houses[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function select(houseId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('house', houseId);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  if (!cur) return null;

  return (
    <div className="hswitch" ref={ref}>
      <button
        type="button"
        data-testid="house-switcher"
        className={`hswitch-btn ${locked ? 'is-locked' : ''}`.trim()}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="hswitch-eyebrow">HOUSE</span>
        <span className="hswitch-cur">
          {cur.name}
          {locked ? (
            <Icon name="grid" size={13} style={{ opacity: 0.5 }} />
          ) : (
            <Icon name="chevDown" size={14} />
          )}
        </span>
      </button>

      {open && !locked && (
        <div className="hswitch-menu" role="listbox">
          <div className="hswitch-menu-head">Switch house context</div>
          {houses.map((h) => (
            <button
              key={h.id}
              type="button"
              role="option"
              aria-selected={selectedId === h.id}
              data-testid={`house-option-${h.id}`}
              className={`hswitch-opt ${selectedId === h.id ? 'is-sel' : ''}`.trim()}
              onClick={() => select(h.id)}
            >
              <span>{h.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({
  user,
  nav,
  hmodOnDuty = false,
  canSwitchHouse = false,
  canSwitchToWorker = false,
  houses,
  coverageCount = 0,
  coverageOverdue = false,
  coverageUnavailable = false,
  canSeeCoverage = false,
  devClock = null,
  children,
}: {
  user: ShellUser;
  nav: NavItem[];
  hmodOnDuty?: boolean;
  canSwitchHouse?: boolean;
  /** This admin also holds the sw role — offer a link into the worker portal. */
  canSwitchToWorker?: boolean;
  houses?: ShellHouse[];
  /** Open Allied coverage requests still needing a manager. The bell's only badge. */
  coverageCount?: number;
  /** At least one open request whose coverage window has already passed. */
  coverageOverdue?: boolean;
  /**
   * The coverage read FAILED. Distinct from `coverageCount === 0`, which means a
   * genuinely quiet night. The banner must say the status is unknown rather than let
   * silence read as all clear.
   */
  coverageUnavailable?: boolean;
  /** This user is a manager (sm/hm/bm/rsm), so coverage alerts apply to them. */
  canSeeCoverage?: boolean;
  /** Dev-only time-travel control state; null hides the card (e.g. production). */
  devClock?: { offsetSeconds: number } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
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
    // Flip the attribute; the MutationObserver re-renders this component.
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

  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: nav.filter((n) => (n.group ?? 'Operate') === group),
  })).filter((g) => g.items.length > 0);

  const roles = ROLE_RANK.filter((r) => user.roles.includes(r));
  const primaryRole = roles[0] ?? user.roles[0] ?? 'sw';
  const canBeHmod = roles.includes('hm') || roles.includes('bm');

  // Keep the current house context (§2.5) attached to every nav link so the house
  // you are looking as persists across navigation, instead of snapping back to your
  // home house each time. The param is only added once a house has been selected via
  // the switcher (no ?house => clean URLs + home-house default), and it is carried on
  // ALL items — even campus-wide pages that ignore it — so the context still survives
  // when you pass through one of them. Pages that honor it (calendar, schedule
  // builder, preferences, people, hours) resolve it under their own authorization.
  const houseParam = searchParams.get('house');
  const navHref = (href: string) =>
    houseParam ? `${href}?house=${encodeURIComponent(houseParam)}` : href;

  return (
    <div data-testid="app-shell" className={`shell ${navCollapsed ? 'nav-collapsed' : ''}`.trim()}>
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
        <Link href="/dashboard" className="hdr-brand">
          <LogoMark size={32} variant="reversed" />
          <Wordmark />
        </Link>
        <div className="hdr-sep hdr-nonessential" />
        <div className="hdr-nonessential">
          <HouseSwitcher
            houses={
              houses ?? [
                {
                  id: user.homeHouseId,
                  name: prettifyHouse(user.homeHouseId),
                },
              ]
            }
            homeHouseId={user.homeHouseId}
            locked={!canSwitchHouse}
          />
        </div>

        <div className="grow" />

        {devClock && <DevClockCard offsetSeconds={devClock.offsetSeconds} />}

        {canBeHmod && (
          <div
            data-testid="hmod-pill"
            className={`hmod-pill hdr-nonessential ${hmodOnDuty ? 'is-on' : ''}`.trim()}
            aria-label="HMOD on-duty status"
          >
            <span className="hmod-dot" />
            <span className="col" style={{ lineHeight: 1.1, alignItems: 'flex-start' }}>
              <span className="hmod-label">HMOD</span>
              <span className="hmod-state">{hmodOnDuty ? 'On duty' : 'Off duty'}</span>
            </span>
          </div>
        )}

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
          href="/inbox"
          data-testid="nav-bell"
          className="hdr-bell"
          aria-label={
            coverageCount > 0
              ? `${coverageCount} Allied coverage requests need attention`
              : 'Action inbox'
          }
          title={coverageCount > 0 ? 'Allied coverage needed' : 'Action inbox'}
        >
          <Icon name="bell" size={18} />
          {coverageCount > 0 && (
            <span data-testid="bell-urgent-count" className="bell-count is-urgent">
              {coverageCount}
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
                  <span className="t-meta">
                    {ROLE_LABEL[primaryRole] ?? 'Worker'} · {prettifyHouse(user.homeHouseId)}
                  </span>
                </div>
              </div>
              <div className="user-roles">
                {roles.map((r, i) => (
                  <Tag key={r} kind={i === 0 ? 'blue' : 'gray'}>
                    {r.toUpperCase()}
                  </Tag>
                ))}
                {roles.length > 1 && (
                  <span className="t-meta" style={{ marginLeft: 'auto' }}>
                    Roles stack
                  </span>
                )}
              </div>
              {canSwitchToWorker && (
                <Link
                  href="/home"
                  data-testid="switch-to-worker"
                  className="user-item"
                  onClick={() => setUserOpen(false)}
                >
                  Switch to worker view
                </Link>
              )}
              <button type="button" onClick={signOut} data-testid="sign-out" className="user-item">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="nav" aria-label="Primary">
        {groups.map((g) => (
          <div className="nav-group" key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map((item) => (
              <Link
                key={item.href}
                href={navHref(item.href)}
                data-testid={item.testId}
                className={`nav-item ${isActive(pathname, item.href) ? 'is-active' : ''}`.trim()}
                title={item.label}
                onClick={() => setNavCollapsed(true)}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                <span className="nav-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <main className="main">
        {/* Always mounted for a manager, even at zero: it owns the shell-level realtime
            subscription, so a request arriving while they sit on any page surfaces the
            banner without a navigation. It renders nothing when the count is zero. */}
        {canSeeCoverage && (
          <CoverageAlert
            actionRequiredCount={coverageCount}
            hasOverdue={coverageOverdue}
            unavailable={coverageUnavailable}
          />
        )}
        {children}
      </main>
    </div>
  );
}
