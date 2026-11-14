import { INPUT_LIMITS, InputError } from '../security/input';
import type { DatasetRead } from './schema';
import type { RawRecord } from './tokenize';
import { reportIssue, type Diagnostic } from './report';

export function shapeRecords(records: RawRecord[], read: DatasetRead, report: Diagnostic[]) {
  const remaining = records.slice(read.skipRows);
  const header = read.header === 'first-row' ? remaining.shift()?.cells ?? [] : [];
  const width = remaining.reduce((maximum, record) => Math.max(maximum, record.cells.length), header.length);
  if (remaining.length * width > INPUT_LIMITS.datasetCells) throw new InputError('data_cells', 'The padded table would exceed 1,000,000 cells. Reduce the rows or columns.');
  let rows = remaining.filter(record => {
    if (record.cells.every(cell => !cell.trim())) { reportIssue(report, 'blank_row', 'Blank row removed.', record.row); return false; }
    return true;
  }).map(record => {
    if (record.cells.length !== width) reportIssue(report, 'ragged_row', 'Ragged row padded with missing cells.', record.row);
    return { row: record.row, cells: Array.from({ length: width }, (_, index) => record.cells[index] ?? '') };
  });
  let headers = header;
  if (read.transpose) {
    const matrix = header.length ? [header, ...rows.map(row => row.cells)] : rows.map(row => row.cells);
    const transposed = Array.from({ length: width }, (_, index) => matrix.map(row => row[index] ?? ''));
    headers = read.header === 'first-row' ? transposed.shift() ?? [] : [];
    rows = transposed.map((cells, index) => ({ row: index + 1, cells }));
  }
  const columns = rows[0]?.cells.length ?? headers.length;
  if (!columns || !rows.length) throw new InputError('empty_data', 'The table contains no data rows.');
  if (rows.length > INPUT_LIMITS.datasetRows || columns > INPUT_LIMITS.datasetColumns || rows.length * columns > INPUT_LIMITS.datasetCells)
    throw new InputError('data_shape', 'The table exceeds the supported row, column or cell limit.');
  const used = new Set<string>();
  const names = Array.from({ length: columns }, (_, index) => {
    const original = headers[index]?.trim() ?? '', base = original || `Column ${index + 1}`;
    let name = base, suffix = 2;
    while (used.has(name)) name = `${base} (${suffix++})`;
    used.add(name);
    if (!original || name !== original) reportIssue(report, 'renamed_header', `Header renamed to ${name.slice(0, 100)}.`);
    if (name.length > INPUT_LIMITS.textLength) throw new InputError('data_header', 'A column name exceeds the text limit.');
    return name;
  });
  return { names, rows };
}
