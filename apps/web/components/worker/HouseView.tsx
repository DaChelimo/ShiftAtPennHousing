'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { HouseViewBoard } from '../../lib/data/worker/house';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Field, Select } from '../ui/Field';
import { PageHead } from '../ui/PageHead';
import { Tag } from '../ui/Tag';

export function HouseView({ board }: { board: HouseViewBoard }) {
  const pathname = usePathname();

  const dayHref = (offset: number): string =>
    `${pathname}?house=${encodeURIComponent(board.selectedHouseId)}&d=${String(offset)}`;

  // A client navigation that preserves the day when the house changes.
  function onHouseChange(houseId: string): void {
    window.location.href = `${pathname}?house=${encodeURIComponent(houseId)}&d=${String(board.dayOffset)}`;
  }

  return (
    <div className="page" data-testid="house-view">
      <PageHead
        eyebrow="House schedule"
        title={board.selectedHouseName}
        sub="See who is on the desk at any house. This view is read only."
        actions={
          board.deskPhone ? (
            <a className="btn btn-secondary btn-md" href={`tel:${board.deskPhone}`} data-testid="house-call-desk">
              Call the desk
            </a>
          ) : undefined
        }
      />

      <Field label="House">
        <Select
          value={board.selectedHouseId}
          data-testid="house-switcher"
          onChange={(e) => onHouseChange(e.target.value)}
        >
          {board.houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      </Field>

      <div className="week-header" data-testid="house-day-nav">
        <Link href={dayHref(board.dayOffset - 1)} className="icon-btn" aria-label="Previous day">
          &lsaquo;
        </Link>
        <span className="t-body" data-testid="house-date-label">
          {board.dateLabel}
        </span>
        <Link href={dayHref(board.dayOffset + 1)} className="icon-btn" aria-label="Next day">
          &rsaquo;
        </Link>
      </div>

      {board.rows.length === 0 ? (
        <EmptyState icon="calendar" title="Nothing scheduled" desc="No shifts at this house on this day." />
      ) : (
        <div className="house-grid-wrap">
          <div className="col gap-2" data-testid="house-agenda">
            {board.rows.map((r) => (
              <Card key={r.id} pad data-testid={`house-row-${r.id}`}>
                <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="t-body">{r.timeLabel}</span>
                  {r.vacant ? (
                    <Tag kind="gray">Open</Tag>
                  ) : (
                    <span className="row gap-2" style={{ alignItems: 'center' }}>
                      <span className="t-helper">{r.workerName}</span>
                      {r.isFloat && <Tag kind="purple">Float</Tag>}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
