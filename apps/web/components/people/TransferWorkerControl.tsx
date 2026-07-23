'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { transferWorker } from '../../lib/actions/people';
import { Button, Field, Modal, Notification, Select, TextInput } from '../ui';

// Per-row "Transfer" control on /admin/people (house transfers, migration
// 20260719000001). Either the source or the destination house's HM/BM (or an
// admin) may move a worker; the action + RPC re-check authoritatively. The page
// already gates isHouseAdmin.
//
// Timing:
//   * "When the next season starts" (default) — records the move; the worker keeps
//     working their current house until the boundary, when the daily job applies it.
//   * "Immediately" — flips their home house now and reopens their old-house shifts.
//   * "On a specific date" — same as immediate if today, else scheduled for that day.
//
// Mirrors the HireWorkerControl client pattern (useRouter + Modal testId +
// data-testid controls + router.refresh on success).

type House = { id: string; name: string };
type Timing = 'season' | 'now' | 'date';

function prettifyHouse(id: string, houses: House[]): string {
  return houses.find((h) => h.id === id)?.name ?? id;
}

export function TransferWorkerControl({
  userId,
  name,
  currentHouseId,
  houses,
}: {
  userId: string;
  name: string;
  currentHouseId: string;
  houses: House[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const others = houses.filter((h) => h.id !== currentHouseId);
  const [dest, setDest] = useState<string>(others[0]?.id ?? '');
  const [timing, setTiming] = useState<Timing>('season');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');

  function reset() {
    setDest(others[0]?.id ?? '');
    setTiming('season');
    setDate('');
    setNote('');
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const effectiveDate = timing === 'season' ? null : timing === 'now' ? 'now' : date;
    const res = await transferWorker({
      userId,
      destHouseId: dest,
      effectiveDate,
      note: note || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    const to = prettifyHouse(res.data.toHouse, houses);
    setDone(
      res.data.appliedNow
        ? `${name} now belongs to ${to}.`
        : `${name} will move to ${to} on ${res.data.effectiveDate}.`,
    );
    reset();
    router.refresh();
  }

  const canSubmit = dest !== '' && (timing !== 'date' || date !== '');

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        icon="arrowRight"
        data-testid={`people-transfer-${userId}`}
        disabled={busy}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Transfer
      </Button>

      {done !== null && (
        <Notification kind="success" title="Worker transferred" testId="transfer-success">
          {done}
        </Notification>
      )}

      {open && (
        <Modal
          testId="transfer-form"
          eyebrow="Transfer worker"
          title={`Transfer ${name}`}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <Button
                kind="secondary"
                data-testid="transfer-cancel"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                kind="primary"
                icon="arrowRight"
                data-testid="transfer-submit"
                disabled={busy || !canSubmit}
                onClick={run}
              >
                {busy ? 'Transferring…' : 'Transfer worker'}
              </Button>
            </>
          }
        >
          <p className="t-meta" style={{ marginTop: 0, marginBottom: 12 }}>
            {name} currently belongs to <b>{prettifyHouse(currentHouseId, houses)}</b>. They keep
            working there until the transfer takes effect; only their preferences and the upcoming
            season’s roster follow them to the new house before then.
          </p>

          <Field label="Move to" htmlFor="transfer-dest">
            <Select
              id="transfer-dest"
              data-testid="transfer-dest"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
            >
              {others.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="When" htmlFor="transfer-when">
            <Select
              id="transfer-when"
              data-testid="transfer-when"
              value={timing}
              onChange={(e) => setTiming(e.target.value as Timing)}
            >
              <option value="season">When the next season starts (recommended)</option>
              <option value="now">Immediately</option>
              <option value="date">On a specific date</option>
            </Select>
          </Field>

          {timing === 'date' && (
            <Field label="Effective date" htmlFor="transfer-date">
              <TextInput
                id="transfer-date"
                type="date"
                data-testid="transfer-date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          )}

          <Field label="Note (optional)" htmlFor="transfer-note">
            <TextInput
              id="transfer-note"
              data-testid="transfer-note"
              value={note}
              placeholder="Reason for the move"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {(timing === 'now' || timing === 'date') && (
            <p className="t-meta" style={{ marginTop: 4 }}>
              Applying the move reopens the worker’s future shifts at their old house for others to
              pick up.
            </p>
          )}

          {error !== null && (
            <Notification kind="error" title="Could not transfer worker" testId="transfer-error">
              {error}
            </Notification>
          )}
        </Modal>
      )}
    </>
  );
}
