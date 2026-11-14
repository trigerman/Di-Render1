import type { DatasetRead, DatasetColumn } from './schema';

export type Cell = { state: 'value'; value: string | number; precision?: boolean } | { state: 'missing' | 'invalid'; reason: string };
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function readNumber(value: string, policy: Pick<DatasetRead, 'decimal' | 'thousands'>): Cell {
  const text = value.trim(), decimal = escape(policy.decimal), separator = policy.thousands;
  const integral = separator ? `(?:\\d+|\\d{1,3}(?:${escape(separator)}\\d{3})+)` : '\\d+';
  if (!new RegExp(`^[+-]?(?:${integral}(?:${decimal}\\d*)?|${decimal}\\d+)(?:[eE][+-]?\\d+)?$`).test(text))
    return { state: 'invalid', reason: 'not_number' };
  const normal = (separator ? text.split(separator).join('') : text).replace(policy.decimal, '.');
  const number = Number(normal);
  if (!Number.isFinite(number)) return { state: 'invalid', reason: 'not_finite' };
  return { state: 'value', value: number, precision: Number.isInteger(number) && !Number.isSafeInteger(number) };
}

/** Calendar validation and explicit UTC arithmetic; Date.parse is never involved. */
export function readDate(value: string, format: DatasetRead['dateFormat']): Cell {
  let year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millis = 0, offset = 0;
  const text = value.trim();
  if (format === 'iso') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(text);
    if (!match) return { state: 'invalid', reason: 'invalid_date' };
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
    hour = Number(match[4] ?? 0); minute = Number(match[5] ?? 0); second = Number(match[6] ?? 0); millis = Number((match[7] ?? '').padEnd(3, '0'));
    const zone = match[8];
    if (zone && zone !== 'Z') {
      const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
      if (hours > 23 || minutes > 59) return { state: 'invalid', reason: 'invalid_date' };
      offset = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
    }
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match) return { state: 'invalid', reason: 'invalid_date' };
    year = Number(match[3]); month = Number(match[format === 'dmy' ? 2 : 1]); day = Number(match[format === 'dmy' ? 1 : 2]);
  }
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, millis);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return { state: 'invalid', reason: 'invalid_date' };
  return { state: 'value', value: date.getTime() - offset * 60_000 };
}
export function readCell(raw: string, column: Pick<DatasetColumn, 'type'>, read: DatasetRead): Cell {
  if (read.missing.includes(raw.trim())) return { state: 'missing', reason: 'missing' };
  if (column.type === 'number') return readNumber(raw, read);
  if (column.type === 'date') return readDate(raw, read.dateFormat);
  return { state: 'value', value: raw };
}
