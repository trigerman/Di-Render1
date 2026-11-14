import type { PreparedObservations } from '../analysis/observations';
import { pairGroups } from '../analysis/pairing';
import { ENGINE_VERSION, analysisFingerprint } from '../analysis/fingerprint';
import type { PlotSpec } from '../plots/spec';
import { descriptive } from './descriptive';
import { kruskalWallis, dunn } from './kSample';
import { tTest, pairedT, mannWhitney, wilcoxon, notComputable } from './twoSample';
import { adjustP } from './padjust';
import { significanceLabel } from './format';
import { analysisResultSchema, type AnalysisResult, type TestResult } from './schema';
import { INPUT_LIMITS, InputError } from '../security/input';
import { isPairedTest, plannedComparisons, usesTukey } from '../analysis/comparisons';
import { anovaModel, oneWayAnova, tukeyComparisons } from './anova';

export function runAnalysis(observations: PreparedObservations, spec: PlotSpec): AnalysisResult | null {
  const config = spec.analysis;
  if (!config || spec.type === 'stacked-bar') return null;
  if (config.test === 'anova' && config.postHoc === 'dunn' || config.test === 'kruskal-wallis' && config.postHoc === 'tukey') throw new InputError('analysis_test', 'Choose a post-hoc method compatible with the overall test.');
  if (config.test === 'kruskal-wallis' && observations.groups.length === 2) throw new InputError('analysis_test', 'For two groups, select a two-group test explicitly.');
  const groups = observations.groups, values = groups.map(group => group.observations.map(observation => observation.y));
  const planned = plannedComparisons(groups, config), tukey = usesTukey(config);
  if (tukey && (config.alpha < .000001 || config.alpha > .999999)) throw new InputError('analysis_test', 'Tukey confidence intervals require alpha between 0.000001 and 0.999999.');
  const familySize = tukey ? groups.length * (groups.length - 1) / 2 : planned.length;
  if (tukey && familySize > INPUT_LIMITS.plotComparisons) throw new InputError('plot_comparisons', 'Tukey HSD supports up to 20 groups. Select fewer value columns or use ANOVA without post-hoc comparisons.');
  const model = config.test === 'anova' ? anovaModel(values) : null;
  const postHoc = tukey ? tukeyComparisons(model, planned, config.alpha) : [];
  const exclusions = structuredClone(observations.exclusions);
  const pairing: Pick<AnalysisResult['comparisons'][number], 'matchedPairs' | 'excludedA' | 'excludedB'>[] = [];
  const tests = planned.map(([a, b], index): TestResult => {
    if (tukey) return postHoc[index]!.result;
    if (isPairedTest(config.test)) {
      try {
        const paired = pairGroups(groups[a]!, groups[b]!, spec); exclusions.push(...paired.exclusions);
        pairing[index] = { matchedPairs: paired.a.length, excludedA: (groups[a]!.pairingRows?.length ?? values[a]!.length) - paired.a.length, excludedB: (groups[b]!.pairingRows?.length ?? values[b]!.length) - paired.b.length };
        return config.test === 'paired-t' ? pairedT(paired.a, paired.b) : wilcoxon(paired.a, paired.b);
      } catch (error) {
        if (!(error instanceof InputError)) throw error;
        pairing[index] = { matchedPairs: null };
        return notComputable(config.test === 'paired-t' ? 'Paired t' : 'Wilcoxon', error.message);
      }
    }
    if (config.test === 'kruskal-wallis') return dunn(values, a, b);
    if (config.test === 'mann-whitney') return mannWhitney(values[a]!, values[b]!);
    return tTest(values[a]!, values[b]!, config.test === 'student');
  });
  const adjusted = tukey ? postHoc.map(comparison => comparison.adjustedP) : adjustP(tests.map(test => test.p), config.adjustment, familySize);
  const global = config.test === 'anova' ? oneWayAnova(model) : config.test === 'kruskal-wallis' && groups.length > 2 ? kruskalWallis(values)
    : groups.length < 2 ? notComputable(config.test, 'At least two groups are required.') : null;
  return analysisResultSchema.parse({ engine: ENGINE_VERSION, fingerprint: analysisFingerprint(observations, config), alternative: 'two-sided',
    groups: groups.map((group, index) => ({ key: group.key, label: group.label, descriptive: descriptive(values[index]!) })), global, familySize,
    comparisons: planned.map(([a, b], index) => { const selectedP = tukey || config.useAdjusted ? adjusted[index]! : tests[index]!.p; return { a, b, result: tests[index]!, adjustedP: adjusted[index]!, selectedP, significant: selectedP !== null && selectedP < config.alpha, label: significanceLabel(selectedP, config), ...pairing[index] }; }), exclusions: exclusions.slice(0, 200) });
}
