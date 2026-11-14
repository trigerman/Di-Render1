import type { AnalysisResult, AnalysisConfig } from '../stats/schema';
export function bracketLayout(result: AnalysisResult | null, config: AnalysisConfig | null, positions?: number[], labelWidth?: (label: string) => number) {
  if (!result || !config || config.showBrackets === false) return [];
  const span = (comparison: { a: number; b: number }) => { const a = positions?.[comparison.a] ?? comparison.a, b = positions?.[comparison.b] ?? comparison.b; return { a: Math.min(a, b), b: Math.max(a, b) }; };
  const occupied = (comparison: { a: number; b: number; label: string }) => {
    const extent = span(comparison), center = (extent.a + extent.b) / 2, half = (labelWidth?.(comparison.label) ?? 0) / 2;
    return { a: Math.min(extent.a, center - half), b: Math.max(extent.b, center + half) };
  };
  const comparisons = result.comparisons.filter(comparison => comparison.selectedP !== null && (!config.hideNs || comparison.significant) && span(comparison).a !== span(comparison).b).sort((a, b) => span(a).b - span(a).a - (span(b).b - span(b).a) || span(a).a - span(b).a);
  const levels: { a: number; b: number }[][] = [];
  return comparisons.map(comparison => {
    let level = 0;
    const extent = occupied(comparison);
    while (levels[level]?.some(other => extent.a <= other.b && extent.b >= other.a)) level++;
    (levels[level] ??= []).push(extent);
    return { ...comparison, level };
  });
}
