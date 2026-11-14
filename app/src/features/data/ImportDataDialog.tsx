import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { FileUp, Table2 } from 'lucide-react';
import { useDialogBehavior } from '../../components/dialogs/useDialogBehavior';
import { dataText as d, type Locale } from '../../i18n/messages';
import type { DataSource, Dataset, DatasetColumn, DatasetRead } from '../../domain/data/schema';
import { decodeFile } from './decodeFile';
import { assertFileSize, INPUT_LIMITS } from '../../domain/security/input';
import type { ImportPreview } from '../../domain/data/dataset';
import { useDataWorker } from './useDataWorker';
import { DataPreviewGrid } from './DataPreviewGrid';
import { defaultRead } from '../../domain/data/detect';
import { TypeValuesGrid } from './TypeValuesGrid';
import { ContinueIcon, PlotDialogFooter, PlotDialogHeader, type PlotNavigation } from '../plots/PlotDialogChrome';

export type ImportDraft = {
  text: string; name: string; read?: DatasetRead; columns?: DatasetColumn[]; origin: Dataset['origin'];
  file: File | null; confirmed: boolean; rows: string[][];
};
export const emptyImportDraft = (locale: Locale): ImportDraft => ({
  text: '', name: '', file: null, confirmed: false, rows: [['', ''], ['', ''], ['', '']],
  origin: { name: d(locale, 'pastedData'), mediaType: 'text/plain', encoding: 'utf-8', bytes: 0, importedAt: new Date().toISOString() },
});

