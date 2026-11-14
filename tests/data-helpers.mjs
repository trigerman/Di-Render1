import { previewImport } from '../app/src/domain/data/dataset.ts';
import { defaultPlotSpec } from '../app/src/domain/plots/spec.ts';
import { createProject } from '../app/src/domain/project/factory.ts';
export function dataFixture(text = 'Group,Series,Value,Other,Low,High,ID,X,Chr,Position,P\nA,S1,1,2,0,3,i1,1,1,10,0.1\nA,S1,2,4,1,5,i2,2,1,20,0.01\nA,S1,3,6,2,7,i3,3,1,30,0.001\nB,S2,3,4,2,5,i1,4,2,10,0.2\nB,S2,4,6,3,7,i2,5,2,20,0.02\nB,S2,5,8,4,9,i3,6,2,30,0.002', read, columns) {
  const preview = previewImport(text, read, columns);
  const dataset = { id: 'dataset-11111111-1111-4111-8111-111111111111', name: 'Measurements', sourceId: preview.source.id, origin: { name: 'table.csv', mediaType: 'text/csv', encoding: 'utf-8', bytes: Buffer.byteLength(text), importedAt: '2026-10-11T00:00:00.000Z' }, read: preview.read, columns: preview.table.columns };
  const project = createProject(); project.datasets = [dataset]; project.dataSources = [preview.source];
  return { ...preview, dataset, project };
}
export const analysisConfig = (test = 'welch') => ({ test, pairing: 'id', comparisons: 'all', control: null, adjustment: 'holm', alpha: .05, useAdjusted: true, label: 'stars', hideNs: false });
export function fixtureSpec(dataset, type) {
  const spec = defaultPlotSpec(dataset, type); spec.roles = { x: 'c0', y: 'c2', id: 'c6' };
  // Keep historical saved-plot rendering fixtures on their explicit SEM setting.
  // New-plot SD defaults are covered separately by smart-plots.test.mjs.
  spec.error = 'sem';
  if (['grouped-bar', 'stacked-bar', 'grouped-dot-bar', 'heatmap'].includes(type)) spec.roles.series = 'c1';
  if (['line', 'area', 'scatter'].includes(type)) { spec.roles.x = 'c7'; spec.roles.series = 'c1'; }
  if (type === 'range') { spec.roles.low = 'c4'; spec.roles.high = 'c5'; }
  if (type === 'cleveland') spec.roles.values = ['c2', 'c3'];
  if (type === 'manhattan') { spec.roles.chromosome = 'c8'; spec.roles.position = 'c9'; spec.roles.p = 'c10'; }
  return spec;
}
export function plotObject(spec, id = 'plot-test') { return { id, name: spec.appearance.title, kind: 'plot', x: 400, y: 300, width: 520, height: 380, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true, locked: false, fill: '#FFFFFF', stroke: '#263238', strokeWidth: 1, plot: spec }; }
