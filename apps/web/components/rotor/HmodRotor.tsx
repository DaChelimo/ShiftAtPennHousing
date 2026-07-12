'use client';

import { useState } from 'react';

import { saveRotor } from '../../lib/actions/rotor';
import type { RotorCandidate, RotorWeek } from '../../lib/data/rotor';
import { Button, Card, EmptyState, Icon, Notification, Select } from '../ui';

export function HmodRotor({
  weeks,
  candidates,
  assignments,
}: {
  weeks: RotorWeek[];
  candidates: RotorCandidate[];
  assignments: Record<string, string>;
}) {
  const [selection, setSelection] = useState<Record<string, string>>(assignments);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const entries = Object.entries(selection)
      .filter(([, hmodUserId]) => hmodUserId !== '')
      .map(([weekStartDate, hmodUserId]) => ({ weekStartDate, hmodUserId }));
    const res = await saveRotor({ entries });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
  }

  if (weeks.length === 0) {
    return (
      <Card pad>
        <EmptyState
          tone="neutral"
          icon="calendar"
          title="No active semester"
          desc="There is no scheduling period to plan a rotor for yet."
        />
      </Card>
    );
  }

  return (
    <div className="col gap-4">
      <Card>
        <div className="dtable-wrap">
          <table data-testid="rotor-grid" className="dtable">
            <thead>
              <tr>
                <th>Week</th>
                <th>HMOD on duty</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.weekStartDate}>
                  <td>
                    <span className="cell-name">
                      <b>{week.label}</b>
                      <span className="cell-sub">Friday 08:00 handoff</span>
                    </span>
                  </td>
                  <td>
                    <Select
                      data-testid={`rotor-select-${week.weekStartDate}`}
                      aria-label={`HMOD for ${week.label}`}
                      value={selection[week.weekStartDate] ?? ''}
                      onChange={(e) => {
                        setSaved(false);
                        setSelection((prev) => ({ ...prev, [week.weekStartDate]: e.target.value }));
                      }}
                    >
                      <option value="">Unassigned</option>
                      {candidates.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {error !== null && (
        <Notification kind="error" title="Could not save" testId="rotor-error">
          {error}
        </Notification>
      )}

      <div className="row gap-3 center">
        <Button data-testid="rotor-save" onClick={onSave} disabled={saving} icon="check">
          {saving ? 'Saving…' : 'Save rotor'}
        </Button>
        {saved && (
          <span
            data-testid="rotor-saved"
            className="row gap-1 center"
            style={{ color: 'var(--success)', fontSize: 13, fontWeight: 500 }}
          >
            <Icon name="checkCircle" size={16} />
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}
