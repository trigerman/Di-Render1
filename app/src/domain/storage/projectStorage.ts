import { prepareProjectPlots, prepareStoredPlots } from '../plots/prepare';
import { hydrateState, hydrateFigure, persistSourceReferences, type LibraryChange } from './dataSourceRecords';
import { createStore, get, type UseStore } from "idb-keyval";
import { z } from "zod";
import { migrateProject } from "../project/migrations";
import { parseProject, type OpenBioFigureProject } from "../project/schema";
import type { ProjectImage } from "../media/images";
import type { DataSource } from "../data/schema";
import { INPUT_LIMITS, InputError } from "../security/input";
import {
  decodeSavedFigure, encodeFigureRecord, FIGURE_SUMMARY_PREFIX, figureIdsToSync, figureRecordKey, figureSummaryKey,
  importCandidateIds, listFigureSummaries, resolveImportById, resolveImportByContent, resolveImportDecision,
  selectLibrarySync, stateWithoutFigure, summarizeFigure, type FigureList,
} from "./figureLibrary";

const STATE_KEY = "openrender:documents:v2";
const MAX_RECENT_PROJECTS = 8;
const legacyStateSchema = z.object({
  version: z.literal(2),
  current: z.unknown().nullable(),
  previous: z.unknown().nullable(),
  recent: z.array(z.object({
    project: z.unknown(), lastOpenedAt: z.iso.datetime(),
  }).strict()).max(MAX_RECENT_PROJECTS),
}).strict();
const packedProjectSchema = z.object({body: z.unknown(), mediaIds: z.array(z.string()).max(100),
  dataSourceIds: z.array(z.string().regex(/^data-[a-f0-9]{64}$/)).max(INPUT_LIMITS.dataSources).optional(),
}).strict();
const packedDataProjectSchema = packedProjectSchema.required({dataSourceIds: true});
const packedStateV3Schema = z.object({
  version: z.literal(3),
  current: z.unknown().nullable(),
  previous: z.unknown().nullable(),
  recent: z.array(z.object({project: z.unknown(), lastOpenedAt: z.iso.datetime()}).strict()).max(MAX_RECENT_PROJECTS),
  media: z.array(z.unknown()).max(900),
}).strict();
const packedStateSchema = z.discriminatedUnion("version", [packedStateV3Schema,
  packedStateV3Schema.extend({version: z.literal(4), dataSources: z.array(z.unknown()).max(10 * INPUT_LIMITS.dataSources)}),
]);

export interface RecentProject { project: OpenBioFigureProject; lastOpenedAt: string; }
interface StoredState { version: 2; current: OpenBioFigureProject | null; previous: OpenBioFigureProject | null; recent: RecentProject[]; }
export interface ProjectStorage {
  load(): Promise<OpenBioFigureProject | null>;
  save(project: OpenBioFigureProject): Promise<void>;
  clear(): Promise<void>;
  listRecent(): Promise<RecentProject[]>;
  removeRecent(projectId: string): Promise<void>;
  clearRecent(): Promise<void>;
  /** Saved figures, newest save first; invalid summaries are omitted and counted. */
  listFigures(): Promise<FigureList>;
  loadFigure(id: string): Promise<OpenBioFigureProject>;
  /** Removes the saved figure with its recent item and recovery copy; refuses the state's current figure. */
  deleteFigure(id: string): Promise<void>;
  /** The project to open for a validated file project, decided by content (D-5); writes nothing. */
  resolveImport(project: OpenBioFigureProject): Promise<OpenBioFigureProject>;
}
const emptyState = (): StoredState => ({ version: 2, current: null, previous: null, recent: [] });

