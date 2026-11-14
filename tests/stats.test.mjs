import './dom-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tTest, pairedT, mannWhitney, wilcoxon } from '../app/src/domain/stats/twoSample.ts';
import { kruskalWallis, dunn } from '../app/src/domain/stats/kSample.ts';
import { normalSurvival, tTwoSided, chiSquareSurvival, fSurvival } from '../app/src/domain/stats/distributions.ts';
import { descriptive } from '../app/src/domain/stats/descriptive.ts';
import { adjustP } from '../app/src/domain/stats/padjust.ts';
import { significanceLabel } from '../app/src/domain/stats/format.ts';
import { bracketLayout } from '../app/src/domain/plots/brackets.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/stats/scipy-1.17.1.json', import.meta.url)));
// Relative 1e-10, including tiny survival probabilities; no broad absolute floor masks small p.
function close(actual, expected) { if (expected === null) return assert.equal(actual, null); assert.ok(Number.isFinite(actual)); assert.ok(Math.abs(actual - expected) <= Math.max(1e-300, Math.abs(expected) * 1e-10), `${actual} differs from ${expected}`); }
for (const [index, value] of fixture.cases.entries()) test(`SciPy ${fixture.scipy} ${value.kind} reference ${index}`, () => {
  const result = value.kind === 'welch' ? tTest(value.a, value.b) : value.kind === 'student' ? tTest(value.a, value.b, true) : value.kind === 'paired-t' ? pairedT(value.a, value.b) : value.kind === 'mann-whitney' ? mannWhitney(value.a, value.b) : value.kind === 'wilcoxon' ? wilcoxon(value.a, value.b) : value.kind === 'dunn' ? dunn(value.groups, value.aIndex, value.bIndex) : kruskalWallis(value.groups);
  close(result.statistic, value.statistic); close(result.p, value.p); if (value.df !== null && value.p !== null) close(result.df, value.df); if (value.p === null) assert.ok(result.reason);
});
for (const [index, value] of fixture.distributions.entries()) test(`direct survival reference ${value.kind} ${index}`, () => close(value.kind === 'normal' ? normalSurvival(value.x) : value.kind === 't' ? tTwoSided(value.x, value.df) : value.kind === 'chi' ? chiSquareSurvival(value.x, value.df) : fSurvival(value.x, value.a, value.b), value.expected));
test('type-7 quartiles, sample SD and t confidence interval match independent reference', () => { const result = descriptive(fixture.descriptive.values); for (const [key, value] of Object.entries(fixture.descriptive)) if (key !== 'values') close(result[key], value); });
test('R p.adjust family semantics retain failed comparisons', () => {
  const p = [.01, .04, null, .03];
  assert.deepEqual(adjustP(p, 'bonferroni', 4), [.04, .16, null, .12]);
  assert.deepEqual(adjustP(p, 'holm', 4), [.04, .09, null, .09]);
  const bh = adjustP(p, 'bh', 4); close(bh[0], .04); close(bh[1], .04 * 4 / 3); close(bh[3], .04 * 4 / 3); assert.equal(bh[2], null);
});
const adjustments = JSON.parse(readFileSync(new URL('./fixtures/stats/r-4.5.2-padjust.json', import.meta.url)));
for (const [index, value] of adjustments.cases.entries()) test(`${adjustments.reference} ${value.method} rational reference ${index}`, () => {
  const actual = adjustP(value.p, value.method, value.familySize);
  value.expected.forEach((expected, index) => close(actual[index], expected));
});
test('alpha decides significance before stars and hide-ns', () => {
  const config = { alpha: .001, label: 'stars', hideNs: true };
  assert.equal(significanceLabel(.005, config), 'ns'); assert.equal(significanceLabel(.07, { ...config, alpha: .1 }), '*');
  assert.equal(bracketLayout({ comparisons: [{ a: 0, b: 1, selectedP: .005, significant: false, label: 'ns' }] }, config).length, 0);
});
test('minimum data, all ties and extreme numeric ranges return typed results', () => {
  assert.equal(tTest([1], [2]).p, null); assert.equal(mannWhitney([1,1,1,1,1], [1,1,1,1,1]).p, 1);
  assert.equal(wilcoxon([-1,2,3,4,5], [0,0,0,0,0]).p, .125); assert.equal(kruskalWallis([[1,1], [1,1], [1,1]]).p, null);
  for (const value of Object.values(descriptive([-1e308, 1e308]))) assert.ok(value === null || Number.isFinite(value));
});
