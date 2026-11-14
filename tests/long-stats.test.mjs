import './dom-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dataFixture, analysisConfig, plotObject } from './data-helpers.mjs';
import { initialPlotSpec } from '../app/src/domain/plots/recommend.ts';
import { buildPlotScene, sceneToSvg } from '../app/src/domain/plots/scene.ts';
import { bracketLayout } from '../app/src/domain/plots/brackets.ts';
import { runAnalysis } from '../app/src/domain/stats/engine.ts';
import { prepareObservations } from '../app/src/domain/analysis/observations.ts';
import { readPortableProject } from '../app/src/domain/project/portable.ts';

const sample = 'Student_Status\tMajor\tGrade\nGraduate\tPolitics\t67\nUndergraduate\tMath\t63\nGraduate\tMath\t78\nGraduate\tEcon\t78\nGraduate\tEcon\t65\nGraduate\tEcon\t69\nGraduate\tPolitics\t96';
const setup = text => { const f=dataFixture(text); return {...f,spec:initialPlotSpec(f.dataset)}; };
const run = f => runAnalysis(prepareObservations(f.table,f.spec),f.spec);
const labels = scene => scene.primitives.filter(p=>p.kind==='text'&&/^(ns|\*+|p\s*[=<])/.test(p.text));
const close = (a,b,tolerance=1e-8) => assert.ok(Number.isFinite(a)&&Math.abs(a-b)<tolerance,`${a} != ${b}`);
const oracle=JSON.parse(readFileSync(new URL('./fixtures/stats/long-scipy-1.17.1.json',import.meta.url)));

for (const method of ['anova','kruskal-wallis']) test(`reported long table calculates ${method} with all six comparisons`,()=>{
  const f=setup(sample); f.spec.analysis={...analysisConfig(method),showGlobal:true};
  const original=run(f); assert.equal(original.comparisons.length,6);assert.ok(original.comparisons.every(c=>c.selectedP!==null));
  const expected=oracle.cases[0];close(original.global.p,method==='anova'?expected.anovaP:expected.kruskalP);
  for(const [width,height,font] of [[520,380,12],[520,180,12],[520,380,24]]) {
    f.spec.appearance.fontSize=font;
    const scene=buildPlotScene(f.source,f.dataset,f.spec,width,height);
    assert.equal(scene.error,null);assert.deepEqual(scene.result,original);assert.equal(labels(scene).length,6);
    for(const label of labels(scene))assert.ok(label.y>label.size && label.y<height && label.x>=0 && label.x<=width);
    const ticks=scene.primitives.filter(p=>p.kind==='text'&&p.anchor==='end');
    for(let i=1;i<ticks.length;i++)assert.ok(Math.abs(ticks[i].y-ticks[i-1].y)>=font*1.29);
    assert.doesNotMatch(sceneToSvg(scene),/NaN|Infinity/);
  }
  f.spec.result=original;const imported=readPortableProject(JSON.stringify({...f.project,objects:[plotObject(f.spec)]}));
  assert.deepEqual(imported.objects[0].plot.result,original);
});

for(const [i,reference] of oracle.cases.entries())test(`sparse and unbalanced groups match independent SciPy reference ${i}`,()=>{
  const f=setup('Group,Value\n'+reference.groups.flatMap((g,i)=>g.map(y=>`G${i},${y}`)).join('\n'));
  f.spec.analysis=analysisConfig('anova');const a=run(f);close(a.global.statistic,reference.F);close(a.global.p,reference.anovaP);
  for(const [i,c] of a.comparisons.entries()){close(c.selectedP,reference.pairs[i].tukeyP,2e-7);close(c.result.ciLow,reference.pairs[i].low,2e-7);close(c.result.ciHigh,reference.pairs[i].high,2e-7);}
  f.spec.analysis=analysisConfig('kruskal-wallis');const k=run(f);close(k.global.statistic,reference.H);close(k.global.p,reference.kruskalP);
  k.comparisons.forEach((c,i)=>close(c.result.p,reference.pairs[i].dunnP));
});

