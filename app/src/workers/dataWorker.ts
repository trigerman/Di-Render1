import { identityTransform, plotTransform, type LinearTransform } from '../domain/plots/transform';
import { z } from 'zod';
import { dataSourceSchema, datasetSchema, datasetReadSchema, datasetColumnSchema } from '../domain/data/schema';
import { previewImport, readDataset } from '../domain/data/dataset';
import { plotSpecSchema } from '../domain/plots/spec';
import { buildPlotScene } from '../domain/plots/scene';
import { INPUT_LIMITS, InputError } from '../domain/security/input';
import { preflightValue } from '../domain/security/input';
import { openBioFigureProjectSchema, type ProjectObject } from '../domain/project/schema';
import { decodeDataFile, verifyDataSourceHashes } from '../domain/data/source';
import { prepareObservations } from '../domain/analysis/observations';

const requestSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('file'),bytes:z.instanceof(Uint8Array).refine(bytes => bytes.byteLength <= INPUT_LIMITS.dataSourceBytes),fallback:z.literal('windows-1252').optional()}).strict(),
  z.object({ kind: z.literal('import'), text: z.string().max(INPUT_LIMITS.dataSourceBytes), read: datasetReadSchema.optional(), columns: z.array(datasetColumnSchema).max(INPUT_LIMITS.datasetColumns).optional() }).strict(),
  z.object({ kind: z.literal('plot'), source: dataSourceSchema.optional(), dataset: datasetSchema.optional(), spec: plotSpecSchema, width: z.number().positive().max(INPUT_LIMITS.coordinate), height: z.number().positive().max(INPUT_LIMITS.coordinate) }).strict(),
  z.object({ kind: z.literal('summary'), sources: z.array(dataSourceSchema).max(INPUT_LIMITS.dataSources), datasets: z.array(datasetSchema).max(INPUT_LIMITS.datasets) }).strict(),
  z.object({ kind: z.literal('prepare-project'), project: z.unknown(), measurements: z.array(z.object({ id: z.string().max(128), text: z.string().max(1000), size: z.number().positive().max(100), width: z.number().nonnegative().max(INPUT_LIMITS.coordinate) }).strict()).max(INPUT_LIMITS.plotElements).optional() }).strict(),
]);
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown) => void };
scope.onmessage = event => {
  try {
    const request = requestSchema.parse(event.data);
    if (request.kind === 'prepare-project') {
      preflightValue(request.project); const project = openBioFigureProjectSchema.parse(request.project); verifyDataSourceHashes(project.dataSources);
      const plots: { id: string; scene: ReturnType<typeof buildPlotScene> }[] = [], totals = { elements: 0, commands: 0, text: 0, bytes: 0 };
      const visit = (objects: ProjectObject[], parent: LinearTransform = identityTransform) => objects.forEach(object => {
        const {matrix, scaleX: sx, scaleY: sy} = plotTransform(parent, object);
        if (sx > INPUT_LIMITS.scale || sy > INPUT_LIMITS.scale || object.width * sx > INPUT_LIMITS.coordinate || object.height * sy > INPUT_LIMITS.coordinate) throw new InputError('transform_limit', 'Project transforms exceed the supported geometry budget.');
        if (object.kind === 'group') visit(object.children, matrix);
        if (object.kind !== 'plot') return;
        const dataset = project.datasets.find(dataset => dataset.id === object.plot.datasetId), source = project.dataSources.find(source => source.id === dataset?.sourceId), widths = new Map(request.measurements?.filter(value => value.id === object.id).map(value => [JSON.stringify([value.text, value.size]), value.width]));
        const scene = buildPlotScene(source, dataset, object.plot, object.width * sx, object.height * sy, (text, size) => widths.get(JSON.stringify([text, size])) ?? text.length * size * .6);
        for (const key of ['elements','commands','text','bytes'] as const) totals[key] += scene.budget[key];
        if (totals.elements > INPUT_LIMITS.plotElements || totals.commands > INPUT_LIMITS.plotPathCommands || totals.text > INPUT_LIMITS.plotText || totals.bytes > INPUT_LIMITS.plotBytes) throw new InputError('plot_budget', 'The figure exceeds its plot export budget. Reduce points, labels or plots before applying.');
        scene.observations = null; plots.push({ id: object.id, scene });
      }); visit(project.objects); scope.postMessage({ok:true,value:{project,plots}});
    } else if (request.kind === 'file') { scope.postMessage({ok:true,value:decodeDataFile(request.bytes,request.fallback)});
    } else if (request.kind === 'import') {
      const preview = previewImport(request.text, request.read, request.columns);
      const rowCount = preview.table.rows.length;
      preview.table.rows = preview.table.rows.slice(0, 150);
      scope.postMessage({ ok: true, value: { ...preview, rowCount } });
    } else if (request.kind === 'summary') {
      scope.postMessage({ ok: true, value: request.datasets.map(dataset => {
        const source = request.sources.find(source => source.id === dataset.sourceId);
        try { if (!source) throw new InputError('missing_data_source', 'The dataset source is missing.'); const table = readDataset(source, dataset); return { id: dataset.id, rows: table.rows.length, columns: table.columns.length, report: table.report }; }
        catch (error) { return { id: dataset.id, rows: null, columns: dataset.columns.length, report: [], error: error instanceof InputError ? error.message : 'Unsupported data.' }; }
      }) });
    } else {
      const scene = buildPlotScene(request.source, request.dataset, request.spec, request.width, request.height);
      let observedGroups = scene.observations?.groups ?? [];
      // A crowded annotation frame must not remove the controls needed to
      // select fewer comparisons. Mapping failures retain the scene's diagnostic.
      if (!scene.observations && request.source && request.dataset && scene.error) {
        try { observedGroups = prepareObservations(readDataset(request.source, request.dataset), request.spec).groups; }
        catch (error) { if (!(error instanceof InputError)) throw error; }
      }
      const series = [...new Set(observedGroups.map(group => group.series))];
      const groups = observedGroups.map((group, index) => ({ key: group.key, label: group.label, level: group.level, series: group.series, n: group.observations.length, paletteIndex: request.spec.type === 'grouped-bar' ? series.indexOf(group.series) : index,
        mean: group.observations.reduce((sum, observation) => sum + observation.y / group.observations.length, 0) }));
      scene.observations = null;
      scope.postMessage({ ok: true, value: { scene, groups } });
    }
  } catch (error) { scope.postMessage({ ok: false, error: error instanceof InputError ? error.message : 'Unsupported data or settings.', code: error instanceof InputError ? error.code : 'invalid_data' }); }
};
