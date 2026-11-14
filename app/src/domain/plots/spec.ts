import { z } from 'zod';
import { isSafePaint } from '../assets/sanitize';
import { analysisConfigSchema, analysisResultSchema } from '../stats/schema';
import type { Dataset } from '../data/schema';
import { INPUT_LIMITS } from '../security/input';

export const PLOT_TYPES = ['bar', 'grouped-bar', 'stacked-bar', 'line', 'area', 'range', 'scatter', 'heatmap', 'box', 'violin', 'dot-bar', 'dot-column', 'grouped-dot-bar', 'cleveland', 'manhattan'] as const;
const column = z.string().regex(/^c(0|[1-9]\d*)$/).max(16), text = z.string().max(1000);
const mappedColumns = (maximum: number) => z.array(column).max(maximum).refine(keys => new Set(keys).size === keys.length, 'Mapped columns must be unique.');
const paint = z.string().max(128).refine(isSafePaint);
const shared = z.object({
  version: z.literal(1), datasetId: z.string().min(1).max(128), layout: z.enum(['long', 'wide', 'wide-series']),
  roles: z.object({ x: column.optional(), y: column.optional(), series: column.optional(), values: mappedColumns(INPUT_LIMITS.plotGroups).optional(), replicates: mappedColumns(INPUT_LIMITS.datasetColumns).optional(), id: column.optional(), label: column.optional(), low: column.optional(), high: column.optional(), chromosome: column.optional(), position: column.optional(), p: column.optional() }).strict(),
  aggregate: z.enum(['none', 'mean', 'median', 'sum', 'count']), error: z.enum(['none', 'sd', 'sem', 'ci95', 'range', 'iqr']),
  appearance: z.object({ title: text, xLabel: text, yLabel: text, fontFamily: z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9 ,'-]*$/), fontSize: z.number().finite().min(6).max(60),
    palette: z.array(paint).min(1).max(50), groupColors: z.array(z.object({ level: z.string().max(INPUT_LIMITS.textLength), color: paint }).strict()).max(50), legend: z.boolean(), yScale: z.enum(['linear', 'log10']), yMin: z.number().finite().nullable(), yMax: z.number().finite().nullable(), showN: z.boolean(),
    points: z.object({ show: z.boolean(), jitter: z.number().min(0).max(1), size: z.number().min(0.5).max(10), opacity: z.number().min(0).max(1) }).strict(), decimal: z.enum(['.', ',']) }).strict(),
  analysis: analysisConfigSchema.nullable(), result: analysisResultSchema.nullable(),
}).strict();
const empty = z.object({}).strict();
export const plotSpecSchema = z.discriminatedUnion('type', [
  shared.extend({ type: z.literal('bar'), options: empty }), shared.extend({ type: z.literal('grouped-bar'), options: empty }), shared.extend({ type: z.literal('stacked-bar'), options: empty }),
  shared.extend({ type: z.literal('line'), options: empty }), shared.extend({ type: z.literal('area'), options: empty }),
  shared.extend({ type: z.literal('range'), options: z.object({ midpoint: z.boolean() }).strict() }), shared.extend({ type: z.literal('scatter'), options: empty }),
  shared.extend({ type: z.literal('heatmap'), options: z.object({ diverging: z.boolean() }).strict() }),
  shared.extend({ type: z.literal('box'), options: z.object({ whisker: z.enum(['tukey', 'min-max']) }).strict() }),
  shared.extend({ type: z.literal('violin'), options: z.object({ normalize: z.enum(['width', 'area']), trim: z.boolean() }).strict() }),
  shared.extend({ type: z.literal('dot-bar'), options: empty }), shared.extend({ type: z.literal('dot-column'), options: empty }), shared.extend({ type: z.literal('grouped-dot-bar'), options: empty }),
  shared.extend({ type: z.literal('cleveland'), options: empty }), shared.extend({ type: z.literal('manhattan'), options: z.object({ pMode: z.enum(['raw', 'log10']), genomeLines: z.boolean() }).strict() }),
]);
export type PlotSpec = z.infer<typeof plotSpecSchema>;
export type PlotType = PlotSpec['type'];
export const OKABE_ITO = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#000000'];
export const CHART_PALETTE = ['#066F79', '#E87D5B', '#2B87CC', '#8C6BB1', '#DAAC48'];
export function optionsForType(type: PlotType): PlotSpec['options'] {
  if (type === 'box') return { whisker: 'tukey' };
  if (type === 'violin') return { normalize: 'width', trim: true };
  if (type === 'heatmap') return { diverging: false };
  if (type === 'range') return { midpoint: true };
  if (type === 'manhattan') return { pMode: 'raw', genomeLines: true };
  return {};
}
export function defaultPlotSpec(dataset: Dataset, type: PlotType = 'bar'): PlotSpec {
  const numbers = dataset.columns.filter(column => column.type === 'number'), category = dataset.columns.find(column => column.type === 'category') ?? dataset.columns[0];
  return plotSpecSchema.parse({ version: 1, type, datasetId: dataset.id, layout: 'long', roles: { x: category?.key, y: numbers[0]?.key }, aggregate: 'mean', error: 'sd', options: optionsForType(type),
    appearance: { title: dataset.name, xLabel: category?.name ?? '', yLabel: numbers[0]?.name ?? '', fontFamily: 'IBM Plex Sans', fontSize: 12, palette: OKABE_ITO, groupColors: [], legend: true, yScale: 'linear', yMin: null, yMax: null, showN: false, points: { show: false, jitter: 0.3, size: 2.5, opacity: 0.8 }, decimal: '.' }, analysis: null, result: null });
}
