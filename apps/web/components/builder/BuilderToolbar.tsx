import { useEffect, useRef, useState } from 'react';

import type { PublishStats } from '../../lib/actions/builder';
import { Button, Icon, IconButton, Tag } from '../ui';

// A2: surfaces that every assignment is saved the instant it's made (the
// builder has no batch "Save" — drafts persist per-action), so the HM can
// close the tab and resume later without losing work. The indicator is ALWAYS
// present (even before the first edit) so the autosave contract is discoverable,
// not something the SM has to be told about.
function savedTimeLabel(ts: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(ts),
  );
}

const AUTOSAVE_TIP =
  'Every change saves automatically. You can close this and pick up where you left off.';

function SaveStatus({ saving, savedAt }: { saving: boolean; savedAt: number | null }) {
  if (saving) {
    return (
      <span
        data-testid="builder-save-status"
        className="bld-savestate is-saving"
        title={AUTOSAVE_TIP}
      >
        <Icon name="refresh" size={13} className="bld-spin" />
        Saving…
      </span>
    );
  }
  if (savedAt !== null) {
    return (
      <span
        data-testid="builder-save-status"
        className="bld-savestate is-saved"
        title={AUTOSAVE_TIP}
      >
        <Icon name="check" size={13} />
        Saved {savedTimeLabel(savedAt)}
      </span>
    );
  }
  return (
    <span data-testid="builder-save-status" className="bld-savestate is-idle" title={AUTOSAVE_TIP}>
      <Icon name="check" size={13} />
      Saves automatically
    </span>
  );
}

type BuilderToolbarProps = {
  houseLabel: string;
  published: boolean;
  publishStats: PublishStats | null;
  saving: boolean;
  savedAt: number | null;
  phase: 1 | 2;
  onPhaseChange: (phase: 1 | 2) => void;
  showClearAll: boolean;
  onClearAll: () => void;
  showExport: boolean;
  onDownloadHtml: () => void;
  onPrintPdf: () => void;
  onPublish: () => void;
  onExpand: () => void;
};

// Compact bar + overflow menu: only the phase switch, More, Expand, and
// Publish stay visible at all times. Clear all and the two export actions
// (used far less often than switching phase or publishing) collapse into a
// single "More" menu instead of sitting at the same visual weight as
// everything else. The phase switch starts its own line, flush with the
// title above it, so the top identity row and the operational row read as
// two distinct groups instead of one packed line.
export function BuilderToolbar({
  houseLabel,
  published,
  publishStats,
  saving,
  savedAt,
  phase,
  onPhaseChange,
  showClearAll,
  onClearAll,
  showExport,
  onDownloadHtml,
  onPrintPdf,
  onPublish,
  onExpand,
}: BuilderToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const showMore = showClearAll || showExport;

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [moreOpen]);

  return (
    <div className="bld-toolbar">
      <div className="bld-toolbar-tier1">
        <div className="row gap-2">
          <h1 className="t-h1">{houseLabel} weekly template</h1>
          {published ? (
            <span data-testid="schedule-published-badge">
              <Tag kind="green" icon="check">
                Published{publishStats !== null && ` · ${publishStats.scheduled} scheduled`}
              </Tag>
            </span>
          ) : (
            <Tag kind="amber">Draft</Tag>
          )}
        </div>
      </div>
      <div className="bld-toolbar-tier2">
        <div className="seg" data-testid="builder-phase-switch">
          <button
            type="button"
            data-testid="builder-phase-1"
            className={`seg-btn ${phase === 1 ? 'is-on' : ''}`.trim()}
            onClick={() => onPhaseChange(1)}
          >
            Preferences
          </button>
          <button
            type="button"
            data-testid="builder-phase-2"
            className={`seg-btn ${phase === 2 ? 'is-on' : ''}`.trim()}
            onClick={() => onPhaseChange(2)}
          >
            Manual
          </button>
        </div>
        <div className="row gap-2">
          {showMore && (
            <div className="bld-more-wrap" ref={moreRef}>
              <IconButton
                icon="overflow"
                label="More actions"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              />
              {moreOpen && (
                <div className="bld-more-menu" role="menu">
                  {showExport && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="bld-more-item"
                        data-testid="export-html-button"
                        onClick={() => {
                          onDownloadHtml();
                          setMoreOpen(false);
                        }}
                      >
                        <Icon name="download" size={14} />
                        Download HTML
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="bld-more-item"
                        data-testid="export-pdf-button"
                        onClick={() => {
                          onPrintPdf();
                          setMoreOpen(false);
                        }}
                      >
                        <Icon name="download" size={14} />
                        Print / Save as PDF
                      </button>
                    </>
                  )}
                  {showClearAll && (
                    <button
                      type="button"
                      role="menuitem"
                      className="bld-more-item is-danger"
                      data-testid="clear-all-button"
                      onClick={() => {
                        onClearAll();
                        setMoreOpen(false);
                      }}
                    >
                      <Icon name="trash" size={14} />
                      Clear all
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <Button
            kind="secondary"
            icon="expand"
            data-testid="builder-expand-button"
            onClick={onExpand}
          >
            Expand
          </Button>
          {!published && (
            <Button data-testid="publish-button" icon="check" onClick={onPublish}>
              Publish
            </Button>
          )}
        </div>
      </div>
      <div className="bld-toolbar-tier3">
        <p className="t-helper bld-toolbar-helper">
          Drag consecutive blocks, then pick who works them. This repeating pattern applies to every
          week until you edit a specific week.
        </p>
        <SaveStatus saving={saving} savedAt={savedAt} />
      </div>
    </div>
  );
}