/** A full disk gets its own code so the editor can say how to free space; other failures keep `otherwise`. */
export function storageFailure(error: unknown, otherwise: unknown, hasData = false): unknown {
  return (error as { name?: unknown } | null)?.name === "QuotaExceededError"
    ? new InputError("storage_full", hasData
      ? "Local storage is full. Delete saved figures or remove datasets you no longer need, or download a project backup."
      : "Local storage is full. Delete saved figures you no longer need or download a project backup.")
    : otherwise;
}
function failTransaction(transaction: IDBTransaction, reject: (reason: unknown) => void, error: unknown, hasData = false) {
  reject(storageFailure(error, error, hasData));
  try { transaction.abort(); }
  catch (abortError) {
    // A quota failure may already have aborted the transaction.
    if (!(abortError instanceof DOMException && abortError.name === "InvalidStateError")) reject(abortError);
  }
}
function validProject(value: unknown): OpenBioFigureProject | null {
  if (value == null) return null;
  try { return migrateProject(value); }
  catch { return null; } // A damaged revision is recoverable from the independent previous revision.
}
function unpackProject(value: unknown, media: Map<string, ProjectImage>, sources?: Map<string, DataSource>) {
  if (!value) return null;
  const packed = (sources ? packedDataProjectSchema : packedProjectSchema).safeParse(value);
  if (!packed.success || typeof packed.data.body !== "object" || packed.data.body === null || Array.isArray(packed.data.body)) return null;
  if (!sources && packed.data.dataSourceIds !== undefined) return null;
  const images = packed.data.mediaIds.map(id => media.get(id));
  if (images.some(image => !image)) return null;
  if (sources && packed.data.dataSourceIds) {
    // The body never carries a second, competing source list in v4.
    if ("dataSources" in packed.data.body) return null;
    const dataSources = packed.data.dataSourceIds.map(id => sources.get(id));
    if (dataSources.some(source => !source)) return null;
    return validProject({...packed.data.body, media: images, dataSources});
  }
  return validProject({...packed.data.body, media: images});
}
export function packState(state: StoredState) {
  const media = new Map<string, ProjectImage>();
  const dataSources = new Map<string, DataSource>();
  const pack = (project: OpenBioFigureProject | null) => {
    if (!project) return null;
    for (const image of project.media) {
      const existing = media.get(image.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(image))
        throw new Error("Saved image identity is inconsistent.");
      media.set(image.id, image);
    }
    for (const source of project.dataSources) {
      const existing = dataSources.get(source.id);
      if (existing && existing.content !== source.content) throw new Error("Saved data source identity is inconsistent.");
      dataSources.set(source.id, source);
    }
    const {media: images, dataSources: sources, ...body} = project;
    return {body, mediaIds: images.map(image => image.id), dataSourceIds: sources.map(source => source.id)};
  };
  const current = pack(state.current);
  const previous = pack(state.previous);
  const recent = state.recent.map(item => ({project: pack(item.project)!, lastOpenedAt: item.lastOpenedAt}));
  return {version: 4 as const, current, previous, recent, media: [...media.values()], dataSources: [...dataSources.values()]};
}
function readState(value: unknown): StoredState { return readStoredState(value).state; }

