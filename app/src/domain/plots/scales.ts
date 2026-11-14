export function linearScale(minimum: number, maximum: number, start: number, end: number) {
  const span = maximum - minimum || 1;
  return (value: number) => start + (value - minimum) / span * (end - start);
}
export function niceTicks(minimum: number, maximum: number, target = 5): number[] {
  const span = maximum - minimum;
  if (!(span > 0) || !Number.isFinite(span)) return [minimum];
  const rough = span / target, base = 10 ** Math.floor(Math.log10(rough)), ratio = rough / base;
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * base;
  const ticks: number[] = [];
  for (let index = Math.ceil(minimum / step); index <= Math.floor(maximum / step) && ticks.length < 50; index++) ticks.push(index * step);
  return ticks;
}
export function dateTicks(minimum: number, maximum: number): number[] {
  const span = maximum - minimum, ticks: number[] = [], date = new Date(minimum);
  date.setUTCHours(0, 0, 0, 0);
  const unit = span > 730 * 86400000 ? 'year' : span > 60 * 86400000 ? 'month' : 'day';
  if (unit === 'year') { date.setUTCMonth(0, 1); }
  else if (unit === 'month') date.setUTCDate(1);
  const step = unit === 'day' ? Math.max(1, Math.ceil(span / 86400000 / 6)) : unit === 'year' ? Math.max(1, Math.ceil(span / 31557600000 / 6)) : Math.max(1, Math.ceil(span / 2629800000 / 6));
  for (let count = 0; count < 50 && date.getTime() <= maximum; count++) {
    if (date.getTime() >= minimum) ticks.push(date.getTime());
    if (unit === 'year') date.setUTCFullYear(date.getUTCFullYear() + step);
    else if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + step);
    else date.setUTCDate(date.getUTCDate() + step);
  }
  return ticks;
}
