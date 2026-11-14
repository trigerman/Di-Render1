import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anovaModel, oneWayAnova, tukeyComparisons } from '../app/src/domain/stats/anova.ts';
import { studentizedRangeSurvival } from '../app/src/domain/stats/studentizedRange.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/stats/anova-scipy-1.17.1.json', import.meta.url)));
const close = (actual, expected, relative=1e-9, absolute=1e-12) => assert.ok(Number.isFinite(actual) && Math.abs(actual-expected)<=Math.max(absolute,Math.abs(expected)*relative), `${actual} != ${expected}`);
for(const [i,c] of fixture.cases.entries()) test(`SciPy ANOVA and Tukey/Kramer reference ${i}`,()=>{
  const model=anovaModel(c.groups), global=oneWayAnova(model), comparisons=tukeyComparisons(model,c.pairs.map(p=>[p.a,p.b]),c.alpha);
  // Large-offset SciPy means lose a few ulps; the centered implementation preserves the differences.
  const shifted=c.groups[0][0]>1e10;
  close(global.statistic,c.F,shifted?1e-7:1e-10);close(global.p,c.p,shifted?1e-6:1e-10);assert.equal(global.df,c.df);assert.equal(global.df2,c.df2);
  c.pairs.forEach((p,i)=>{const r=comparisons[i];close(r.result.statistic,p.q,shifted?5e-5:1e-9);close(r.result.effect,p.difference,shifted?5e-5:1e-9);close(r.adjustedP,p.p,shifted?5e-5:1e-6,2e-11);close(r.result.ciLow,p.low,shifted?5e-4:1e-8,2e-8);close(r.result.ciHigh,p.high,shifted?5e-4:1e-8,2e-8);});
});
for(const c of fixture.distributions) test(`studentized range survival k=${c.k}, df=${c.df}, q=${c.q}`,()=>{
  // SciPy switches to infinite-df at 100000. Test its documented limiting approximation separately.
  close(studentizedRangeSurvival(c.q,c.k,c.df),c.p,c.df>=100000?0.001:2e-6,c.df>=100000?3e-6:2e-11);
});
test('ANOVA refuses degenerate inputs and remains scale/translation invariant',()=>{
  for(const groups of [[],[[1,2]],[[],[2,3]],[[1],[2]],[[1,1],[2,2]]]) assert.equal(oneWayAnova(anovaModel(groups)).p,null);
  const groups=[[1,2,4],[5,7,9],[10,11,16]], baseline=oneWayAnova(anovaModel(groups));
  for(const altered of [groups.map(g=>g.map(x=>x*1e300)),groups.map(g=>g.map(x=>x*1e-300)),groups.map(g=>g.map(x=>x+1e12))]) close(oneWayAnova(anovaModel(altered)).p,baseline.p,1e-10);
});
