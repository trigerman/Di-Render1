import type { DataSource, Dataset, DatasetColumn, DatasetRead } from './schema';
import { datasetReadSchema } from './schema';
import { assertDataSourceContent, createDataSource } from './source';
import { tokenize } from './tokenize';
import { shapeRecords } from './shape';
import { inferColumns } from './inference';
import { detectRead } from './detect';
import { readCell, readNumber, type Cell } from './cells';
import { reportIssue, type Diagnostic } from './report';
import { InputError } from '../security/input';

export interface TypedTable { columns: DatasetColumn[]; rows: { row: number; raw: string[]; cells: Cell[] }[]; report: Diagnostic[] }
export interface ImportPreview { source: DataSource; read: DatasetRead; table: TypedTable; ambiguous: { row: number; raw: string; decimal: number; thousands: number }[] }
export function previewImport(text: string, settings?: DatasetRead, overrides?: DatasetColumn[], existingSource?: DataSource): ImportPreview {
  const source = existingSource ?? createDataSource(text), read = datasetReadSchema.parse(settings ?? detectRead(source.content)), report: Diagnostic[] = [];
  const shaped = shapeRecords(tokenize(source.content, read.delimiter, read), read, report);
  const inferred = inferColumns(shaped.names, shaped.rows, read, report);
  const columns = inferred.map((column, index) => ({ ...column, ...overrides?.[index], key: `c${index}`, name: shaped.names[index]! }));
  const ambiguous: ImportPreview['ambiguous'] = [];
  const rows = shaped.rows.map(row => {
    const cells = row.cells.map((raw, index) => {
      const cell = readCell(raw, columns[index]!, read);
      if (cell.state !== 'value') reportIssue(report, `${cell.state}_${index}`, `${columns[index]!.name.slice(0, 100)}: ${cell.reason}.`, row.row);
      if (/^[+-]?\d{1,3},\d{3}$/.test(raw.trim()) && ambiguous.length < 5) {
        const decimal = readNumber(raw, { decimal: ',', thousands: null }), thousands = readNumber(raw, { decimal: '.', thousands: ',' });
        if (decimal.state === 'value' && thousands.state === 'value') ambiguous.push({ row: row.row, raw, decimal: Number(decimal.value), thousands: Number(thousands.value) });
      }
      return cell;
    });
    return { row: row.row, raw: row.cells, cells };
  });
  return { source, read, table: { columns, rows, report }, ambiguous };
}
export function readDataset(source: DataSource, dataset: Dataset): TypedTable {
  assertDataSourceContent(source.content);
  if (source.id !== dataset.sourceId) throw new InputError('missing_data_source', 'The dataset source is missing.');
  const preview = previewImport(source.content, dataset.read, dataset.columns, source);
  if (preview.table.columns.length !== dataset.columns.length) throw new InputError('data_columns_changed', 'The dataset column definitions no longer match the source.');
  preview.table.columns = dataset.columns;
  return preview.table;
}

/** Includes every read/column input; data shared under different overrides never aliases. */
export class DatasetCache {
  private entries = new Map<string, TypedTable>();
  get(source: DataSource, dataset: Dataset): TypedTable {
    const key = source.id + JSON.stringify(dataset.read) + JSON.stringify(dataset.columns);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const table = readDataset(source, dataset);
    if (this.entries.size >= 4) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, table); return table;
  }
  clear() { this.entries.clear(); }
}
