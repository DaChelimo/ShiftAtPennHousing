'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { createClient } from '../lib/supabase/client';

import { Avatar } from './ui/Avatar';
import { Icon, type IconName } from './ui/Icon';
import { Tag } from './ui/Tag';

export type ShellHouse = { id: string; name: string; restricted: boolean };

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

const GROUP_ORDER = ['Operate', 'Manage', 'System'];

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
  if (href === '/') return pathname === '/';
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
// `?house=<id|all>` into the current pathname's query (preserving `?week=`). The
// "All houses" aggregate item appears only on /coverage (the calendar is always
// single-house).
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
  const onCoverage = pathname.startsWith('/coverage');
  // The active selection: `all` only on coverage; otherwise an unknown id falls back
  // to the home house for the label.
  const selectedId =
    requested === 'all' && onCoverage
      ? 'all'
      : (houses.find((h) => h.id === requested)?.id ?? homeHouseId);
  const cur =
    selectedId === 'all'
      ? { id: 'all', name: 'All houses', restricted: false }
      : (houses.find((h) => h.id === selectedId) ?? houses[0]);

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
          {cur.restricted && <span className="hswitch-chip">Restricted</span>}
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
          {onCoverage && (
            <button
              type="button"
              role="option"
              aria-selected={selectedId === 'all'}
              data-testid="house-option-all"
              className={`hswitch-opt ${selectedId === 'all' ? 'is-sel' : ''}`.trim()}
              onClick={() => select('all')}
            >
              <span>All houses</span>
            </button>
          )}
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
              {h.restricted && <span className="hswitch-chip">Restricted</span>}
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
  houses,
  unreadCount = 0,
  children,
}: {
  user: ShellUser;
  nav: NavItem[];
  hmodOnDuty?: boolean;
  canSwitchHouse?: boolean;
  houses?: ShellHouse[];
  unreadCount?: number;
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
          <Icon name="menu" size={18} />
        </button>
        <Link href="/" className="hdr-brand">
          Shift<span className="hdr-at">@</span>PennHousing
        </Link>
        <div className="hdr-sep hdr-nonessential" />
        <div className="hdr-nonessential">
          <HouseSwitcher
            houses={
              houses ?? [
                {
                  id: user.homeHouseId,
                  name: prettifyHouse(user.homeHouseId),
                  restricted: user.homeHouseId === 'harnwell',
                },
              ]
            }
            homeHouseId={user.homeHouseId}
            locked={!canSwitchHouse}
          />
        </div>

        <div className="grow" />

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
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          title="Notifications"
        >
          <Icon name="bell" size={18} />
          {unreadCount > 0 && (
            <span data-testid="bell-count" className="bell-count">
              {unreadCount}
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
            <Avatar name={user.name} size={28} color="#0061FC" />
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
                href={item.href}
                data-testid={item.testId}
                className={`nav-item ${isActive(pathname, item.href) ? 'is-active' : ''}`.trim()}
                title={item.label}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                <span className="nav-label">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
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