export function ImportDataDialog({ locale, existing, source, readOnly, initialText, initialFile, typeValues, onClose, onApply, draft, onDraftChange, navigation, datasetId }: {
  locale: Locale; existing?: Dataset; source?: DataSource; readOnly?: boolean; initialText?: string; initialFile?: File; typeValues?: boolean;
  onClose: () => void; onApply: (source: DataSource, dataset: Dataset) => Promise<void>;
  draft?: ImportDraft; onDraftChange?: Dispatch<SetStateAction<ImportDraft>>; navigation?: PlotNavigation; datasetId?: string;
}) {
  const ref = useRef<HTMLElement>(null), fileRevision = useRef(0), fileTask = useRef<AbortController | null>(null);
  const [localDraft, setLocalDraft] = useState<ImportDraft>(() => ({ ...emptyImportDraft(locale), text: initialText ?? source?.content ?? '', name: existing?.name ?? '', read: existing?.read, columns: existing?.columns, origin: existing?.origin ?? emptyImportDraft(locale).origin, file: initialFile ?? null }));
  const { text, name, read, columns, origin, file, confirmed, rows } = draft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [readingFile, setReadingFile] = useState(false), [fileKey, setFileKey] = useState(0);
  const patch = (value: Partial<ImportDraft>) => setDraft(previous => ({ ...previous, ...value }));
  const result = useDataWorker<ImportPreview & { rowCount: number }>({ kind: 'import', text, ...(read ? { read } : {}), ...(columns ? { columns } : {}) });
  const preview = result.value, settings = read ?? preview?.read ?? defaultRead;
  const replaceText = (value: string) => {
    fileRevision.current++; fileTask.current?.abort(); setError(null); setReadingFile(false); setFileKey(key => key + 1);
    patch({ text: value, file: null, origin: emptyImportDraft(locale).origin, confirmed: false });
  };
  useDialogBehavior(ref, () => { if (!busy) onClose(); }, !navigation);
  const reset = () => {
    fileRevision.current++; fileTask.current?.abort(); setError(null); setReadingFile(false); setFileKey(key => key + 1);
    setDraft(emptyImportDraft(locale));
  };
  const acquire = async (selected: File, fallback?: 'windows-1252') => {
    fileTask.current?.abort(); const task = fileTask.current = new AbortController();
    const revision = ++fileRevision.current; patch({ file: selected, text: '', confirmed: false }); setError(null); setReadingFile(true);
    try {
      assertFileSize(selected.size, INPUT_LIMITS.dataSourceBytes);
      const decoded = await decodeFile(new Uint8Array(await selected.arrayBuffer()), fallback, task.signal);
      if (fileRevision.current !== revision) return;
      patch({ text: decoded.source.content, origin: { name: selected.name.slice(0, 256), mediaType: /\.csv$/i.test(selected.name) ? 'text/csv' : /\.(tsv|tab)$/i.test(selected.name) ? 'text/tab-separated-values' : 'text/plain', encoding: decoded.encoding, bytes: selected.size, importedAt: new Date().toISOString() },
        ...(!existing ? { name: selected.name.replace(/\.[^.]+$/, '').slice(0, 1000), read: undefined, columns: undefined } : {}), confirmed: false });
    } catch (failure) { if (fileRevision.current === revision) setError(failure instanceof Error ? failure.message : d(locale, 'error')); }
    finally { if (fileRevision.current === revision) setReadingFile(false); }
  };
  useEffect(() => {
    const pendingFile = initialFile ?? (draft?.file && !draft.text ? draft.file : undefined);
    if (pendingFile) void acquire(pendingFile);
    return () => { fileRevision.current++; fileTask.current?.abort(); };
  }, [initialFile]);
  const updateRead = (value: Partial<DatasetRead>) => patch({ read: { ...settings, ...value }, confirmed: false });
  const apply = async () => {
    if (!preview || result.busy || busy || readingFile || error || preview.ambiguous.length && !confirmed) return;
    setBusy(true); setError(null);
    try {
      let datasetColumns = preview.table.columns;
      if (existing && !columns) datasetColumns = datasetColumns.map(column => ({ ...column, type: existing.columns.find(previous => previous.name === column.name)?.type ?? column.type }));
      const dataset: Dataset = { id: existing?.id ?? datasetId ?? `dataset-${crypto.randomUUID()}`, name: (name || d(locale, 'dataset')).slice(0, 1000), sourceId: preview.source.id,
        origin: { ...origin, bytes: file ? origin.bytes : new TextEncoder().encode(preview.source.content).byteLength, importedAt: new Date().toISOString() }, read: preview.read, columns: datasetColumns };
      await onApply(preview.source, dataset); if (!navigation) onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : d(locale, 'error')); } finally { setBusy(false); }
  };
  const content = <>
    <div className="data-dialog-body" inert={busy} onDragOver={event => { if (!readOnly && !busy && !typeValues) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!readOnly && !busy && !typeValues && event.dataTransfer.files[0]) void acquire(event.dataTransfer.files[0]); }}>
    <div className="plot-section-intro"><div><h3>{d(locale, 'reviewData')}</h3><p>{d(locale, 'reviewDataHint')}</p></div><span className="plot-local-note">{d(locale, 'localOnly')}</span></div>
    {existing && !readOnly && <p>{d(locale, 'retainColumns')}</p>}
    <div className="data-import-columns"><div className="plot-panel data-input-panel">
      <label>{d(locale, 'datasetName')}<input value={name} disabled={readOnly || busy} maxLength={1000} placeholder={d(locale, 'datasetPlaceholder')} onChange={event => patch({ name: event.target.value })} /></label>
      {typeValues && <TypeValuesGrid rows={rows} locale={locale} onChange={(nextRows, value) => { replaceText(value); patch({ rows: nextRows, read: { ...defaultRead, delimiter: '\t' } }); }} />}
      {!readOnly && !typeValues && <label className="plot-file-drop"><FileUp aria-hidden="true" /><strong>{d(locale, 'chooseFile')}</strong><span>{file?.name ?? d(locale, 'dropFileHint')}</span><input key={fileKey} type="file" disabled={busy} accept=".csv,.tsv,.tab,.txt,text/plain,text/csv,text/tab-separated-values" onChange={event => { if (event.target.files?.[0]) void acquire(event.target.files[0]); }} /></label>}
      {!typeValues && <label>{d(locale, 'pasteData')}<textarea aria-label={d(locale, 'pasteData')} value={text} readOnly={readOnly || busy} placeholder={d(locale, 'pastePlaceholder')} rows={8} onChange={event => replaceText(event.target.value)} /></label>}
      {!readOnly && <fieldset><legend>{d(locale, 'readSettings')}</legend>
        <label>{d(locale, 'delimiter')}<select aria-label={d(locale, 'delimiter')} value={settings.delimiter} onChange={event => updateRead({ delimiter: event.target.value as DatasetRead['delimiter'] })}>{[',', '\t', ';', '|'].map(delimiter => <option key={delimiter} value={delimiter}>{delimiter === '\t' ? d(locale, 'tabDelimiter') : delimiter}</option>)}</select></label>
        <label>{d(locale, 'header')}<select aria-label={d(locale, 'header')} value={settings.header} onChange={event => updateRead({ header: event.target.value as DatasetRead['header'] })}><option value="first-row">{d(locale, 'firstRow')}</option><option value="none">{d(locale, 'noHeader')}</option></select></label>
        <label>{d(locale, 'skipRows')}<input type="number" min={0} max={INPUT_LIMITS.datasetRows} value={settings.skipRows} onChange={event => updateRead({ skipRows: event.target.valueAsNumber })} /></label>
        <label>{d(locale, 'decimal')}<select aria-label={d(locale, 'decimal')} value={settings.decimal} onChange={event => updateRead({ decimal: event.target.value as DatasetRead['decimal'], thousands: settings.thousands === event.target.value ? null : settings.thousands })}><option>.</option><option>,</option></select></label>
        <label>{d(locale, 'thousands')}<select aria-label={d(locale, 'thousands')} value={settings.thousands ?? ''} onChange={event => updateRead({ thousands: (event.target.value || null) as DatasetRead['thousands'] })}>{['', ',', '.', ' ', "'"].filter(value => value !== settings.decimal).map(value => <option key={value} value={value}>{value || d(locale, 'none')}</option>)}</select></label>
        <label>{d(locale, 'dateFormat')}<select aria-label={d(locale, 'dateFormat')} value={settings.dateFormat} onChange={event => updateRead({ dateFormat: event.target.value as DatasetRead['dateFormat'] })}>{['iso', 'dmy', 'mdy'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>{d(locale, 'missingTokens')}<textarea rows={3} value={settings.missing.join('\n')} onChange={event => updateRead({ missing: event.target.value.split('\n') })} /></label>
        <label><input type="checkbox" checked={settings.transpose} onChange={event => updateRead({ transpose: event.target.checked })} />{d(locale, 'transpose')}</label>
      </fieldset>}
    </div><div className="plot-panel data-preview-panel"><div className="plot-panel-heading"><h3>{d(locale, 'preview')}</h3>{preview && <span className="plot-count">{preview.rowCount.toLocaleString()} {d(locale, 'rows')} · {preview.table.columns.length} {d(locale, 'columns')}</span>}</div>{(result.busy || readingFile) && text !== '' && <p role="status">{d(locale, 'reading')}</p>}
      {!preview && !text && <div className="plot-empty-preview"><Table2 aria-hidden="true" /><h4>{d(locale, 'tablePreviewEmpty')}</h4><p>{d(locale, 'tablePreviewHint')}</p></div>}
      {preview && <>{preview.rowCount > 150 && <p>{d(locale, 'previewSample')}</p>}<DataPreviewGrid table={preview.table} locale={locale} />
        {!readOnly && <div className="data-column-types">{preview.table.columns.map((column, index) => <label key={column.key}>{column.name}<select value={column.type} onChange={event => patch({ columns: preview.table.columns.map((value, position) => position === index ? { ...value, type: event.target.value as DatasetColumn['type'] } : value) })}>{['number', 'category', 'date', 'text'].map(type => <option key={type} value={type}>{d(locale, type)}</option>)}</select></label>)}</div>}
        <h3>{d(locale, 'diagnostics')}</h3><ul>{preview.table.report.map((entry, index) => <li key={index}>{d(locale, entry.message)} ({entry.count}) {entry.rows.slice(0, 5).join(', ')}</li>)}</ul>
        {preview.ambiguous.length > 0 && !readOnly && <div className="plot-policy-note"><p>{d(locale, 'ambiguous')}</p><ul>{preview.ambiguous.map((item, index) => <li key={index}>{item.raw}: {item.decimal} / {item.thousands}</li>)}</ul><label><input type="checkbox" checked={confirmed} onChange={event => patch({ confirmed: event.target.checked })} />{d(locale, 'confirmPolicy')}</label></div>}
      </>}
    </div></div>
    {(error || result.error) && (text !== '' || error) && <p role="alert">{d(locale, error || result.error || 'error')}</p>}{error && file && <button type="button" onClick={() => void acquire(file, 'windows-1252')}>{d(locale, 'windows1252')}</button>}
    </div>
    <PlotDialogFooter locale={locale} onClose={onClose} busy={busy} navigation={navigation ?? (!readOnly ? { onBack: onClose, onReset: reset } : undefined)} hint={navigation ? d(locale, 'draftOnly') : d(locale, 'dataNote')} primary={!readOnly && <button type="button" className="button primary" onClick={() => void apply()} disabled={busy || readingFile || !!error || result.busy || !preview || preview.ambiguous.length > 0 && !confirmed}>{d(locale, navigation ? 'continueToPlot' : existing ? 'replaceData' : 'addDataset')}<ContinueIcon /></button>} />
  </>;
  return navigation ? content : <div className="data-overlay"><section ref={ref} className="data-dialog plot-workflow" role="dialog" aria-modal="true" aria-labelledby="plot-dialog-title"><PlotDialogHeader locale={locale} title={d(locale, readOnly ? 'openTable' : existing ? 'replaceData' : 'importData')} busy={busy} onClose={onClose} />{content}</section></div>;
}
