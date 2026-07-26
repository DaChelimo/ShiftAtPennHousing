// The intake queue table's status vocabulary and column definitions. Split out of
// KnowledgeIntake.tsx (well over the project's 600-line file ceiling) since this is
// a self-contained, reusable slice: status labels/colors plus the row actions,
// with no dependency on the rest of that component's upload-pipeline state.

import type { IntakeRow } from '../../lib/actions/kbIntake';
import { Button, Icon, Tag, type Column, type TagKind } from '../ui';

import { DeleteDocumentControl } from './DeleteDocumentControl';

// Operator-facing status labels (no em/en dashes per project copy rule).
export const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  normalizing: 'Reading document',
  proposed: 'Ready for review',
  in_review: 'In review',
  approved: 'Approving',
  embedding: 'Adding to knowledge base',
  live: 'Live',
  rejected: 'Rejected',
  failed: 'Needs attention',
  deleted: 'Removed',
};

const STATUS_TAG_KIND: Record<string, TagKind> = {
  live: 'green',
  proposed: 'amber',
  in_review: 'amber',
  failed: 'red',
  rejected: 'gray',
  deleted: 'gray',
  uploaded: 'blue',
  normalizing: 'blue',
  embedding: 'blue',
  approved: 'blue',
};

export const BUSY_STATUSES = ['uploaded', 'normalizing', 'embedding', 'approved'];

export function StatusTag({ status }: { status: string }) {
  const busy = BUSY_STATUSES.includes(status);
  const icon =
    !busy && status === 'live'
      ? 'checkCircle'
      : !busy && status === 'failed'
        ? 'warnFill'
        : undefined;
  return (
    <Tag kind={STATUS_TAG_KIND[status] ?? 'gray'} dot={busy} icon={icon}>
      {STATUS_LABEL[status] ?? status}
    </Tag>
  );
}

export function buildIntakeQueueColumns(opts: {
  expandedRowId: string | null;
  openReview: (intakeId: string) => void;
  retryIntake: (intakeId: string) => void;
  resumeApproval: (intakeId: string) => void;
}): Column<IntakeRow>[] {
  const { expandedRowId, openReview, retryIntake, resumeApproval } = opts;

  return [
    {
      key: 'filename',
      header: 'Document',
      render: (r) => (
        <div className="row gap-2">
          <Icon name="doc" size={16} style={{ color: 'var(--text-secondary)' }} />
          <span>{r.filename}</span>
        </div>
      ),
    },
    {
      key: 'format',
      header: 'Format',
      render: (r) => <Tag kind="outline">{r.format.toUpperCase()}</Tag>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div className="col gap-1">
          <StatusTag status={r.status} />
          {r.status === 'failed' && r.statusDetail ? (
            <span className="t-helper" style={{ color: 'var(--st-danger)' }}>
              {r.statusDetail}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => {
        const open = expandedRowId === r.intakeId;
        if (r.status === 'proposed' || r.status === 'in_review') {
          return (
            <Button
              kind="tertiary"
              size="sm"
              icon={open ? 'collapse' : undefined}
              onClick={() => openReview(r.intakeId)}
              data-testid="kb-review-open"
            >
              {open ? 'Hide' : 'Review'}
            </Button>
          );
        }
        if (r.status === 'failed') {
          // A failure after the proposal existed (approve/commit) resumes
          // approval instead of re-running extract/propose, which would
          // silently throw away whatever the reviewer had already approved.
          return r.hasProposal ? (
            <Button
              kind="tertiary"
              size="sm"
              icon="refresh"
              onClick={() => resumeApproval(r.intakeId)}
            >
              Retry
            </Button>
          ) : (
            <Button
              kind="tertiary"
              size="sm"
              icon="refresh"
              onClick={() => retryIntake(r.intakeId)}
            >
              Retry
            </Button>
          );
        }
        if (r.status === 'embedding') {
          // Should only ever be visible for a second or two. Still here after
          // a refresh means the request that set it never finished (crashed
          // dev server, dropped connection) -- nothing times this out on its
          // own, so this is the manual way to finish the job.
          return (
            <Button
              kind="tertiary"
              size="sm"
              icon="refresh"
              onClick={() => resumeApproval(r.intakeId)}
            >
              Resume
            </Button>
          );
        }
        if (r.status === 'live') {
          return (
            <div className="row gap-2">
              <Button
                kind="tertiary"
                size="sm"
                icon={open ? 'collapse' : undefined}
                onClick={() => openReview(r.intakeId)}
                data-testid="kb-details-open"
              >
                {open ? 'Hide' : 'Details'}
              </Button>
              <DeleteDocumentControl intakeId={r.intakeId} title={r.filename} />
            </div>
          );
        }
        if (r.status === 'deleted') {
          return (
            <Button
              kind="tertiary"
              size="sm"
              icon={open ? 'collapse' : undefined}
              onClick={() => openReview(r.intakeId)}
              data-testid="kb-details-open"
            >
              {open ? 'Hide' : 'Details'}
            </Button>
          );
        }
        return null;
      },
    },
  ];
}
