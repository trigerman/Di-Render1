import { descriptive } from './descriptive';
import { normalSurvival, tTwoSided } from './distributions';
import { ranks } from './ranks';
import type { TestResult } from './schema';
export const notComputable = (test: string, reason: string): TestResult => ({ test, statistic: null, df: null, p: null, effect: null, method: 'not-computable', reason });
const result = (test: string, statistic: number, p: number, method: string, df: number | null = null, effect: number | null = null): TestResult => {
  if (![statistic, p, ...(df === null ? [] : [df]), ...(effect === null ? [] : [effect])].every(Number.isFinite)) return notComputable(test, 'Numeric range exceeded.');
  return { test, statistic, p: Math.max(0, Math.min(1, p)), df, effect, method, reason: null };
};
export function tTest(a: readonly number[], b: readonly number[], equalVariance = false): TestResult {
  const test = equalVariance ? 'Student t' : 'Welch t', x = descriptive(a), y = descriptive(b);
  if (a.length < 2 || b.length < 2) return notComputable(test, 'At least two observations per group are required.');
  if (x.sd === null || y.sd === null || x.mean === null || y.mean === null) return notComputable(test, 'Numeric range exceeded.');
  const va = x.sd! ** 2, vb = y.sd! ** 2;
  if (!va && !vb) return notComputable(test, 'Both groups have zero variance.');
  const pooled = ((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2);
  const variance = equalVariance ? pooled * (1 / a.length + 1 / b.length) : va / a.length + vb / b.length;
  const df = equalVariance ? a.length + b.length - 2 : variance ** 2 / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  const statistic = (x.mean! - y.mean!) / Math.sqrt(variance);
  return result(test, statistic, tTwoSided(statistic, df), 't distribution', df);
}
export function pairedT(a: readonly number[], b: readonly number[]): TestResult {
  if (a.length !== b.length || a.length < 2) return notComputable('Paired t', 'At least two complete pairs are required.');
  const d = descriptive(a.map((value, index) => value - b[index]!));
  if (!d.sd) return notComputable('Paired t', 'Paired differences have zero variance.');
  const statistic = d.mean! / d.sem!; return result('Paired t', statistic, tTwoSided(statistic, a.length - 1), 'paired t distribution', a.length - 1);
}

/** Truncated Gaussian-binomial product; O(min(m,n) * observed tail), without recursion. */
function exactUTail(m: number, n: number, tail: number): number {
  const counts = new Float64Array(tail + 1); counts[0] = 1;
  let total = 1;
  for (let i = 1; i <= m; i++) {
    for (let k = i; k <= tail; k++) counts[k] = counts[k]! + counts[k - i]!;
    for (let k = tail; k >= n + i; k--) counts[k] = counts[k]! - counts[k - n - i]!;
    total *= (n + i) / i;
  }
  return 2 * counts.reduce((sum, value) => sum + value, 0) / total;
}
export function mannWhitney(a: readonly number[], b: readonly number[]): TestResult {
  if (!a.length || !b.length) return notComputable('Mann–Whitney U', 'Each group requires an observation.');
  const ranked = ranks([...a, ...b]), m = a.length, n = b.length, N = m + n;
  const u = ranked.ranks.slice(0, m).reduce((sum, rank) => sum + rank, 0) - m * (m + 1) / 2;
  const effect = 2 * u / (m * n) - 1;
  if (!ranked.ties.length && Math.min(m, n) <= 8) {
    return result('Mann–Whitney U', u, exactUTail(Math.min(m, n), Math.max(m, n), Math.floor(Math.min(u, m * n - u))), 'exact', null, effect);
  }
  const variance = m * n / 12 * (N + 1 - ranked.ties.reduce((sum, size) => sum + size ** 3 - size, 0) / (N * (N - 1)));
  if (!variance) return result('Mann–Whitney U', u, 1, 'asymptotic; all tied', null, effect);
  const z = Math.max(0, Math.abs(u - m * n / 2) - 0.5) / Math.sqrt(variance);
  return result('Mann–Whitney U', u, 2 * normalSurvival(z), 'asymptotic; tie and continuity corrected', null, effect);
}
export function wilcoxon(a: readonly number[], b: readonly number[]): TestResult {
  if (a.length !== b.length || !a.length) return notComputable('Wilcoxon signed-rank', 'Complete matched pairs are required.');
  const all = a.map((value, index) => value - b[index]!), differences = all.filter(value => value !== 0);
  if (!differences.length) return result('Wilcoxon signed-rank', 0, 1, 'exact permutation; all differences zero', null, 0);
  const ranked = ranks(differences.map(Math.abs)), n = differences.length;
  let positive = 0, negative = 0;
  ranked.ranks.forEach((rank, index) => { if (differences[index]! > 0) positive += rank; else negative += rank; });
  const w = Math.min(positive, negative), effect = (positive - negative) / (positive + negative);
  if (!ranked.ties.length && differences.length === all.length && n <= 50) {
    const counts = new Array<number>(n * (n + 1) / 2 + 1).fill(0); counts[0] = 1;
    for (let rank = 1; rank <= n; rank++) for (let sum = counts.length - 1; sum >= rank; sum--) counts[sum] = counts[sum]! + counts[sum - rank]!;
    return result('Wilcoxon signed-rank', w, 2 * counts.slice(0, Math.floor(w) + 1).reduce((sum, value) => sum + value, 0) / 2 ** n, 'exact; zero_method=wilcox', null, effect);
  }
  // SciPy 1.17.1 auto exhausts sign permutations for tied/zero samples of at most 13 pairs.
  if (all.length <= 13) {
    const scaled = ranked.ranks.map(rank => Math.round(rank * 2)), maximum = scaled.reduce((sum, rank) => sum + rank, 0);
    const counts = new Float64Array(maximum + 1); counts[0] = 1;
    for (const rank of scaled) for (let sum = maximum; sum >= rank; sum--) counts[sum] = counts[sum]! + counts[sum - rank]!;
    const tail = counts.slice(0, Math.round(w * 2) + 1).reduce((sum, count) => sum + count, 0);
    return result('Wilcoxon signed-rank', w, 2 * tail / 2 ** n, 'exact permutation; zero_method=wilcox', null, effect);
  }
  const variance = (n * (n + 1) * (2 * n + 1) - ranked.ties.reduce((sum, size) => sum + size ** 3 - size, 0) / 2) / 24;
  const z = Math.abs(positive - n * (n + 1) / 4) / Math.sqrt(variance);
  return result('Wilcoxon signed-rank', w, 2 * normalSurvival(z), 'asymptotic; zero_method=wilcox; no continuity correction', null, effect);
}