const values=[[1,3,4,7,6,9],[9,14,13,18,20,22],[12,16,19,24,27,31]];
for(const method of ['anova','kruskal-wallis','welch','student','mann-whitney','pairwise-welch','paired-t','wilcoxon'])test(`${method} has identical results in long and wide data, with ID matching for pairs`,()=>{
  const wide=setup('ID,A,B,C\n'+values[0].map((_,i)=>`s${i},${values.map(g=>g[i]).join(',')}`).join('\n'));
  const long=setup('ID,Group,Value\n'+values[0].flatMap((_,i)=>values.map((g,j)=>`s${i},${'ABC'[j]},${g[i]}`)).reverse().join('\n'));
  // Explicit category order ensures the same pair direction after row permutation.
  long.dataset.columns[1].levels=['A','B','C'];long.table.columns[1].levels=['A','B','C'];
  for(const f of [wide,long])f.spec.analysis=analysisConfig(method);
  const a=run(wide),b=run(long);assert.equal(a.familySize,b.familySize);
  if(a.global)close(a.global.p,b.global.p);
  a.comparisons.forEach((c,i)=>{close(c.selectedP,b.comparisons[i].selectedP);close(c.result.statistic,b.comparisons[i].result.statistic);if(c.matchedPairs)assert.equal(c.matchedPairs,b.comparisons[i].matchedPairs);});
  for(const f of [wide,long])assert.equal(buildPlotScene(f.source,f.dataset,f.spec,520,220).error,null);
});

for(const method of ['anova','kruskal-wallis'])test(`${method} agrees in long, replicate-column and categorical series-column layouts`,()=>{
  const replicates=setup('Group,R1,R2,R3\nA,1,3,4\nA,7,6,9\nB,9,14,13\nB,18,20,22\nC,12,16,19\nC,24,27,31');
  replicates.spec={...replicates.spec,type:'bar',layout:'wide',roles:{x:'c0',replicates:['c1','c2','c3']}};
  const long=setup('Group,Value\n'+values.flatMap((g,i)=>g.map(y=>`${'ABC'[i]},${y}`)).join('\n'));
  const series=setup('Group,A,B,C\n'+values[0].map((_,i)=>`Only,${values.map(g=>g[i]).join(',')}`).join('\n'));
  for(const f of [replicates,long,series])f.spec.analysis=analysisConfig(method);
  const baseline=run(long);
  for(const f of [replicates,series]){const result=run(f);close(result.global.p,baseline.global.p);result.comparisons.forEach((c,i)=>close(c.selectedP,baseline.comparisons[i].selectedP));assert.equal(buildPlotScene(f.source,f.dataset,f.spec,520,220).error,null);}
});

test('six interleaved grouped cells keep every comparison visible and nonoverlapping',()=>{
  const rows=['Group,Series,Value'];for(let r=0;r<3;r++)for(let s=0;s<3;s++)for(let g=0;g<2;g++)rows.push(`G${g},S${s},${g*20+s*7+r*r}`);
  const f=setup(rows.join('\n'));f.spec.analysis={...analysisConfig('kruskal-wallis'),showGlobal:true,label:'p'};
  const scene=buildPlotScene(f.source,f.dataset,f.spec,520,380);assert.equal(scene.error,null);assert.equal(labels(scene).length,15);assert.ok(scene.notices.includes('bracketsCompact'));
  const texts=labels(scene);for(const a of texts)for(const b of texts)if(a!==b&&a.y===b.y)assert.ok(Math.abs(a.x-b.x)>(a.text.length*a.size+b.text.length*b.size)*.3);
  const before=scene.result;f.spec.analysis.showBrackets=false;const hidden=buildPlotScene(f.source,f.dataset,f.spec,520,180);assert.equal(hidden.error,null);assert.deepEqual(hidden.result.comparisons,before.comparisons);assert.equal(labels(hidden).length,0);
});

test('bracket lanes use actual positions and label extents, not encounter order',()=>{
  const comparisons=[{a:0,b:1,selectedP:.1,label:'p = 0.1'},{a:2,b:3,selectedP:.2,label:'p = 0.2'}];
  const positions=[0,300,100,200];const brackets=bracketLayout({comparisons},analysisConfig(),positions,()=>60);
  assert.notEqual(brackets[0].level,brackets[1].level);
  const closePositions=[0,10,20,30];const tight=bracketLayout({comparisons},analysisConfig(),closePositions,()=>60);assert.notEqual(tight[0].level,tight[1].level);
});

test('all-singleton ANOVA retains the data and reports insufficient residual degrees of freedom',()=>{
  const f=setup('Group,Value\nA,1\nB,3\nC,7');f.spec.analysis=analysisConfig('anova');const scene=buildPlotScene(f.source,f.dataset,f.spec,520,380);
  assert.equal(scene.error,null);assert.equal(scene.result.global.p,null);assert.match(scene.result.global.reason,/residual degrees of freedom/);assert.ok(scene.result.comparisons.every(c=>c.selectedP===null));
});
