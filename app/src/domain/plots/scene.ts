import { DatasetCache, type TypedTable } from '../data/dataset';
import type { DataSource, Dataset } from '../data/schema';
import { shortLabel } from '../data/report';
import { prepareObservations, type Observation, type PreparedObservations } from '../analysis/observations';
import { runAnalysis } from '../stats/engine';
import { descriptive } from '../stats/descriptive';
import type { AnalysisResult } from '../stats/schema';
import type { PlotSpec } from './spec';
import { linearScale, niceTicks, dateTicks } from './scales';
import { kde } from './kde';
import { bracketLayout } from './brackets';
import { INPUT_LIMITS, InputError } from '../security/input';

export type Primitive =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string; stroke?: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth?: number }
  | { kind: 'circle'; x: number; y: number; radius: number; fill: string; opacity?: number }
  | { kind: 'path'; d: string; fill: string; stroke?: string; opacity?: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; angle?: number };
export interface PlotScene { width: number; height: number; primitives: Primitive[]; result: AnalysisResult | null; error: string | null; notices: string[]; budget: { elements: number; commands: number; text: number; bytes: number }; observations: PreparedObservations | null }
export type MeasureText = (text: string, size: number, family: string) => number;
export function assertPlotBudget(budget: PlotScene['budget']): void {
  if (budget.elements > INPUT_LIMITS.plotElements || budget.commands > INPUT_LIMITS.plotPathCommands || budget.text > INPUT_LIMITS.plotText || budget.bytes > INPUT_LIMITS.plotBytes)
    throw new InputError('plot_budget', 'The figure exceeds its plot export budget. Reduce points, labels or plots before applying.');
}
const cache = new DatasetCache();
const preparedScenes = new Map<string, {scene: PlotScene; content: string | undefined}>();
function sceneKey(source: DataSource | undefined, dataset: Dataset | undefined, spec: PlotSpec, width: number, height: number): string { return JSON.stringify([source?.id, dataset?.read, dataset?.columns, spec, width, height]); }
export function hasPreparedPlot(source: DataSource | undefined, dataset: Dataset | undefined, spec: PlotSpec, width: number, height: number): boolean { const prepared = preparedScenes.get(sceneKey(source, dataset, spec, width, height)); return !!prepared && prepared.content === source?.content; }
/** Only the bundled same-origin preparation worker may seed this ephemeral cache. */
export function rememberPlotScene(source: DataSource | undefined, dataset: Dataset | undefined, spec: PlotSpec, scene: PlotScene) {
  const remember = (definition: PlotSpec) => { if (preparedScenes.size >= 64) preparedScenes.delete(preparedScenes.keys().next().value!); preparedScenes.set(sceneKey(source, dataset, definition, scene.width, scene.height), {scene, content: source?.content}); };
  remember(spec); if (!scene.error) remember({ ...spec, result: scene.result });
}
const rounded = (value: number) => Number(value.toFixed(3));
const point = (x: number, y: number) => `${rounded(x)} ${rounded(y)}`;
const aggregate = (values: number[], spec: PlotSpec) => spec.aggregate === 'sum' ? values.reduce((sum, value) => sum + value, 0) : spec.aggregate === 'count' ? values.length : spec.aggregate === 'median' ? descriptive(values).median! : descriptive(values).mean!;
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function heatColor(ratio: number, diverging: boolean): string {
  const bounded = Math.max(0, Math.min(1, ratio)), start = [245, 248, 250], end = diverging && bounded > .5 ? [190, 55, 32] : [20, 85, 165], intensity = diverging ? Math.abs(bounded - .5) * 2 : bounded;
  return '#' + start.map((value, index) => Math.round(value + (end[index]! - value) * intensity).toString(16).padStart(2, '0')).join('');
}
function jitter(seed: string): number { let hash = 2166136261; for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619); return (hash >>> 0) / 4294967296 - 0.5; }
function errorInterval(values: number[], spec: PlotSpec): [number, number] {
  const stats = descriptive(values), center = aggregate(values, spec);
  if (spec.error === 'range') return [stats.min!, stats.max!];
  if (spec.error === 'iqr') return [stats.q1!, stats.q3!];
  if (spec.error === 'ci95') return [stats.ciLow ?? center, stats.ciHigh ?? center];
  const error = spec.error === 'sd' ? stats.sd ?? 0 : spec.error === 'sem' ? stats.sem ?? 0 : 0;
  return [center - error, center + error];
}
export function sceneToSvg(scene: PlotScene, family = 'IBM Plex Sans'): string {
  const children = scene.primitives.map(primitive => {
    if (primitive.kind === 'rect') return `<rect x="${primitive.x}" y="${primitive.y}" width="${primitive.width}" height="${primitive.height}" fill="${xml(primitive.fill)}" stroke="${xml(primitive.stroke ?? 'none')}"/>`;
    if (primitive.kind === 'line') return `<line x1="${primitive.x1}" y1="${primitive.y1}" x2="${primitive.x2}" y2="${primitive.y2}" stroke="${xml(primitive.stroke)}" stroke-width="${primitive.strokeWidth ?? 1}"/>`;
    if (primitive.kind === 'circle') return `<circle cx="${primitive.x}" cy="${primitive.y}" r="${primitive.radius}" fill="${xml(primitive.fill)}" opacity="${primitive.opacity ?? 1}"/>`;
    if (primitive.kind === 'path') return `<path d="${primitive.d}" fill="${xml(primitive.fill)}" stroke="${xml(primitive.stroke ?? 'none')}" opacity="${primitive.opacity ?? 1}"/>`;
    return `<text x="${primitive.x}" y="${primitive.y}" font-family="${xml(family)}" font-size="${primitive.size}" fill="${xml(primitive.fill)}" text-anchor="${primitive.anchor ?? 'start'}"${primitive.angle ? ` transform="rotate(${primitive.angle} ${primitive.x} ${primitive.y})"` : ''}>${xml(primitive.text)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">${children}</svg>`;
}
function finish(scene: Omit<PlotScene, 'budget'>, family: string): PlotScene {
  let elements = 2, commands = 0, text = 0;
  for (const primitive of scene.primitives) {
    elements += primitive.kind === 'text' ? 5 : 3;
    if (primitive.kind === 'text') text += primitive.text.length;
    if (primitive.kind === 'path') {
      if (primitive.d.length > INPUT_LIMITS.pathLength) throw new InputError('plot_path', 'A generated plot path exceeds the supported path limit.');
      commands += (primitive.d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []).length;
    }
    if (primitive.kind === 'rect') commands += 5;
    if (primitive.kind === 'circle') commands += 4;
    if (primitive.kind === 'line') commands += 2;
  }
  const result: PlotScene = { ...scene, budget: { elements, commands, text, bytes: 0 } };
  assertPlotBudget(result.budget);
  result.budget.bytes = new TextEncoder().encode(sceneToSvg(result, family)).byteLength;
  assertPlotBudget(result.budget);
  return result;
}
export function buildPlotScene(source: DataSource | undefined, dataset: Dataset | undefined, spec: PlotSpec, width: number, height: number, measureText: MeasureText = (text, size) => text.length * size * 0.6): PlotScene {
  const prepared = preparedScenes.get(sceneKey(source, dataset, spec, width, height));
  if (prepared && prepared.content === source?.content) return prepared.scene;
  try { return renderPlotScene(source, dataset, spec, width, height, measureText); }
  catch (error) {
    if (!(error instanceof InputError) || !['plot_mapping', 'pairing', 'duplicate_subject', 'analysis_control'].includes(error.code)) throw error;
    const primitives: Primitive[] = [{ kind: 'rect', x: 0, y: 0, width, height, fill: '#FFFFFF', stroke: '#A74732' }, { kind: 'text', x: 12, y: 25, text: shortLabel(spec.appearance.title || 'Plot', 100), size: spec.appearance.fontSize, fill: '#263238' }, { kind: 'text', x: 12, y: 50, text: shortLabel(error.message, Math.max(10, Math.floor(width / (spec.appearance.fontSize * 0.6)))), size: spec.appearance.fontSize, fill: '#A74732' }];
    return finish({ width, height, primitives, result: null, error: error.message, notices: [], observations: null }, spec.appearance.fontFamily);
  }
}
function renderPlotScene(source: DataSource | undefined, dataset: Dataset | undefined, spec: PlotSpec, width: number, height: number, measureText: MeasureText): PlotScene {
  const primitives: Primitive[] = [], notices: string[] = [], font = spec.appearance.fontSize;
  const text = (x: number, y: number, value: string, size = font, anchor: 'start' | 'middle' | 'end' = 'start', angle = 0) => primitives.push({ kind: 'text', x: rounded(x), y: rounded(y), text: value, size, fill: '#263238', anchor, angle });
  const line = (x1: number, y1: number, x2: number, y2: number, stroke = '#263238') => primitives.push({ kind: 'line', x1: rounded(x1), y1: rounded(y1), x2: rounded(x2), y2: rounded(y2), stroke });
  const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string) => primitives.push({ kind: 'rect', x: rounded(x), y: rounded(y), width: rounded(Math.max(0.001, w)), height: rounded(Math.max(0.001, h)), fill, stroke });
  const path = (d: string, fill: string, stroke?: string, opacity?: number) => primitives.push({ kind: 'path', d, fill, stroke, opacity });
  const color = (level: string, index: number) => spec.appearance.groupColors.find(item => item.level === level)?.color ?? spec.appearance.palette[index % spec.appearance.palette.length]!;
  let prepared: PreparedObservations | null = null, table: TypedTable, result: AnalysisResult | null;
  try {
    if (!source || !dataset) throw new InputError('plot_mapping', 'The dataset is missing. Open Edit plot to choose a dataset.');
    table = cache.get(source, dataset); prepared = prepareObservations(table, spec); result = runAnalysis(prepared, spec);
    if (!prepared.groups.length) throw new InputError('plot_mapping', 'No valid observations remain under this mapping.');
  } catch (error) {
    if (error instanceof InputError && error.code === 'plot_groups') throw error;
    const message = error instanceof InputError ? error.message : 'The data or statistical calculation cannot be read under these settings.';
    rect(0, 0, width, height, '#FFFFFF', '#A74732'); text(12, 25, shortLabel(spec.appearance.title || 'Plot', 100)); text(12, 50, shortLabel(message, Math.max(10, Math.floor(width / (font * 0.6)))));
    return finish({ width, height, primitives, result: null, error: message, notices: [], observations: prepared }, spec.appearance.fontFamily);
  }
  const groups = prepared.groups, all = groups.flatMap(group => group.observations), values = all.map(observation => observation.y);
  prepared.exclusions.forEach(entry => notices.push(`${entry.reason}: ${entry.count} (rows ${entry.rows.slice(0, 5).join(', ')}).`));
  table.report.forEach(entry => notices.push(`${entry.message} (${entry.count}).`));
  if (result && spec.result && JSON.stringify(result) !== JSON.stringify(spec.result)) {
    notices.push(`Statistics recomputed from ${spec.result.engine} to ${result.engine}.`);
    result.comparisons.forEach(comparison => { const previous = spec.result!.comparisons.find(item => item.a === comparison.a && item.b === comparison.b); if (previous && JSON.stringify(previous) !== JSON.stringify(comparison)) notices.push(`${comparison.a + 1} / ${comparison.b + 1}: stored statistic ${previous.result.statistic}, p ${previous.result.p}, adjusted p ${previous.adjustedP}; current statistic ${comparison.result.statistic}, p ${comparison.result.p}, adjusted p ${comparison.adjustedP}.`); });
  }
  let marks = 0;
  const mark = (x: number, y: number, fill: string, radius = spec.appearance.points.size) => { if (++marks > INPUT_LIMITS.plotMarks) throw new InputError('plot_marks', 'The plot exceeds 20,000 marks. Reduce data or choose an aggregate.'); primitives.push({ kind: 'circle', x: rounded(x), y: rounded(y), radius, fill, opacity: spec.appearance.points.opacity }); };
  const points = (observations: Observation[], position: (observation: Observation) => { x: number; y: number }, fill: string) => {
    if (observations.length <= 500) { observations.forEach(observation => { const p = position(observation); mark(p.x, p.y, fill); }); return; }
    const r = spec.appearance.points.size;
    for (let start = 0; start < observations.length; start += 500) {
      let d = '';
      for (const observation of observations.slice(start, start + 500)) {
        if (++marks > INPUT_LIMITS.plotMarks) throw new InputError('plot_marks', 'The plot exceeds 20,000 marks. Reduce data or choose an aggregate.');
        const p = position(observation); d += `M ${point(p.x - r, p.y)} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z `;
      }
      path(d.trim(), fill, undefined, spec.appearance.points.opacity);
    }
  };
  const intervals = groups.map(group => errorInterval(group.observations.map(value => value.y), spec));
  const boundsIntervals = ['line', 'area'].includes(spec.type) ? groups.flatMap(group => {
    const byX = new Map<string | number, number[]>();
    for (const observation of group.observations) { const values = byX.get(observation.x) ?? []; values.push(observation.y); byX.set(observation.x, values); }
    return [...byX.values()].map(values => errorInterval(values, spec));
  }) : intervals;
  let minimum = values.reduce((a, b) => Math.min(a, b), Infinity), maximum = values.reduce((a, b) => Math.max(a, b), -Infinity);
  boundsIntervals.forEach(([low, high]) => { minimum = Math.min(minimum, low); maximum = Math.max(maximum, high); });
  all.forEach(value => { if (value.low !== null) minimum = Math.min(minimum, value.low); if (value.high !== null) maximum = Math.max(maximum, value.high); });
  if (spec.type === 'manhattan' && spec.options.genomeLines) maximum = Math.max(maximum, -Math.log10(5e-8));
  if (['bar', 'grouped-bar', 'dot-column', 'stacked-bar', 'area'].includes(spec.type) || ['dot-bar', 'grouped-dot-bar'].includes(spec.type) && minimum >= 0) { minimum = Math.min(0, minimum); maximum = Math.max(0, maximum); }
  if (spec.type === 'stacked-bar') {
    const totals = new Map<string, { positive: number; negative: number }>();
    groups.forEach(group => { const total = totals.get(group.level) ?? { positive: 0, negative: 0 }, value = aggregate(group.observations.map(observation => observation.y), spec); if (value >= 0) total.positive += value; else total.negative += value; totals.set(group.level, total); });
    minimum = Math.min(0, ...[...totals.values()].map(total => total.negative)); maximum = Math.max(0, ...[...totals.values()].map(total => total.positive)); notices.push('Stacked bars do not support statistics.');
  }
  if (minimum === maximum) { const margin = Math.abs(minimum) * 0.1 || 1; minimum -= margin; maximum += margin; }
  const log = spec.appearance.yScale === 'log10';
  if (log) { minimum = values.reduce((minimum, value) => value > 0 ? Math.min(minimum, value) : minimum, Infinity); if (!(minimum > 0)) throw new InputError('plot_mapping', 'Log scale requires positive values.'); }
  if (spec.appearance.yMin !== null) minimum = spec.appearance.yMin;
  if (spec.appearance.yMax !== null) maximum = spec.appearance.yMax;
  if (!(maximum > minimum) || log && minimum <= 0 || !Number.isFinite(maximum - minimum)) throw new InputError('plot_mapping', 'The axis bounds are invalid.');
  const format = (value: number) => Number(value.toPrecision(4)).toString().replace('.', spec.appearance.decimal);
  const ticks = log ? Array.from({ length: Math.min(20, Math.floor(Math.log10(maximum)) - Math.ceil(Math.log10(minimum)) + 1) }, (_, index) => 10 ** (Math.ceil(Math.log10(minimum)) + index)) : niceTicks(minimum, maximum);
  const left = Math.max(48, ...ticks.map(tick => measureText(format(tick), font, spec.appearance.fontFamily) + 18)) + (spec.appearance.yLabel ? font + 8 : 0);
  const right = width - 18;
  const groupedColumns = spec.type === 'grouped-bar', columnLevels = [...new Set(groups.map(group => group.level))], columnSeries = [...new Set(groups.map(group => group.series))];
  const levelBand = (right - left) / columnLevels.length;
  const band = groupedColumns ? levelBand * 0.72 / columnSeries.length : (right - left) / groups.length;
  const gx = (index: number) => groupedColumns ? left + levelBand * (columnLevels.indexOf(groups[index]!.level) + 0.5) + band * (columnSeries.indexOf(groups[index]!.series) - (columnSeries.length - 1) / 2) : left + band * (index + 0.5);
  const columnGroups = spec.layout === 'wide' && !spec.roles.replicates?.length;
  const xColumnIndex = table.columns.findIndex(column => column.key === spec.roles.x);
  const lineCategories = !['line', 'area', 'scatter'].includes(spec.type) ? [] : columnGroups ? (spec.roles.values ?? []).map(key => table.columns.find(column => column.key === key)!.name) : [...new Set(table.rows.map(row => row.cells[xColumnIndex]).filter(cell => cell?.state === 'value').map(cell => cell!.state === 'value' ? String(cell!.value) : ''))];
  const categoricalLine = ['line', 'area'].includes(spec.type) && prepared.xType === 'category';
  // Row encounter order can differ from the visual order of grouped bars.
  const bracketPositions = groups.map((group, index) => categoricalLine ? left + (right - left) * lineCategories.indexOf(group.level) / Math.max(1, lineCategories.length - 1) : gx(index));
  const canBracket = categoricalLine || ['bar', 'grouped-bar', 'dot-column', 'box', 'violin', 'dot-bar', 'grouped-dot-bar', 'range', 'cleveland'].includes(spec.type);
  const requestedBrackets = bracketLayout(result, spec.analysis);
  const brackets = canBracket ? bracketLayout(result, spec.analysis, bracketPositions, label => measureText(label, font, spec.appearance.fontFamily) + 8) : [];
  if (requestedBrackets.length && !canBracket) notices.push('bracketsNeedCategories');
  if (canBracket && requestedBrackets.length > brackets.length) notices.push('bracketsSameX');
  if (result && spec.analysis?.showBrackets !== false) {
    if (result.comparisons.some(comparison => comparison.selectedP === null)) notices.push('bracketsNotComputable');
    if (result.comparisons.length && result.comparisons.every(comparison => comparison.selectedP !== null && !comparison.significant) && spec.analysis?.hideNs) notices.push('bracketsHiddenNs');
    if (!result.comparisons.length) notices.push('bracketsNoComparisons');
  }
  const levels = brackets.reduce((max, bracket) => Math.max(max, bracket.level + 1), 0);
  if (brackets.length > 10) notices.push('More than 10 brackets are shown. Hide ns or choose comparisons against a control to simplify the plot.');
  const legendEntries: { label: string; display: string; x: number; row: number; index: number }[] = [];
  if (spec.appearance.legend) {
    const labels = [...new Set(groups.map(group => group.series ?? group.level))]; let offset = left, row = 0;
    labels.forEach((label, index) => { const display = shortLabel(label, Math.max(8, Math.min(30, Math.floor((right - left - 25) / (font * .6))))), length = Math.min(right - left, measureText(display, font, spec.appearance.fontFamily) + 25); if (offset > left && offset + length > right) { row++; offset = left; } legendEntries.push({ label, display, x: offset, row, index }); offset += length; });
  }
  const legendHeight = legendEntries.length ? (legendEntries.at(-1)!.row + 1) * (font + 8) : 0;
  const globalLabel = spec.analysis?.showGlobal && result?.global?.p !== null && result?.global?.p !== undefined
    ? `${result.global.test}: ${result.global.df2 !== undefined ? `F(${result.global.df}, ${result.global.df2})` : `H(${result.global.df})`} = ${format(result.global.statistic!)}, p = ${format(result.global.p)}` : '';
  const headingBottom = 14 + (spec.appearance.title ? font * 2 : 0) + (globalLabel ? font * 2 : 0), bottom = height - 32 - (spec.appearance.xLabel ? font + 8 : 0) - legendHeight;
  if (right - left < 30 || bottom - headingBottom < 25) throw new InputError('plot_mapping', 'The frame is too small for its axis labels. Reduce the font size or enlarge the plot.');
  // Fit annotations into the available height without discarding the calculation
  // or hiding selected comparisons. Reserve space for the data in small frames.
  const availableHeight = bottom - headingBottom, dataHeight = Math.min(96, availableHeight * .4);
  const bracketScale = levels ? Math.min(1, (availableHeight - dataHeight) / (levels * (font + 12))) : 1;
  const bracketStep = (font + 12) * bracketScale, top = headingBottom + levels * bracketStep;
  if (bracketScale < 1) notices.push('bracketsCompact');
  const yLinear = linearScale(log ? Math.log10(minimum) : minimum, log ? Math.log10(maximum) : maximum, bottom, top);
  const y = (value: number) => yLinear(log ? Math.log10(Math.max(value, minimum)) : value);
  let bracketX = gx;
  rect(0, 0, width, height, '#FFFFFF');
  text(width / 2, font + 8, shortLabel(spec.appearance.title, 100), font + 2, 'middle');
  if (globalLabel) text(width / 2, 10 + (spec.appearance.title ? font * 2 : 0) + font, globalLabel, Math.min(font, (width - 24) / Math.max(1, measureText(globalLabel, font, spec.appearance.fontFamily)) * font), 'middle');
  if (spec.type === 'heatmap') {
    const columns = [...new Set(all.map(observation => observation.series))];
    if (columns.length > INPUT_LIMITS.plotGroups) throw new InputError('plot_groups', 'Heatmap exceeds 50 column groups.');
    const cw = (right - left) / Math.max(1, columns.length), rh = (bottom - top) / groups.length;
    const min = Math.min(...values), max = Math.max(...values);
    groups.forEach((group, row) => {
      const cells = new Map<string | null, Observation[]>(); group.observations.forEach(observation => cells.set(observation.series, [...cells.get(observation.series) ?? [], observation]));
      columns.forEach((column, index) => { const observations = cells.get(column); if (!observations) return;
        if (++marks > INPUT_LIMITS.plotMarks) throw new InputError('plot_marks', 'Heatmap exceeds the mark limit.');
        if (observations.length > 1) { prepared.combinedRows += observations.length - 1; if (spec.aggregate === 'none') throw new InputError('plot_mapping', 'Duplicate heatmap cells require an explicit aggregate.'); }
        const value = aggregate(observations.map(item => item.y), spec), ratio = spec.options.diverging ? (value / Math.max(Math.abs(min), Math.abs(max), 1) + 1) / 2 : (value - min) / (max - min || 1);
        rect(left + index * cw, top + row * rh, cw - 1, rh - 1, heatColor(ratio, spec.options.diverging));
      }); text(left - 6, top + rh * (row + 0.5), shortLabel(group.level, 30), font, 'end');
    });
    columns.forEach((column, index) => text(left + cw * (index + 0.5), bottom + font + 4, shortLabel(String(column ?? 'Value'), 20), font, 'middle'));
    text(left, height - 8, `${format(min)} → ${format(max)} · Missing cells are blank`, font);
  } else {
    let lastTickY = Infinity;
    ticks.forEach(tick => {
      const tickY = y(tick); line(left, tickY, right, tickY, '#DCE3E5');
      if (bracketScale === 1 || Math.abs(tickY - lastTickY) >= font * 1.3) {
        text(left - 7, tickY + font / 3, format(tick), font, 'end'); lastTickY = tickY;
      }
    });
    line(left, top, left, bottom); line(left, bottom, right, bottom);
    if (['line', 'area', 'scatter', 'manhattan'].includes(spec.type)) {
      const series = new Map<string, Observation[]>(); all.forEach(observation => { const key = spec.type === 'manhattan' ? observation.chromosome! : observation.series ?? 'Data'; const list = series.get(key) ?? []; list.push(observation); series.set(key, list); });
      const categories = lineCategories;
      let xValues = all.map(observation => Number(observation.x));
      const numeric = prepared.xType === 'number' || prepared.xType === 'date' || spec.type === 'manhattan';
      const chromosomeOffsets = new Map<string, number>();
      if (spec.type === 'manhattan') {
        const chromosomeValue = (key: string) => { const clean = key.replace(/^chr/i, '').toUpperCase(); return clean === 'X' ? 23 : clean === 'Y' ? 24 : ['MT', 'M'].includes(clean) ? 25 : /^\d+$/.test(clean) ? Number(clean) : 1000; };
        const ordered = [...series].sort((a, b) => chromosomeValue(a[0]) - chromosomeValue(b[0]) || a[0].localeCompare(b[0], 'en'));
        series.clear(); let offset = 0;
        for (const [chromosome, observations] of ordered) { chromosomeOffsets.set(chromosome, offset); series.set(chromosome, observations); offset += observations.reduce((max, observation) => Math.max(max, observation.position!), 0) + 1; }
        xValues = all.map(observation => chromosomeOffsets.get(observation.chromosome!)! + observation.position!);
      }
      const xmin = numeric ? xValues.reduce((a, b) => Math.min(a, b), Infinity) : 0, xmax = numeric ? xValues.reduce((a, b) => Math.max(a, b), -Infinity) : Math.max(1, categories.length - 1), sx = linearScale(xmin, xmax === xmin ? xmin + 1 : xmax, left, right);
      const categoryIndex = new Map(categories.map((category, index) => [category, index]));
      const x = (observation: Observation) => sx(spec.type === 'manhattan' ? chromosomeOffsets.get(observation.chromosome!)! + observation.position! : numeric ? Number(observation.x) : (categoryIndex.get(String(observation.x)) ?? 0));
      if (categoricalLine) bracketX = index => x(groups[index]!.observations[0]!);
      let seriesIndex = 0;
      for (const [name, observations] of series) {
        const seriesGroup = groups.find(group => (group.series ?? group.level) === name); const fill = color(seriesGroup?.key ?? name, seriesIndex++);
        if (spec.type === 'scatter' || spec.type === 'manhattan') points(observations, observation => ({ x: x(observation), y: y(observation.y) }), fill);
        else {
          const grouped = new Map<string | number, Observation[]>(); observations.forEach(observation => { const list = grouped.get(observation.x) ?? []; list.push(observation); grouped.set(observation.x, list); });
          const ordered = [...grouped].map(([, list]) => { if (list.length > 1) { if (spec.aggregate === 'none') throw new InputError('plot_mapping', 'Duplicate X values require an explicit aggregate.'); prepared.combinedRows += list.length - 1; } return { ...list[0]!, y: aggregate(list.map(item => item.y), spec) }; }).sort((a, b) => x(a) - x(b));
          const segments: typeof ordered[] = [[]];
          const gapXs = columnGroups ? categories.flatMap((category, index) => grouped.has(category) ? [] : [index]) : prepared.gaps.filter(gap => (gap.series ?? 'Data') === name).map(gap => numeric ? Number(gap.x) : categoryIndex.get(String(gap.x)) ?? 0).sort((a, b) => a - b); let gapIndex = 0;
          ordered.forEach((observation, index) => { const prior = ordered[index - 1], currentX = numeric ? Number(observation.x) : categoryIndex.get(String(observation.x)) ?? 0, priorX = prior ? numeric ? Number(prior.x) : categoryIndex.get(String(prior.x)) ?? 0 : -Infinity; while (gapIndex < gapXs.length && gapXs[gapIndex]! <= priorX) gapIndex++; if (prior && gapIndex < gapXs.length && gapXs[gapIndex]! < currentX) segments.push([]); segments.at(-1)!.push(observation); });
          for (const segment of segments) for (let start = 0; start < segment.length; start += 300) {
            const part = segment.slice(Math.max(0, start - 1), start + 300), d = part.map((observation, index) => `${index ? 'L' : 'M'} ${point(x(observation), y(observation.y))}`).join(' ');
            if (spec.type === 'area' && part.length) path(d + ` L ${point(x(part.at(-1)!), y(0))} L ${point(x(part[0]!), y(0))} Z`, fill, undefined, 0.25);
            path(d, 'none', fill);
          }
          if (spec.error !== 'none') for (const list of grouped.values()) { const [lo, hi] = errorInterval(list.map(item => item.y), spec), cx = x(list[0]!); line(cx, y(lo), cx, y(hi), fill); line(cx - 3, y(lo), cx + 3, y(lo), fill); line(cx - 3, y(hi), cx + 3, y(hi), fill); }
          if (spec.appearance.points.show) points(ordered, observation => ({ x: x(observation), y: y(observation.y) }), fill);
        }
      }
      if (spec.type === 'manhattan') {
        for (const [chromosome, observations] of series) text(x(observations[0]!) + (x(observations.at(-1)!) - x(observations[0]!)) / 2, bottom + font + 4, shortLabel(chromosome, 8), font, 'middle');
        if (spec.options.genomeLines) for (const threshold of [-Math.log10(5e-8), 5]) { line(left, y(threshold), right, y(threshold), '#A74732'); text(right, y(threshold) - 3, format(threshold), font, 'end'); }
      } else if (numeric) (prepared.xType === 'date' ? dateTicks(xmin, xmax) : niceTicks(xmin, xmax)).forEach(tick => text(sx(tick), bottom + font + 4, prepared.xType === 'date' ? new Date(tick).toISOString().slice(0, 10) : format(tick), font, 'middle'));
      else categories.forEach((category, index) => text(sx(index), bottom + font + 4, shortLabel(category, 15), font, 'middle'));
    } else {
      const stacked = new Map<string, { positive: number; negative: number }>(), levels = [...new Set(groups.map(group => group.level))];
      const densities = spec.type === 'violin' ? groups.map(group => kde(group.observations.map(value => value.y), spec.options.trim)) : [];
      const densityMaximum = densities.reduce((max, density) => Math.max(max, ...(density?.map(value => value.density) ?? [0])), 0);
      groups.forEach((group, index) => {
        const data = group.observations.map(value => value.y), stats = descriptive(data), fill = color(group.key, groupedColumns ? columnSeries.indexOf(group.series) : index), center = aggregate(data, spec), x = gx(index), half = Math.min(28, band * 0.3), [low, high] = intervals[index]!;
        const errorBar = () => { if (spec.error !== 'none') { line(x, y(low), x, y(high)); line(x - 5, y(low), x + 5, y(low)); line(x - 5, y(high), x + 5, y(high)); } };
        if (spec.type === 'stacked-bar') {
          const accumulated = stacked.get(group.level) ?? { positive: 0, negative: 0 }, before = center >= 0 ? accumulated.positive : accumulated.negative, after = before + center;
          if (center >= 0) accumulated.positive = after; else accumulated.negative = after; stacked.set(group.level, accumulated);
          const sx = left + (right - left) / levels.length * (levels.indexOf(group.level) + 0.5), sw = (right - left) / levels.length * 0.65;
          rect(sx - sw / 2, Math.min(y(before), y(after)), sw, Math.abs(y(before) - y(after)), fill); marks++;
        } else if (['bar', 'grouped-bar', 'dot-column'].includes(spec.type)) { rect(x - half, Math.min(y(0), y(center)), half * 2, Math.abs(y(0) - y(center)), fill); errorBar(); marks++; }
        else if (['dot-bar', 'grouped-dot-bar'].includes(spec.type)) { line(x - half, y(center), x + half, y(center), fill); errorBar(); }
        else if (spec.type === 'range') { const lo = Math.min(...group.observations.map(value => value.low ?? value.y)), hi = Math.max(...group.observations.map(value => value.high ?? value.y)); line(x, y(lo), x, y(hi), fill); line(x - half / 2, y(lo), x + half / 2, y(lo), fill); line(x - half / 2, y(hi), x + half / 2, y(hi), fill); if (spec.options.midpoint) mark(x, y(center), fill); }
        else if (spec.type === 'box') {
          const lower = spec.options.whisker === 'min-max' ? stats.min! : Math.min(...data.filter(value => value >= stats.q1! - 1.5 * stats.iqr!)), upper = spec.options.whisker === 'min-max' ? stats.max! : Math.max(...data.filter(value => value <= stats.q3! + 1.5 * stats.iqr!));
          rect(x - half, y(stats.q3!), half * 2, y(stats.q1!) - y(stats.q3!), fill, '#263238'); line(x - half, y(stats.median!), x + half, y(stats.median!)); line(x, y(lower), x, y(stats.q1!)); line(x, y(stats.q3!), x, y(upper)); line(x - half / 2, y(lower), x + half / 2, y(lower)); line(x - half / 2, y(upper), x + half / 2, y(upper));
          if (!spec.appearance.points.show && data.length >= 5) points(group.observations.filter(value => value.y < lower || value.y > upper), observation => ({ x, y: y(observation.y) }), '#263238');
          if (data.length < 5) notices.push(`${group.label}: n < 5; observations are overlaid.`);
        } else if (spec.type === 'violin') {
          const density = densities[index];
          if (density) {
            const maximum = spec.options.normalize === 'width' ? Math.max(...density.map(value => value.density)) : densityMaximum;
            const vertices = [...density.map(value => ({ x: x - half * value.density / maximum, y: y(value.y) })), ...[...density].reverse().map(value => ({ x: x + half * value.density / maximum, y: y(value.y) }))];
            path(vertices.map((vertex, position) => `${position ? 'L' : 'M'} ${point(vertex.x, vertex.y)}`).join(' ') + ' Z', fill, '#263238');
          } else notices.push(`${group.label}: singleton or zero variance; no density is drawn.`);
          line(x - half / 2, y(stats.median!), x + half / 2, y(stats.median!));
        } else if (spec.type === 'cleveland') { const measures = [...new Set(group.observations.map(observation => observation.measure))]; const items = measures.map(measure => { const observations = group.observations.filter(observation => observation.measure === measure); return { ...observations[0]!, y: aggregate(observations.map(observation => observation.y), spec) }; }); if (items.length === 2) line(x, y(items[0]!.y), x, y(items[1]!.y), fill); items.forEach((item, position) => mark(x, y(item.y), spec.appearance.palette[position % spec.appearance.palette.length]!)); }
        const show = spec.appearance.points.show || ['dot-bar', 'dot-column', 'grouped-dot-bar'].includes(spec.type) || spec.type === 'box' && data.length < 5 || spec.type === 'violin' && !densities[index];
        if (show && spec.type !== 'cleveland') points(group.observations, observation => ({ x: x + jitter(`${spec.datasetId}:${observation.row}:${group.key}`) * half * 2 * spec.appearance.points.jitter, y: y(observation.y) }), '#263238');
        if (spec.type !== 'stacked-bar' && !groupedColumns) text(x, bottom + font + 4, shortLabel(group.label, Math.max(8, Math.floor(band / (font * 0.6)))), font, 'middle');
        if (spec.appearance.showN) text(x, top + font, `n=${data.length}`, font, 'middle');
      });
      if (spec.type === 'stacked-bar') levels.forEach((level, index) => text(left + (right - left) / levels.length * (index + 0.5), bottom + font + 4, shortLabel(level, 18), font, 'middle'));
      if (groupedColumns) columnLevels.forEach((level, index) => text(left + levelBand * (index + 0.5), bottom + font + 4, shortLabel(level, Math.max(8, Math.floor(levelBand / (font * 0.6)))), font, 'middle'));
    }
    brackets.forEach(bracket => { const by = top - 8 * bracketScale - bracket.level * bracketStep, a = bracketX(bracket.a), b = bracketX(bracket.b); line(a, by + 5 * bracketScale, a, by); line(a, by, b, by); line(b, by, b, by + 5 * bracketScale); text((a + b) / 2, by - 4 * bracketScale, bracket.label, font * bracketScale, 'middle'); });
    if (spec.appearance.xLabel) text((left + right) / 2, height - legendHeight - 8, shortLabel(spec.appearance.xLabel, 80), font, 'middle');
    if (spec.appearance.yLabel) text(font + 2, (top + bottom) / 2, shortLabel(spec.appearance.yLabel, 80), font, 'middle', -90);
    if (spec.appearance.legend) {
      legendEntries.forEach(entry => { const cy = height - legendHeight + entry.row * (font + 8); rect(entry.x, cy, 8, 8, color(groups.find(group => (group.series ?? group.level) === entry.label)?.key ?? entry.label, entry.index)); text(entry.x + 12, cy + font - 1, entry.display, font); });
    }
  }
  if (prepared.combinedRows) notices.push(`${prepared.combinedRows} duplicate observations combined using ${spec.aggregate}.`);
  return finish({ width, height, primitives, result, error: null, notices: [...new Set(notices)], observations: prepared }, spec.appearance.fontFamily);
}
