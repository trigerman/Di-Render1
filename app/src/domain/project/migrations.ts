import { createProject } from "./factory";
import { z } from "zod";
import { InputError, preflightValue } from "../security/input";
import {
  FORMAT_VERSION,
  parseProject,
  type OpenBioFigureProject,
} from "./schema";

const legacySchema = z.object({
  formatVersion: z.union([z.literal(0), z.literal("0.1.0")]),
  title: z.string().min(1).max(10_000).optional(),
  metadata: z.object({ title: z.string().min(1).max(10_000) }).strict().optional(),
  document: z.object({
    width: z.number().int().min(100).max(10_000).optional(),
    height: z.number().int().min(100).max(10_000).optional(),
    background: z.string().max(128).optional(),
  }).strict().optional(),
  objects: z.array(z.unknown()).max(5_000).optional(),
  assets: z.array(z.unknown()).max(1_000).optional(),
}).strict();

export function migrateProject(input: unknown): OpenBioFigureProject {
  preflightValue(input);
  if (typeof input !== "object" || input === null)
    throw new Error("Project data must be an object.");
  if ("formatVersion" in input && input.formatVersion === FORMAT_VERSION)
    return parseProject(input);
  if ("formatVersion" in input && ["1.0.0", "2.0.0"].includes(String(input.formatVersion)) &&
      ("dataSources" in input || "datasets" in input))
    throw new InputError("invalid_project", "Older project formats cannot contain datasets or data sources.");
  if ("formatVersion" in input && input.formatVersion === "2.0.0")
    return parseProject({ ...input, formatVersion: FORMAT_VERSION, dataSources: [], datasets: [] });
  if ("formatVersion" in input && input.formatVersion === "1.0.0") {
    // The 1.0 document is otherwise unchanged. Reject new object kinds dressed
    // as an old file before applying the current strict schema.
    const old = input as { objects?: unknown };
    const isOldObject = (value: unknown): boolean => {
      if (!value || typeof value !== "object" || !("kind" in value)) return false;
      const object = value as { kind: unknown; children?: unknown };
      if (!["rect", "ellipse", "text", "line", "arrow", "connector", "svg", "group"].includes(String(object.kind))) return false;
      return object.kind !== "group" || (Array.isArray(object.children) && object.children.every(isOldObject));
    };
    if (!Array.isArray(old.objects) || !old.objects.every(isOldObject))
      throw new InputError("invalid_project", "Project structure or values are unsupported.");
    return parseProject({ ...input, formatVersion: FORMAT_VERSION, media: [], dataSources: [], datasets: [] });
  }

  const legacy = legacySchema.safeParse(input);
  if (legacy.success) {
    const candidate = legacy.data;
    const migrated = createProject("custom", {
      width: candidate.document?.width ?? 1200,
      height: candidate.document?.height ?? 800,
    });
    migrated.metadata.title =
      candidate.title ?? candidate.metadata?.title ?? "Imported figure";
    migrated.document.background = candidate.document?.background ?? "#ffffff";
    return parseProject({ ...migrated, objects: candidate.objects ?? [], assets: candidate.assets ?? [] });
  }

  throw new InputError("unsupported_version", "Project format or migration data is unsupported.");
}
