import type { OpenBioFigureProject, ProjectObject } from '../../domain/project/schema';
import type { Diagnostic } from '../../domain/data/report';
import { useDataWorker } from './useDataWorker';
import { originalDownloadName } from '../../domain/data/exportCsv';
import { makeDownload } from '../../domain/export/exporters';
import { dataText as d, type Locale } from '../../i18n/messages';
import type { Dataset } from '../../domain/data/schema';

export function datasetPlots(objects: ProjectObject[], id: string): ProjectObject[] {
  return objects.flatMap(object => object.kind === 'group' ? datasetPlots(object.children, id) : object.kind === 'plot' && object.plot.datasetId === id ? [object] : []);
}
export function DataPanel({ project, locale, onImport, onPlot, onOpen, onReplace, onRename, onDelete, onDrop, onError }: { project: OpenBioFigureProject; locale: Locale; onImport: () => void; onPlot: (datasetId?: string) => void; onOpen: (dataset: Dataset) => void; onReplace: (dataset: Dataset) => void; onRename: (dataset: Dataset, name: string) => void; onDelete: (dataset: Dataset) => void; onDrop: (file: File) => void; onError: (message: string) => void }) {
  const summaries = useDataWorker<{ id: string; rows: number | null; columns: number; report: Diagnostic[]; error?: string }[]>({ kind: 'summary', sources: project.dataSources, datasets: project.datasets }, JSON.stringify([project.dataSources.map(source => source.id), project.datasets]));
  return <section className="data-panel" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files[0]) onDrop(event.dataTransfer.files[0]); }}>
    <h2>{d(locale, 'data')}</h2><p>{d(locale, 'dataNote')}</p><div className="data-actions"><button type="button" className="button primary" onClick={onImport}>{d(locale, 'importData')}</button><button type="button" onClick={() => onPlot()}>{d(locale, 'createPlot')}</button></div>
    {!project.datasets.length && <p>{d(locale, 'noData')}</p>}
    {project.datasets.map(dataset => {
      const source = project.dataSources.find(source => source.id === dataset.sourceId), plots = datasetPlots(project.objects, dataset.id);
      const summary = summaries.value?.find(item => item.id === dataset.id), dimensions = summary ? `${summary.rows?.toLocaleString() ?? '—'} × ${summary.columns}` : d(locale, 'reading');
      return <article key={dataset.id} className="data-row"><input aria-label={d(locale, 'rename') + ' ' + dataset.name} key={dataset.name} defaultValue={dataset.name} maxLength={1000} onBlur={event => { if (event.target.value && event.target.value !== dataset.name) onRename(dataset, event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <small>{dimensions} · {d(locale, 'plots')}: {plots.length}</small><p>{dataset.origin.name}</p><small>{d(locale, 'imported')}: {dataset.origin.importedAt.slice(0, 10)}</small>
        {summary?.report.length ? <details><summary>{d(locale, 'diagnostics')}</summary><ul>{summary.report.map((entry, index) => <li key={index}>{d(locale, entry.message)} ({entry.count})</li>)}</ul></details> : null}
        {summary?.error && <p role="alert">{d(locale, summary.error)}</p>}
        <div className="data-row-actions"><button type="button" onClick={() => onOpen(dataset)}>{d(locale, 'openTable')}</button><button type="button" onClick={() => onPlot(dataset.id)}>{d(locale, 'createPlot')}</button><button type="button" onClick={() => onReplace(dataset)}>{d(locale, 'replaceData')}</button>
          <button type="button" onClick={() => { if (source) makeDownload(source.content, dataset.origin.mediaType, originalDownloadName(dataset)); }}>{d(locale, 'downloadOriginal')}</button>
          <button type="button" onClick={() => plots.length ? onError(d(locale, 'deletionRefused') + ' ' + plots.map(plot => plot.name).join(', ')) : onDelete(dataset)}>{d(locale, 'deleteDataset')}</button></div>
      </article>;
    })}
  </section>;
}
