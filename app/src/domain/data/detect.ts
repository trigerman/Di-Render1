import type { DatasetRead } from './schema';
import { tokenize } from './tokenize';
import { readNumber } from './cells';

export const defaultRead: DatasetRead = { version: 1, delimiter: ',', header: 'first-row', skipRows: 0, decimal: '.', thousands: null, missing: ['', 'NA', 'N/A', 'NaN', 'null'], dateFormat: 'iso', transpose: false };
export function detectRead(text: string): DatasetRead {
  const candidates: DatasetRead['delimiter'][] = ['\t', ',', ';', '|'];
  let best: { delimiter: DatasetRead['delimiter']; score: number[]; records: string[][] } | undefined;
  for (const delimiter of candidates) {
    try {
      const records = tokenize(text, delimiter, { ...defaultRead, header: 'first-row', delimiter }).filter(record => record.cells.some(cell => cell.trim())).map(record => record.cells);
      const counts = new Map<number, number>();
      records.forEach(record => counts.set(record.length, (counts.get(record.length) ?? 0) + 1));
      const modal = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [1, 0];
      const score = [Number(modal[0] > 1 && (records[0]?.length ?? 0) > 1), modal[1] / Math.max(1, records.length), Number(modal[0] > 1)];
      if (!best || score.some((part, index) => part !== best!.score[index] && score.slice(0, index).every((prior, j) => prior === best!.score[j]) && part > best!.score[index]!)) best = { delimiter, score, records };
    } catch { /* A candidate with invalid quoting/shape cannot win. The selected reader reports errors. */ }
  }
  const read = { ...defaultRead, missing: [...defaultRead.missing], delimiter: best?.delimiter ?? ',' };
  if (best?.records[0]?.every(cell => readNumber(cell, read).state === 'value')) read.header = 'none';
  if (read.delimiter === ';' && best?.records.slice(1).some(row => row.some(cell => /^[+-]?\d+,\d+$/.test(cell.trim())))) read.decimal = ',';
  return read;
}
