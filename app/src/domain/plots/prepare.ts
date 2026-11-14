import { identityTransform, plotTransform, type LinearTransform } from './transform';
import type { OpenBioFigureProject, ProjectObject } from '../project/schema';
import { hasPreparedPlot, rememberPlotScene, type PlotScene } from './scene';
import { preflightValue, INPUT_LIMITS, InputError } from '../security/input';

export interface PreparedPlot { id: string; scene: PlotScene }
export interface TextMeasurement { id: string; text: string; size: number; width: number }
/** Heavy imports and analyses run off-thread; the second pass uses actual loaded-font measurements. */
export async function prepareProjectPlots(project: OpenBioFigureProject | unknown, signal?: AbortSignal): Promise<void> {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return;
  if (!project || typeof project !== 'object' || !('objects' in project) || !Array.isArray(project.objects)) return;
  const pending: {objects: unknown[]; depth: number}[] = [{objects: project.objects, depth: 0}]; let found = false, count = 0;
  while (pending.length) { const entry = pending.pop()!; if (entry.depth > INPUT_LIMITS.jsonDepth) throw new InputError('input_complexity', 'Project nesting exceeds the supported limit.'); for (const object of entry.objects) { if (++count > INPUT_LIMITS.objects) throw new InputError('object_limit', 'Project object count exceeds the supported limit.'); if (!object || typeof object !== 'object') continue; if ('kind' in object && object.kind === 'plot') found = true; if ('children' in object && Array.isArray(object.children)) pending.push({objects: object.children, depth: entry.depth + 1}); } }
  if (!found) return;
  preflightValue(project);
  const candidate = project as OpenBioFigureProject;
  const cached = (objects: ProjectObject[], parent: LinearTransform = identityTransform): boolean => objects.every(object => { const {matrix, scaleX, scaleY} = plotTransform(parent, object); if (object.kind === 'group') return cached(object.children, matrix); if (object.kind !== 'plot') return true; const dataset = candidate.datasets?.find(dataset => dataset.id === object.plot.datasetId), source = candidate.dataSources?.find(source => source.id === dataset?.sourceId); return hasPreparedPlot(source, dataset, object.plot, object.width * scaleX, object.height * scaleY); });
  if (cached(candidate.objects)) return;
  if (signal?.aborted) throw new InputError('plot_cancelled', 'Plot preparation was cancelled.');
  await document.fonts?.ready;
  if (signal?.aborted) throw new InputError('plot_cancelled', 'Plot preparation was cancelled.');
  const worker = new Worker(new URL('../../workers/dataWorker.ts', import.meta.url), { type: 'module' });
  try {
    const request = (measurements?: TextMeasurement[]) => new Promise<{ project: OpenBioFigureProject; plots: PreparedPlot[] }>((resolve, reject) => {
      const stop = () => { done(); reject(new InputError('plot_cancelled', 'Plot preparation was cancelled.')); };
      signal?.addEventListener('abort', stop, { once: true });
      const timeout = setTimeout(() => { done(); reject(new InputError('plot_timeout', 'The plot took too long to prepare. Reduce the data.')); }, 60_000);
      const done = () => { clearTimeout(timeout); signal?.removeEventListener('abort', stop); };
      worker.onmessage = event => { done(); if (event.data?.ok) resolve(event.data.value); else reject(new InputError(event.data?.code ?? 'plot_prepare', event.data?.error ?? 'The plot could not be prepared.')); };
      worker.onerror = () => { done(); reject(new InputError('plot_prepare', 'Local plot preparation failed.')); };
      if (signal?.aborted) { stop(); return; }
      worker.postMessage({ kind: 'prepare-project', project, ...(measurements ? { measurements } : {}) });
    });
    const first = await request(), byId = new Map<string, Extract<ProjectObject, {kind:'plot'}>>();
    const collect = (objects: ProjectObject[]) => objects.forEach(object => { if (object.kind === 'plot') byId.set(object.id, object); if (object.kind === 'group') collect(object.children); }); collect(first.project.objects);
    const context = document.createElement('canvas').getContext('2d'), measurements: TextMeasurement[] = [];
    first.plots.forEach(plot => plot.scene.primitives.forEach(primitive => { if (primitive.kind !== 'text') return; if (context) context.font = `${primitive.size}px ${byId.get(plot.id)!.plot.appearance.fontFamily}`; measurements.push({ id: plot.id, text: primitive.text, size: primitive.size, width: context?.measureText(primitive.text).width ?? primitive.text.length * primitive.size * .6 }); }));
    const final = await request(measurements);
    final.plots.forEach(plot => { const object = byId.get(plot.id)!; const dataset = final.project.datasets.find(dataset => dataset.id === object.plot.datasetId), source = final.project.dataSources.find(source => source.id === dataset?.sourceId); rememberPlotScene(source, dataset, object.plot, plot.scene); });
  } finally { worker.terminate(); }
}
/** Packed revisions are independent. A bad current record must not prevent previous recovery. */
export async function prepareStoredPlots(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object') return;
  const state = value as {version?:number; current?:unknown; previous?:unknown; recent?:{project?:unknown}[]; media?:{id?:string}[]; dataSources?:{id?:string}[]};
  for (const candidate of [state.current, state.previous, ...(Array.isArray(state.recent) ? state.recent.map(item => item?.project) : [])]) {
    let project = candidate;
    if ([3,4].includes(state.version ?? 0) && candidate && typeof candidate === 'object' && 'body' in candidate && candidate.body && typeof candidate.body === 'object') {
      const packed = candidate as {body:object;mediaIds?:string[];dataSourceIds?:string[]};
      project = { ...packed.body, media: state.media?.filter(image => packed.mediaIds?.includes(image.id ?? '')) ?? [], dataSources: state.dataSources?.filter(source => packed.dataSourceIds?.includes(source.id ?? '')) ?? [] };
    }
    try { await prepareProjectPlots(project); } catch { /* The strict revision decoder decides recovery. */ }
  }
}
