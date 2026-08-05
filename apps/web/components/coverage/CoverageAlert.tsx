'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { createClient } from '../../lib/supabase/client';
import { Icon } from '../ui';
import './coverage.css';

// App-wide Allied coverage alert.
//
// WHY THIS IS IN THE SHELL AND NOT ON /inbox
// ------------------------------------------
// Managers have no push devices: only the worker mobile app registers push_tokens, so
// dispatch-push contacts zero devices for an RSM or HM and still stamps delivered_at.
// Until the manager mobile app ships, the ONLY way an Allied request reaches a human is
// if the web app makes it unmissable while they are somewhere in the app. A bell badge
// on a page nobody is looking at does not do that.
//
// So this component:
//   * renders a persistent red bar on EVERY page while a request needs attention,
//   * subscribes to realtime so it appears without a navigation or reload,
//   * prefixes document.title so it is visible in a BACKGROUND browser tab,
//   * plays one short chime on arrival, mutable and remembered.
//
// It is NOT dismissable while a request is open. That is deliberate.

const MUTE_KEY = 'shift.coverageChimeMuted';

// The mute flag lives in localStorage, which does not exist during SSR. useSyncExternalStore
// is the shape React provides for exactly that: the server snapshot is `false`, the client
// reads the real value on hydration, and no state is set from an effect. Subscribing to
// `storage` also keeps two open manager tabs in agreement, which the old effect did not.
// `storage` never fires in the tab that wrote the value, so toggleMute notifies locally.
const muteListeners = new Set<() => void>();

function emitMuteChange(): void {
  for (const listener of muteListeners) listener();
}

function subscribeMute(onStoreChange: () => void): () => void {
  muteListeners.add(onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    muteListeners.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

// Reading storage can throw (Safari private mode, blocked cookies). This now runs during
// render, so a throw would take the banner down with it. Same rule as the chime: a browser
// that blocks it must never break the banner.
function getMuteSnapshot(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

function getMuteServerSnapshot(): boolean {
  return false;
}

// A short two-tone chime built with WebAudio. No asset to ship, no external request
// (the CSP on this app forbids one anyway), and it works offline.
function playChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    for (const [i, freq] of [880, 1174.7].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.18);
    }
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // Audio is a nice-to-have. A browser that blocks it must never break the banner.
  }
}

export function CoverageAlert({
  actionRequiredCount,
  hasOverdue,
  unavailable = false,
}: {
  actionRequiredCount: number;
  hasOverdue: boolean;
  /** The coverage read failed, so the count is unknown rather than zero. */
  unavailable?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const muted = useSyncExternalStore(subscribeMute, getMuteSnapshot, getMuteServerSnapshot);
  const previousCount = useRef(actionRequiredCount);

  const toggleMute = useCallback(() => {
    try {
      window.localStorage.setItem(MUTE_KEY, String(!getMuteSnapshot()));
    } catch {
      // Storage is unavailable; the toggle is a no-op rather than a crash.
    }
    emitMuteChange();
  }, []);

  // Realtime at the SHELL level, so every page reacts. Any change to either table
  // re-runs the server components, which re-derive through the same @shift/core
  // predicates. We never re-implement that logic here.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('shell-coverage')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'allied_coverage_requests' },
        () => router.refresh(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  // Chime only when the count RISES, so a refresh or a close-out is silent.
  useEffect(() => {
    if (actionRequiredCount > previousCount.current && !muted) {
      playChime();
    }
    previousCount.current = actionRequiredCount;
  }, [actionRequiredCount, muted]);

  // Make it visible in a background tab. Restores the original title on cleanup.
  useEffect(() => {
    const original = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = actionRequiredCount > 0 ? `(${actionRequiredCount}) ${original}` : original;
    return () => {
      document.title = original;
    };
  }, [actionRequiredCount, pathname]);

  // A failed read is NOT quiet. Say so, with the same prominence as a real alert: a
  // manager who sees no banner will assume every desk is staffed.
  if (unavailable) {
    return (
      <div className="cov-banner is-overdue" role="alert" data-testid="coverage-banner-unavailable">
        <span className="cov-banner-icon">
          <Icon name="warnFill" size={18} />
        </span>
        <span className="cov-banner-text">
          <b>Coverage status could not be loaded.</b> Open requests may exist and are not being
          shown here. Check the inbox, and reload if it persists.
        </span>
        <span className="cov-banner-actions">
          <Link href="/inbox" data-testid="coverage-banner-unavailable-open">
            Open the inbox
          </Link>
        </span>
      </div>
    );
  }

  if (actionRequiredCount === 0) return null;

  const plural = actionRequiredCount === 1 ? '' : 's';
  return (
    <div
      className={`cov-banner ${hasOverdue ? 'is-overdue' : ''}`.trim()}
      role="alert"
      aria-live="assertive"
      data-testid="coverage-banner"
    >
      <span className="cov-banner-icon">
        <Icon name="warnFill" size={18} />
      </span>
      <span className="cov-banner-text">
        <b>
          {actionRequiredCount} Allied coverage request{plural}
        </b>{' '}
        {hasOverdue
          ? 'need attention now. At least one coverage window has already passed.'
          : `need${actionRequiredCount === 1 ? 's' : ''} a manager. A desk will be empty if nobody acts.`}
      </span>
      <span className="cov-banner-actions">
        <Link href="/inbox" data-testid="coverage-banner-open">
          Open the inbox
        </Link>
        <button
          type="button"
          className="cov-banner-link cov-banner-mute"
          onClick={toggleMute}
          aria-pressed={muted}
          data-testid="coverage-banner-mute"
        >
          {muted ? 'Unmute sound' : 'Mute sound'}
        </button>
      </span>
    </div>
  );
}
