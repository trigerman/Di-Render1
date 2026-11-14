import { tCritical } from './distributions';
export function quantile(sorted: readonly number[], probability: number): number {
  if (!sorted.length) throw new Error('Quantile requires observations.');
  const index = (sorted.length - 1) * probability, floor = Math.floor(index), fraction = index - floor;
  return sorted[floor]! * (1 - fraction) + sorted[Math.min(floor + 1, sorted.length - 1)]! * fraction;
}
export function descriptive(values: readonly number[]) {
  const n = values.length;
  if (!n) return { n, mean: null, sd: null, sem: null, ciLow: null, ciHigh: null, median: null, q1: null, q3: null, iqr: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value / n, 0);
  const scale = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0) || 1;
  const sd = n > 1 ? Math.sqrt(values.reduce((sum, value) => sum + ((value / scale - mean / scale) / Math.sqrt(n - 1)) ** 2, 0)) * scale : null;
  const sem = sd === null ? null : sd / Math.sqrt(n), margin = sem === null ? null : sem * tCritical(n - 1);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  const finite = (value: number | null) => value === null || !Number.isFinite(value) ? null : value;
  return { n, mean: finite(mean), sd: finite(sd), sem: finite(sem), ciLow: finite(margin === null ? null : mean - margin), ciHigh: finite(margin === null ? null : mean + margin),
    median: finite(quantile(sorted, 0.5)), q1: finite(q1), q3: finite(q3), iqr: finite(q3 - q1), min: sorted[0]!, max: sorted[n - 1]! };
}
