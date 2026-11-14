import type { Dataset } from '../data/schema';
import { INPUT_LIMITS } from '../security/input';
import { defaultPlotSpec, type PlotSpec, type PlotType } from './spec';
import { columnGroupKeys } from './recommend';

export type DataArrangement = 'rows' | 'columns' | 'replicates' | 'series-columns';
export const supportsColumnGroups = (type: PlotType) => !['grouped-bar', 'scatter', 'cleveland', 'manhattan', 'heatmap'].includes(type);
export const supportsSeriesColumns = (type: PlotType) => ['line', 'area', 'scatter', 'grouped-bar'].includes(type);
export function dataArrangement(spec: PlotSpec): DataArrangement {
  if (spec.layout === 'wide-series') return 'series-columns';
  // Cleveland uses a row label plus one or two measures in either stored layout.
  if (spec.layout === 'long' || spec.type === 'cleveland') return 'rows';
  return spec.roles.replicates?.length || spec.roles.replicates && !spec.roles.values ? 'replicates' : 'columns';
}

/** Changing arrangement is explicit; the persisted format remains compatible with saved plots. */
export function arrangePlot(spec: PlotSpec, dataset: Dataset, arrangement: DataArrangement): PlotSpec {
  const defaults = defaultPlotSpec(dataset, spec.type);
  const numeric = dataset.columns.filter(column => column.type === 'number').map(column => column.key);
  if (arrangement === 'series-columns') {
    const x = spec.roles.x ?? dataset.columns[0]?.key;
    const values = numeric.filter(key => key !== x && key !== spec.roles.id);
    const type = dataset.columns.find(column => column.key === x)?.type === 'category' ? 'grouped-bar' : 'line';
    return { ...spec, type, options: {}, layout: 'wide-series', roles: { x, values: values.length <= INPUT_LIMITS.plotGroups ? values : [], ...(spec.roles.id ? { id: spec.roles.id } : {}) },
      aggregate: 'mean', error: 'sd', analysis: null, result: null };
  }
  if (arrangement === 'columns') {
    // Exclude identifiers and named axes; users can explicitly include them.
    const groupKeys = columnGroupKeys(dataset);
    const values = groupKeys.length <= INPUT_LIMITS.plotGroups ? groupKeys : [];
    return { ...spec, type: 'bar', options: {}, layout: 'wide', roles: { values }, aggregate: 'mean', error: 'sd',
      appearance: { ...spec.appearance, xLabel: '', yLabel: '', groupColors: [] }, analysis: null, result: null };
  }
  if (arrangement === 'replicates') {
    const x = spec.roles.x ?? defaults.roles.x;
    const replicates = numeric.filter(key => key !== x);
    return { ...spec, layout: 'wide', roles: { x, replicates }, result: null };
  }
  return { ...spec, layout: 'long', roles: defaults.roles, result: null };
}
