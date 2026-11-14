import { identityTransform, plotTransform } from '../plots/transform';
import { z } from "zod";
import { projectAssetSchema } from "../assets/schema";
import { sanitizeSvg, isSafePaint } from "../assets/sanitize";
import { matchesApprovedAsset } from "../assets/reviewedCatalog";
import { INPUT_LIMITS, InputError, preflightValue } from "../security/input";
import { SHAPE_IDS } from "../shapes/registry";
import { decodeProjectImage, type ProjectImage } from "../media/images";
import { dataSourceSchema, datasetSchema } from "../data/schema";
import { plotSpecSchema } from '../plots/spec';
import { buildPlotScene } from '../plots/scene';

export const FORMAT_VERSION = "3.0.0" as const;

const commonObjectSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(INPUT_LIMITS.textLength),
  x: z.number().finite().min(-INPUT_LIMITS.coordinate).max(INPUT_LIMITS.coordinate),
  y: z.number().finite().min(-INPUT_LIMITS.coordinate).max(INPUT_LIMITS.coordinate),
  width: z.number().positive().max(INPUT_LIMITS.coordinate),
  height: z.number().positive().max(INPUT_LIMITS.coordinate),
  scaleX: z.number().min(0.001).max(INPUT_LIMITS.scale),
  scaleY: z.number().min(0.001).max(INPUT_LIMITS.scale),
  angle: z.number().finite().min(-360_000).max(360_000),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  fill: z.string().max(128).refine(isSafePaint).nullable(),
  stroke: z.string().max(128).refine(isSafePaint).nullable(),
  strokeWidth: z.number().min(0).max(10_000),
}).strict();

const rectObjectSchema = commonObjectSchema.extend({ kind: z.literal("rect") });
const plotObjectSchema = commonObjectSchema.extend({ kind: z.literal('plot'), plot: plotSpecSchema });
const ellipseObjectSchema = commonObjectSchema.extend({
  kind: z.literal("ellipse"),
});
const textObjectSchema = commonObjectSchema.extend({
  kind: z.literal("text"),
  text: z.string().max(INPUT_LIMITS.textLength),
  fontFamily: z.string().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9 ,'-]*$/),
  fontSize: z.number().positive().max(10_000),
  fontWeight: z.union([z.enum(["normal", "bold"]), z.number().int().min(100).max(900)]),
  textAlign: z.enum(["left", "center", "right", "justify"]),
});
const linePointsSchema = z.tuple(Array.from({ length: 4 }, () => z.number().finite().min(-INPUT_LIMITS.coordinate).max(INPUT_LIMITS.coordinate)) as [z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber]);
const connectorAttachmentSchema = z.object({
  objectId: z.string().min(1).max(128),
  site: z.enum(["center", "top", "right", "bottom", "left"]),
}).strict();
const lineObjectSchema = commonObjectSchema.extend({
  kind: z.enum(["line", "arrow"]),
  points: linePointsSchema,
});
const connectorObjectSchema = commonObjectSchema.extend({
  kind: z.literal("connector"),
  points: linePointsSchema,
  start: connectorAttachmentSchema.nullable().optional(),
  end: connectorAttachmentSchema.nullable().optional(),
  routing: z.enum(["straight", "elbow", "curved"]).optional(),
});
const svgObjectSchema = commonObjectSchema.extend({
  kind: z.literal("svg"),
  assetId: z.string().min(1).max(128),
});
const shapeObjectSchema = commonObjectSchema.extend({
  kind: z.literal("shape"),
  shapeId: z.enum(SHAPE_IDS),
  adjustment: z.number().finite().min(0.15).max(0.85),
  label: z.string().max(INPUT_LIMITS.textLength),
});
const imageObjectSchema = commonObjectSchema.extend({
  kind: z.literal("image"),
  mediaId: z.string().regex(/^image-[a-f0-9]{64}$/),
  cropX: z.number().int().min(0).max(INPUT_LIMITS.pngSide),
  cropY: z.number().int().min(0).max(INPUT_LIMITS.pngSide),
  cropWidth: z.number().int().positive().max(INPUT_LIMITS.pngSide),
  cropHeight: z.number().int().positive().max(INPUT_LIMITS.pngSide),
  flipX: z.boolean(),
  flipY: z.boolean(),
});
const mediaSchema = z.object({
  id: z.string().regex(/^image-[a-f0-9]{64}$/),
  name: z.string().min(1).max(256),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  data: z.string().min(4).max(Math.ceil(INPUT_LIMITS.imageBytes / 3) * 4),
  width: z.number().int().positive().max(INPUT_LIMITS.pngSide),
  height: z.number().int().positive().max(INPUT_LIMITS.pngSide),
}).strict();

