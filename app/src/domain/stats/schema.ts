import { z } from 'zod';
import { INPUT_LIMITS } from '../security/input';

export const analysisConfigSchema = z.object({
  test: z.enum(['welch', 'student', 'paired-t', 'mann-whitney', 'wilcoxon', 'kruskal-wallis', 'pairwise-welch', 'anova']),
  pairing: z.enum(['id', 'row-order']), comparisons: z.enum(['all', 'control', 'selected']), control: z.string().max(INPUT_LIMITS.textLength).nullable(),
  pairs: z.array(z.tuple([z.string().max(INPUT_LIMITS.textLength), z.string().max(INPUT_LIMITS.textLength)])).max(INPUT_LIMITS.plotComparisons).optional(),
  postHoc: z.enum(['none', 'tukey', 'dunn']).optional(), showGlobal: z.boolean().optional(), showBrackets: z.boolean().optional(),
  adjustment: z.enum(['none', 'bonferroni', 'holm', 'bh']), alpha: z.number().finite().gt(0).lt(1),
  useAdjusted: z.boolean(), label: z.enum(['stars', 'p', 'scientific']), hideNs: z.boolean(),
}).strict();
const number = z.number().finite().nullable();
export const descriptiveSchema = z.object({ n: z.number().int().nonnegative(), mean: number, sd: number, sem: number, ciLow: number, ciHigh: number, median: number, q1: number, q3: number, iqr: number, min: number, max: number }).strict();
export const testResultSchema = z.object({ test: z.string().max(128), statistic: number, df: number, df2: number.optional(), p: number.refine(value => value === null || value >= 0 && value <= 1), effect: number, ciLow: number.optional(), ciHigh: number.optional(), method: z.string().max(128), reason: z.string().max(500).nullable() }).strict();
export const analysisResultSchema = z.object({
  engine: z.string().max(128), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), alternative: z.literal('two-sided'),
  groups: z.array(z.object({ key: z.string().max(INPUT_LIMITS.textLength), label: z.string().max(INPUT_LIMITS.textLength), descriptive: descriptiveSchema }).strict()).max(INPUT_LIMITS.plotGroups),
  global: testResultSchema.nullable(), familySize: z.number().int().min(0).max(INPUT_LIMITS.plotComparisons),
  comparisons: z.array(z.object({ a: z.number().int().nonnegative(), b: z.number().int().nonnegative(), result: testResultSchema, adjustedP: number.refine(value => value === null || value >= 0 && value <= 1), selectedP: number, significant: z.boolean(), label: z.string().max(128), matchedPairs: z.number().int().nonnegative().nullable().optional(), excludedA: z.number().int().nonnegative().optional(), excludedB: z.number().int().nonnegative().optional() }).strict()).max(INPUT_LIMITS.plotComparisons),
  exclusions: z.array(z.object({ reason: z.string().max(500), count: z.number().int().nonnegative(), rows: z.array(z.number().int().nonnegative()).max(50) }).strict()).max(200),
}).strict();
export type AnalysisConfig = z.infer<typeof analysisConfigSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type TestResult = z.infer<typeof testResultSchema>;
