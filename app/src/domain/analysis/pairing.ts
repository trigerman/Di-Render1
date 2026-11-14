import type { ObservationGroup } from './observations';
import type { PlotSpec } from '../plots/spec';
import { InputError } from '../security/input';
export function pairGroups(a: ObservationGroup, b: ObservationGroup, spec: PlotSpec) {
  const exclusions: { reason: string; count: number; rows: number[] }[] = [];
  if (spec.analysis?.pairing === 'row-order') {
    if (spec.layout !== 'wide' || spec.roles.replicates?.length) throw new InputError('pairing', 'Row-order pairing requires column groups with one measurement per subject per column.');
    for (const group of [a, b]) if (new Set(group.observations.map(value => value.row)).size !== group.observations.length) throw new InputError('pairing', 'More than one observation occupies a paired source row.');
    const byRow = new Map(b.observations.map(value => [value.row, value]));
    const leftRows = new Set(a.observations.map(value => value.row));
    const pairs = a.observations.filter(value => byRow.has(value.row)).map(value => [value.y, byRow.get(value.row)!.y] as const);
    const unmatched = [...a.observations.filter(value => !byRow.has(value.row)), ...b.observations.filter(value => !leftRows.has(value.row))];
    if (unmatched.length) exclusions.push({ reason: 'unmatched_rows', count: unmatched.length, rows: unmatched.slice(0, 50).map(value => value.row) });
    return { a: pairs.map(pair => pair[0]), b: pairs.map(pair => pair[1]), exclusions };
  }
  if (!spec.roles.id) throw new InputError('pairing', 'Choose a subject ID column for paired analysis.');
  for (const group of [a, b]) {
    const ids = new Set<string>();
    for (const observation of group.pairingRows ?? group.observations) {
      if (observation.id === null || !observation.id.trim()) continue;
      if (ids.has(observation.id)) throw new InputError('duplicate_subject', 'A subject ID occurs more than once in one group. Correct the pairing.');
      ids.add(observation.id);
    }
  }
  const map = (group: ObservationGroup) => { const ids = new Map<string, typeof group.observations[number]>(); for (const observation of group.observations) {
    if (observation.id === null || !observation.id.trim()) continue;
    if (ids.has(observation.id)) throw new InputError('duplicate_subject', 'A subject ID occurs more than once in one group. Correct the pairing.'); ids.set(observation.id, observation);
  } return ids; };
  const left = map(a), right = map(b), pairedA: number[] = [], pairedB: number[] = [], excludedRows: number[] = [];
  for (const observation of a.observations) { if (observation.id !== null && right.has(observation.id)) { pairedA.push(observation.y); pairedB.push(right.get(observation.id)!.y); } else excludedRows.push(observation.row); }
  for (const observation of b.observations) if (observation.id === null || !left.has(observation.id)) excludedRows.push(observation.row);
  if (excludedRows.length) exclusions.push({ reason: 'unmatched_ids', count: excludedRows.length, rows: excludedRows.slice(0, 50) });
  return { a: pairedA, b: pairedB, exclusions };
}
