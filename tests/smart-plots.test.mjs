import './dom-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, analysisConfig, plotObject } from './data-helpers.mjs';
import { initialPlotSpec, recommendPlots } from '../app/src/domain/plots/recommend.ts';
import { defaultPlotSpec, plotSpecSchema } from '../app/src/domain/plots/spec.ts';
import { prepareObservations } from '../app/src/domain/analysis/observations.ts';
import { buildPlotScene, sceneToSvg } from '../app/src/domain/plots/scene.ts';
import { dataArrangement, arrangePlot } from '../app/src/domain/plots/mapping.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
import { readPortableProject } from '../app/src/domain/project/portable.ts';
import { initialAnalysisConfig, statisticalChoices } from '../app/src/domain/stats/guidance.ts';

const setup = text => { const f = dataFixture(text); return { ...f, spec: initialPlotSpec(f.dataset) }; };
const sceneFor = f => buildPlotScene(f.source, f.dataset, f.spec, 520, 380);
test('numeric headers default to per-column means; numeric and text subject IDs are excluded', () => {
  for (const ids of ['1\n2\n3', 's1\ns2\ns3']) {
    const f = setup('Subject ID,Control,Treatment\n' + ids.split('\n').map((id,i) => `${id},${i+1},${i+6}`).join('\n'));
    assert.equal(f.spec.layout,'wide'); assert.equal(f.spec.type,'bar'); assert.equal(f.spec.aggregate,'mean');
    assert.deepEqual(f.spec.roles,{values:['c1','c2'],id:'c0'}); assert.equal(f.spec.analysis,null);
    assert.deepEqual(sceneFor(f).observations.groups.map(g=>g.observations.map(o=>o.y)),[[1,2,3],[6,7,8]]);
  }
  assert.deepEqual(setup('A,B\n1,2\n3,4').spec.roles,{values:['c0','c1']});
  assert.deepEqual(setup('Value\n1\n3').spec.roles,{values:['c0']});
});
for (const header of ['Time (h)','Elapsed_seconds','Day','Date']) test(`${header} maps to X and every measure is a distinct series`, () => {
  const dates=header==='Date', f=setup(`${header},Control,Treatment\n${dates?'2026-01-01':0},1,7\n${dates?'2026-01-02':1},,8\n${dates?'2026-01-03':2},3,9`);
  assert.equal(f.spec.type,'line');assert.equal(f.spec.layout,'wide-series');assert.equal(dataArrangement(f.spec),'series-columns');
  assert.deepEqual(f.spec.roles,{x:'c0',values:['c1','c2']});assert.equal(f.spec.error,'sd');
  const scene=sceneFor(f);assert.equal(scene.error,null);assert.deepEqual(scene.observations.groups.map(g=>g.label),['Control','Treatment']);
  assert.deepEqual(scene.observations.groups.map(g=>g.observations.map(o=>o.y)),[[1,3],[7,8,9]]);
  assert.equal(scene.observations.gaps[0].series,'Control');assert.equal(scene.primitives.filter(p=>p.kind==='path'&&p.fill==='none').length,3);
  assert.doesNotMatch(sceneToSvg(scene),/NaN|Infinity/);
  const imported=readPortableProject(JSON.stringify(parseProject({...f.project,objects:[plotObject(f.spec)]})));
  assert.deepEqual(imported.objects[0].plot,f.spec);
});
test('long time series use time, value and group roles, not averages across time', () => {
  const f=setup('Subject,Time,Group,Value\ns1,0,A,1\ns1,1,A,2\ns2,0,B,5\ns2,1,B,6');
  assert.equal(f.spec.type,'line');assert.equal(f.spec.layout,'long');assert.deepEqual(f.spec.roles,{x:'c1',y:'c3',series:'c2',id:'c0'});
  assert.equal(sceneFor(f).observations.groups.length,2);
});
test('category plus measure is a mean bar; two factors or category plus measures form actual grouped bars', () => {
  let f=setup('Group,Value,ID\nA,1,1\nA,2,2\nB,3,1\nB,5,2');assert.equal(f.spec.type,'bar');assert.deepEqual(f.spec.roles,{x:'c0',y:'c1',id:'c2'});
  f=setup('Group,Condition,Value\nA,Pre,1\nA,Post,3\nB,Pre,2\nB,Post,5');assert.equal(f.spec.type,'grouped-bar');assert.equal(f.spec.layout,'long');assert.deepEqual(f.spec.roles,{x:'c0',series:'c1',y:'c2'});
  f=setup('Group,Pre,Post\nA,1,3\nA,3,5\nB,2,5\nB,4,7');assert.equal(f.spec.type,'grouped-bar');assert.equal(f.spec.layout,'wide-series');
  f.spec.appearance.legend=false;const scene=sceneFor(f);assert.equal(scene.error,null);assert.deepEqual(scene.observations.groups.map(g=>g.label),['A · Pre','A · Post','B · Pre','B · Post']);
  const bars=scene.primitives.filter(p=>p.kind==='rect'&&f.spec.appearance.palette.includes(p.fill));assert.equal(bars.length,4);assert.equal(new Set(bars.map(p=>p.x)).size,4);assert.equal(new Set(bars.map(p=>p.fill)).size,2);
});
test('explicit numeric X headers suggest scatter; ambiguous two measures remain column means', () => {
  assert.equal(setup('X,Y\n1,3\n2,6').spec.type,'scatter');
  assert.equal(setup('Dose,Response\n1,3\n2,6').spec.type,'scatter');
  assert.equal(setup('Height,Weight\n1,3\n2,6').spec.layout,'wide');
  const f=setup('Height,Weight\n1,3\n2,6');assert.ok(recommendPlots(f.dataset).some(s=>s.type==='scatter'));
});
test('series mapping rejects X as a measure, mixed row series, unsupported types and excessive expansion', () => {
  const f=setup('Time,A,B\n0,1,2\n1,2,3');
  for (const roles of [{x:'c0',values:['c0','c1']},{x:'c0',values:['c1'],series:'c2'},{x:'c0',values:['c1'],replicates:['c2']}]) {
    assert.throws(()=>prepareObservations(f.table,{...f.spec,roles}),/Separate column series/);
  }
  assert.throws(()=>prepareObservations(f.table,{...f.spec,type:'bar'}),/Separate column series/);
  assert.equal(plotSpecSchema.safeParse({...f.spec,roles:{x:'c0',values:['c1','c1']}}).success,false);
  const large=setup('Time,'+Array.from({length:51},(_,i)=>'M'+i).join(',')+'\n0,'+Array(51).fill('1').join(','));
  assert.deepEqual(large.spec.roles.values,[]);assert.match(sceneFor(large).error,/at least one value/);
  const rows=Array.from({length:500001},(_,i)=>({row:i,cells:f.table.rows[0].cells}));
  assert.throws(()=>prepareObservations({...f.table,rows},f.spec),/observation limit/);
});
const paired=()=>setup('ID,Before,After\ns1,1,12\ns2,2,16\ns3,4,15\ns4,3,19\ns5,6,18\ns6,5,21');
for (const type of ['bar','dot-bar','dot-column','box','violin','line','area']) test(`paired stars and brackets render on ${type}, with toggles controlling only display`, () => {
  const f=paired();f.spec.type=type;f.spec.options=defaultPlotSpec(f.dataset,type).options;f.spec.analysis={...analysisConfig('paired-t'),showBrackets:true};
  let scene=sceneFor(f);assert.equal(scene.error,null);assert.equal(scene.result.comparisons.length,1);const comparison=scene.result.comparisons[0];assert.equal(comparison.matchedPairs,6);assert.match(comparison.label,/^\*+$/);
  const star=scene.primitives.find(p=>p.kind==='text'&&p.text===comparison.label);assert.ok(star);assert.ok(star.y>0);assert.ok(star.x>0&&star.x<520);
  assert.match(sceneToSvg(scene),new RegExp('>'+comparison.label.replaceAll('*','\\*')+'</text>'));
  f.spec.analysis.showBrackets=false;scene=sceneFor(f);assert.deepEqual(scene.result.comparisons[0],comparison);assert.ok(!scene.primitives.some(p=>p.kind==='text'&&p.text===comparison.label));
});
test('explicit row pairing also draws stars; no ID, constant differences and Hide ns explain missing annotations', () => {
  const f=paired();delete f.spec.roles.id;f.spec.type='line';f.spec.analysis={...analysisConfig('paired-t'),pairing:'row-order'};
  let scene=sceneFor(f);assert.equal(scene.error,null);assert.ok(scene.primitives.some(p=>p.kind==='text'&&/^\*+$/.test(p.text)));
  f.spec.analysis.pairing='id';scene=sceneFor(f);assert.ok(scene.notices.includes('bracketsNotComputable'));assert.match(scene.result.comparisons[0].result.reason,/subject ID/);
  const constant=setup('A,B\n1,3\n2,4\n3,5');constant.spec.analysis={...analysisConfig('paired-t'),pairing:'row-order'};assert.ok(sceneFor(constant).notices.includes('bracketsNotComputable'));
  const ns=setup('A,B\n1,1.1\n2,1.9\n3,3.1');ns.spec.analysis={...analysisConfig(),hideNs:true};assert.ok(sceneFor(ns).notices.includes('bracketsHiddenNs'));
});
test('continuous series do not imply pointwise comparisons and explain the categorical bracket requirement', () => {
  const f=setup('Time,A,B\n0,1,9\n1,2,13\n2,4,11');f.spec.analysis=analysisConfig();
  const scene=sceneFor(f);assert.equal(scene.error,null);assert.ok(scene.notices.includes('bracketsNeedCategories'));assert.ok(!scene.primitives.some(p=>p.kind==='text'&&/^\*+$/.test(p.text)));
  f.spec.analysis={...analysisConfig('paired-t'),pairing:'row-order'};assert.match(sceneFor(f).result.comparisons[0].result.reason,/Row-order pairing requires column groups/);
});
test('manual series arrangement stays editable and preserves old wide column and replicate meanings', () => {
  const f=paired(), series=arrangePlot(f.spec,f.dataset,'series-columns');assert.equal(series.layout,'wide-series');
  const old=defaultPlotSpec(f.dataset);old.layout='wide';old.roles={x:'c0',values:['c1','c2']};
  assert.deepEqual(prepareObservations(f.table,old).groups.map(g=>g.label),['Before','After']);
});
test('wide non-time paired defaults match rows; explicit IDs and time data require identity-based setup', () => {
  const wide=setup('CTRL,TEST2,TEST3\n1,4,7\n2,6,8');const groups=prepareObservations(wide.table,wide.spec).groups;
  assert.equal(wide.spec.analysis,null);assert.equal(initialAnalysisConfig(wide.spec,wide.dataset,'paired-t',groups).pairing,'row-order');
  assert.equal(initialAnalysisConfig(paired().spec,paired().dataset,'paired-t',groups).pairing,'id');
  const time=setup('Time,A,B\n0,1,8\n1,3,9');time.spec=arrangePlot(time.spec,time.dataset,'columns');assert.deepEqual(time.spec.roles.values,['c1','c2']);
  assert.equal(initialAnalysisConfig(time.spec,time.dataset,'paired-t',groups).pairing,'id');
  const config=initialAnalysisConfig(wide.spec,wide.dataset,'welch',groups);assert.equal(config.adjustment,'holm');assert.equal(config.comparisons,'selected');assert.deepEqual(config.pairs,[]);
  assert.equal(statisticalChoices(1).length,0);assert.ok(statisticalChoices(2).some(choice=>choice.test==='welch'));assert.ok(statisticalChoices(3).some(choice=>choice.test==='anova'));
});
test('similarly labelled conditions are wide groups, including day numbers and indexed X/time names', () => {
  for(const headers of ['CTRL,TEST2,TEST3','Day 1,Day 7,Day 14','X1,X2,X3','Time_1,Time_2,Time_3','Time (control),Time (treated),Time (followup)']){
    const f=setup(headers+'\n1,4,7\n2,5,8');assert.equal(f.spec.layout,'wide',headers);assert.deepEqual(f.spec.roles.values,['c0','c1','c2']);
    assert.equal(initialAnalysisConfig(f.spec,f.dataset,'paired-t',prepareObservations(f.table,f.spec).groups).pairing,'row-order');
  }
});
test('SD is the initial error interval for every inferred and manually constructed type', () => {
  for(const text of ['A,B\n1,4\n2,6','Time,A,B\n0,1,8\n1,3,9','Group,Y\nA,1\nB,4']){
    const f=setup(text);assert.equal(f.spec.error,'sd');assert.equal(defaultPlotSpec(f.dataset).error,'sd');
    for(const suggestion of recommendPlots(f.dataset))assert.equal(suggestion.error,'sd');
  }
});
