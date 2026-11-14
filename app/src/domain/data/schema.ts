import { z } from "zod";
import { INPUT_LIMITS } from "../security/input";
import { isWellFormedUnicode } from "./source";

export const dataSourceSchema = z.object({
  id: z.string().regex(/^data-[a-f0-9]{64}$/),
  content: z.string().refine(isWellFormedUnicode)
    .refine(content => !content.includes("\0")),
}).strict();

export const datasetReadSchema = z.object({
  version: z.literal(1),
  delimiter: z.enum([",", "\t", ";", "|"]),
  header: z.enum(["first-row", "none"]),
  skipRows: z.number().int().min(0).max(INPUT_LIMITS.datasetRows),
  decimal: z.enum([".", ","]),
  thousands: z.enum([",", ".", " ", "'"]).nullable(),
  missing: z.array(z.string().max(256)).max(100),
  dateFormat: z.enum(["iso", "dmy", "mdy"]),
  transpose: z.boolean(),
}).strict().refine(read => read.decimal !== read.thousands);

export const datasetColumnSchema = z.object({
  key: z.string().regex(/^c(0|[1-9]\d*)$/).max(16),
  name: z.string().min(1).max(INPUT_LIMITS.textLength),
  type: z.enum(["number", "category", "date", "text"]),
  unit: z.string().max(128).nullable(),
  levels: z.array(z.string().max(INPUT_LIMITS.textLength)).max(INPUT_LIMITS.datasetRows).nullable(),
}).strict().refine(column => column.levels === null || new Set(column.levels).size === column.levels.length);

export const datasetSchema = z.object({
  id: z.string().regex(/^dataset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  name: z.string().min(1).max(INPUT_LIMITS.textLength),
  sourceId: z.string().regex(/^data-[a-f0-9]{64}$/),
  origin: z.object({
    name: z.string().min(1).max(256),
    mediaType: z.enum(["text/csv", "text/tab-separated-values", "text/plain"]),
    encoding: z.enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"]),
    bytes: z.number().int().min(0).max(INPUT_LIMITS.dataSourceBytes),
    importedAt: z.iso.datetime(),
  }).strict(),
  read: datasetReadSchema,
  columns: z.array(datasetColumnSchema).min(1).max(INPUT_LIMITS.datasetColumns),
}).strict();

export type DataSource = z.infer<typeof dataSourceSchema>;
export type Dataset = z.infer<typeof datasetSchema>;
export type DatasetRead = z.infer<typeof datasetReadSchema>;
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;
