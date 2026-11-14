import type { TypedTable } from '../data/dataset';
import type { Cell } from '../data/cells';
import { shortLabel } from '../data/report';
import type { PlotSpec } from '../plots/spec';
import { INPUT_LIMITS, InputError } from '../security/input';
import { isPairedTest } from './comparisons';
import { supportsSeriesColumns } from '../plots/mapping';

export interface Observation { row: number; x: string | number; y: number; series: string | null; id: string | null; low: number | null; high: number | null; label: string | null; chromosome: string | null; position: number | null; p: number | null; measure: string | null }
export interface ObservationGroup { key: string; level: string; series: string | null; label: string; observations: Observation[]; pairingRows?: { row: number; id: string | null }[] }
export interface PreparedObservations { groups: ObservationGroup[]; exclusions: { reason: string; count: number; rows: number[] }[]; xType: 'number' | 'category' | 'date' | 'text'; combinedRows: number; gaps: { x: string | number; series: string | null; row: number }[] }

export function prepareObservations(table: TypedTable, spec: PlotSpec): PreparedObservations {
  const seriesColumns = spec.layout === 'wide-series';
  if (seriesColumns && (!supportsSeriesColumns(spec.type) || !spec.roles.x || spec.roles.series || spec.roles.replicates?.length || spec.roles.values?.includes(spec.roles.x))) {
    throw new InputError('plot_mapping', 'Separate column series require an X column and distinct value columns, without a row series or replicates mapping.');
  }
  if (spec.type === 'grouped-bar' && !seriesColumns && (spec.layout !== 'long' || !spec.roles.x || !spec.roles.y || !spec.roles.series)) {
    throw new InputError('plot_mapping', 'Grouped bars require group, series and value columns in row data.');
  }
  if (spec.type === 'grouped-bar' && !seriesColumns && new Set([spec.roles.x, spec.roles.series, spec.roles.y]).size !== 3) {
    throw new InputError('plot_mapping', 'Choose distinct group, series and value columns for grouped bars.');
  }
  const index = (key: string | undefined, numeric = false): number => {
    const found = table.columns.findIndex(column => column.key === key);
    if (found < 0 || numeric && table.columns[found]!.type !== 'number') throw new InputError('plot_mapping', 'A mapped column is missing or has the wrong type. Open Edit plot to repair its mapping.');
    return found;
  };
  const exclusions: PreparedObservations['exclusions'] = [], groups: ObservationGroup[] = [], byKey = new Map<string, ObservationGroup>(), gaps: PreparedObservations['gaps'] = [];
  const pairingRows = new Map<string, { row: number; id: string | null }[]>();
  const exclude = (reason: string, row: number) => { let entry = exclusions.find(item => item.reason === reason); if (!entry) { if (exclusions.length >= 200) return; entry = { reason, count: 0, rows: [] }; exclusions.push(entry); } entry.count++; if (entry.rows.length < 50) entry.rows.push(row); };
  const value = (cells: Cell[], position: number): string | number | null => { const cell = cells[position]; return cell?.state === 'value' ? cell.value : null; };
  const optional = (key: string | undefined, cells: Cell[], numeric = false) => key ? value(cells, index(key, numeric)) : null;
  const xIndex = spec.type === 'manhattan' ? index(spec.roles.chromosome) : spec.type === 'cleveland' ? index(spec.roles.x) : spec.layout === 'wide' && !spec.roles.replicates?.length ? -1 : index(spec.roles.x);
  const xType = xIndex < 0 ? 'category' : table.columns[xIndex]!.type;
  if (xType === 'text') throw new InputError('plot_mapping', 'Free text cannot be used as a group. Override its column type to category explicitly.');
  if (['scatter', 'manhattan'].includes(spec.type) && spec.type === 'scatter' && xType !== 'number') throw new InputError('plot_mapping', 'Scatter X must be numeric.');
  const valueKeys = seriesColumns ? spec.roles.values : spec.layout === 'wide' ? spec.roles.replicates?.length ? spec.roles.replicates : spec.roles.values : spec.type === 'cleveland' && spec.roles.values?.length ? spec.roles.values : [spec.roles.y];
  if (spec.type !== 'manhattan' && spec.type !== 'range' && !valueKeys?.length) throw new InputError('plot_mapping', 'Choose at least one value column.');
  const yIndices = (valueKeys ?? []).filter((key): key is string => !!key).map(key => index(key, true));
  if (new Set(yIndices).size !== yIndices.length) throw new InputError('plot_mapping', 'Each measure column can be mapped only once.');
  if (seriesColumns && new Set(yIndices.map(position => table.columns[position]!.name)).size !== yIndices.length) throw new InputError('plot_mapping', 'Series column names must be unique.');
  // Bound derived allocations before expanding wide columns into observations.
  if (table.rows.length * Math.max(1, yIndices.length) > INPUT_LIMITS.datasetCells) throw new InputError('plot_observations', 'The mapped table exceeds the supported observation limit.');
  if (spec.type === 'cleveland' && (yIndices.length < 1 || yIndices.length > 2)) throw new InputError('plot_mapping', 'Cleveland plots require one or two value columns.');
  if (!yIndices.length && !['range', 'manhattan'].includes(spec.type)) throw new InputError('plot_mapping', 'Choose a numeric measure column.');
  // Validate optional roles even when the table is empty.
  for (const key of [spec.roles.series, spec.roles.id, spec.roles.label, spec.roles.chromosome]) if (key) index(key);
  for (const key of [spec.roles.low, spec.roles.high, spec.roles.position, spec.roles.p]) if (key) index(key, true);
  for (const row of table.rows) {
    const x = xIndex < 0 ? null : value(row.cells, xIndex);
    if (xIndex >= 0 && (x === null || typeof x === 'string' && !x.trim())) { exclude('blank_group', row.row); continue; }
    const rowSeries = optional(spec.roles.series, row.cells);
    if (spec.roles.series && (rowSeries === null || !String(rowSeries).trim())) { exclude('missing_series', row.row); continue; }
    const indices = yIndices.length ? yIndices : [-1];
    for (const yIndex of indices) {
      const series = seriesColumns ? table.columns[yIndex]!.name : rowSeries;
      const continuous = spec.type === 'scatter' || ['line', 'area'].includes(spec.type) && (xType === 'number' || xType === 'date');
      const level = continuous ? String(series ?? 'Data') : xIndex < 0 ? table.columns[yIndex]!.name : String(x);
      const groupingSeries = spec.type === 'heatmap' ? null : series, key = JSON.stringify([level, groupingSeries]);
      // Validate pairing identities before filtering missing/invalid measures. An
      // excluded duplicate must never turn ambiguous subjects into valid pairs.
      if (spec.analysis && isPairedTest(spec.analysis.test)) {
        if (!pairingRows.has(key) && pairingRows.size >= INPUT_LIMITS.plotGroups) throw new InputError('plot_groups', 'The plot exceeds 50 groups.');
        const rows = pairingRows.get(key) ?? [], id = optional(spec.roles.id, row.cells);
        rows.push({ row: row.row, id: id === null ? null : String(id) }); pairingRows.set(key, rows);
      }
      const low = optional(spec.roles.low, row.cells, true), high = optional(spec.roles.high, row.cells, true), p = optional(spec.roles.p, row.cells, true);
      let y = yIndex < 0 ? spec.type === 'range' && typeof low === 'number' && typeof high === 'number' ? (low + high) / 2 : p : value(row.cells, yIndex);
      if (spec.type === 'manhattan') {
        if (typeof p !== 'number') { exclude('missing_p', row.row); continue; }
        if (spec.options.pMode === 'raw') {
          if (p < 0 || p > 1) { exclude('p_out_of_domain', row.row); continue; }
          if (p === 0) { y = 300; exclude('p_zero_capped', row.row); } else y = -Math.log10(p);
        } else { if (p < 0) { exclude('p_out_of_domain', row.row); continue; } y = p; }
      }
      if (typeof y !== 'number' || !Number.isFinite(y)) { exclude(row.cells[yIndex]?.state === 'missing' ? 'missing_measure' : 'not_number', row.row); if (x !== null && ['line', 'area'].includes(spec.type)) gaps.push({ x, series: series === null ? null : String(series), row: row.row }); continue; }
      if (spec.appearance.yScale === 'log10' && y <= 0) { exclude('log_out_of_domain', row.row); continue; }
      if (spec.type === 'range' && spec.roles.low && (typeof low !== 'number' || typeof high !== 'number' || low > high)) { exclude('invalid_range', row.row); continue; }
      const chromosome = optional(spec.roles.chromosome, row.cells), position = optional(spec.roles.position, row.cells, true);
      if (spec.type === 'manhattan' && (chromosome === null || !String(chromosome).trim() || typeof position !== 'number' || position < 0)) { exclude('invalid_position', row.row); continue; }
      let group = byKey.get(key);
      if (!group) {
        if (groups.length >= INPUT_LIMITS.plotGroups) throw new InputError('plot_groups', 'The plot exceeds 50 groups.');
        group = { key, level, series: groupingSeries === null ? null : String(groupingSeries), label: shortLabel(level) + (groupingSeries === null || continuous ? '' : ' · ' + shortLabel(String(groupingSeries))), observations: [], ...(pairingRows.has(key) ? { pairingRows: pairingRows.get(key)! } : {}) };
        groups.push(group); byKey.set(key, group);
      }
      const id = optional(spec.roles.id, row.cells), label = optional(spec.roles.label, row.cells);
      group.observations.push({ row: row.row, x: x ?? level, y, series: series === null ? null : String(series), id: id === null ? null : String(id), low: typeof low === 'number' ? low : null, high: typeof high === 'number' ? high : null, label: label === null ? null : String(label), chromosome: chromosome === null ? null : String(chromosome), position: typeof position === 'number' ? position : null, p: typeof p === 'number' ? p : null, measure: yIndex < 0 ? null : table.columns[yIndex]!.key });
    }
  }
  // Header groups follow the explicit column selection, even when a column starts with missing cells.
  const levels = xIndex >= 0 ? table.columns[xIndex]!.levels : yIndices.map(position => table.columns[position]!.name);
  if (levels) groups.sort((a, b) => { const ai = levels.indexOf(a.level), bi = levels.indexOf(b.level); return (ai < 0 ? levels.length : ai) - (bi < 0 ? levels.length : bi); });
  if (seriesColumns) {
    const seriesOrder = yIndices.map(position => table.columns[position]!.name);
    const continuous = ['line', 'area', 'scatter'].includes(spec.type) && (xType === 'number' || xType === 'date');
    const groupOrder = [...new Set(groups.map(group => group.level))];
    groups.sort((a, b) => (continuous ? 0 : groupOrder.indexOf(a.level) - groupOrder.indexOf(b.level)) || seriesOrder.indexOf(a.series!) - seriesOrder.indexOf(b.series!));
  }
  return { groups, exclusions, xType, combinedRows: 0, gaps };
}
