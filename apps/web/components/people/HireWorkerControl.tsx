'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { type AppRole, hireWorker } from '../../lib/actions/people';
import { Button, Field, Modal, Notification, Select, TextInput } from '../ui';

// T2-6 — the "Hire worker" control on /admin/people (BSpec §4.5 "Hiring"). The page
// already gates isHouseAdmin (HM/BM-only). Clicking opens a form modal (name, email,
// initial role, optional phone); confirm calls the hireWorker action, which creates
// the auth user + app rows atomically and scopes the hire to the caller's house.
// On success the roster refreshes so the new (active) row appears.
//
// Mirrors the FireWorkerControl client pattern (useRouter + Modal testId +
// data-testid controls + router.refresh on success).
const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'sw', label: 'Student Worker (SW)' },
  { value: 'sm', label: 'Student Manager (SM)' },
  { value: 'hm', label: 'Housing Manager (HM)' },
  { value: 'rsm', label: 'Residential Services Manager (RSM)' },
  { value: 'bm', label: 'Building Manager (BM)' },
];

export function HireWorkerControl({ houseName }: { houseName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('sw');
  const [phone, setPhone] = useState('');

  function reset() {
    setName('');
    setEmail('');
    setRole('sw');
    setPhone('');
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const res = await hireWorker({ name, email, role, phone: phone || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setDone(res.data.name);
    reset();
    // Refresh so the new active row appears in the roster.
    router.refresh();
  }

  return (
    <>
      <Button
        icon="add"
        data-testid="people-hire-open"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Hire worker
      </Button>

      {done !== null && (
        <Notification kind="success" title="Worker hired" testId="hire-success">
          {done} has been added to {houseName} and can sign in now.
        </Notification>
      )}

      {open && (
        <Modal
          testId="hire-form"
          eyebrow="Hire worker"
          title={`Hire a worker at ${houseName}`}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <Button
                kind="secondary"
                data-testid="hire-cancel"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                kind="primary"
                icon="add"
                data-testid="hire-submit"
                disabled={busy || name.trim() === '' || email.trim() === ''}
                onClick={run}
              >
                {busy ? 'Hiring…' : 'Hire worker'}
              </Button>
            </>
          }
        >
          <p className="t-meta" style={{ marginTop: 0, marginBottom: 12 }}>
            The new hire starts with no assigned shifts and is active immediately. They acquire
            shifts through schedule assignment, permanent pickup, weekly claims, and floats.
          </p>

          <Field label="Full name" htmlFor="hire-name">
            <TextInput
              id="hire-name"
              data-testid="hire-name"
              value={name}
              placeholder="Jordan Lee"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Email" htmlFor="hire-email">
            <TextInput
              id="hire-email"
              type="email"
              data-testid="hire-email"
              value={email}
              placeholder="jordan.lee@shiftatpenn.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Initial role" htmlFor="hire-role">
            <Select
              id="hire-role"
              data-testid="hire-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Phone (optional)" htmlFor="hire-phone">
            <TextInput
              id="hire-phone"
              type="tel"
              data-testid="hire-phone"
              value={phone}
              placeholder="(215) 555-0123"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>

          {error !== null && (
            <Notification kind="error" title="Could not hire worker" testId="hire-error">
              {error}
            </Notification>
          )}
        </Modal>
      )}
    </>
  );
}