/** Read a revision independently so a damaged current copy can recover from previous. */
export function readStoredState(value: unknown): {state: StoredState; recovered: boolean} {
  if (value === undefined) return {state: emptyState(), recovered: false};
  const packed = packedStateSchema.safeParse(value);
  let current: OpenBioFigureProject | null;
  let previous: OpenBioFigureProject | null;
  let recent: RecentProject[];
  let rawCurrent: unknown;
  if (packed.success) {
    const media = new Map<string, ProjectImage>();
    for (const item of packed.data.media) {
      if (item && typeof item === "object" && "id" in item && typeof item.id === "string")
        media.set(item.id, item as ProjectImage);
    }
    let sources: Map<string, DataSource> | undefined;
    if (packed.data.version === 4) {
      sources = new Map();
      const duplicateIds = new Set<string>();
      for (const item of packed.data.dataSources) {
        // Validation of bytes, Unicode and the graph happens per restored project.
        if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
          if (sources.has(item.id)) { sources.delete(item.id); duplicateIds.add(item.id); }
          else if (!duplicateIds.has(item.id)) sources.set(item.id, item as DataSource);
        }
      }
    }
    rawCurrent = packed.data.current;
    current = unpackProject(packed.data.current, media, sources);
    previous = unpackProject(packed.data.previous, media, sources);
    recent = packed.data.recent.flatMap(item => {
      const project = unpackProject(item.project, media, sources);
      return project ? [{project, lastOpenedAt: item.lastOpenedAt}] : [];
    });
  } else {
    const legacy = legacyStateSchema.safeParse(value);
    if (!legacy.success) throw new Error("Local document storage is invalid. Export files are unaffected.");
    rawCurrent = legacy.data.current;
    current = validProject(legacy.data.current);
    previous = validProject(legacy.data.previous);
    recent = legacy.data.recent.flatMap(item => {
      const project = validProject(item.project);
      return project ? [{project, lastOpenedAt: item.lastOpenedAt}] : [];
    });
  }
  if (rawCurrent != null && !current && !previous)
    throw new Error("No readable saved revision was found. Open a portable project backup.");
  return {state: {
    version: 2, current: current ?? previous, previous,
    recent: recent.sort((a,b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)),
  }, recovered: Boolean(previous && !current)};
}

export class IndexedDbProjectStorage implements ProjectStorage {
  readonly #store: UseStore;
  recoveredPreviousRevision = false;
  constructor(store: UseStore = createStore("openrender-documents", "documents")) { this.#store = store; }

  private request(store: IDBObjectStore, key: string): Promise<unknown> {
    return new Promise((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  private readPackedState(): Promise<unknown> {
    return this.#store('readonly', async store => hydrateState(await this.request(store, STATE_KEY), key => this.request(store, key)));
  }
  private readFigureRecords(ids: string[]): Promise<{ summary: unknown; record: unknown }[]> {
    return this.#store('readonly', store => Promise.all(ids.map(async id => {
      const [summary, raw] = await Promise.all([this.request(store, figureSummaryKey(id)), this.request(store, figureRecordKey(id))]);
      let record: unknown; try { record = await hydrateFigure(raw, key => this.request(store, key)); } catch { record = undefined; }
      return { summary, record };
    })));
  }

  async load() {
    const raw: unknown = await this.readPackedState();
    if (raw === undefined) {
      // Preserve the inherited database until a validated copy commits to the new store.
      const legacy: unknown = await get("openbiofigure:autosave:v1");
      if (legacy) { const project = migrateProject(legacy); await this.save(project); return project; }
      return null;
    }
    await prepareStoredPlots(raw);
    const {state, recovered} = readStoredState(raw);
    this.recoveredPreviousRevision = recovered;
    // The sync reads the state record again in its own transaction. A failed copy never blocks
    // startup and is retried by the next load.
    await this.#syncLibrary().catch(() => undefined);
    const restored = state.current;
    if (!recovered || !restored) return restored;
    // D-6b: a recovered revision opens as decided by content (D-5), so no later save can replace a
    // differing saved figure with its id. If that cannot be decided, it opens under a fresh id.
    return this.resolveImport(restored)
      .catch(() => ({ ...restored, metadata: { ...restored.metadata, id: globalThis.crypto.randomUUID() } }));
  }

