import type { Dataset } from '../data/schema';
import type { PlotSpec } from '../plots/spec';
import { hasTimeColumn } from '../plots/recommend';
import type { AnalysisConfig } from './schema';

export const canPairRows = (spec: PlotSpec) => spec.layout === 'wide' && !spec.roles.replicates?.length;

/** A paired test is still an explicit choice. For non-time column groups its
 * initial matching rule follows table rows; saved choices are never rewritten. */
export function initialAnalysisConfig(spec: PlotSpec, dataset: Dataset | undefined, test: AnalysisConfig['test'], groups: readonly { key: string }[]): AnalysisConfig {
  return { test, pairing: canPairRows(spec) && !spec.roles.id && dataset && !hasTimeColumn(dataset) ? 'row-order' : 'id',
    comparisons: test === 'anova' || test === 'kruskal-wallis' ? 'all' : 'selected', pairs: groups.length === 2 ? [[groups[0]!.key, groups[1]!.key]] : [],
    control: null, adjustment: 'holm', alpha: .05, useAdjusted: true, label: 'stars', hideNs: false, showBrackets: true };
}

export function statisticalChoices(groupCount: number): { test: AnalysisConfig['test']; reason: string }[] {
  if (groupCount < 2) return [];
  return groupCount === 2 ? [
    { test: 'welch', reason: 'welchGuide' }, { test: 'paired-t', reason: 'pairedGuide' },
    { test: 'mann-whitney', reason: 'mannGuide' }, { test: 'wilcoxon', reason: 'wilcoxonGuide' },
  ] : [
    { test: 'anova', reason: 'anovaGuide' }, { test: 'pairwise-welch', reason: 'welchFamilyGuide' },
    { test: 'kruskal-wallis', reason: 'kruskalGuide' }, { test: 'paired-t', reason: 'pairedFamilyGuide' }, { test: 'wilcoxon', reason: 'wilcoxonGuide' },
  ];
}
