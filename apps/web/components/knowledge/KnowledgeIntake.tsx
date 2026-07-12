'use client';

// KB Intake admin surface (INTAKE_PLAN Phase 3 + section 6.2): stat dashboard, the
// upload control, the live-status queue, and the review panel. Status labels are the
// operator-facing ones from the spec (no em/en dashes per project copy rule).

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import {
  approveIntake,
  loadIntakeDetail,
  processIntake,
  rejectIntake,
  uploadForIntake,
  type IntakeDetail,
  type IntakeQueue,
} from '../../lib/actions/kbIntake';

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  normalizing: 'Reading document',
  proposed: 'Ready for review',
  in_review: 'In review',
  approved: 'Approving',
  embedding: 'Adding to knowledge base',
  live: 'Live',
  rejected: 'Rejected',
  failed: 'Needs attention',
};

const STATUS_KIND: Record<string, 'ok' | 'warn' | 'busy' | 'muted'> = {
  live: 'ok',
  proposed: 'warn',
  in_review: 'warn',
  failed: 'warn',
  uploaded: 'busy',
  normalizing: 'busy',
  embedding: 'busy',
  approved: 'busy',
  rejected: 'muted',
};

function Badge({ status }: { status: string }) {
  const kind = STATUS_KIND[status] ?? 'muted';
  const cls = { ok: 'badge-ok', warn: 'badge-warn', busy: 'badge-busy', muted: 'badge-muted' }[
    kind
  ];
  return <span className={`badge ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function KnowledgeIntake({ initial }: { initial: IntakeQueue }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<IntakeDetail | null>(null);
  const [busy, setBusy] = useState(false);

  // Approximate the live queue by refreshing while anything is mid-pipeline. A Supabase
  // Realtime subscription is the follow-on; polling keeps the status honest for v1.
  const inFlight = initial.rows.some((r) =>
    ['uploaded', 'normalizing', 'embedding', 'approved'].includes(r.status),
  );
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  const refresh = () => startTransition(() => router.refresh());

  async function onUpload(form: FormData) {
    setBusy(true);
    await uploadForIntake(form);
    setBusy(false);
    refresh();
  }

  async function openReview(intakeId: string) {
    const res = await loadIntakeDetail(intakeId);
    if (res.ok) setSelected(res.data);
  }

  async function onApprove() {
    if (selected === null) return;
    setBusy(true);
    await approveIntake(selected.intakeId, selected.proposed ?? undefined);
    setBusy(false);
    setSelected(null);
    refresh();
  }

  async function onReject() {
    if (selected === null) return;
    setBusy(true);
    await rejectIntake(selected.intakeId);
    setBusy(false);
    setSelected(null);
    refresh();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Stat label="Awaiting review" value={initial.counts.awaitingReview} />
        <Stat label="Live documents" value={initial.kb.documents} />
        <Stat label="Chunks indexed" value={initial.kb.chunks} />
        <Stat label="Needs attention" value={initial.counts.needsAttention} danger />
      </div>

      <form action={onUpload} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="file"
          name="file"
          accept=".md,.markdown,.txt,.pdf"
          required
          data-testid="kb-upload-input"
        />
        <button type="submit" disabled={busy} data-testid="kb-upload-submit">
          {busy ? 'Working...' : 'Upload document'}
        </button>
        <button type="button" onClick={refresh} disabled={pending} style={{ marginLeft: 'auto' }}>
          Refresh
        </button>
      </form>

      <section>
        <h3 style={{ marginBottom: 8 }}>Intake queue</h3>
        <table className="table" data-testid="kb-queue">
          <thead>
            <tr>
              <th>Document</th>
              <th>Format</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initial.rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ color: 'var(--text-muted, #888)' }}>
                  No documents yet. Upload a guide, binder page, or email to begin.
                </td>
              </tr>
            ) : (
              initial.rows.map((r) => (
                <tr key={r.intakeId} data-testid="kb-queue-row">
                  <td>{r.filename}</td>
                  <td>{r.format}</td>
                  <td>
                    <Badge status={r.status} />
                    {r.status === 'failed' && r.statusDetail ? (
                      <div style={{ fontSize: 12, color: 'var(--text-danger, #a32d2d)' }}>
                        {r.statusDetail}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {r.status === 'proposed' || r.status === 'in_review' ? (
                      <button
                        type="button"
                        onClick={() => openReview(r.intakeId)}
                        data-testid="kb-review-open"
                      >
                        Review
                      </button>
                    ) : r.status === 'failed' ? (
                      <button
                        type="button"
                        onClick={() =>
                          startTransition(async () => {
                            await processIntake(r.intakeId);
                            router.refresh();
                          })
                        }
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {selected?.proposed ? (
        <ReviewPanel
          detail={selected}
          busy={busy}
          onChange={(proposed) => setSelected({ ...selected, proposed })}
          onApprove={onApprove}
          onReject={onReject}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{ background: 'var(--surface-1, #f6f6f4)', borderRadius: 8, padding: '1rem' }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)' }}>{label}</div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 500,
          color: danger && value > 0 ? 'var(--text-danger, #a32d2d)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ReviewPanel({
  detail,
  busy,
  onChange,
  onApprove,
  onReject,
  onClose,
}: {
  detail: IntakeDetail;
  busy: boolean;
  onChange: (proposed: NonNullable<IntakeDetail['proposed']>) => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const p = detail.proposed!;
  const set = (patch: Partial<typeof p>) => onChange({ ...p, ...patch });
  const durable = p.items.filter((i) => i.kind === 'durable_rule');
  const dated = p.items.filter((i) => i.kind === 'dated_announcement');
  const leave = p.items.filter((i) => i.kind === 'structured_leave');

  return (
    <section
      className="card"
      data-testid="kb-review-panel"
      style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Review: {p.title}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Title">
          <input value={p.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Source reference">
          <input value={p.sourceRef} onChange={(e) => set({ sourceRef: e.target.value })} />
        </Field>
        <Field label="House scope">
          <input
            value={p.houseScope ?? ''}
            placeholder="blank = shared, all houses"
            onChange={(e) =>
              set({ houseScope: e.target.value.trim() === '' ? null : e.target.value.trim() })
            }
          />
        </Field>
        <Field label="Sensitivity">
          <select
            value={p.sensitivity}
            onChange={(e) => set({ sensitivity: e.target.value as typeof p.sensitivity })}
          >
            <option value="general">general</option>
            <option value="internal">internal</option>
            <option value="restricted">restricted</option>
          </select>
        </Field>
      </div>

      <ItemGroup
        title={`Durable rules (${durable.length}) - indexed as timeless`}
        items={durable}
      />
      <ItemGroup
        title={`Dated announcements (${dated.length}) - indexed with an expiry window`}
        items={dated}
        showWindow
      />
      {leave.length > 0 ? (
        <div
          data-testid="kb-leave-note"
          style={{
            background: 'var(--bg-warning, #faeeda)',
            borderRadius: 8,
            padding: '10px 12px',
          }}
        >
          <strong>{leave.length} leave item(s) not indexed.</strong> Enter these via the Housing
          Manager leave path so duty resolution honors them:
          <ul style={{ margin: '6px 0 0' }}>
            {leave.map((i, k) => (
              <li key={k} style={{ fontSize: 13 }}>
                {i.content}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.representations?.deIdentifiedLesson ? (
        <div
          style={{
            background: 'var(--surface-1, #f6f6f4)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
          }}
        >
          <strong>De-identified lesson (indexed):</strong> {p.representations.deIdentifiedLesson}
          <div style={{ color: 'var(--text-secondary, #666)', marginTop: 4 }}>
            The raw incident record is never indexed.
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          style={{ color: 'var(--text-danger, #a32d2d)' }}
        >
          Reject
        </button>
        <button type="button" onClick={onApprove} disabled={busy} data-testid="kb-approve">
          {busy ? 'Approving...' : 'Approve and index'}
        </button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary, #666)' }}>{label}</span>
      {children}
    </label>
  );
}

function ItemGroup({
  title,
  items,
  showWindow,
}: {
  title: string;
  items: NonNullable<IntakeDetail['proposed']>['items'];
  showWindow?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginBottom: 4 }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((i, k) => (
          <li key={k} style={{ fontSize: 14, marginBottom: 4 }}>
            {i.content}
            {showWindow && i.window.effectiveUntil ? (
              <span style={{ color: 'var(--text-secondary, #666)', fontSize: 12 }}>
                {' '}
                (through {i.window.effectiveUntil})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
