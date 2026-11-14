import { chiSquareSurvival, normalSurvival } from './distributions';
import { ranks } from './ranks';
import { notComputable } from './twoSample';
import type { TestResult } from './schema';
export function kruskalWallis(groups: readonly (readonly number[])[]): TestResult {
  if (groups.length < 2 || groups.some(group => !group.length)) return notComputable('Kruskal–Wallis', 'At least two nonempty groups are required.');
  const all = groups.flat(), N = all.length, ranked = ranks(all);
  const correction = 1 - ranked.ties.reduce((sum, size) => sum + size ** 3 - size, 0) / (N ** 3 - N);
  if (!correction) return notComputable('Kruskal–Wallis', 'All values are tied.');
  let offset = 0, sum = 0;
  for (const group of groups) { const total = ranked.ranks.slice(offset, offset + group.length).reduce((s, rank) => s + rank, 0); sum += total ** 2 / group.length; offset += group.length; }
  const H = Math.max(0, (12 / (N * (N + 1)) * sum - 3 * (N + 1)) / correction), df = groups.length - 1;
  return { test: 'Kruskal–Wallis', statistic: H, df, p: chiSquareSurvival(H, df), effect: null, method: 'tie corrected', reason: null };
}
export function dunn(groups: readonly (readonly number[])[], a: number, b: number): TestResult {
  const all = groups.flat(), N = all.length, ranked = ranks(all);
  if (N < 2 || !groups[a]?.length || !groups[b]?.length) return notComputable('Dunn', 'Two nonempty groups are required.');
  const variance = N * (N + 1) / 12 - ranked.ties.reduce((sum, size) => sum + size ** 3 - size, 0) / (12 * (N - 1));
  if (!variance) return notComputable('Dunn', 'All values are tied.');
  let offset = 0;
  const means = groups.map(group => { const mean = ranked.ranks.slice(offset, offset + group.length).reduce((sum, rank) => sum + rank, 0) / group.length; offset += group.length; return mean; });
  const z = (means[a]! - means[b]!) / Math.sqrt(variance * (1 / groups[a]!.length + 1 / groups[b]!.length));
  return { test: 'Dunn', statistic: z, df: null, p: Math.min(1, 2 * normalSurvival(Math.abs(z))), effect: null, method: 'tie-corrected normal', reason: null };
}
