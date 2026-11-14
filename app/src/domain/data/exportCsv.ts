import type { Dataset } from './schema';
import { safeFileStem } from '../export/exporters';

export function exportTable(rows: readonly (readonly (string | number | null)[])[], delimiter: ',' | '\t' = ','): string {
  return rows.map(row => row.map(value => {
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Non-finite result cannot be exported.'); return String(value); }
    let text = value ?? '';
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return text.includes(delimiter) || /["\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(delimiter)).join('\r\n') + '\r\n';
}
export function originalDownloadName(dataset: Dataset): string {
  let stem = safeFileStem(dataset.origin.name.replace(/\.[^.]*$/, ''));
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem)) stem += '-data';
  return stem + (dataset.origin.mediaType === 'text/csv' ? '.csv' : dataset.origin.mediaType === 'text/tab-separated-values' ? '.tsv' : '.txt');
}
