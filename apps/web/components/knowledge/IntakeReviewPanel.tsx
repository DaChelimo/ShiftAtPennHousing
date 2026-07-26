'use client';

// The content of a KB intake queue row's inline expansion (see DataTable's
// expandedKey/renderExpanded in KnowledgeIntake.tsx). Two shapes depending on
// status: a proposal awaiting a decision (ReviewPanel: editable fields + the
// durable/dated chunk groups) or a document that already has a final outcome
// (live/deleted: read-only pipeline metrics only). Split out of
// KnowledgeIntake.tsx because that file was well past the project's 600-line
// file ceiling before this even existed.

import { useState } from 'react';

import type { IntakeDetail, IntakeRow } from '../../lib/actions/kbIntake';
import {
  Button,
  Card,
  Field,
  Icon,
  IconButton,
  Notification,
  Select,
  Tag,
  TextArea,
  TextInput,
} from '../ui';

import { DeleteDocumentControl } from './DeleteDocumentControl';
import { HouseScopePicker, useHouseScopeDefault } from './HouseScopePicker';
import { IntakeMetricsPanel } from './IntakeMetricsPanel';
import type { HouseOption } from './KnowledgeIntake';

export function IntakeRowExpansion({
  row,
  detail,
  loading,
  busy,
  houses,
  isProjectAdmin,
  currentUserHouseId,
  onChange,
  onApprove,
  onReject,
  onClose,
  onDeleted,
}: {
  row: IntakeRow;
  detail: IntakeDetail | null;
  loading: boolean;
  busy: boolean;
  houses: HouseOption[];
  isProjectAdmin: boolean;
  currentUserHouseId: string;
  onChange: (proposed: NonNullable<IntakeDetail['proposed']>) => void;
  onApprove: (finalProposed: NonNullable<IntakeDetail['proposed']>) => void;
  onReject: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  if (loading || detail === null) {
    return (
      <div className="dtable-expanded-panel row gap-2" style={{ alignItems: 'center' }}>
        <span className="spinner" aria-hidden="true" />
        <span className="t-helper">Loading {row.filename}...</span>
      </div>
    );
  }

  if (detail.proposed && detail.status !== 'live' && detail.status !== 'deleted') {
    return (
      <div className="dtable-expanded-panel">
        <ReviewPanel
          detail={detail}
          busy={busy}
          houses={houses}
          isProjectAdmin={isProjectAdmin}
          currentUserHouseId={currentUserHouseId}
          onChange={onChange}
          onApprove={onApprove}
          onReject={onReject}
          onClose={onClose}
        />
      </div>
    );
  }

  return (
    <div className="dtable-expanded-panel col gap-4">
      <div className="row gap-2 between">
        <span className="t-h2">
          {detail.status === 'live' ? 'Live document' : 'Removed document'}:{' '}
          {detail.proposed?.title ?? detail.intakeId}
        </span>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          {detail.status === 'live' && (
            <DeleteDocumentControl
              intakeId={detail.intakeId}
              title={detail.proposed?.title ?? detail.intakeId}
              onDeleted={onDeleted}
            />
          )}
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
      </div>
      {detail.status === 'deleted' && (
        <Notification
          kind="warning"
          title="Removed from the knowledge base"
          testId="kb-deleted-note"
        >
          This document&apos;s chunks were deleted. The metrics below are kept for reference.
        </Notification>
      )}
      {detail.metrics ? (
        <IntakeMetricsPanel
          intakeId={detail.intakeId}
          status={detail.status}
          metrics={detail.metrics}
          chunks={detail.chunks}
        />
      ) : (
        <span className="t-helper">No pipeline metrics recorded for this document.</span>
      )}
    </div>
  );
}

function ReviewPanel({
  detail,
  busy,
  houses,
  isProjectAdmin,
  currentUserHouseId,
  onChange,
  onApprove,
  onReject,
  onClose,
}: {
  detail: IntakeDetail;
  busy: boolean;
  houses: HouseOption[];
  isProjectAdmin: boolean;
  currentUserHouseId: string;
  onChange: (proposed: NonNullable<IntakeDetail['proposed']>) => void;
  onApprove: (finalProposed: NonNullable<IntakeDetail['proposed']>) => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const p = detail.proposed!;
  const set = (patch: Partial<typeof p>) => onChange({ ...p, ...patch });

  // Seed house scope once per document (see useHouseScopeDefault): the operator's
  // last-saved selection, or their own house (Harnwell for a Project Admin) if
  // nothing is saved yet. Deliberately overrides whatever Claude guessed.
  useHouseScopeDefault({
    intakeId: detail.intakeId,
    isProjectAdmin,
    currentUserHouseId,
    onChange: (houseScope) => set({ houseScope }),
  });

  // Deletion is a soft mark, not a splice: a deleted chunk stays in p.items
  // (and can be un-deleted) so it's tracked by its position in that array,
  // not removed from it. Items carry no stable id from the pipeline, so
  // content edits are still keyed by object identity against p.items.
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());
  const toggleDeleted = (idx: number) =>
    setDeletedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  // Only one group's full-page view is open at a time -- opening the other
  // closes this one, same as the pipeline-log / chunks-committed panels below.
  const [expandedGroup, setExpandedGroup] = useState<'durable' | 'dated' | null>(null);

  const indexed = p.items.map((item, idx) => ({ item, idx }));
  const durable = indexed.filter(({ item }) => item.kind === 'durable_rule');
  const dated = indexed.filter(({ item }) => item.kind === 'dated_announcement');
  const leave = p.items.filter((i) => i.kind === 'structured_leave');

  const updateItem = (target: (typeof p.items)[number], content: string) =>
    onChange({ ...p, items: p.items.map((it) => (it === target ? { ...it, content } : it)) });

  const handleApprove = () =>
    onApprove({ ...p, items: p.items.filter((_, idx) => !deletedIndices.has(idx)) });

  return (
    <Card pad data-testid="kb-review-panel">
      <div className="col gap-4">
        <div className="row gap-2 between">
          <span className="t-h2">Review: {p.title}</span>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>

        <div className="col gap-3">
          <Field label="Title">
            <TextInput value={p.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Source reference">
            <TextInput value={p.sourceRef} onChange={(e) => set({ sourceRef: e.target.value })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <span className="t-label">House scope</span>
              <HouseScopePicker
                value={p.houseScope}
                houses={houses}
                onChange={(houseScope) => set({ houseScope })}
              />
              <span className="t-helper">Uncheck houses this document should not apply to</span>
            </div>
            <Field label="Sensitivity">
              <Select
                value={p.sensitivity}
                onChange={(e) => set({ sensitivity: e.target.value as typeof p.sensitivity })}
              >
                <option value="general">general</option>
                <option value="internal">internal</option>
                <option value="restricted">restricted</option>
              </Select>
            </Field>
          </div>
        </div>

        <ItemGroup
          id="durable"
          title={`Durable rules (${durable.length}), indexed as timeless`}
          items={durable}
          deletedIndices={deletedIndices}
          onUpdate={updateItem}
          onToggleDeleted={toggleDeleted}
          expandedGroup={expandedGroup}
          setExpandedGroup={setExpandedGroup}
        />
        <ItemGroup
          id="dated"
          title={`Dated announcements (${dated.length}), indexed with an expiry window`}
          items={dated}
          deletedIndices={deletedIndices}
          onUpdate={updateItem}
          onToggleDeleted={toggleDeleted}
          expandedGroup={expandedGroup}
          setExpandedGroup={setExpandedGroup}
          groupByDate
        />
        {leave.length > 0 ? (
          <div
            className="col gap-2"
            data-testid="kb-leave-note"
            style={{
              background: 'var(--st-pending-bg)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
            }}
          >
            <span className="t-body">
              <strong>{leave.length} leave item(s) not indexed.</strong> Enter these via the Housing
              Manager leave path so duty resolution honors them:
            </span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {leave.map((i, k) => (
                <li key={k} className="t-helper">
                  {i.content}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {p.representations?.deIdentifiedLesson ? (
          <div
            className="col gap-1"
            style={{
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
            }}
          >
            <span className="t-body">
              <strong>De-identified lesson (indexed):</strong>{' '}
              {p.representations.deIdentifiedLesson}
            </span>
            <span className="t-helper">The raw incident record is never indexed.</span>
          </div>
        ) : null}

        {detail.metrics ? (
          <div className="col gap-2">
            <span className="t-h3">Pipeline metrics so far</span>
            <IntakeMetricsPanel
              intakeId={detail.intakeId}
              status={detail.status}
              metrics={detail.metrics}
              chunks={detail.chunks}
            />
          </div>
        ) : null}

        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          <Button kind="danger" onClick={onReject} disabled={busy}>
            Reject
          </Button>
          <Button kind="primary" onClick={handleApprove} disabled={busy} data-testid="kb-approve">
            {busy ? 'Approving...' : 'Approve and index'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type ProposedItem = NonNullable<IntakeDetail['proposed']>['items'][number];
type IndexedItem = { item: ProposedItem; idx: number };

type GroupId = 'durable' | 'dated';

// The proposer resolves window dates as absolute YYYY-MM-DD; render that as a
// short human date rather than raw ISO. Parsed as UTC so the calendar day
// never shifts under a non-UTC local timezone.
function formatUntilDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// Many dated announcements share the same expiry (e.g. a dozen summer programs
// all "through Aug 7"). Bucketing by that date lets the date live once, on the
// bucket, instead of repeating an identical chip on every single card.
function buildDateGroups(
  items: IndexedItem[],
): Array<{ key: string; until: string | null; entries: IndexedItem[] }> {
  const map = new Map<string, IndexedItem[]>();
  for (const entry of items) {
    const key = entry.item.window.effectiveUntil ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entries]) => ({ key, until: key === '' ? null : key, entries }));
}

function ItemGroup({
  id,
  title,
  items,
  deletedIndices,
  onUpdate,
  onToggleDeleted,
  groupByDate,
  expandedGroup,
  setExpandedGroup,
}: {
  id: GroupId;
  title: string;
  items: IndexedItem[];
  deletedIndices: Set<number>;
  onUpdate: (item: ProposedItem, content: string) => void;
  onToggleDeleted: (idx: number) => void;
  groupByDate?: boolean;
  expandedGroup: GroupId | null;
  setExpandedGroup: (id: GroupId | null) => void;
}) {
  // Groups start collapsed -- a long proposal shouldn't force a scroll past
  // rules the operator hasn't asked to see yet.
  const [collapsed, setCollapsed] = useState(true);
  if (items.length === 0) return null;
  const expanded = expandedGroup === id;
  const showFull = expanded || !collapsed;

  const chunkCard = ({ item, idx }: IndexedItem, index: number) => (
    <ChunkCard
      key={idx}
      index={index}
      item={item}
      deleted={deletedIndices.has(idx)}
      onSave={(content) => onUpdate(item, content)}
      onToggleDeleted={() => onToggleDeleted(idx)}
    />
  );

  let running = 0;
  const fullContent = groupByDate ? (
    <div className="kb-date-group-list">
      {buildDateGroups(items).map((group) => (
        <div className="kb-date-group" key={group.key}>
          <div className="kb-date-group-head">
            <Icon name="clock" size={13} />
            <span>{group.until ? `Until ${formatUntilDate(group.until)}` : 'No expiry set'}</span>
            <span className="kb-date-group-count">{group.entries.length}</span>
          </div>
          <div className="kb-chunk-list">
            {group.entries.map((entry) => chunkCard(entry, ++running))}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="kb-chunk-list">{items.map((entry, n) => chunkCard(entry, n + 1))}</div>
  );

  return (
    <>
      {expanded && <div className="kb-panel-backdrop" onClick={() => setExpandedGroup(null)} />}
      <div className={`kb-group ${expanded ? 'is-expanded' : ''}`.trim()}>
        <div className="kb-group-toprow">
          <button
            type="button"
            className="kb-group-header"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
          >
            <span className="kb-group-title">{title}</span>
          </button>
          <IconButton
            icon={expanded ? 'collapse' : 'expand'}
            label={expanded ? 'Minimize' : 'Expand to full page'}
            onClick={() => setExpandedGroup(expanded ? null : id)}
          />
        </div>
        {showFull ? (
          fullContent
        ) : (
          <div className="kb-group-preview">
            {chunkCard(items[0], 1)}
            {items.length > 1 && (
              // Goes straight to the full-page view rather than un-collapsing
              // inline -- an inline list of dozens of chunks just becomes more
              // scrolling in the same cramped space; the full-page view is the
              // one place built to actually read through them.
              <button type="button" className="kb-group-more" onClick={() => setExpandedGroup(id)}>
                <Icon name="expand" size={14} />
                <span>Show {items.length - 1} more</span>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ChunkCard({
  index,
  item,
  deleted,
  onSave,
  onToggleDeleted,
}: {
  index: number;
  item: ProposedItem;
  deleted: boolean;
  onSave: (content: string) => void;
  onToggleDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  // Approval here is a lightweight per-chunk review mark for the operator's
  // own tracking while working through a long proposal -- untouched and
  // approved chunks both index the same on "Approve and index" below. Only
  // `deleted` (the panel-level soft-delete set, toggled by this card's trash
  // button) actually excludes a chunk from what gets indexed.
  const [approved, setApproved] = useState(false);

  return (
    <div
      className={`kb-chunk-card ${deleted ? 'is-deleted' : approved ? 'is-approved' : ''}`.trim()}
      data-testid="kb-chunk-card"
    >
      <div className="kb-chunk-card-head">
        <div className="kb-chunk-head-tags">
          <span className="kb-chunk-index">{index}</span>
          {deleted ? (
            <Tag kind="red" icon="trash">
              Deleted
            </Tag>
          ) : approved ? (
            <Tag kind="green" icon="checkCircle">
              Approved
            </Tag>
          ) : null}
        </div>
        <div className="kb-chunk-actions">
          <IconButton
            className="icon-btn-sm"
            size={14}
            icon="check"
            label={approved ? 'Unapprove chunk' : 'Approve chunk'}
            active={approved}
            onClick={() => setApproved((a) => !a)}
          />
          <div className="kb-chunk-actions-group">
            <IconButton
              className="icon-btn-sm"
              size={14}
              icon="edit"
              label={editing ? 'Stop editing chunk' : 'Edit chunk'}
              active={editing}
              onClick={() => {
                if (!editing) setDraft(item.content);
                setEditing((e) => !e);
              }}
            />
            <IconButton
              className="icon-btn-sm"
              size={14}
              icon="trash"
              label={deleted ? 'Restore chunk' : 'Delete chunk'}
              active={deleted}
              onClick={onToggleDeleted}
            />
          </div>
        </div>
      </div>

      {editing ? (
        <div className="col gap-2">
          <TextArea value={draft} rows={4} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <Button kind="tertiary" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              kind="secondary"
              size="sm"
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="kb-chunk-text">{item.content}</p>
      )}
    </div>
  );
}
