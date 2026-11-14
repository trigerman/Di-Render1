import type { AnalysisConfig } from './schema';
export function adjustP(values: readonly (number | null)[], method: AnalysisConfig['adjustment'], familySize = values.length): (number | null)[] {
  const ordered = values.map((p, index) => ({ p, index })).filter((item): item is { p: number; index: number } => item.p !== null).sort((a, b) => a.p - b.p || a.index - b.index);
  const result = values.map(p => p === null ? null : Math.min(1, p * (method === 'bonferroni' ? familySize : 1)));
  if (method === 'holm') {
    let previous = 0;
    ordered.forEach((item, rank) => { previous = Math.max(previous, Math.min(1, item.p * (familySize - rank))); result[item.index] = previous; });
  } else if (method === 'bh') {
    let previous = 1;
    for (let rank = ordered.length - 1; rank >= 0; rank--) { const item = ordered[rank]!; previous = Math.min(previous, item.p * familySize / (rank + 1)); result[item.index] = previous; }
  }
  return result;
}
