import { dataText as d, type Locale } from '../../i18n/messages';
import type { AnalysisResult, AnalysisConfig } from './schema';
import { exportTable } from '../data/exportCsv';
import { hasPostHoc, usesTukey } from '../analysis/comparisons';
export function statisticsRows(result: AnalysisResult, config: AnalysisConfig, datasetName: string, locale: Locale = 'en'): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [['Dataset', datasetName], ['Engine', result.engine], ['Fingerprint', result.fingerprint], ['Pairwise alternative', result.alternative], ['Alpha', config.alpha], ['Adjustment', hasPostHoc(config) && config.postHoc === 'none' ? 'none' : usesTukey(config) ? 'Tukey HSD / Tukey–Kramer (full family)' : config.adjustment], ['Family size m', result.familySize],
    ['Group', 'n', 'Mean', 'SD', 'SEM', 'Median', 'Q1', 'Q3', 'IQR', 'CI low', 'CI high']];
  result.groups.forEach(group => { const s = group.descriptive; rows.push([group.label, s.n, s.mean, s.sd, s.sem, s.median, s.q1, s.q3, s.iqr, s.ciLow, s.ciHigh]); });
  rows.push(['Group A', 'Group B', 'Test', 'Statistic', 'df', 'Raw p', 'Adjusted p', 'Selected p', 'Effect', 'Method', 'Reason', 'df denominator', 'Difference CI low', 'Difference CI high', 'Matched pairs', 'Excluded A', 'Excluded B']);
  if (result.global) rows.push(['All groups', '', result.global.test, result.global.statistic, result.global.df, result.global.p, null, null, result.global.effect, d(locale, result.global.method), result.global.reason ? d(locale, result.global.reason) : null, result.global.df2 ?? null]);
  result.comparisons.forEach(comparison => rows.push([result.groups[comparison.a]?.label ?? '', result.groups[comparison.b]?.label ?? '', comparison.result.test, comparison.result.statistic, comparison.result.df, comparison.result.p, comparison.adjustedP, comparison.selectedP, comparison.result.effect, d(locale, comparison.result.method), comparison.result.reason ? d(locale, comparison.result.reason) : null, null, comparison.result.ciLow ?? null, comparison.result.ciHigh ?? null, comparison.matchedPairs ?? null, comparison.excludedA ?? null, comparison.excludedB ?? null]));
  rows.push(['Exclusion reason', 'Count', 'Source rows (first 50)']); result.exclusions.forEach(exclusion => rows.push([d(locale, exclusion.reason), exclusion.count, exclusion.rows.join('; ')]));
  if (locale === 'fr') { const headers = new Set([0,1,2,3,4,5,6,7,8 + result.groups.length, rows.length - result.exclusions.length - 1]); rows.forEach((row, index) => { if (headers.has(index)) row.forEach((value, column) => { if (typeof value === 'string' && (index === 7 || index === 8 + result.groups.length || index === rows.length - result.exclusions.length - 1 || column === 0)) row[column] = d(locale, value); }); }); }
  return rows;
}
export const statisticsCsv = (result: AnalysisResult, config: AnalysisConfig, name: string, locale: Locale = 'en') => exportTable(statisticsRows(result, config, name, locale));
export const statisticsClipboard = (result: AnalysisResult, config: AnalysisConfig, name: string, locale: Locale = 'en') => exportTable(statisticsRows(result, config, name, locale), '\t');