export type ProjectObject =
  | z.infer<typeof plotObjectSchema>
  | z.infer<typeof rectObjectSchema>
  | z.infer<typeof ellipseObjectSchema>
  | z.infer<typeof textObjectSchema>
  | z.infer<typeof lineObjectSchema>
  | z.infer<typeof connectorObjectSchema>
  | z.infer<typeof svgObjectSchema>
  | z.infer<typeof shapeObjectSchema>
  | z.infer<typeof imageObjectSchema>
  | (z.infer<typeof commonObjectSchema> & {
      kind: "group";
      children: ProjectObject[];
    });

export const projectObjectSchema: z.ZodType<ProjectObject> = z.lazy(() =>
  z.union([
    rectObjectSchema,
    ellipseObjectSchema,
    textObjectSchema,
    lineObjectSchema,
    connectorObjectSchema,
    svgObjectSchema,
    shapeObjectSchema,
    imageObjectSchema,
    plotObjectSchema,
    commonObjectSchema.extend({
      kind: z.literal("group"),
      children: z.array(projectObjectSchema).max(INPUT_LIMITS.objects),
    }),
  ]),
);

export const openBioFigureProjectSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  metadata: z.object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(INPUT_LIMITS.textLength),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    applicationVersion: z.string().min(1).max(128),
  }).strict(),
  document: z.object({
    width: z.number().int().min(100).max(10_000),
    height: z.number().int().min(100).max(10_000),
    unit: z.literal("px"),
    background: z.string().min(1).max(128).refine(isSafePaint),
    preset: z.string().min(1).max(128),
  }).strict(),
  objects: z.array(projectObjectSchema).max(INPUT_LIMITS.objects),
  assets: z.array(projectAssetSchema).max(INPUT_LIMITS.assets),
  media: z.array(mediaSchema).max(100),
  dataSources: z.array(dataSourceSchema).max(INPUT_LIMITS.dataSources),
  datasets: z.array(datasetSchema).max(INPUT_LIMITS.datasets),
  settings: z.object({
    grid: z.object({
      enabled: z.boolean(),
      size: z.number().int().min(2).max(200),
      snap: z.boolean(),
    }).strict(),
    locale: z.enum(["en", "fr"]),
  }).strict(),
}).strict();

export type OpenBioFigureProject = z.infer<typeof openBioFigureProjectSchema>;

