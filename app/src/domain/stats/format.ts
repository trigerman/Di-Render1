import type { AnalysisConfig } from './schema';
export function significanceLabel(p: number | null, config: Pick<AnalysisConfig, 'alpha' | 'label'>): string {
  if (p === null) return 'not computable';
  if (p >= config.alpha) return 'ns';
  if (config.label === 'stars') return p < 0.0001 ? '****' : p < 0.001 ? '***' : p < 0.01 ? '**' : '*';
  if (config.label === 'scientific') return 'p = ' + p.toExponential(3);
  return p < 0.0001 ? 'p < 0.0001' : 'p = ' + Number(p.toPrecision(3));
}
