import type { Dataset, DatasetColumn } from '../data/schema';
import { INPUT_LIMITS } from '../security/input';
import { defaultPlotSpec, optionsForType, type PlotSpec, type PlotType } from './spec';

export interface PlotSuggestion {
  id: string; type: PlotType; reason: string; layout: PlotSpec['layout']; roles: PlotSpec['roles']; error: PlotSpec['error'];
}
const name = (column: DatasetColumn) => column.name.toLowerCase().trim().replace(/[_-]+/g, ' ');
const identifier = (column: DatasetColumn) => /^(id|index|row|subject|participant|patient|sample|replicate|well)(\s*(id|number|no\.?|#))?$/.test(name(column));
const temporal = (column: DatasetColumn) => column.type === 'date' || /^(time|date|datetime|timestamp|days?|weeks?|months?|years?|hours?|minutes?|seconds?|elapsed(?: time)?|duration)(?:\s*(?:\([^)]*\)|\[[^\]]*\]|ms|s|sec|seconds|minutes|min|hours|h|days))?$/.test(name(column));
const axis = (column: DatasetColumn) => /^(x|dose|concentration|distance|wavelength|frequency)(?:\s*(?:\([^)]*\)|\[[^\]]*\]))?$/.test(name(column));
// Day 1 / Day 7, X1 / X2 and multiple time-labelled measurement columns are
// conditions, not a shared time axis. Only a single credible axis is inferred.
const timeAxis = (dataset: Dataset) => { const candidates = dataset.columns.filter(column => !identifier(column) && temporal(column) && column.type !== 'text'); return candidates.length === 1 ? candidates[0] : undefined; };
export const hasTimeColumn = (dataset: Dataset) => !!timeAxis(dataset);
export const columnGroupKeys = (dataset: Dataset) => { const time = timeAxis(dataset), x = time ?? dataset.columns.find(column => column.type === 'number' && axis(column)); return dataset.columns.filter(column => column.type === 'number' && !identifier(column) && column !== x).map(column => column.key); };

/** Inspectable defaults from declared types and headers. Never infer a test or pairing. */
export function recommendPlots(dataset: Dataset): PlotSuggestion[] {
  const id = dataset.columns.find(identifier), usable = dataset.columns.filter(column => !identifier(column));
  const numeric = usable.filter(column => column.type === 'number'), categories = usable.filter(column => column.type === 'category');
  const time = timeAxis(dataset);
  const x = time ?? numeric.find(axis), measures = numeric.filter(column => column !== x);
  const suggestions: PlotSuggestion[] = [];
  const add = (type: PlotType, reason: string, layout: PlotSpec['layout'], roles: PlotSpec['roles'], error: PlotSpec['error'] = 'sd') => {
    const mapped = { ...roles, ...(id ? { id: id.key } : {}) };
    const key = JSON.stringify([type, layout, mapped]);
    if (!suggestions.some(item => item.id === key)) suggestions.push({ id: key, type, reason, layout, roles: mapped, error });
  };
  const columnKeys = (columns: DatasetColumn[]) => columns.length <= INPUT_LIMITS.plotGroups ? columns.map(column => column.key) : [];
  if (x && measures.length) {
    const series = categories.find(column => column !== x);
    const separateColumns = measures.length > 1 && !series;
    const roles = separateColumns ? { x: x.key, values: columnKeys(measures) } : { x: x.key, y: measures[0]!.key, ...(series ? { series: series.key } : {}) };
    const layout = separateColumns ? 'wide-series' : 'long';
    add(time ? 'line' : 'scatter', time ? 'timeSeriesReason' : 'namedAxisReason', layout, roles);
    add(time ? 'area' : 'line', time ? 'timeSeriesReason' : 'namedAxisReason', layout, roles);
  }
  if (categories.length >= 2 && numeric.length) add('grouped-bar', 'groupedBarReason', 'long', { x: categories[0]!.key, series: categories[1]!.key, y: numeric[0]!.key });
  if (categories.length === 1 && numeric.length > 1 && !x) add('grouped-bar', 'wideGroupedReason', 'wide-series', { x: categories[0]!.key, values: columnKeys(numeric) });
  if (categories.length && numeric.length) for (const type of ['bar', 'dot-bar', 'dot-column', 'box', 'violin'] as const) add(type, 'groupReason', 'long', { x: categories[0]!.key, y: numeric[0]!.key });
  const groupColumns = numeric.filter(column => column !== x);
  if (groupColumns.length) {
    // IDs remain available for explicit pairing but are never averaged as measures.
    for (const type of ['bar', 'dot-bar', 'dot-column', 'box', 'violin'] as const) add(type, 'columnMeansReason', 'wide', { values: columnKeys(groupColumns) });
  }
  if (numeric.length >= 2) add('scatter', 'numericReason', 'long', { x: numeric[0]!.key, y: numeric[1]!.key });
  if (categories.length >= 2 && numeric.length) add('heatmap', 'groupReason', 'long', { x: categories[0]!.key, series: categories[1]!.key, y: numeric[0]!.key });
  return suggestions;
}

export function applyPlotSuggestion(spec: PlotSpec, dataset: Dataset, suggestion: PlotSuggestion): PlotSpec {
  return { ...spec, type: suggestion.type, options: optionsForType(suggestion.type), layout: suggestion.layout, roles: suggestion.roles,
    aggregate: 'mean', error: suggestion.error, analysis: null, result: null,
    appearance: { ...spec.appearance, xLabel: suggestion.layout === 'wide' ? '' : dataset.columns.find(column => column.key === suggestion.roles.x)?.name ?? '',
      yLabel: dataset.columns.find(column => column.key === suggestion.roles.y)?.name ?? '', groupColors: [] } } as PlotSpec;
}
export function initialPlotSpec(dataset: Dataset): PlotSpec {
  const spec = defaultPlotSpec(dataset), suggestion = recommendPlots(dataset)[0];
  return suggestion ? applyPlotSuggestion(spec, dataset, suggestion) : spec;
}
