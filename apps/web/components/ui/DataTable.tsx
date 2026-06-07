import type { ReactNode } from 'react';

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Right-aligned mono cell (counts, hours). */
  numeric?: boolean;
  render: (row: T) => ReactNode;
};

// Carbon data table convention. Presentational: the caller supplies columns +
// rows and an optional row-click handler (rows become keyboard-activatable when
// `onRowClick` is set). Sorting/filtering live in the screen, above this.
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  selectedKey,
  emptyText = 'No rows',
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  emptyText?: ReactNode;
}) {
  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <span className="t-helper">{emptyText}</span>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = getRowKey(row);
              const clickable = onRowClick != null;
              return (
                <tr
                  key={key}
                  className={`${clickable ? 'is-clickable' : ''} ${
                    selectedKey === key ? 'is-sel' : ''
                  }`.trim()}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? 'num' : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
