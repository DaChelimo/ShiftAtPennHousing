'use client';

import type { Phase2Advisory } from '@shift/core';

import { Button, Modal } from '../ui';

import { advisoryText } from './RosterPanels';

// Confirm-override card (2026-07-31 redesign, extracted out of
// ScheduleBuilder.tsx on the way out per that file's quarantine note in
// AGENTS.md §5.2): title only, then each reason as its own plain line flush
// with the title's left margin. No eyebrow jargon ("Soft cap" / "Advisory"),
// no indented bullet list, no second boxed heading competing with the modal's
// own title. Builder-only by design: an SM/HM building next week's draft
// hasn't seen these workers' hours yet, unlike the live calendar, where the
// confirm is skipped entirely because the operator is editing a schedule they
// already know (see ShiftOverrideEditor.tsx).
export function OverrideConfirmModal({
  kind,
  name,
  advisories,
  onCancel,
  onConfirm,
}: {
  kind: 'over_target' | 'advisory';
  name: string;
  advisories?: Phase2Advisory[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      testId={kind === 'over_target' ? 'over-target-warning' : 'advisory-confirm'}
      title="Confirm override"
      width={440}
      onClose={onCancel}
      footer={
        <>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            kind={kind === 'over_target' ? 'primary' : 'danger'}
            data-testid={kind === 'over_target' ? 'over-target-confirm' : 'advisory-confirm-accept'}
            onClick={onConfirm}
          >
            Assign anyway
          </Button>
        </>
      }
    >
      {kind === 'over_target' ? (
        <p className="t-body" style={{ margin: 0 }}>
          {name} would be pushed over their weekly target hours.
        </p>
      ) : (
        <div className="col gap-1">
          {(advisories ?? []).map((a, i) => (
            <p key={i} className="t-body" style={{ margin: 0 }}>
              {advisoryText(a)}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}