  /**
   * Copies missing or stale current and recent figures into the library (D-6, D-6a); writes only
   * library keys. The state record is read in this same readwrite transaction, which IndexedDB
   * runs wholly before or after any save or delete from any tab, so every copy is decided from
   * the state committed when the sync runs, never from an older read. It is async, like every
   * method here: the store opens the database synchronously, so a denied open must reject, not throw.
   */
  async #syncLibrary(): Promise<void> {
    return this.#store("readwrite", store => new Promise<void>((resolve, reject) => {
      const transaction = store.transaction;
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error("The saved figure library could not be updated."));
      const stateRequest = store.get(STATE_KEY);
      stateRequest.onsuccess = () => { void (async () => {
        try {
          if (stateRequest.result === undefined) return;
          const hydrated = await hydrateState(stateRequest.result, key => this.request(store, key));
          const {state, recovered} = readStoredState(hydrated), ids = figureIdsToSync(state), currentId = state.current?.metadata.id;
          const summaries = new Map<string, unknown>();
          await Promise.all(ids.map(async id => summaries.set(id, await this.request(store, figureSummaryKey(id)))));
          const rawCurrent = currentId === undefined ? undefined : await this.request(store, figureRecordKey(currentId));
          const currentRecord = await hydrateFigure(rawCurrent, key => this.request(store, key)).catch(() => undefined);
          const writes = selectLibrarySync({...state, recovered}, summaries, currentRecord, new Date().toISOString());
          await persistSourceReferences(store, stateRequest.result, undefined, writes);
        } catch (error) { failTransaction(transaction, reject, error); }
      })(); };
    }));
  }

  private async mutate(operation: (state: StoredState) => StoredState,
      changes: LibraryChange[] = [], hasData = false): Promise<void> {
    await prepareStoredPlots(await this.readPackedState());
    await this.#store("readwrite", store => new Promise<void>((resolve, reject) => {
      const transaction = store.transaction;
      transaction.oncomplete = () => resolve();
      transaction.onerror = event => reject(storageFailure(transaction.error,
        storageFailure(event.target instanceof IDBRequest ? event.target.error : null,
          new Error("The local save could not be committed."), hasData), hasData));
      transaction.onabort = () => reject(storageFailure(transaction.error,
        new Error("The local save was cancelled; the previous revision is retained."), hasData));
      const request = store.get(STATE_KEY);
      request.onsuccess = () => { void (async () => {
        try {
          const hydrated = await hydrateState(request.result, key => this.request(store, key));
          const next = operation(readState(hydrated));
          await persistSourceReferences(store, request.result, packState(next), changes);
        } catch (error) { failTransaction(transaction, reject, error, hasData); }
      })(); };
    }));
  }

  async save(value: OpenBioFigureProject) {
    await prepareProjectPlots(value);
    const project = parseProject(value); // Validation finishes before opening a write transaction.
    const savedAt = new Date().toISOString();
    await this.mutate(state => ({
      version: 2, current: project, previous: state.current,
      recent: [{project, lastOpenedAt: savedAt},
        ...state.recent.filter(item => item.project.metadata.id !== project.metadata.id)].slice(0, MAX_RECENT_PROJECTS),
    }), [{ project, savedAt }], project.datasets.length > 0);
  }
  async clear() { await this.mutate(state => ({...state, current: null, previous: null})); }
  async listRecent() { const raw = await this.readPackedState(); await prepareStoredPlots(raw); return readState(raw).recent; }
  async removeRecent(projectId: string) {
    await this.mutate(state => ({...state, recent: state.recent.filter(item => item.project.metadata.id !== projectId)}));
  }
  async clearRecent() { await this.mutate(state => ({...state, recent: []})); }

  // Async so that a denied database open rejects, which the Figures tab shows as its error state.
  async listFigures() {
    return this.#store("readonly", store => new Promise<FigureList>((resolve, reject) => {
      // The upper-open bound ends just past the prefix's final ":", so only summary keys match.
      const range = IDBKeyRange.bound(FIGURE_SUMMARY_PREFIX, FIGURE_SUMMARY_PREFIX.slice(0, -1) + ";", false, true);
      const keys = store.getAllKeys(range);
      const values = store.getAll(range);
      store.transaction.oncomplete = () =>
        resolve(listFigureSummaries(keys.result.map((key, index) => [key, values.result[index]] as const)));
      store.transaction.onerror = store.transaction.onabort = () => reject(new Error("Saved figures could not be read."));
    }));
  }
  async loadFigure(id: string) {
    // A failed read is reported like a missing entry.
    const {summary, record} = (await this.readFigureRecords([id]).catch(() => []))[0] ?? {summary: undefined, record: undefined};
    if (record && typeof record === 'object' && 'project' in record) await prepareProjectPlots(record.project).catch(() => undefined);
    return decodeSavedFigure(id, summary, record);
  }
  async deleteFigure(id: string) {
    await this.mutate(state => stateWithoutFigure(state, id), [{ deleteId: id }]);
  }
  async resolveImport(value: OpenBioFigureProject) {
    await prepareProjectPlots(value);
    const file = parseProject(value);
    const id = file.metadata.id;
    const {summary, record} = (await this.readFigureRecords([id]))[0]!;
    if (record && typeof record === 'object' && 'project' in record) await prepareProjectPlots(record.project).catch(() => undefined);
    const byId = resolveImportById(file, summary, record);
    if (byId) return byId;
    const candidates = importCandidateIds(file, (await this.listFigures()).figures);
    const records = await this.readFigureRecords(candidates);
    for (const {record} of records) if (record && typeof record === 'object' && 'project' in record) await prepareProjectPlots(record.project).catch(() => undefined);
    return resolveImportByContent(file, candidates.map((candidate, index) => [candidate, records[index]!.record] as const));
  }
}

