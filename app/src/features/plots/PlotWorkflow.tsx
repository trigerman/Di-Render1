import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, FileUp, Keyboard, LockKeyhole } from 'lucide-react';
import { useDialogBehavior } from '../../components/dialogs/useDialogBehavior';
import type { DataSource, Dataset } from '../../domain/data/schema';
import type { OpenBioFigureProject, ProjectObject } from '../../domain/project/schema';
import { type PlotSpec } from '../../domain/plots/spec';
import { initialPlotSpec } from '../../domain/plots/recommend';
import { dataText as d, type Locale } from '../../i18n/messages';
import { emptyImportDraft, ImportDataDialog } from '../data/ImportDataDialog';
import { PlotEditor } from './PlotEditor';
import { PlotDialogFooter, PlotDialogHeader, type PlotStep } from './PlotDialogChrome';

export type PlotDraftData = { source: DataSource; dataset: Dataset };

/** Draft data belongs to this dialog. Only Apply commits it with the plot. */
export function PlotWorkflow({ project, locale, target, datasetId, onClose, onApply }: {
  project: OpenBioFigureProject; locale: Locale; target?: Extract<ProjectObject, { kind: 'plot' }>; datasetId?: string;
  onClose: () => void; onApply: (spec: PlotSpec, data?: PlotDraftData) => Promise<void>;
}) {
  const initial = project.datasets.find(dataset => dataset.id === (target?.plot.datasetId ?? datasetId)) ?? project.datasets[0];
  const ref = useRef<HTMLElement>(null), applying = useRef(false);
  const [spec, setSpec] = useState<PlotSpec | null>(() => target?.plot ?? (initial ? initialPlotSpec(initial) : null));
  const [step, setStep] = useState<PlotStep>(spec ? 'design' : 'source');
  const [draft, setDraft] = useState(() => emptyImportDraft(locale));
  const [data, setData] = useState<PlotDraftData | undefined>();
  const [mode, setMode] = useState<'import' | 'type'>('import'), [hasImport, setHasImport] = useState(false);
  const [selectedId, setSelectedId] = useState(initial?.id ?? ''), [busy, setBusy] = useState(false), [wasReset, setWasReset] = useState(false);
  const close = () => { if (!applying.current) onClose(); };
  useDialogBehavior(ref, close);
  useLayoutEffect(() => {
    // Move focus before input is possible; a delayed frame can steal an active edit.
    ref.current?.querySelector<HTMLElement>('.data-dialog-body input:not(:disabled), .data-dialog-body select:not(:disabled), .data-dialog-body button:not(:disabled)')?.focus();
  }, [step]);
  const reset = () => {
    if (applying.current) return;
    setDraft(emptyImportDraft(locale)); setData(undefined); setSpec(null); setSelectedId(''); setHasImport(false); setMode('import'); setWasReset(true); setStep('source');
  };
  const startImport = (typeValues = false) => {
    const nextMode = typeValues ? 'type' : 'import';
    if (mode !== nextMode) setDraft(emptyImportDraft(locale));
    setMode(nextMode); setHasImport(true); setWasReset(false); setStep('import');
  };
  const navigation = { onBack: () => setStep(step === 'design' && hasImport ? 'import' : 'source'), onReset: reset };
  const review = async (source: DataSource, dataset: Dataset) => {
    setSpec(previous => {
      if (!previous) return initialPlotSpec(dataset);
      if (data?.dataset.id === previous.datasetId) {
        const key = (value: string) => dataset.columns.find(column => column.name === data.dataset.columns.find(old => old.key === value)?.name)?.key ?? 'c999999';
        const roles = Object.fromEntries(Object.entries(previous.roles).map(([role, value]) => [role, Array.isArray(value) ? value.map(key) : typeof value === 'string' ? key(value) : value]));
        return { ...previous, datasetId: dataset.id, roles, result: null };
      }
      return initialPlotSpec(dataset);
    });
    setData({ source, dataset }); setStep('design');
  };
  const draftProject = data ? { ...project, datasets: [...project.datasets, data.dataset], dataSources: project.dataSources.some(source => source.id === data.source.id) ? project.dataSources : [...project.dataSources, data.source] } : project;
  return <div className="data-overlay"><section ref={ref} className={`data-dialog plot-workflow plot-step-${step}`} role="dialog" aria-modal="true" aria-labelledby="plot-dialog-title" aria-busy={busy}>
    <PlotDialogHeader locale={locale} title={d(locale, target ? 'editPlot' : 'createPlot')} onClose={close} busy={busy} step={step} canReview={hasImport} onStep={setStep} />
    {step === 'source' && <>
      <div className="data-dialog-body plot-source-body">
        <div className="plot-source-intro"><span className="plot-eyebrow">{d(locale, 'startWithData')}</span><h3>{d(locale, 'sourceHeading')}</h3><p>{d(locale, 'sourceDescription')}</p></div>
        <div className="plot-source-options">
          <button type="button" className="plot-source-card" aria-label={d(locale, 'importData')} onClick={() => startImport()}><span className="plot-source-icon"><FileUp aria-hidden="true" /></span><strong>{d(locale, 'importData')}</strong><span>{d(locale, 'importOptionHint')}</span><span className="plot-source-link">{d(locale, draft.text && mode === 'import' ? 'resumeData' : 'chooseFileOrPaste')}<ArrowRight aria-hidden="true" /></span></button>
          <button type="button" className="plot-source-card" aria-label={d(locale, 'typeValues')} onClick={() => startImport(true)}><span className="plot-source-icon"><Keyboard aria-hidden="true" /></span><strong>{d(locale, 'typeValues')}</strong><span>{d(locale, 'typeOptionHint')}</span><span className="plot-source-link">{d(locale, draft.text && mode === 'type' ? 'resumeData' : 'openBlankTable')}<ArrowRight aria-hidden="true" /></span></button>
        </div>
        {project.datasets.length > 0 && <div className="plot-existing-data"><div><h4>{d(locale, 'useSavedData')}</h4><p>{d(locale, 'useSavedDataHint')}</p></div><label><span className="visually-hidden">{d(locale, 'dataset')}</span><select aria-label={d(locale, 'dataset')} value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">{d(locale, 'chooseDataset')}</option>{project.datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><button type="button" disabled={!selectedId} onClick={() => { const selected = project.datasets.find(dataset => dataset.id === selectedId); if (!selected) return; setSpec(previous => previous?.datasetId === selected.id ? previous : initialPlotSpec(selected)); setHasImport(false); setStep('design'); }}>{d(locale, 'useDataset')}<ArrowRight aria-hidden="true" /></button></div>}
        {wasReset && <p className="plot-reset-notice" role="status">{d(locale, 'resetDone')}</p>}
        <p className="plot-privacy-note"><LockKeyhole aria-hidden="true" />{d(locale, 'dataNote')}</p>
      </div>
      <PlotDialogFooter locale={locale} onClose={close} navigation={navigation} atStart hint={d(locale, 'draftOnly')} />
    </>}
    {step === 'import' && <ImportDataDialog locale={locale} draft={draft} onDraftChange={setDraft} typeValues={mode === 'type'} datasetId={data?.dataset.id} navigation={navigation} onClose={close} onApply={review} />}
    {step === 'design' && spec && <PlotEditor project={draftProject} locale={locale} target={target} spec={spec} setSpec={setSpec} navigation={navigation} onClose={close} onImport={startImport} onApply={async plot => {
      if (applying.current) return;
      applying.current = true; setBusy(true);
      try { await onApply(plot, data?.dataset.id === plot.datasetId ? data : undefined); }
      finally { applying.current = false; setBusy(false); }
    }} />}
  </section></div>;
}
