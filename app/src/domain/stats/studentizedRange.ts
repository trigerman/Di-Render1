import { logGamma, normalSurvival, tTwoSided } from './distributions';

// Positive nodes/weights of 16-point Gauss–Legendre quadrature.
const nodes = [.09501250983763744, .2816035507792589, .4580167776572274, .6178762444026438, .755404408355003, .8656312023878318, .9445750230732326, .9894009349916499];
const weights = [.1894506104550685, .1826034150449236, .1691565193950025, .1495959888165767, .1246289712555339, .09515851168249278, .06225352393864789, .02715245941175409];
function quadrature(from: number, to: number, step: number) {
  const points: { x: number; weight: number }[] = [], count = Math.ceil((to - from) / step), half = (to - from) / count / 2;
  for (let i = 0; i < count; i++) for (let j = 0; j < nodes.length; j++) for (const sign of [-1, 1]) {
    points.push({ x: from + (2 * i + 1) * half + sign * half * nodes[j]!, weight: half * weights[j]! });
  }
  return points;
}
const normalPoints = quadrature(-12, 12, 2).map(({ x, weight }) => ({ x, weight: weight * Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI), tail: normalSurvival(x) }));

/** Direct survival of the range of k independent standard normals. Integrating the
 * minimum's density avoids subtracting a near-one CDF for significant results. */
function rangeSurvival(q: number, groups: number): number {
  let probability = 0;
  for (const { x, weight, tail } of normalPoints) {
    const ratio = Math.min(1, normalSurvival(x + q) / tail);
    probability += groups * weight * tail ** (groups - 1) * -Math.expm1((groups - 1) * Math.log1p(-ratio));
  }
  return Math.max(0, Math.min(1, probability));
}

/** Q = normal range / sqrt(chi-square(df)/df). Integrate over log(scale),
 * standardized to keep the quadrature resolved even for large residual df.
 * This implementation follows the defining probability integral, not a t-test
 * or Bonferroni approximation. All integration ranges and work are bounded. */
export function studentizedRangeSurvival(q: number, groups: number, df: number): number {
  if (!(groups >= 2 && groups <= 50 && Number.isInteger(groups) && df >= 1 && Number.isFinite(df))) throw new Error('Unsupported studentized range parameters.');
  if (q <= 0) return 1;
  if (!Number.isFinite(q)) return 0;
  if (groups === 2) return tTwoSided(q / Math.SQRT2, df);
  const shape = df / 2, root = Math.sqrt(2 * df);
  // Stirling's remainder avoids cancellation for large df.
  const logPeak = shape > 100 ? -.5 * Math.log(2 * Math.PI) - 1 / (12 * shape) + 1 / (360 * shape ** 3)
    : Math.log(2) + shape * Math.log(shape) - logGamma(shape) - shape - Math.log(root);
  let probability = 0;
  for (const { x, weight } of quadrature(-Math.max(12, 40 / Math.sqrt(shape)), 12, 2)) {
    const z = 2 * x / root, density = Math.exp(logPeak + shape * (z - Math.expm1(z)));
    probability += weight * density * rangeSurvival(q * Math.exp(x / root), groups);
  }
  return Math.max(0, Math.min(1, probability));
}

export function studentizedRangeCritical(groups: number, df: number, alpha: number): number {
  let low = 0, high = 4;
  while (studentizedRangeSurvival(high, groups, df) > alpha && high < 1e8) high *= 2;
  for (let i = 0; i < 38; i++) {
    const middle = (low + high) / 2;
    if (studentizedRangeSurvival(middle, groups, df) > alpha) low = middle; else high = middle;
  }
  return (low + high) / 2;
}
