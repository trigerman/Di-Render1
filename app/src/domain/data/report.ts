import { sha256 } from '../assets/svgFingerprint';

export interface Diagnostic { code: string; message: string; count: number; rows: number[] }
export function shortLabel(value: string, maximum = 64): string {
  return value.length <= maximum ? value : value.slice(0, maximum - 10) + '…' + sha256(value).slice(0, 8);
}
export function reportIssue(report: Diagnostic[], code: string, message: string, row?: number): void {
  let entry = report.find(item => item.code === code && item.message === message.slice(0, 500));
  if (!entry) {
    if (report.length >= 200) return;
    entry = { code, message: message.slice(0, 500), count: 0, rows: [] }; report.push(entry);
  }
  entry.count++;
  if (row !== undefined && entry.rows.length < 50 && report.reduce((sum, item) => sum + item.rows.length, 0) < 1000) entry.rows.push(row);
}