export function parseProject(value: unknown): OpenBioFigureProject {
  preflightValue(value);
  const result = openBioFigureProjectSchema.safeParse(value);
  if (!result.success) throw new InputError("invalid_project", "Project structure or values are unsupported.");
  const project = result.data;
  const sources = new Set<string>();
  for (const source of project.dataSources) {
    if (sources.has(source.id)) throw new InputError("duplicate_id", "Project data source IDs must be unique.");
    sources.add(source.id);
  }
  const datasets = new Set<string>();
  const usedSources = new Set<string>();
  for (const dataset of project.datasets) {
    if (datasets.has(dataset.id)) throw new InputError("duplicate_id", "Project dataset IDs must be unique.");
    datasets.add(dataset.id);
    if (!sources.has(dataset.sourceId)) throw new InputError("missing_data_source", "A dataset references a missing data source.");
    usedSources.add(dataset.sourceId);
    if (dataset.columns.some((column, index) => column.key !== `c${index}`))
      throw new InputError("invalid_columns", "Dataset column keys must be unique and contiguous in source order.");
  }
  if (usedSources.size !== sources.size)
    throw new InputError("unused_data_source", "Every data source must be referenced by a dataset.");
  if (project.document.width * project.document.height > INPUT_LIMITS.pngPixels)
    throw new InputError("document_too_large", "The document exceeds the canvas budget. Reduce its dimensions.");
  const assets = new Map<string, { commands: number; elements: number }>();
  const media = new Map<string, ProjectImage>();
  for (const image of project.media) {
    if (media.has(image.id)) throw new InputError("duplicate_id", "Project image IDs must be unique.");
    decodeProjectImage(image);
    media.set(image.id, image);
  }
  let retainedCommands = 0;
  for (const asset of project.assets) {
    if (assets.has(asset.id)) throw new InputError("duplicate_id", "Project asset IDs must be unique.");
    const sanitized = sanitizeSvg(asset.svg);
    asset.svg = sanitized.svg;
    if (sanitized.changed) {
      const note = "Inert comments were removed and SVG serialization was normalized during import.";
      const notes = asset.attribution.modificationNotes ? asset.attribution.modificationNotes + " " + note : note;
      if (notes.length > INPUT_LIMITS.textLength)
        throw new InputError("text_limit", "SVG modification notes exceed the supported text limit.");
      asset.attribution.modified = true;
      asset.attribution.modificationNotes = notes;
    }
    // A portable file or recovery record cannot grant reviewed catalogue status.
    // Reconstruct approval from the application-owned manifest and SVG fingerprint.
    asset.verified = matchesApprovedAsset(asset);
    assets.set(asset.id, { commands: sanitized.pathCommands, elements: sanitized.elements });
    retainedCommands += sanitized.pathCommands;
  }
  const ids = new Set<string>();
  const connectorIds = new Set<string>();
  let objectCount = 0;
  let commands = 0;
  let elements = 0;
  const plotBudget = { elements: 0, commands: 0, text: 0, bytes: 0 };
  const visit = (objects: ProjectObject[], parent = identityTransform) => {
    for (const object of objects) {
      if (++objectCount > INPUT_LIMITS.objects)
        throw new InputError("object_limit", "Project object count exceeds the supported limit.");
      if (ids.has(object.id)) throw new InputError("duplicate_id", "Project object IDs must be unique.");
      ids.add(object.id);
      if (object.kind === "connector") connectorIds.add(object.id);
      const {matrix, scaleX, scaleY} = plotTransform(parent, object);
      if (Math.max(scaleX, scaleY) > INPUT_LIMITS.scale ||
          object.width * scaleX > INPUT_LIMITS.coordinate || object.height * scaleY > INPUT_LIMITS.coordinate)
        throw new InputError("transform_limit", "Project transforms exceed the supported geometry budget.");
      if (object.kind === "svg") {
        const asset = assets.get(object.assetId);
        if (!asset) throw new InputError("missing_asset", "Project contains a missing asset reference.");
        commands += asset.commands;
        elements += asset.elements;
      }
      if (object.kind === 'plot') {
        const dataset = project.datasets.find(dataset => dataset.id === object.plot.datasetId);
        const source = project.dataSources.find(source => source.id === dataset?.sourceId);
        const scene = buildPlotScene(source, dataset, object.plot, object.width * scaleX, object.height * scaleY);
        for (const key of ['elements', 'commands', 'text', 'bytes'] as const) plotBudget[key] += scene.budget[key];
        if (plotBudget.elements > INPUT_LIMITS.plotElements || plotBudget.commands > INPUT_LIMITS.plotPathCommands || plotBudget.text > INPUT_LIMITS.plotText || plotBudget.bytes > INPUT_LIMITS.plotBytes)
          throw new InputError('plot_budget', 'The figure exceeds its plot export budget. Reduce points, labels or plots before applying.');
        commands += scene.budget.commands; elements += scene.budget.elements;
      }
      if (object.kind === "image") {
        const image = media.get(object.mediaId);
        if (!image || object.cropX + object.cropWidth > image.width || object.cropY + object.cropHeight > image.height)
          throw new InputError("missing_image", "Project image or crop is invalid.");
      }
      if (object.kind === "group") visit(object.children, matrix);
    }
  };
  visit(project.objects);
  const checkAttachments = (objects: ProjectObject[]) => {
    for (const object of objects) {
      if (object.kind === "connector") {
        for (const attachment of [object.start, object.end]) {
          if (attachment && (!ids.has(attachment.objectId) || connectorIds.has(attachment.objectId)))
            throw new InputError("missing_attachment", "A connector references a missing object.");
        }
      }
      if (object.kind === "group") checkAttachments(object.children);
    }
  };
  checkAttachments(project.objects);
  if (Math.max(commands, retainedCommands) > INPUT_LIMITS.documentPathCommands || elements > INPUT_LIMITS.documentVectorElements)
    throw new InputError("vector_limit", "Expanded artwork exceeds the project vector budget.");
  return project;
}
