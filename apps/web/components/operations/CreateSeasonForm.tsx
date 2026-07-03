'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createSeason } from '../../lib/actions/operatingSeasons';
import { Button, Card, Field, Notification, TextInput } from '../ui';

// Turn a human name into a legal slug: lowercase, alnum runs joined by single
// underscores, no leading/trailing underscore. "Summer 2026" -> "summer_2026".
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function CreateSeasonForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState({
    seasonName: '',
    slug: '',
    startDate: '',
    endDate: '',
    hoursCap: 40,
    capEnforcement: 'hard' as 'soft' | 'hard',
    shiftStartBound: '08:00',
    shiftEndBound: '00:00',
  });

  function setName(seasonName: string) {
    setForm((f) => ({
      ...f,
      seasonName,
      slug: slugTouched ? f.slug : slugify(seasonName),
    }));
  }

  async function submit() {
    if (
      form.seasonName.trim() === '' ||
      form.slug.trim() === '' ||
      form.startDate === '' ||
      form.endDate === ''
    ) {
      setError('Name, slug, and both dates are required.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createSeason(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/admin/operations/${result.data.seasonId}`);
  }

  return (
    <Card pad>
      <div className="col gap-5">
        <div className="col gap-1">
          <h2 className="t-h2">Create a season</h2>
          <p className="t-helper">
            A season is a date range with its own rules. After creating it you set which houses are
            open when, their staffing, and when floating is allowed.
          </p>
        </div>

        {error !== null && (
          <Notification kind="error" title="Could not create season">
            {error}
          </Notification>
        )}

        <div className="col gap-4" style={{ maxWidth: 560 }}>
          <div className="row gap-4 wrap">
            <div style={{ flex: 2, minWidth: 220 }}>
              <Field label="Season name" helper="Shown to managers, e.g. Summer 2026">
                <TextInput
                  value={form.seasonName}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Summer 2026"
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label="Slug" helper="Internal id">
                <TextInput
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm({ ...form, slug: e.target.value });
                  }}
                  placeholder="summer_2026"
                />
              </Field>
            </div>
          </div>

          <div className="row gap-4 wrap">
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label="Start date">
                <TextInput
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label="End date">
                <TextInput
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </Field>
            </div>
          </div>

          <div className="row gap-4 wrap" style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 120 }}>
              <Field label="Weekly hours cap">
                <TextInput
                  type="number"
                  value={String(form.hoursCap)}
                  onChange={(e) => setForm({ ...form, hoursCap: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Cap enforcement">
              <div className="seg" role="group">
                <button
                  type="button"
                  className={`seg-btn${form.capEnforcement === 'soft' ? ' is-on' : ''}`}
                  onClick={() => setForm({ ...form, capEnforcement: 'soft' })}
                >
                  Soft
                </button>
                <button
                  type="button"
                  className={`seg-btn${form.capEnforcement === 'hard' ? ' is-on' : ''}`}
                  onClick={() => setForm({ ...form, capEnforcement: 'hard' })}
                >
                  Hard
                </button>
              </div>
            </Field>
          </div>

          <div className="row gap-4 wrap">
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label="Desk opens">
                <TextInput
                  type="time"
                  value={form.shiftStartBound}
                  onChange={(e) => setForm({ ...form, shiftStartBound: e.target.value })}
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Field label="Desk closes" helper="00:00 means midnight (end of day)">
                <TextInput
                  type="time"
                  value={form.shiftEndBound}
                  onChange={(e) => setForm({ ...form, shiftEndBound: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="row">
          <Button icon="add" onClick={submit} disabled={busy}>
            {busy ? 'Creating.' : 'Create season'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
