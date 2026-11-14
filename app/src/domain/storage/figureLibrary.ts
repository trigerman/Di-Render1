import { z } from "zod";
import { migrateProject } from "../project/migrations";
import { parseProject, type OpenBioFigureProject } from "../project/schema";
import { INPUT_LIMITS, InputError } from "../security/input";

// Saved figures live beside the autosave state record in the same object store, so one
// transaction can commit both. Every value read back is untrusted and decoded here.
export const FIGURE_SUMMARY_PREFIX = "openrender:figure-summary:v1:";
const FIGURE_RECORD_PREFIX = "openrender:figure:v1:";
export const figureSummaryKey = (id: string) => FIGURE_SUMMARY_PREFIX + id;
export const figureRecordKey = (id: string) => FIGURE_RECORD_PREFIX + id;

// Bounds equal the project schema's, so every saved project has a valid summary.
const figureSummarySchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(INPUT_LIMITS.textLength),
  width: z.number().int().min(100).max(10_000),
  height: z.number().int().min(100).max(10_000),
  savedAt: z.iso.datetime(),
}).strict();
const figureRecordSchema = z.object({ version: z.literal(1), project: z.unknown() }).strict();

export type FigureSummary = z.infer<typeof figureSummarySchema>;
export interface FigureList { figures: FigureSummary[]; skipped: number; }
export interface FigureRecord { version: 1; project: OpenBioFigureProject; }
export interface RecentFigure { project: OpenBioFigureProject; lastOpenedAt: string; }
export interface LibrarySyncState {
  current: OpenBioFigureProject | null;
  recent: readonly RecentFigure[];
  /** True when the stored current revision is unreadable and `current` is the recovered previous one. */
  recovered?: boolean;
}
export interface LibraryWrite { project: OpenBioFigureProject; savedAt: string; }

const unreadableFigure = () =>
  new InputError("saved_figure_invalid", "This saved figure is missing or damaged and could not be opened.");

export function summarizeFigure(project: OpenBioFigureProject, savedAt: string): FigureSummary {
  return { version: 1, id: project.metadata.id, title: project.metadata.title,
    width: project.document.width, height: project.document.height, savedAt };
}
export const encodeFigureRecord = (project: OpenBioFigureProject): FigureRecord => ({ version: 1, project });

/** A valid summary, or null; with `expectedId`, the summary must also belong to that figure. */
export function parseFigureSummary(value: unknown, expectedId?: string): FigureSummary | null {
  const summary = figureSummarySchema.safeParse(value);
  return summary.success && (expectedId === undefined || summary.data.id === expectedId) ? summary.data : null;
}

export function decodeFigureRecord(value: unknown, expectedId: string): OpenBioFigureProject {
  const record = figureRecordSchema.safeParse(value);
  if (!record.success) throw unreadableFigure();
  let project: OpenBioFigureProject;
  try { project = migrateProject(record.data.project); }
  catch { throw unreadableFigure(); }
  if (project.metadata.id !== expectedId) throw unreadableFigure();
  return project;
}
function readFigureRecord(value: unknown, expectedId: string): OpenBioFigureProject | null {
  try { return decodeFigureRecord(value, expectedId); }
  catch { return null; }
}

/** Opening a saved figure needs both its listed summary and its full record. */
export function decodeSavedFigure(id: string, summary: unknown, record: unknown): OpenBioFigureProject {
  if (!parseFigureSummary(summary, id)) throw unreadableFigure();
  return decodeFigureRecord(record, id);
}

