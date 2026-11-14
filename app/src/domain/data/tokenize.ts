import { INPUT_LIMITS, InputError } from '../security/input';
import type { DatasetRead } from './schema';

export interface RawRecord { cells: string[]; row: number }

/** Reader v1: quoted fields are decoded without trimming any cell or record. */
export function tokenize(text: string, delimiter: DatasetRead['delimiter'], read?: DatasetRead): RawRecord[] {
  const records: RawRecord[] = [];
  let cells: string[] = [], field = '', quoted = false, closed = false, line = 1, startLine = 1;
  const maxFields = read?.transpose ? INPUT_LIMITS.datasetRows : INPUT_LIMITS.datasetColumns;
  const maxRecords = (read?.transpose ? INPUT_LIMITS.datasetColumns : INPUT_LIMITS.datasetRows) + (read?.skipRows ?? 0) + (read?.header === 'first-row' ? 1 : 0);
  const pushField = () => {
    cells.push(field); field = ''; closed = false;
    if (cells.length > maxFields) throw new InputError('data_columns', 'The table exceeds the supported column or transposed row limit.');
  };
  const pushRow = () => {
    pushField(); records.push({ cells, row: startLine }); cells = []; startLine = line + 1;
    if (records.length > maxRecords) throw new InputError('data_rows', 'The table exceeds the supported row or transposed column limit.');
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else { field += char; if (char === '\n' || char === '\r' && text[index + 1] !== '\n') line++; }
      continue;
    }
    if (char === delimiter) pushField();
    else if (char === '\r' || char === '\n') { pushRow(); if (char === '\r' && text[index + 1] === '\n') index++; line++; }
    else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new InputError('data_quotes', `Malformed quotes at row ${line}, column ${cells.length + 1}.`);
      field += char;
    }
  }
  if (quoted) throw new InputError('data_quotes', `Unclosed quoted field at row ${startLine}, column ${cells.length + 1}.`);
  if (field || cells.length || closed) pushRow();
  return records;
}
