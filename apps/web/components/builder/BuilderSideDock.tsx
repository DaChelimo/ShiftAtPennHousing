'use client';

// Schedule builder: the side panel's full-screen behaviour.
//
// Outside full screen the panel is a plain grid column and this file does
// nothing but pass its children through (`display: contents`). In full screen
// the point is to see the WHOLE week, so the panel becomes a drawer that is
// closed on entry and slides in from the right edge behind a single tab
// button. Clicking a shift reveals it, the tab toggles it, and Esc walks the
// same ladder (see `useSideDock().handleEscape`).

import { useCallback, useState, type ReactNode } from 'react';

import { Icon } from '../ui';

export type SideDock = {
  /** Drawer state. Only meaningful while full screen; false otherwise. */
  open: boolean;
  toggle: () => void;
  /** Open the drawer because something needs to be read (a shift was clicked). */
  reveal: () => void;
  /**
   * Esc inside full screen. Returns true when the drawer absorbed the press,
   * false when the caller should exit full screen instead.
   *
   * A full screen the SM has never opened the drawer in exits on the first
   * press. Once they have used the drawer, Esc brings it back first and the
   * next press leaves. Esc while it is already open always leaves, so there is
   * never a state with no keyboard way out.
   */
  handleEscape: () => boolean;
};

export function useSideDock(expanded: boolean): SideDock {
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // Entering or leaving full screen resets the drawer: full screen always
  // starts closed. Adjusted during render (rather than in an effect) so the
  // first paint of full screen is already collapsed, with no open-then-shut flash.
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if (prevExpanded !== expanded) {
    setPrevExpanded(expanded);
    setOpen(false);
    setTouched(false);
  }

  const toggle = useCallback(() => {
    setOpen((v) => !v);
    setTouched(true);
  }, []);

  const reveal = useCallback(() => {
    setOpen(true);
    setTouched(true);
  }, []);

  const handleEscape = useCallback(() => {
    if (open || !touched) return false;
    setOpen(true);
    return true;
  }, [open, touched]);

  return { open, toggle, reveal, handleEscape };
}

export function BuilderSideDock({
  expanded,
  dock,
  children,
}: {
  expanded: boolean;
  dock: SideDock;
  children: ReactNode;
}) {
  const open = expanded && dock.open;
  return (
    <div className={`builder-side-dock ${open ? 'is-open' : ''}`.trim()}>
      {expanded && (
        <button
          type="button"
          className="bld-side-tab"
          data-testid="builder-side-toggle"
          aria-expanded={open}
          aria-label={open ? 'Hide the details panel' : 'Show the details panel'}
          title={open ? 'Hide the details panel' : 'Show the details panel'}
          onClick={dock.toggle}
        >
          <Icon name={open ? 'chevRight' : 'chevLeft'} size={16} />
        </button>
      )}
      <aside className="builder-side">{children}</aside>
    </div>
  );
}
