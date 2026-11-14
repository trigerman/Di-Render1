import { z } from 'zod';
import { dataSourceSchema, type DataSource } from '../data/schema';
import { verifyDataSourceHashes } from '../data/source';
import type { OpenBioFigureProject } from '../project/schema';
import { INPUT_LIMITS, InputError } from '../security/input';
import { figureRecordKey, figureSummaryKey, summarizeFigure } from './figureLibrary';

export const DATA_SOURCE_PREFIX = 'openrender:data-source:v1:';
export const dataSourceKey = (id: string) => DATA_SOURCE_PREFIX + id;
const ids = z.array(z.string().regex(/^data-[a-f0-9]{64}$/)).max(10 * INPUT_LIMITS.dataSources).refine(values => new Set(values).size === values.length);
const stateSchema = z.object({ version: z.literal(5), current: z.unknown().nullable(), previous: z.unknown().nullable(), recent: z.array(z.object({ project: z.unknown(), lastOpenedAt: z.iso.datetime() }).strict()).max(8), media: z.array(z.unknown()).max(900), dataSourceIds: ids }).strict();
const figureSchema = z.object({ version: z.literal(2), body: z.unknown(), dataSourceIds: ids.max(INPUT_LIMITS.dataSources) }).strict();
const sourceRecordSchema = z.object({ version: z.literal(1), source: dataSourceSchema, references: z.number().int().min(1).max(100_000) }).strict();
const verified = new Map<string, string>();
type Get = (key: string) => Promise<unknown>;
const getFrom = (store: IDBObjectStore): Get => key => new Promise((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
function sourceRecord(value: unknown): z.infer<typeof sourceRecordSchema> {
  const record = sourceRecordSchema.parse(value);
  if (verified.get(record.source.id) !== record.source.content) {
    verifyDataSourceHashes([record.source]);
    if (verified.size >= INPUT_LIMITS.dataSources) verified.delete(verified.keys().next().value!);
    verified.set(record.source.id, record.source.content);
  }
  return record;
}
async function sourcesFor(sourceIds: string[], get: Get): Promise<DataSource[]> {
  const values = await Promise.all(sourceIds.map(id => get(dataSourceKey(id))));
  return values.flatMap((value, index) => { try { const record = sourceRecord(value); return record.source.id === sourceIds[index] ? [record.source] : []; } catch { return []; } });
}
/** Missing or damaged sources invalidate their revision independently, preserving recovery. */
export async function hydrateState(value: unknown, get: Get): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 5) return value;
  const state = stateSchema.parse(value), sources = await sourcesFor(state.dataSourceIds, get);
  const { dataSourceIds, ...body } = state;
  return { ...body, version: 4, dataSources: sources };
}
export async function hydrateFigure(value: unknown, get: Get): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2) return value;
  const record = figureSchema.parse(value);
  if (!record.body || typeof record.body !== 'object' || Array.isArray(record.body) || 'dataSources' in record.body) throw new InputError('saved_figure_invalid', 'This saved figure is missing or damaged.');
  return { version: 1, project: { ...record.body, dataSources: await sourcesFor(record.dataSourceIds, get) } };
}
export interface LibraryChange { project?: OpenBioFigureProject; savedAt?: string; deleteId?: string }
function ownerIds(value: unknown, state: boolean): string[] {
  const parsed = (state ? stateSchema : figureSchema).safeParse(value); return parsed.success ? parsed.data.dataSourceIds : [];
}
/** Sources, revision references, library records and reference-counted collection commit atomically. */
export async function persistSourceReferences(store: IDBObjectStore, oldState: unknown, packed: { version: 4; current: unknown; previous: unknown; recent: unknown[]; media: unknown[]; dataSources: DataSource[] } | undefined, changes: LibraryChange[]) {
  const get = getFrom(store), pool = new Map<string, DataSource>(packed?.dataSources.map(source => [source.id, source]) ?? []), deltas = new Map<string, number>();
  const delta = (oldIds: string[], nextIds: string[]) => { const old = new Set(oldIds), next = new Set(nextIds); old.forEach(id => { if (!next.has(id)) deltas.set(id, (deltas.get(id) ?? 0) - 1); }); next.forEach(id => { if (!old.has(id)) deltas.set(id, (deltas.get(id) ?? 0) + 1); }); };
  let nextState: unknown;
  if (packed) { const { dataSources, ...body } = packed; nextState = { ...body, version: 5, dataSourceIds: dataSources.map(source => source.id) }; stateSchema.parse(nextState); if (!dataSources.length) nextState = packed; delta(ownerIds(oldState, true), dataSources.map(source => source.id)); }
  const writes: { id: string; change: LibraryChange; record?: unknown }[] = [];
  for (const change of changes) {
    const id = change.project?.metadata.id ?? change.deleteId;
    if (!id) throw new Error('A library mutation must name its figure.');
    const old = await get(figureRecordKey(id));
    const nextIds = change.project?.dataSources.map(source => source.id) ?? [];
    delta(ownerIds(old, false), nextIds);
    change.project?.dataSources.forEach(source => { const prior = pool.get(source.id); if (prior && prior.content !== source.content) throw new Error('Data source identity changed.'); pool.set(source.id, source); });
    if (change.project) { const { dataSources, ...body } = change.project; writes.push({ id, change, record: dataSources.length ? { version: 2, body, dataSourceIds: dataSources.map(source => source.id) } : {version: 1, project: change.project} }); }
    else writes.push({ id, change });
  }
  for (const [id, change] of deltas) {
    if (!change) continue;
    const value = await get(dataSourceKey(id));
    const existing = value === undefined ? undefined : sourceRecord(value), source = pool.get(id) ?? existing?.source;
    if (existing && pool.has(id) && existing.source.content !== pool.get(id)!.content) throw new Error('Data source identity changed.');
    const references = (existing?.references ?? 0) + change;
    if (references <= 0) { store.delete(dataSourceKey(id)); continue; }
    if (!source || source.id !== id) throw new InputError('missing_data_source', 'A referenced dataset source is missing.');
    const next = sourceRecord({ version: 1, source, references }); store.put(next, dataSourceKey(id));
  }
  if (packed) store.put(nextState, 'openrender:documents:v2');
  for (const write of writes) {
    if (write.change.project) { store.put(write.record, figureRecordKey(write.id)); store.put(summarizeFigure(write.change.project, write.change.savedAt!), figureSummaryKey(write.id)); }
    else { store.delete(figureRecordKey(write.id)); store.delete(figureSummaryKey(write.id)); }
  }
}
