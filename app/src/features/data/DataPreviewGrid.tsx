import { useRef, useState } from 'react';
import type { TypedTable } from '../../domain/data/dataset';
import { dataText as d, type Locale } from '../../i18n/messages';

export function DataPreviewGrid({ table, locale }: { table: TypedTable; locale: Locale }) {
  const [start, setStart] = useState(0), visible = table.rows.slice(start, start + 20);
  const ref = useRef<HTMLDivElement>(null), [cell, setCell] = useState({row: 0, column: 0});
  return <div ref={ref} className="data-preview-scroll" onScroll={event => setStart(Math.max(0, Math.min(table.rows.length - 20, Math.floor(event.currentTarget.scrollTop / 30))))} onKeyDown={event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const row = Math.max(0, Math.min(table.rows.length - 1, cell.row + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
    const column = Math.max(0, Math.min(table.columns.length - 1, event.key === 'Home' ? 0 : event.key === 'End' ? table.columns.length - 1 : cell.column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)));
    setCell({row, column}); if (row < start || row >= start + 20) { const next = Math.max(0, row - 10); setStart(next); if (ref.current) ref.current.scrollTop = next * 30; }
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-cell="${row},${column}"]`)?.focus());
  }}>
    <table role="grid" aria-label={d(locale, 'tablePreview')} aria-rowcount={table.rows.length + 1} aria-colcount={table.columns.length + 1}>
      <thead><tr><th>{d(locale, 'sourceRows')}</th>{table.columns.map((column, index) => <th key={column.key}>{column.name}<small>{d(locale, column.type)} · {d(locale, 'excluded')}: {table.report.filter(entry => entry.code === `missing_${index}` || entry.code === `invalid_${index}`).reduce((sum, entry) => sum + entry.count, 0)}</small></th>)}</tr></thead>
      <tbody>
        {start > 0 && <tr aria-hidden="true"><td colSpan={table.columns.length + 1} style={{ height: start * 30, padding: 0 }} /></tr>}
        {visible.map((row, offset) => <tr key={row.row} aria-rowindex={start + offset + 2}><th>{row.row}</th>{row.cells.map((value, index) => <td key={index} data-cell={`${start + offset},${index}`} tabIndex={cell.row === start + offset && cell.column === index ? 0 : -1} onFocus={() => setCell({row: start + offset, column: index})} data-state={value.state} title={value.state === 'value' ? undefined : d(locale, value.reason)}>{(row.raw[index]?.length ?? 0) > 200 ? row.raw[index]!.slice(0, 199) + String.fromCharCode(0x2026) : row.raw[index]}{value.state !== 'value' && <span className="visually-hidden"> {d(locale, value.reason)}</span>}</td>)}</tr>)}
        {table.rows.length - start - visible.length > 0 && <tr aria-hidden="true"><td colSpan={table.columns.length + 1} style={{ height: (table.rows.length - start - visible.length) * 30, padding: 0 }} /></tr>}
      </tbody>
    </table>
  </div>;
}
