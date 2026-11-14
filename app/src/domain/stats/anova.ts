import { fSurvival, tTwoSided } from './distributions';
import { studentizedRangeCritical, studentizedRangeSurvival } from './studentizedRange';
import { notComputable } from './twoSample';
import type { TestResult } from './schema';

export function anovaModel(groups: readonly (readonly number[])[]) {
  if (groups.length < 2 || groups.some(group => !group.length) || groups.every(group => group.length === 1)) return null;
  const n = groups.reduce((total, group) => total + group.length, 0), df = groups.length - 1, df2 = n - groups.length;
  const scale = groups.reduce((maximum, group) => group.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), maximum), 0) || 1;
  const origin = groups[0]![0]!, normalized = groups.map(group => group.map(value => Number.isFinite(value - origin) ? (value - origin) / scale : value / scale - origin / scale));
  const means = normalized.map(group => group.reduce((sum, value) => sum + value / group.length, 0));
  const center = means.reduce((sum, mean, index) => sum + mean * (groups[index]!.length / n), 0);
  const between = means.reduce((sum, mean, index) => sum + groups[index]!.length * (mean - center) ** 2, 0);
  const within = normalized.reduce((sum, group, index) => sum + group.reduce((sum, value) => sum + (value - means[index]!) ** 2, 0), 0);
  return { groups, scale, means, between, within, df, df2, mse: within / df2 };
}
export type AnovaModel = ReturnType<typeof anovaModel>;
export function oneWayAnova(model: AnovaModel): TestResult {
  if (!model) return notComputable('One-way ANOVA', 'At least two nonempty groups and residual degrees of freedom are required.');
  if (!(model.mse > 0)) return notComputable('One-way ANOVA', 'Within-group variance is zero.');
  const statistic = model.between / model.df / model.mse;
  if (!Number.isFinite(statistic)) return notComputable('One-way ANOVA', 'Numeric range exceeded.');
  return { test: 'One-way ANOVA', statistic, df: model.df, df2: model.df2, p: fSurvival(statistic, model.df, model.df2), effect: model.between / (model.between + model.within), method: 'F distribution; eta squared', reason: null };
}

/** A single pooled ANOVA error term and full k-group range distribution are used
 * for every pair, even if the user displays only one pair or a control subset. */
export function tukeyComparisons(model: AnovaModel, pairs: readonly (readonly [number, number])[], alpha: number) {
  const invalid = !model ? 'At least two nonempty groups and residual degrees of freedom are required.' : !(model.mse > 0) ? 'Within-group variance is zero.' : null;
  if (invalid || !model) return pairs.map(() => ({ result: notComputable('Tukey HSD', invalid!), adjustedP: null }));
  if (!pairs.length) return [];
  const k = model.groups.length, critical = studentizedRangeCritical(k, model.df2, alpha);
  const balanced = model.groups.every(group => group.length === model.groups[0]!.length);
  return pairs.map(([a, b]) => {
    const difference = model.means[a]! - model.means[b]!, se = Math.sqrt(model.mse * (1 / model.groups[a]!.length + 1 / model.groups[b]!.length) / 2);
    const q = Math.abs(difference) / se, effect = difference * model.scale, margin = critical * se * model.scale;
    const ciLow = effect - margin, ciHigh = effect + margin;
    if (![q, effect, ciLow, ciHigh].every(Number.isFinite)) return { result: notComputable('Tukey HSD', 'Numeric range exceeded.'), adjustedP: null };
    return { result: { test: balanced ? 'Tukey HSD' : 'Tukey–Kramer', statistic: q, df: model.df2, p: tTwoSided(q / Math.SQRT2, model.df2), effect, ciLow, ciHigh, method: 'studentized range; mean difference A - B', reason: null } satisfies TestResult,
      adjustedP: studentizedRangeSurvival(q, k, model.df2) };
  });
}