export class MemoryProjectStorage implements ProjectStorage {
  #state = emptyState();
  // Library values are kept as stored values, like IndexedDB, and decoded on every read.
  readonly #library = new Map<string, unknown>();
  load() {
    const ids = figureIdsToSync(this.#state);
    const summaries = new Map(ids.map(id => [id, this.#library.get(figureSummaryKey(id))] as const));
    const currentRecord = this.#state.current && this.#library.get(figureRecordKey(this.#state.current.metadata.id));
    for (const write of selectLibrarySync(this.#state, summaries, currentRecord, new Date().toISOString()))
      this.#putFigure(write.project, write.savedAt);
    return Promise.resolve(this.#state.current ? parseProject(this.#state.current) : null);
  }
  save(value: OpenBioFigureProject) {
    const project = parseProject(value);
    const savedAt = new Date().toISOString();
    this.#state = {...this.#state, current: project, previous: this.#state.current,
      recent: [{project, lastOpenedAt: savedAt},
        ...this.#state.recent.filter(item => item.project.metadata.id !== project.metadata.id)].slice(0, MAX_RECENT_PROJECTS)};
    this.#putFigure(project, savedAt);
    return Promise.resolve();
  }
  #putFigure(project: OpenBioFigureProject, savedAt: string) {
    this.#library.set(figureSummaryKey(project.metadata.id), summarizeFigure(project, savedAt));
    this.#library.set(figureRecordKey(project.metadata.id), structuredClone(encodeFigureRecord(project)));
  }
  clear() { this.#state.current = null; this.#state.previous = null; return Promise.resolve(); }
  listRecent() { return Promise.resolve(structuredClone(this.#state.recent)); }
  removeRecent(id: string) { this.#state.recent = this.#state.recent.filter(item => item.project.metadata.id !== id); return Promise.resolve(); }
  clearRecent() { this.#state.recent = []; return Promise.resolve(); }
  listFigures() {
    return Promise.resolve(listFigureSummaries([...this.#library].filter(([key]) => key.startsWith(FIGURE_SUMMARY_PREFIX))));
  }
  async loadFigure(id: string) {
    return decodeSavedFigure(id, this.#library.get(figureSummaryKey(id)), this.#library.get(figureRecordKey(id)));
  }
  async deleteFigure(id: string) {
    this.#state = stateWithoutFigure(this.#state, id);
    this.#library.delete(figureSummaryKey(id));
    this.#library.delete(figureRecordKey(id));
  }
  async resolveImport(value: OpenBioFigureProject) {
    const file = parseProject(value);
    const candidates = importCandidateIds(file, (await this.listFigures()).figures);
    return resolveImportDecision(file,
      {summary: this.#library.get(figureSummaryKey(file.metadata.id)), record: this.#library.get(figureRecordKey(file.metadata.id))},
      candidates.map(id => [id, this.#library.get(figureRecordKey(id))] as const));
  }
}
