import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFixture, analysisConfig, plotObject } from './data-helpers.mjs';
import { defaultPlotSpec } from '../app/src/domain/plots/spec.ts';
import { prepareObservations } from '../app/src/domain/analysis/observations.ts';
import { runAnalysis } from '../app/src/domain/stats/engine.ts';
import { buildPlotScene, sceneToSvg } from '../app/src/domain/plots/scene.ts';
import { statisticsRows } from '../app/src/domain/stats/export.ts';
import { analysisConfigSchema } from '../app/src/domain/stats/schema.ts';
import { parseProject } from '../app/src/domain/project/schema.ts';
const key = name => JSON.stringify([name,null]);
const input = 'Group,Y,ID\nA,1,i1\nA,3,i2\nA,4,i3\nB,5,i1\nB,8,i2\nB,10,i4\nC,11,i1\nC,12,i2\nC,16,i3';
function setup(text=input,test='welch') {const f=dataFixture(text), spec=defaultPlotSpec(f.dataset,'bar');spec.roles={x:'c0',y:'c1',id:'c2'};spec.analysis={...analysisConfig(test),comparisons:'selected',pairs:[[key('A'),key('B')]]};return {...f,spec};}
const run = f => runAnalysis(prepareObservations(f.table,f.spec),f.spec);
test('specific pairs are keyed identities, preserved across methods and reordered groups',()=>{
  const f=setup();f.spec.analysis.pairs=[[key('A'),key('C')]];
  for(const test of ['welch','student','mann-whitney','paired-t','wilcoxon','pairwise-welch','kruskal-wallis']){
    f.spec.analysis.test=test;const r=run(f);assert.equal(r.familySize,1);assert.deepEqual(r.comparisons.map(c=>[r.groups[c.a].label,r.groups[c.b].label]),[['A','C']]);
  }
  f.dataset.columns[0].levels=['C','B','A'];f.table.columns[0].levels=['C','B','A'];assert.deepEqual(run(f).comparisons.map(c=>[c.a,c.b]),[[0,2]]);
});
test('unselected malformed paired groups cannot block a valid selected pair',()=>{
  const f=setup(input+'\nC,,i1','paired-t');const r=run(f);assert.equal(r.comparisons[0].matchedPairs,2);assert.equal(r.comparisons[0].excludedA,1);assert.equal(r.comparisons[0].excludedB,1);assert.notEqual(r.comparisons[0].result.p,null);
  f.spec.analysis.pairs.push([key('A'),key('C')]);const changed=run(f);assert.equal(changed.familySize,2);assert.match(changed.comparisons[1].result.reason,/subject ID occurs/);assert.equal(changed.comparisons[1].matchedPairs,null);assert.equal(changed.comparisons[0].adjustedP,Math.min(1,2*r.comparisons[0].result.p));
});
test('paired counts include missing values, no compaction shifts the source-row matches',()=>{
  const f=setup('A,B,C\n1,3,9\n2,,8\n4,8,7\n,10,6','paired-t');f.spec.layout='wide';f.spec.roles={values:['c0','c1','c2']};f.spec.analysis.pairing='row-order';
  const r=run(f), c=r.comparisons[0];assert.equal(c.matchedPairs,2);assert.equal(c.excludedA,2);assert.equal(c.excludedB,2);assert.equal(c.result.df,1);
  f.spec.layout='long';f.spec.roles={x:'c2',y:'c0'};f.spec.analysis.comparisons='all';assert.ok(run(f).comparisons.every(c=>c.result.p===null));
});
test('duplicate IDs are rejected even when the duplicate has an excluded measure',()=>{
  const f=setup(input+'\nA,,i1','paired-t');const result=run(f);assert.match(result.comparisons[0].result.reason,/subject ID occurs/);assert.equal(result.comparisons[0].result.p,null);
});
test('row-order cannot manufacture pairs from replicate columns',()=>{
  const f=setup('Group,Y,Z\nA,1,2\nA,3,4\nB,5,6\nB,7,8','paired-t');f.spec.layout='wide';f.spec.roles={x:'c0',replicates:['c1','c2']};f.spec.analysis.pairing='row-order';assert.match(run(f).comparisons[0].result.reason,/column groups/);
});
test('missing selected groups never silently change the family and remain repairable in preview',()=>{
  const f=setup();f.spec.analysis.pairs=[[key('A'),key('Missing')]];assert.throws(()=>run(f),/no longer available/);
  const scene=buildPlotScene(f.source,f.dataset,f.spec,520,380);assert.match(scene.error,/no longer available/);assert.equal(scene.result,null);assert.equal(scene.observations.groups.length,3);
});
test('empty selection runs no pairwise tests; self/reversed duplicate pairs are rejected',()=>{
  const f=setup();f.spec.analysis.pairs=[];assert.equal(run(f).familySize,0);assert.deepEqual(run(f).comparisons,[]);
  for(const pairs of [[[key('A'),key('A')]],[[key('A'),key('B')],[key('B'),key('A')]]]){f.spec.analysis.pairs=pairs;assert.throws(()=>run(f),/each pair only once/);}
  assert.equal(analysisConfigSchema.safeParse({...analysisConfig(),pairs:Array.from({length:191},()=>[key('A'),key('B')])}).success,false);
  assert.equal(analysisConfigSchema.safeParse({...analysisConfig(),pairs:[[key('A'),42]]}).success,false);
});
test('Tukey retains full family p-values and confidence intervals for subset/control/display changes',()=>{
  const f=setup(input,'anova');f.spec.analysis={...f.spec.analysis,postHoc:'tukey',comparisons:'all'};const all=run(f);assert.equal(all.familySize,3);
  f.spec.analysis.comparisons='selected';const subset=run(f);assert.equal(subset.comparisons.length,1);assert.equal(subset.familySize,3);assert.deepEqual(subset.comparisons[0],all.comparisons[0]);
  f.spec.analysis.adjustment='bonferroni';f.spec.analysis.useAdjusted=false;f.spec.analysis.hideNs=true;f.spec.analysis.showBrackets=false;assert.deepEqual(run(f).comparisons,subset.comparisons);
  f.spec.analysis.comparisons='control';f.spec.analysis.control=key('A');assert.deepEqual(run(f).comparisons,all.comparisons.slice(0,2));
  f.spec.analysis.postHoc='none';const only=run(f);assert.equal(only.familySize,0);assert.deepEqual(only.global,all.global);assert.deepEqual(only.comparisons,[]);
});
test('overall annotation, Tukey intervals and pairing diagnostics survive portable persistence and CSV',()=>{
  const f=setup(input,'anova');f.spec.analysis.showGlobal=true;f.spec.analysis.label='p';let scene=buildPlotScene(f.source,f.dataset,f.spec,640,480);
  assert.match(sceneToSvg(scene),/One-way ANOVA: F\(2, 6\)/);assert.match(sceneToSvg(scene),/p =/);f.spec.result=scene.result;
  const project=parseProject({...f.project,objects:[plotObject(f.spec)]});assert.deepEqual(project.objects[0].plot.analysis,f.spec.analysis);assert.equal(project.objects[0].plot.result.global.df2,6);
  const rows=statisticsRows(scene.result,f.spec.analysis,'ANOVA');assert.ok(rows[5][1].includes('Tukey'));assert.ok(rows.flat().includes('df denominator'));assert.ok(rows.flat().includes('Difference CI low'));
  f.spec.analysis.test='paired-t';f.spec.result=null;const paired=run(f);assert.ok(statisticsRows(paired,f.spec.analysis,'Paired').flat().includes('Matched pairs'));
});
test('ANOVA group and alpha limits fail boundedly and keep the group picker available',()=>{
  const f=setup('Group,Y\n'+Array.from({length:21},(_,i)=>`G${i},1\nG${i},3`).join('\n'),'anova');f.spec.roles={x:'c0',y:'c1'};f.spec.analysis.comparisons='all';
  const scene=buildPlotScene(f.source,f.dataset,f.spec,520,380);assert.match(scene.error,/190 comparisons|20 groups/);assert.equal(scene.observations.groups.length,21);
  f.spec.analysis.postHoc='none';assert.ok(run(f).global.p!==null);
  const smaller=setup(input,'anova');smaller.spec.analysis.alpha=1e-50;assert.throws(()=>run(smaller),/alpha between/);
});
test('pair identity collection is bounded even when every measurement is excluded',()=>{
  const f=setup('Group,Y,ID\n'+Array.from({length:51},(_,i)=>`G${i},,i${i}`).join('\n'),'paired-t');
  f.table.columns[1].type='number';f.table.columns[0].type='category';
  assert.throws(()=>prepareObservations(f.table,f.spec),error=>error.code==='plot_groups');
});
