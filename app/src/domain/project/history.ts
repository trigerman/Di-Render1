import type { ProjectImage } from "../media/images";
import type { DataSource } from "../data/schema";
import type { OpenBioFigureProject } from "./schema";

interface Snapshot {
  body: Omit<OpenBioFigureProject, "media" | "dataSources">;
  mediaIds: string[];
  dataSourceIds: string[];
}

export class ProjectHistory {
  readonly limit: number;
  #past: Snapshot[] = [];
  #present: Snapshot;
  #future: Snapshot[] = [];
  #media = new Map<string, ProjectImage>();
  #dataSources = new Map<string, DataSource>();

  constructor(initial: OpenBioFigureProject, limit = 80) {
    this.limit = limit;
    this.#present = this.capture(initial);
  }

  private capture(project: OpenBioFigureProject): Snapshot {
    for (const image of project.media) {
      const existing = this.#media.get(image.id);
      if (existing && existing.data !== image.data) throw new Error("Image identity changed in history.");
      if (!existing) this.#media.set(image.id, structuredClone(image));
    }
    for (const source of project.dataSources) {
      const existing = this.#dataSources.get(source.id);
      if (existing && existing.content !== source.content) throw new Error("Data source identity changed in history.");
      if (!existing) this.#dataSources.set(source.id, structuredClone(source));
    }
    const { media, dataSources, ...body } = project;
    return { body: structuredClone(body), mediaIds: media.map(image => image.id), dataSourceIds: dataSources.map(source => source.id) };
  }

  private restore(snapshot: Snapshot): OpenBioFigureProject {
    return { ...structuredClone(snapshot.body), media: snapshot.mediaIds.map(id => structuredClone(this.#media.get(id)!)),
      dataSources: snapshot.dataSourceIds.map(id => structuredClone(this.#dataSources.get(id)!)) };
  }

  private collectUnusedInputs() {
    const snapshots = [...this.#past, this.#present, ...this.#future];
    const retained = new Set(snapshots.flatMap(snapshot => snapshot.mediaIds));
    for (const id of this.#media.keys()) if (!retained.has(id)) this.#media.delete(id);
    const retainedSources = new Set(snapshots.flatMap(snapshot => snapshot.dataSourceIds));
    for (const id of this.#dataSources.keys()) if (!retainedSources.has(id)) this.#dataSources.delete(id);
  }

  get current() { return this.restore(this.#present); }
  get canUndo() { return this.#past.length > 0; }
  get canRedo() { return this.#future.length > 0; }

  push(next: OpenBioFigureProject) {
    const snapshot = this.capture(next);
    if (JSON.stringify(snapshot) === JSON.stringify(this.#present)) return;
    this.#past.push(this.#present);
    if (this.#past.length > this.limit) this.#past.shift();
    this.#present = snapshot;
    this.#future = [];
    this.collectUnusedInputs();
  }

  replace(next: OpenBioFigureProject) {
    this.#present = this.capture(next);
    this.collectUnusedInputs();
  }

  undo(): OpenBioFigureProject | null {
    const previous = this.#past.pop();
    if (!previous) return null;
    this.#future.push(this.#present);
    this.#present = previous;
    return this.current;
  }

  redo(): OpenBioFigureProject | null {
    const next = this.#future.pop();
    if (!next) return null;
    this.#past.push(this.#present);
    this.#present = next;
    return this.current;
  }
}
