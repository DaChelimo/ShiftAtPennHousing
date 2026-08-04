// Standalone export of the schedule builder's Phase 2 grid — a self-contained HTML
// document (inline CSS, no external assets) rendering exactly what the builder shows:
// one row per time-of-day, one column per weekday, worker names in their assigned
// cells. Used for both the "Download HTML" and "Print / Save as PDF" actions (the PDF
// path prints this same markup via the browser, so the two exports never drift).
//
// Deliberately NOT a screenshot of the interactive builder DOM: that would carry along
// drag handles, hover borders, and app chrome that only make sense in-app. This is a
// dedicated presentation layout, closer to what a student manager would hand out or
// paste into slides — same idea as the "Final Schedule.xlsx" contact-table footer.

import type { BuilderBlock } from '../data/scheduleBuilder';
import { workerColor, workerContrastText } from '../workerColor';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function shortDateLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

// '18:00' -> '6:00 PM'; ':00' minutes collapse to '6 PM' for a cleaner rail.
function friendlyTime(timeLabel24h: string): string {
  const [hStr, minStr] = timeLabel24h.split(':');
  const h = Number(hStr);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return minStr === '00' ? `${String(h12)} ${period}` : `${String(h12)}:${minStr} ${period}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type ScheduleExportParams = {
  houseLabel: string;
  weekStartDate: string | null; // 'YYYY-MM-DD', NY wall date (Monday)
  blocks: BuilderBlock[];
  drafts: Record<string, string[]>; // blockId -> [userId]
  workerName: (userId: string) => string;
  generatedAtLabel: string; // e.g. "Generated Jul 23, 2026, 4:03 PM"
};

// Renders one complete <html> document as a string.
export function buildScheduleExportHtml(params: ScheduleExportParams): string {
  const { houseLabel, weekStartDate, blocks, drafts, workerName, generatedAtLabel } = params;

  const dayKeys =
    weekStartDate === null ? [] : Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));

  // Unique time-of-day rows, ascending, keyed by the HHMM cell suffix.
  const timeKeys = [...new Set(blocks.map((b) => b.timeKey))].sort();
  const byCell = new Map<string, BuilderBlock>();
  for (const b of blocks) byCell.set(b.cellKey, b);

  const assignedUserIds = new Set<string>();
  for (const ids of Object.values(drafts)) for (const id of ids) assignedUserIds.add(id);
  const roster = [...assignedUserIds].sort((a, b) => workerName(a).localeCompare(workerName(b)));

  const headerCells = dayKeys
    .map(
      (dayKey, i) =>
        `<th><div class="dow">${DAY_LABELS[i]}</div><div class="date">${shortDateLabel(dayKey)}</div></th>`,
    )
    .join('');

  const bodyRows = timeKeys
    .map((timeKey) => {
      const sample = blocks.find((b) => b.timeKey === timeKey);
      const timeLabel = sample === undefined ? timeKey : friendlyTime(sample.timeLabel);
      const cells = dayKeys
        .map((dayKey) => {
          const cellKey = `${dayKey}-${timeKey}`;
          const block = byCell.get(cellKey);
          if (block === undefined) return '<td class="cell cell-none"></td>';
          const ids = drafts[block.blockId] ?? [];
          if (ids.length === 0) return '<td class="cell cell-open">Open</td>';
          const pills = ids
            .map((id) => {
              const color = workerColor(id);
              const text = workerContrastText(id);
              return `<span class="pill" style="background:${color};color:${text}">${escapeHtml(
                workerName(id),
              )}</span>`;
            })
            .join('');
          return `<td class="cell cell-filled">${pills}</td>`;
        })
        .join('');
      return `<tr><th class="time">${timeLabel}</th>${cells}</tr>`;
    })
    .join('');

  const legend = roster
    .map((id) => {
      const color = workerColor(id);
      return `<span class="legend-item"><span class="dot" style="background:${color}"></span>${escapeHtml(
        workerName(id),
      )}</span>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(houseLabel)} weekly schedule</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    margin: 32px;
    color: #1a1a1a;
    background: #fff;
  }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .subtitle { color: #666; font-size: 13px; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  thead th { background: #f4f4f5; font-size: 13px; }
  thead th .dow { font-weight: 600; }
  thead th .date { color: #888; font-weight: 400; font-size: 12px; }
  th.time {
    width: 78px;
    font-weight: 400;
    color: #666;
    font-size: 12px;
    white-space: nowrap;
    background: #fafafa;
  }
  td.cell { height: 30px; font-size: 12px; }
  td.cell-none { background: repeating-linear-gradient(45deg, #f7f7f7, #f7f7f7 4px, #efefef 4px, #efefef 8px); }
  td.cell-open { color: #b45309; font-style: italic; }
  .pill {
    display: block;
    border-radius: 4px;
    padding: 2px 6px;
    margin-bottom: 2px;
    font-weight: 600;
    font-size: 11.5px;
  }
  .legend { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 12px 20px; }
  .legend-item { font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .footer { margin-top: 24px; color: #999; font-size: 11px; }
  @media print {
    body { margin: 12px; }
    @page { size: landscape; margin: 10mm; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(houseLabel)} weekly schedule</h1>
  <p class="subtitle">Week of ${weekStartDate ?? 'unknown'} &middot; ${escapeHtml(generatedAtLabel)}</p>
  <table>
    <thead><tr><th class="time"></th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="legend">${legend}</div>
  <p class="footer">Exported from SHIFT. This is a snapshot, not a live view.</p>
</body>
</html>`;
}
