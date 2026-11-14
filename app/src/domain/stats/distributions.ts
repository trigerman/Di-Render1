const coefficients = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function logGamma(value: number): number {
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  const z = value - 1; let sum = 0.99999999999980993;
  coefficients.forEach((coefficient, index) => { sum += coefficient / (z + index + 1); });
  const t = z + 7.5; return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}
const tiny = 1e-300, epsilon = 2e-15;
function betaFraction(a: number, b: number, x: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < epsilon) return h;
  }
  throw new Error('Incomplete beta did not converge.');
}
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? bt * betaFraction(a, b, x) / a : 1 - bt * betaFraction(b, a, 1 - x) / b;
}
export function gammaSurvival(a: number, x: number): number {
  if (x <= 0) return 1;
  const factor = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    let term = 1 / a, sum = term;
    for (let n = 1; n < 10000; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * epsilon) return Math.max(0, 1 - sum * factor); }
  } else {
    let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
    for (let n = 1; n < 10000; n++) {
      const an = -n * (n - a); b += 2; d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d; const delta = d * c; h *= delta;
      if (Math.abs(delta - 1) < epsilon) return Math.min(1, Math.max(0, factor * h));
    }
  }
  throw new Error('Incomplete gamma did not converge.');
}
export const normalSurvival = (z: number) => z >= 0 ? gammaSurvival(0.5, z * z / 2) / 2 : 1 - gammaSurvival(0.5, z * z / 2) / 2;
export const normalCdf = (z: number) => normalSurvival(-z);
export const tTwoSided = (t: number, df: number) => regularizedBeta(df / (df + t * t), df / 2, 0.5);
export const chiSquareSurvival = (x: number, df: number) => gammaSurvival(df / 2, x / 2);
export const fSurvival = (x: number, numeratorDf: number, denominatorDf: number) => regularizedBeta(denominatorDf / (denominatorDf + numeratorDf * x), denominatorDf / 2, numeratorDf / 2);
export function tCritical(df: number, alpha = 0.05): number {
  let low = 0, high = 1;
  while (tTwoSided(high, df) > alpha && high < 1e12) high *= 2;
  for (let index = 0; index < 80; index++) { const mid = (low + high) / 2; if (tTwoSided(mid, df) > alpha) low = mid; else high = mid; }
  return (low + high) / 2;
}
