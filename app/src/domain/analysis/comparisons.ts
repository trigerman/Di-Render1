import type { AnalysisConfig } from '../stats/schema';
import { INPUT_LIMITS, InputError } from '../security/input';

export const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
export const isPairedTest = (test: AnalysisConfig['test']) => test === 'paired-t' || test === 'wilcoxon';
export const hasPostHoc = (config: AnalysisConfig) => config.test === 'anova' || config.test === 'kruskal-wallis';
export const usesTukey = (config: AnalysisConfig) => config.test === 'anova' && config.postHoc !== 'none';

export function plannedComparisons(groups: readonly { key: string }[], config: AnalysisConfig): [number, number][] {
  if (hasPostHoc(config) && config.postHoc === 'none') return [];
  const pairs: [number, number][] = [];
  if (config.comparisons === 'selected') {
    const seen = new Set<string>();
    for (const [left, right] of config.pairs ?? []) {
      const a = groups.findIndex(group => group.key === left), b = groups.findIndex(group => group.key === right), key = pairKey(left, right);
      if (a < 0 || b < 0) throw new InputError('analysis_pairs', 'A selected comparison group is no longer available. Remove that pair or repair the mapping.');
      if (a === b || seen.has(key)) throw new InputError('analysis_pairs', 'Choose distinct groups and include each pair only once.');
      seen.add(key); pairs.push(a < b ? [a, b] : [b, a]);
    }
  } else {
    const control = config.comparisons === 'control' ? groups.findIndex(group => group.key === config.control) : -1;
    if (config.comparisons === 'control' && control < 0) throw new InputError('analysis_control', 'Choose a control from the current groups.');
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) if (config.comparisons === 'all' || a === control || b === control) pairs.push([a, b]);
  }
  if (pairs.length > INPUT_LIMITS.plotComparisons) throw new InputError('plot_comparisons', 'The planned comparison family exceeds 190 comparisons. Choose a control or fewer groups.');
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
