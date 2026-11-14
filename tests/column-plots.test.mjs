import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, analysisConfig, plotObject } from './data-helpers.mjs';
import { defaultPlotSpec, plotSpecSchema } from '../app/src/domain/plots/spec.ts';
import { arrangePlot, dataArrangement } from '../app/src/domain/plots/mapping.ts';
import { prepareObservations } from '../app/src/domain/analysis/observations.ts';
import { buildPlotScene, sceneToSvg } from '../app/src/domain/plots/scene.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { readPortableProject } from '../app/src/domain/project/portable.ts';

const data = () => dataFixture('ID,Control,Treatment,Unused\na,NA,0,900\nb,2,6,901\nc,4,12,902');
test('saved wide Cleveland plots retain their row-label mapping in the editor', () => {
  const fixture = data(), spec = defaultPlotSpec(fixture.dataset, 'cleveland');
  spec.layout = 'wide'; spec.roles = { x: 'c0', values: ['c1', 'c2'] };
  assert.equal(dataArrangement(spec), 'rows'); assert.equal(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380).error, null);
});
test('column arrangement selects numeric columns explicitly, clears stale roles and starts with mean bars', () => {
  const fixture = data(), previous = defaultPlotSpec(fixture.dataset, 'scatter');
  previous.roles = { x: 'c1', y: 'c2', series: 'c0', replicates: ['c3'] }; previous.aggregate = 'sum'; previous.analysis = analysisConfig();
  const spec = arrangePlot(previous, fixture.dataset, 'columns');
  assert.equal(spec.type, 'bar'); assert.equal(spec.aggregate, 'mean'); assert.equal(spec.error, 'sd'); assert.equal(spec.analysis, null);
  assert.equal(dataArrangement(spec), 'columns'); assert.deepEqual(spec.roles, { values: ['c1', 'c2', 'c3'] });
  assert.equal(plotSpecSchema.safeParse(spec).success, true);
  const rows = arrangePlot(spec, fixture.dataset, 'rows'); assert.equal(dataArrangement(rows), 'rows'); assert.deepEqual(rows.roles, { x: 'c0', y: 'c1' });
  const replicates = arrangePlot(rows, fixture.dataset, 'replicates'); assert.equal(dataArrangement(replicates), 'replicates'); assert.deepEqual(replicates.roles, { x: 'c0', replicates: ['c1', 'c2', 'c3'] });
  replicates.roles.replicates = []; assert.equal(dataArrangement(replicates), 'replicates');
});
test('more than 50 numeric columns requires an explicit selection without silent truncation', () => {
  const fixture = dataFixture(Array.from({ length: 51 }, (_, i) => 'M' + i).join(',') + '\n' + Array(51).fill('1').join(','));
  const spec = arrangePlot(defaultPlotSpec(fixture.dataset), fixture.dataset, 'columns');
  assert.deepEqual(spec.roles.values, []); assert.match(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380).error, /at least one value column/);
});
test('column means use each column independently, retain zero and follow selected order despite leading missing values', () => {
  const fixture = data(), spec = arrangePlot(defaultPlotSpec(fixture.dataset), fixture.dataset, 'columns');
  spec.roles.values = ['c1', 'c2']; spec.analysis = analysisConfig(); spec.error = 'none'; spec.appearance.yMin = 0; spec.appearance.yMax = 12; spec.appearance.legend = false;
  const scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380);
  assert.equal(scene.error, null);
  assert.deepEqual(scene.result.groups.map(group => [group.label, group.descriptive.n, group.descriptive.mean]), [['Control', 2, 3], ['Treatment', 3, 6]]);
  assert.equal(scene.result.groups[0].descriptive.sem, 1);
  assert.ok(Math.abs(scene.result.groups[1].descriptive.sem - Math.sqrt(12)) < 1e-12);
  assert.deepEqual(scene.observations.groups.map(group => group.observations.map(value => value.y)), [[2, 4], [0, 6, 12]]);
  const bars = scene.primitives.filter(primitive => primitive.kind === 'rect' && spec.appearance.palette.includes(primitive.fill));
  assert.equal(bars.length, 2); assert.ok(bars[0].x < bars[1].x); assert.ok(Math.abs(bars[1].height / bars[0].height - 2) < 0.0001);
  spec.roles.values = ['c2', 'c1']; assert.deepEqual(prepareObservations(fixture.table, spec).groups.map(group => group.label), ['Treatment', 'Control']);
  const persisted = readPortableProject(JSON.stringify(parseProject({ ...fixture.project, objects: [plotObject(spec)] })));
  assert.deepEqual(persisted.objects[0].plot.roles.values, ['c2', 'c1']);
});
for (const type of ['line', 'area']) test(`${type} uses column names at distinct X positions and breaks at entirely missing columns`, () => {
  const fixture = dataFixture('Control,Missing,Treatment\n2,NA,6\n4,NA,12', undefined, [
    { key: 'c0', name: 'Control', type: 'number', levels: null }, { key: 'c1', name: 'Missing', type: 'number', levels: null }, { key: 'c2', name: 'Treatment', type: 'number', levels: null },
  ]);
  const spec = arrangePlot(defaultPlotSpec(fixture.dataset), fixture.dataset, 'columns'); spec.type = type; spec.error = 'none'; spec.appearance.points.show = true;
  let scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380); assert.equal(scene.error, null);
  const circles = scene.primitives.filter(primitive => primitive.kind === 'circle'); assert.equal(circles.length, 2); assert.ok(circles[0].x < circles[1].x);
  assert.equal(scene.primitives.filter(primitive => primitive.kind === 'path' && primitive.fill === 'none').length, 2);
  for (const name of ['Control', 'Missing', 'Treatment']) assert.ok(scene.primitives.some(primitive => primitive.kind === 'text' && primitive.text === name));
  spec.roles.values = ['c0', 'c2']; scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380);
  assert.equal(scene.primitives.filter(primitive => primitive.kind === 'path' && primitive.fill === 'none').length, 1);
  assert.doesNotMatch(sceneToSvg(scene), /NaN|Infinity/);
});
test('malicious column headers remain escaped in the column-mean SVG', () => {
  const fixture = dataFixture('<script>alert(1)</script>,Safe\n1,2\n3,4'), spec = arrangePlot(defaultPlotSpec(fixture.dataset), fixture.dataset, 'columns');
  const svg = sceneToSvg(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380));
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/);
});
