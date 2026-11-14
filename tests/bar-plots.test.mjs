import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, analysisConfig, plotObject } from './data-helpers.mjs';
import { defaultPlotSpec } from '../app/src/domain/plots/spec.ts';
import { arrangePlot } from '../app/src/domain/plots/mapping.ts';
import { buildPlotScene, sceneToSvg } from '../app/src/domain/plots/scene.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { readPortableProject } from '../app/src/domain/project/portable.ts';
import { recommendPlots } from '../app/src/domain/plots/recommend.ts';

test('dot columns show an aggregate column plus every observation; cross bars remain horizontal', () => {
  const fixture = dataFixture('Group,Value\nA,1\nA,3\nB,-2\nB,-4');
  const spec = defaultPlotSpec(fixture.dataset, 'dot-column'); spec.error = 'none'; spec.appearance.legend = false; spec.appearance.points.show = false;
  const scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380);
  assert.equal(scene.error, null);
  const bars = scene.primitives.filter(primitive => primitive.kind === 'rect' && primitive.fill !== '#FFFFFF');
  assert.equal(bars.length, 2); assert.equal(scene.primitives.filter(primitive => primitive.kind === 'circle').length, 4);
  assert.ok(Math.abs(bars[1].height / bars[0].height - 1.5) < 0.001);
  assert.ok(bars[0].y < bars[1].y); assert.equal(scene.observations.groups[0].observations.length, 2);
  const cross = buildPlotScene(fixture.source, fixture.dataset, { ...spec, type: 'dot-bar' }, 520, 380);
  assert.equal(cross.primitives.filter(primitive => primitive.kind === 'rect' && primitive.fill !== '#FFFFFF').length, 0);
  assert.equal(cross.primitives.filter(primitive => primitive.kind === 'circle').length, 4);
  assert.equal(cross.primitives.filter(primitive => primitive.kind === 'line' && primitive.stroke === spec.appearance.palette[0] && primitive.y1 === primitive.y2).length, 1);
});

test('grouped bars require distinct row group, series and numeric measure roles', () => {
  const fixture = dataFixture('Treatment,Timepoint,Value\nA,Early,2\nA,Late,4\nB,Early,6\nB,Late,8');
  const spec = defaultPlotSpec(fixture.dataset, 'grouped-bar');
  assert.match(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380).error, /group, series and value columns/);
  spec.roles = { x: 'c0', series: 'c0', y: 'c2' }; assert.match(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380).error, /distinct/);
  spec.roles = { x: 'c0', series: 'c1', y: 'c2' }; spec.layout = 'wide'; spec.roles.values = ['c2'];
  assert.match(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380).error, /row data/);
  const suggestion = recommendPlots(fixture.dataset).find(suggestion => suggestion.type === 'grouped-bar'); assert.deepEqual(suggestion.roles, { x: 'c0', series: 'c1', y: 'c2' });
});

test('grouped bars cluster series within X groups, share series colors and leave missing combinations blank', () => {
  const fixture = dataFixture('Treatment,Timepoint,Value\nA,Early,2\nA,Early,4\nA,Late,6\nB,Early,8\nB,Late,10\nC,Late,12');
  const spec = defaultPlotSpec(fixture.dataset, 'grouped-bar'); spec.roles = { x: 'c0', series: 'c1', y: 'c2' }; spec.error = 'none'; spec.appearance.legend = false;
  const scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380); assert.equal(scene.error, null);
  const bars = scene.primitives.filter(primitive => primitive.kind === 'rect' && primitive.fill !== '#FFFFFF'); assert.equal(bars.length, 5);
  assert.equal(bars[0].fill, bars[2].fill); assert.equal(bars[1].fill, bars[3].fill); assert.equal(bars[3].fill, bars[4].fill); assert.notEqual(bars[0].fill, bars[1].fill);
  assert.ok(bars[1].x - bars[0].x < bars[2].x - bars[1].x);
  const labels = scene.primitives.filter(primitive => primitive.kind === 'text' && ['A','B','C'].includes(primitive.text)); assert.equal(labels.length, 3);
  assert.ok(Math.abs((bars[0].x + bars[0].width/2 + bars[1].x + bars[1].width/2)/2 - labels[0].x) < 0.001);
  assert.ok(bars[4].x + bars[4].width/2 > labels[2].x, 'the missing Early slot must remain empty');
  spec.analysis = analysisConfig('pairwise-welch'); const statistics = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 600);
  assert.equal(statistics.error, null); assert.equal(statistics.result.groups.length, 5); assert.equal(statistics.result.groups[0].descriptive.mean, 3);
  assert.equal(statistics.result.groups[0].descriptive.n, 2);
});

test('dot columns retain column-header means, optional statistics, finite SVG and portable persistence', () => {
  const fixture = dataFixture('Control,Treatment\nNA,0\n2,6\n4,12');
  const spec = { ...arrangePlot(defaultPlotSpec(fixture.dataset), fixture.dataset, 'columns'), type: 'dot-column', analysis: analysisConfig() };
  const scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380); assert.equal(scene.error, null);
  assert.deepEqual(scene.result.groups.map(group => [group.label,group.descriptive.n,group.descriptive.mean]), [['Control',2,3],['Treatment',3,6]]);
  assert.equal(scene.primitives.filter(primitive => primitive.kind === 'circle').length, 5);
  const svg = sceneToSvg(scene); assert.doesNotMatch(svg, /NaN|Infinity|<script/);
  const project = readPortableProject(JSON.stringify(parseProject({ ...fixture.project, objects: [plotObject(spec)] })));
  assert.equal(project.objects[0].plot.type, 'dot-column'); assert.deepEqual(project.objects[0].plot.roles.values, ['c0','c1']);
});