const savedTime = (value: string) => Date.parse(value);
export function listFigureSummaries(entries: Iterable<readonly [key: unknown, value: unknown]>): FigureList {
  const figures: FigureSummary[] = [];
  let skipped = 0;
  for (const [key, value] of entries) {
    const summary = typeof key === "string" && key.startsWith(FIGURE_SUMMARY_PREFIX)
      ? parseFigureSummary(value, key.slice(FIGURE_SUMMARY_PREFIX.length)) : null;
    if (summary) figures.push(summary);
    else skipped++;
  }
  figures.sort((a, b) => savedTime(b.savedAt) - savedTime(a.savedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { figures, skipped };
}

const contentOf = (project: OpenBioFigureProject) =>
  JSON.stringify({ ...project, metadata: { ...project.metadata, id: "", updatedAt: "" } });
/** Figure content without its identity and edit time: equal strings mean the same drawing (D-5). */
export const canonicalFigureContent = (project: OpenBioFigureProject) => contentOf(parseProject(project));

export function figureIdsToSync(state: LibrarySyncState): string[] {
  const ids = state.recent.map(item => item.project.metadata.id);
  if (state.current) ids.unshift(state.current.metadata.id);
  return [...new Set(ids)];
}

/**
 * Library entries to (re)write so the current and recent figures are all saved (D-6, D-6a).
 * `summaries` maps figure ids to their stored summary values and `currentRecord` is the
 * stored record of the current figure; both are untrusted and treated as missing when invalid.
 * A recovered current figure only fills a missing entry: a valid one may hold newer work.
 */
export function selectLibrarySync(state: LibrarySyncState, summaries: ReadonlyMap<string, unknown>,
    currentRecord: unknown, now: string): LibraryWrite[] {
  const newest = new Map<string, RecentFigure>();
  for (const item of state.recent) {
    const known = newest.get(item.project.metadata.id);
    if (!known || savedTime(item.lastOpenedAt) > savedTime(known.lastOpenedAt)) newest.set(item.project.metadata.id, item);
  }
  const writes: LibraryWrite[] = [];
  if (state.current) {
    const id = state.current.metadata.id;
    const stored = readFigureRecord(currentRecord, id);
    const missing = !parseFigureSummary(summaries.get(id), id) || !stored;
    const item = newest.get(id);
    if (state.recovered) {
      // A recent item is the figure's latest save, never older than the recovered previous
      // revision, so it is the copy written; with a valid entry it keeps the recent rule below.
      if (missing) {
        writes.push(item ? { project: item.project, savedAt: item.lastOpenedAt } : { project: state.current, savedAt: now });
        newest.delete(id);
      }
    } else {
      // Both projects are schema output, so equal JSON means equal content. Edits such as the
      // grid toggle keep the edit time, so the open figure is compared by content.
      if (missing || JSON.stringify(stored) !== JSON.stringify(state.current))
        writes.push({ project: state.current, savedAt: item?.lastOpenedAt ?? now });
      newest.delete(id);
    }
  }
  for (const [id, item] of newest) {
    const summary = parseFigureSummary(summaries.get(id), id);
    if (!summary || savedTime(item.lastOpenedAt) > savedTime(summary.savedAt))
      writes.push({ project: item.project, savedAt: item.lastOpenedAt });
  }
  return writes;
}

/** Saved figures that could hold the same drawing as `file` under another id, newest first. */
export function importCandidateIds(file: OpenBioFigureProject, summaries: readonly FigureSummary[]): string[] {
  return summaries.filter(summary => summary.id !== file.metadata.id && summary.title === file.metadata.title &&
    summary.width === file.document.width && summary.height === file.document.height).map(summary => summary.id);
}

/**
 * D-5 cases (a) and (b): the project to open when the saved figure with the file's id decides,
 * or null when other saved figures must be compared. An entry that exists but cannot be read
 * still counts as different content, so it is never overwritten.
 */
export function resolveImportById(file: OpenBioFigureProject, summary: unknown, record: unknown): OpenBioFigureProject | null {
  if (summary === undefined && record === undefined) return file;
  const saved = readFigureRecord(record, file.metadata.id);
  return saved && contentOf(saved) === canonicalFigureContent(file) ? saved : null;
}

/** D-5 cases (c) and (d): reuse a valid saved figure with equal content, else fork a new figure. */
export function resolveImportByContent(file: OpenBioFigureProject, candidates: Iterable<readonly [id: string, record: unknown]>,
    newId: () => string = () => globalThis.crypto.randomUUID()): OpenBioFigureProject {
  const content = canonicalFigureContent(file);
  for (const [id, record] of candidates) {
    if (id === file.metadata.id) continue;
    // A damaged or tampered copy is skipped, never reused.
    const candidate = readFigureRecord(record, id);
    if (candidate && contentOf(candidate) === content) return candidate;
  }
  return { ...file, metadata: { ...file.metadata, id: newId() } };
}

export function resolveImportDecision(file: OpenBioFigureProject, saved: { summary: unknown; record: unknown },
    candidates: Iterable<readonly [id: string, record: unknown]>, newId?: () => string): OpenBioFigureProject {
  return resolveImportById(file, saved.summary, saved.record) ?? resolveImportByContent(file, candidates, newId);
}

/**
 * The state record without `id`: its recent item and a recovery copy (`previous`) of it go
 * together, so neither recovery nor the sync can bring the figure back. The state's current
 * figure may be open in another tab and is refused.
 */
export function stateWithoutFigure<T extends LibrarySyncState & { previous: OpenBioFigureProject | null }>(state: T, id: string): T {
  if (state.current?.metadata.id === id)
    throw new InputError("figure_in_use", "This figure was saved most recently and may be open in another tab, so it was not deleted.");
  return { ...state, previous: state.previous?.metadata.id === id ? null : state.previous,
    recent: state.recent.filter(item => item.project.metadata.id !== id) };
}
