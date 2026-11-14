export function ranks(values: readonly number[]) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const result = new Array<number>(values.length), ties: number[] = [];
  for (let start = 0; start < order.length;) {
    let end = start + 1; while (end < order.length && order[end]!.value === order[start]!.value) end++;
    const rank = (start + 1 + end) / 2;
    for (let index = start; index < end; index++) result[order[index]!.index] = rank;
    if (end - start > 1) ties.push(end - start); start = end;
  }
  return { ranks: result, ties };
}
