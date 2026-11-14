import { readFile } from 'node:fs/promises';
import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, fixtureSpec, plotObject, analysisConfig } from './data-helpers.mjs';
import { PLOT_TYPES, plotSpecSchema } from '../app/src/domain/plots/spec.ts';
import { buildPlotScene, sceneToSvg } from '../app/src/domain/plots/scene.ts';
import { prepareObservations } from '../app/src/domain/analysis/observations.ts';
import { pairGroups } from '../app/src/domain/analysis/pairing.ts';
import { runAnalysis } from '../app/src/domain/stats/engine.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { readPortableProject } from '../app/src/domain/project/portable.ts';
import { sanitizeSvg } from '../app/src/domain/assets/sanitize.ts';
import { INPUT_LIMITS } from '../app/src/domain/security/input.ts';
const fixture = dataFixture();
test('duplicate wide mappings are refused at ingress and before row expansion', () => {
  for (const role of ['values', 'replicates']) {
    const spec = fixtureSpec(fixture.dataset, 'bar'); spec.layout = 'wide'; spec.roles = { x: 'c0', [role]: ['c2', 'c2'] };
    assert.equal(plotSpecSchema.safeParse(spec).success, false);
    assert.throws(() => parseProject({ ...fixture.project, objects: [plotObject(spec)] }), error => error.code === 'invalid_project');
    const rows = new Proxy(fixture.table.rows, { get(target, key) { if (key === Symbol.iterator) throw new Error('Rows were expanded before validation.'); return Reflect.get(target, key); } });
    assert.throws(() => prepareObservations({ ...fixture.table, rows }, spec), error => error.code === 'plot_mapping');
  }
});
test('derived observation ceiling is checked before reading any row', () => {
  const spec = fixtureSpec(fixture.dataset, 'bar'); spec.roles = { x: 'c0', y: 'c2' };
  const rows = new Proxy([], { get(_target, key) { if (key === 'length') return INPUT_LIMITS.datasetCells + 1; throw new Error('Rows were read before the allocation bound.'); } });
  assert.throws(() => prepareObservations({ ...fixture.table, rows }, spec), error => error.code === 'plot_observations');
});
for (const type of PLOT_TYPES) test(`${type} scene is deterministic, finite, exportable and strictly persisted`, () => {
  const spec = fixtureSpec(fixture.dataset, type), scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380);
  assert.equal(scene.error, null); assert.ok(scene.primitives.length >= 8); assert.deepEqual(buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380), scene);
  for (const primitive of scene.primitives) for (const value of Object.values(primitive)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  assert.doesNotThrow(() => sanitizeSvg(sceneToSvg(scene))); const project = { ...fixture.project, objects: [plotObject(spec)] };
  assert.equal(readPortableProject(JSON.stringify(parseProject(project))).objects[0].kind, 'plot');
  assert.throws(() => parseProject({ ...project, objects: [{ ...project.objects[0], children: [] }] }));
});
test('box whiskers terminate on data observations, with outliers always drawn', () => {
  const data = dataFixture('Group,Value\nA,1\nA,2\nA,3\nA,4\nA,100'), spec = fixtureSpec(data.dataset, 'box'); spec.roles = { x:'c0', y:'c1' }; spec.appearance.points.show = false;
  const scene = buildPlotScene(data.source, data.dataset, spec, 520, 380); assert.equal(scene.error, null); assert.equal(scene.primitives.filter(value => value.kind === 'circle').length, 1);
  const box = scene.primitives.find(value => value.kind === 'rect' && value.stroke === '#263238'); assert.ok(box); const cap = scene.primitives.filter(value => value.kind === 'line' && value.y1 === value.y2 && value.x2 - value.x1 < 40); assert.ok(cap.some(value => Math.abs(value.y1 - box.y) < .001));
});
test('violin singleton and zero variance use points and median without a fabricated density', () => {
  const data = dataFixture('Group,Value\nA,2\nB,3\nB,3'), spec = fixtureSpec(data.dataset, 'violin'); spec.roles = { x:'c0', y:'c1' };
  const scene = buildPlotScene(data.source, data.dataset, spec, 520, 380); assert.equal(scene.error, null); assert.equal(scene.primitives.filter(value => value.kind === 'path').length, 0); assert.equal(scene.primitives.filter(value => value.kind === 'circle').length, 3); assert.equal(scene.notices.filter(value => value.includes('no density')).length, 2);
});
test('heatmap structured keys cannot collide on punctuation and missing cells are blank', () => {
  const data = dataFixture('Row,Column,Value\n"a||b",c,1\na,"b||c",2\na,c,NA'), spec = fixtureSpec(data.dataset,'heatmap'); spec.roles = { x:'c0',series:'c1',y:'c2' };
  const scene = buildPlotScene(data.source,data.dataset,spec,520,380); assert.equal(scene.error,null); assert.equal(scene.primitives.filter(value => value.kind === 'rect' && value.fill !== '#FFFFFF').length,2); assert.ok(scene.notices.some(value => value.includes('missing_measure')));
});
test('Manhattan p=0 cap and invalid raw p are explicit and thresholds fit the domain', () => {
  const data = dataFixture('Chr,Position,P\nX,1,0\n1,2,2\n2,3,0.2'), spec = fixtureSpec(data.dataset,'manhattan'); spec.roles = {chromosome:'c0',position:'c1',p:'c2'};
  const scene = buildPlotScene(data.source,data.dataset,spec,520,380); assert.equal(scene.error,null); assert.equal(scene.observations.groups.flatMap(group => group.observations).length,2); assert.ok(scene.notices.some(value => value.includes('p_zero_capped'))); assert.ok(scene.notices.some(value => value.includes('p_out_of_domain')));
});
test('line duplicates require an explicit aggregate and missing Y splits paths', () => {
  const data = dataFixture('X,Y\n1,1\n2,2\n3,NA\n4,4\n5,5\n5,7'), spec = fixtureSpec(data.dataset,'line'); spec.roles = {x:'c0',y:'c1'}; spec.error='none'; spec.aggregate='none';
  assert.match(buildPlotScene(data.source,data.dataset,spec,520,380).error,/Duplicate X/); spec.aggregate='mean'; const scene=buildPlotScene(data.source,data.dataset,spec,520,380); assert.equal(scene.error,null); assert.equal(scene.primitives.filter(value=>value.kind==='path').length,2); assert.equal(scene.observations.combinedRows,1);
});
test('explicit roles govern area values and shared blank-group exclusions', () => {
  const spec=fixtureSpec(fixture.dataset,'area'); spec.roles.y='c3'; const prepared=prepareObservations(fixture.table,spec); assert.equal(prepared.groups[0].observations[0].y,2);
  const data=dataFixture('Group,Y\nA,1\n,100\nB,2'), mapped=fixtureSpec(data.dataset,'bar'); mapped.roles={x:'c0',y:'c1'}; const observations=prepareObservations(data.table,mapped); assert.equal(observations.groups.length,2); assert.equal(observations.exclusions[0].reason,'blank_group');
});
test('ID pairing excludes unmatched IDs and rejects duplicates; row-order requires wide data', () => {
  const spec=fixtureSpec(fixture.dataset,'bar'); spec.analysis=analysisConfig('paired-t'); const prepared=prepareObservations(fixture.table,spec); const paired=pairGroups(prepared.groups[0],prepared.groups[1],spec); assert.equal(paired.a.length,3);
  const duplicate=structuredClone(prepared.groups[0]); duplicate.observations.push(duplicate.observations[0]); assert.throws(()=>pairGroups(duplicate,prepared.groups[1],spec),error=>error.code==='duplicate_subject');
  spec.analysis.pairing='row-order'; assert.throws(()=>pairGroups(prepared.groups[0],prepared.groups[1],spec));
});
test('planned comparisons retain failed pairs and display filtering never changes adjustment family', () => {
  const data=dataFixture('Group,Y\nA,1\nA,2\nB,3\nB,4\nC,5'), spec=fixtureSpec(data.dataset,'bar'); spec.roles={x:'c0',y:'c1'}; spec.analysis=analysisConfig();
  const result=runAnalysis(prepareObservations(data.table,spec),spec); assert.equal(result.familySize,3); assert.equal(result.comparisons.filter(value=>value.result.p===null).length,2); assert.equal(result.comparisons[0].adjustedP,Math.min(1,result.comparisons[0].result.p*3));
  spec.analysis.hideNs=true; assert.equal(runAnalysis(prepareObservations(data.table,spec),spec).familySize,3);
});
test('recoverable missing datasets and mappings preserve the stored specification', () => {
  const spec=fixtureSpec(fixture.dataset,'bar'); spec.roles.y='c999'; const project={...fixture.project,objects:[plotObject(spec)]}; assert.doesNotThrow(()=>parseProject(project)); assert.match(buildPlotScene(fixture.source,fixture.dataset,spec,520,380).error,/mapped column/);
  project.datasets=[]; project.dataSources=[]; assert.doesNotThrow(()=>parseProject(project)); assert.match(buildPlotScene(undefined,undefined,spec,520,380).error,/dataset is missing/);
});
test('stored p-values never govern the scene, bracket labels or current statistics', () => {
  const spec=fixtureSpec(fixture.dataset,'bar'); spec.analysis=analysisConfig(); const current=buildPlotScene(fixture.source,fixture.dataset,spec,520,380); spec.result=structuredClone(current.result); spec.result.comparisons[0].result.p=1e-100; spec.result.comparisons[0].adjustedP=1e-100; spec.result.comparisons[0].selectedP=1e-100; spec.result.comparisons[0].significant=true; spec.result.comparisons[0].label='****';
  const scene=buildPlotScene(fixture.source,fixture.dataset,spec,520,380); assert.deepEqual(scene.result,current.result); assert.ok(scene.notices.some(value=>value.includes('stored statistic'))); assert.doesNotMatch(sceneToSvg(scene),/>\*\*\*\*</);
});
test('figure-wide plot budget counts repeated data and nested groups in full', () => {
  const spec=fixtureSpec(fixture.dataset,'bar'), scene=buildPlotScene(fixture.source,fixture.dataset,spec,520,380); const count=Math.floor(INPUT_LIMITS.plotElements/scene.budget.elements)+1;
  const plots=Array.from({length:count},(_,index)=>plotObject(structuredClone(spec),`plot-${index}`)); assert.throws(()=>parseProject({...fixture.project,objects:plots}),error=>error.code==='plot_budget');
  const group={...plots[0],id:'budget-group',kind:'group',children:plots};delete group.plot;assert.throws(()=>parseProject({...fixture.project,objects:[group]}),error=>error.code==='plot_budget');
});

for (const type of PLOT_TYPES) test(type + ' matches its reviewed primitive snapshot', async () => {
  const fixture = dataFixture(), scene = buildPlotScene(fixture.source, fixture.dataset, fixtureSpec(fixture.dataset, type), 520, 380);
  const expected = JSON.parse(await readFile(new URL('./fixtures/plots/' + type + '.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify({primitives:scene.primitives, notices:scene.notices, error:scene.error})), expected);
});

test('Kruskal-Wallis with two groups requires an explicit two-group test', () => {
  const fixture = dataFixture(), spec = fixtureSpec(fixture.dataset, 'box'); spec.analysis = {test:'kruskal-wallis',pairing:'id',comparisons:'all',control:null,adjustment:'holm',alpha:.05,useAdjusted:true,label:'stars',hideNs:false};
  const scene = buildPlotScene(fixture.source, fixture.dataset, spec, 520, 380); assert.match(scene.error, /two-group test/); assert.equal(scene.result, null);
});
