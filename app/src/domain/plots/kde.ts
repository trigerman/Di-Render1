import { descriptive } from '../stats/descriptive';
export function kde(values: readonly number[], trim = true) {
  const stats = descriptive(values);
  if (values.length < 2 || !stats.sd) return null;
  const spread = Math.min(stats.sd, stats.iqr! > 0 ? stats.iqr! / 1.34 : stats.sd);
  const bandwidth = 1.06 * spread * values.length ** -0.2;
  if (!bandwidth || !Number.isFinite(bandwidth)) return null;
  const minimum = stats.min! - (trim ? 0 : 3 * bandwidth), maximum = stats.max! + (trim ? 0 : 3 * bandwidth);
  return Array.from({ length: 65 }, (_, index) => {
    const y = minimum + (maximum - minimum) * index / 64;
    const density = values.reduce((sum, value) => sum + Math.exp(-0.5 * ((y - value) / bandwidth) ** 2), 0) / (values.length * bandwidth * Math.sqrt(2 * Math.PI));
    return { y, density };
  });
}
