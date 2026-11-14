import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ChartNoAxesCombined, Check } from 'lucide-react';
import type { OpenBioFigureProject, ProjectObject } from '../../domain/project/schema';
import { optionsForType, plotSpecSchema, PLOT_TYPES, OKABE_ITO, CHART_PALETTE, type PlotSpec, type PlotType } from '../../domain/plots/spec';
import { StatisticsControls } from './StatisticsControls';
import { ComparisonStatus } from './ComparisonStatus';
import { dataText as d, type Locale } from '../../i18n/messages';
import type { PlotScene } from '../../domain/plots/scene';
import { useDataWorker } from '../data/useDataWorker';
import { PlotPreview } from './PlotPreview';
import { StatisticsTable } from './StatisticsTable';
import { initialPlotSpec, recommendPlots } from '../../domain/plots/recommend';
import { arrangePlot, dataArrangement, supportsColumnGroups, supportsSeriesColumns, type DataArrangement } from '../../domain/plots/mapping';
import { INPUT_LIMITS } from '../../domain/security/input';
import { ColumnSummary, type PlotGroupSummary } from './ColumnSummary';
import { PlotDialogFooter, type PlotNavigation } from './PlotDialogChrome';

export function PlotEditor({ project, locale, target, spec, setSpec, onClose, onApply, onImport, navigation }: {
  project: OpenBioFigureProject; locale: Locale; target?: Extract<ProjectObject, { kind: 'plot' }>;
  spec: PlotSpec; setSpec: Dispatch<SetStateAction<PlotSpec | null>>; navigation: PlotNavigation;
  onClose: () => void; onApply: (spec: PlotSpec) => Promise<void>; onImport: (typeValues?: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const dataset = project.datasets.find(dataset => dataset.id === spec?.datasetId), source = project.dataSources.find(source => source.id === dataset?.sourceId);
  const preview = useDataWorker<{ scene: PlotScene; groups: PlotGroupSummary[] }>(spec ? { kind: 'plot', ...(source ? { source } : {}), ...(dataset ? { dataset } : {}), spec, width: target ? target.width * target.scaleX : 520, height: target ? target.height * target.scaleY : 380 } : { kind: 'import', text: '' });
  const mappingKey = JSON.stringify([source?.id, dataset, spec.type, spec.layout, spec.roles, spec.appearance.yScale]);
  const [lastGroups, setLastGroups] = useState<{ key: string; groups: PlotGroupSummary[] }>({ key: '', groups: [] });
  useEffect(() => { if (preview.value) setLastGroups({ key: mappingKey, groups: preview.value.groups }); }, [preview.value, mappingKey]);
  const currentGroups = preview.value?.groups ?? (lastGroups.key === mappingKey ? lastGroups.groups : []);
  const update = (patch: { [K in keyof PlotSpec]?: PlotSpec[K] }) => { if (spec) setSpec({ ...spec, ...patch } as PlotSpec); };
  const arrangement = dataArrangement(spec);
  const changeArrangement = (value: DataArrangement) => {
    if (!dataset) return;
    const next = arrangePlot(spec, dataset, value);
    if (value === 'columns') next.appearance = { ...next.appearance, xLabel: d(locale, 'column'), yLabel: d(locale, 'value') };
    else next.appearance = { ...next.appearance, xLabel: dataset.columns.find(column => column.key === next.roles.x)?.name ?? '', yLabel: value === 'rows' ? dataset.columns.find(column => column.key === next.roles.y)?.name ?? '' : d(locale, 'value') };
    setSpec(next);
  };
  const changeType = (type: PlotType) => {
    const supported = arrangement === 'series-columns' ? supportsSeriesColumns(type) : arrangement === 'rows' || supportsColumnGroups(type);
    const mapped = !supported && dataset ? arrangePlot(spec, dataset, 'rows') : spec;
    setSpec({ ...mapped, type, options: optionsForType(type), analysis: type === 'stacked-bar' ? null : mapped.analysis, result: null } as PlotSpec);
  };
  const appearance = (patch: Partial<PlotSpec['appearance']>) => { if (spec) update({ appearance: { ...spec.appearance, ...patch } }); };
  const select = (label: string, value: string, values: readonly string[], change: (value: string) => void) => <label>{d(locale, label)}<select aria-label={d(locale, label)} value={value} onChange={event => change(event.target.value)}>{values.map(value => <option key={value} value={value}>{d(locale, label === 'density' && value === 'area' ? 'equalArea' : label === 'pMode' ? value === 'raw' ? 'rawP' : 'logP' : label === 'comparisons' && value === 'control' ? 'controlChoice' : value)}</option>)}</select></label>;
  const role = (key: keyof PlotSpec['roles'], label: string, numeric = false) => <label>{d(locale, label)}<select aria-label={d(locale, label)} value={String(spec?.roles[key] ?? '')} onChange={event => { if (spec) { const roles = { ...spec.roles }; if (event.target.value) Object.assign(roles, { [key]: event.target.value }); else delete roles[key]; update({ roles }); } }}><option value="">{d(locale, 'none')}</option>{dataset?.columns.filter(column => !numeric || column.type === 'number').map(column => <option key={column.key} value={column.key}>{column.name} ({d(locale, column.type)})</option>)}</select></label>;
  const multiple = (key: 'values' | 'replicates', label: string) => <fieldset><legend>{d(locale, label)}</legend>{dataset?.columns.filter(column => column.type === 'number').map(column => <label key={column.key}><input type="checkbox" checked={spec.roles[key]?.includes(column.key) ?? false} disabled={key === 'values' && (spec.roles.values?.length ?? 0) >= INPUT_LIMITS.plotGroups && !spec.roles.values?.includes(column.key)} onChange={event => {
    const selected = new Set(spec.roles[key] ?? []);
    if (event.target.checked) selected.add(column.key); else selected.delete(column.key);
    update({ roles: { ...spec.roles, [key]: dataset.columns.filter(column => selected.has(column.key)).map(column => column.key) }, result: null });
  }} />{column.name}</label>)}</fieldset>;
  const apply = async () => {
    if (!spec || preview.busy || !preview.value || preview.value.scene.error) return;
    setBusy(true); setError(null);
    try { await onApply(plotSpecSchema.parse({ ...spec, result: preview.value.scene.result })); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : d(locale, 'error')); } finally { setBusy(false); }
  };
  const scene = preview.value?.scene;
  const recommendations = dataset ? recommendPlots(dataset) : [];
  const seriesTypes = spec.roles.x && dataset?.columns.find(column => column.key === spec.roles.x)?.type === 'number' ? ['line', 'area', 'scatter', 'grouped-bar'] as const : ['line', 'area', 'grouped-bar'] as const;
  const columnTypes = ['bar', 'dot-bar', 'dot-column', 'line', 'box', 'violin'] as const;
  const suggestions = <section className="plot-type-picker" aria-labelledby="plot-suggestions-heading">
    <div className="plot-picker-heading"><ChartNoAxesCombined aria-hidden="true" /><h3 id="plot-suggestions-heading">{d(locale, 'suggestions')}</h3></div>
    <p>{d(locale, 'suggestionsHint')}</p>
    <div className="data-actions plot-suggestions">{arrangement === 'columns' || arrangement === 'series-columns' ? (arrangement === 'columns' ? columnTypes : seriesTypes).map(type => <button key={type} type="button" data-plot-type={type} aria-label={d(locale, type)} aria-pressed={spec.type === type} onClick={() => changeType(type)}><span>{d(locale, type)}</span>{spec.type === type && <Check aria-hidden="true" />}</button>) : <>{dataset?.columns.some(column => column.type === 'number') && <button type="button" aria-label={d(locale, 'columnMeans')} onClick={() => changeArrangement('columns')}>{d(locale, 'columnMeans')}<small>{d(locale, 'columnMeansReason')}</small></button>}{recommendations.filter(suggestion => suggestion.layout === 'long').map(suggestion => <button key={suggestion.id} type="button" data-plot-type={suggestion.type} aria-label={d(locale, suggestion.type)} aria-pressed={spec.type === suggestion.type} title={d(locale, suggestion.reason)} onClick={() => update({ type: suggestion.type, layout: suggestion.layout, options: optionsForType(suggestion.type), roles: suggestion.roles, analysis: suggestion.type === 'stacked-bar' ? null : spec.analysis, result: null })}><span>{d(locale, suggestion.type)}</span>{spec.type === suggestion.type && <Check aria-hidden="true" />}</button>)}</>}</div>
  </section>;

  return <>
    <div className="data-dialog-body plot-design-body" inert={busy}>
    <div className="plot-editor-columns">
      <section className="plot-panel plot-mapping"><div className="plot-panel-heading"><h3>{d(locale, 'mapping')}</h3><span className="plot-panel-index">01</span></div><p className="plot-panel-description">{d(locale, 'mappingHint')}</p><label>{d(locale, 'dataset')}<select aria-label={d(locale, 'dataset')} value={spec.datasetId} onChange={event => { const selected = project.datasets.find(dataset => dataset.id === event.target.value); if (selected) setSpec(initialPlotSpec(selected)); }}>{project.datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
        <label>{d(locale, 'dataArrangement')}<select aria-label={d(locale, 'dataArrangement')} value={arrangement} onChange={event => changeArrangement(event.target.value as DataArrangement)}>
          <option value="rows">{d(locale, 'groupAndValue')}</option><option value="columns">{d(locale, 'columnNamesX')}</option><option value="series-columns">{d(locale, 'separateColumnSeries')}</option><option value="replicates">{d(locale, 'groupReplicates')}</option>
        </select></label>
        {arrangement === 'columns' && <div className="plot-mapping-note"><strong>{d(locale, 'columnMeans')}</strong><p>{d(locale, 'columnMeansHint')}</p><small>{d(locale, 'columnSelectionHint')}</small></div>}
        {arrangement === 'replicates' && <p className="plot-panel-description">{d(locale, 'replicateHint')}</p>}
        {arrangement === 'series-columns' && <p className="plot-mapping-note">{d(locale, 'columnSeriesHint')}</p>}
        {arrangement !== 'columns' && role('x', 'groupX')}{arrangement === 'rows' && role('y', 'measureY', true)}
        {(arrangement === 'columns' || arrangement === 'series-columns' || spec.type === 'cleveland') && multiple('values', 'valueColumns')}{arrangement === 'replicates' && multiple('replicates', 'replicates')}
        {spec.type === 'grouped-bar' && <p className="plot-mapping-note">{d(locale, arrangement === 'series-columns' ? 'wideGroupedReason' : 'groupedBarHint')}</p>}{arrangement !== 'series-columns' && role('series', 'series')}
        {role('id', 'subjectId')}{role('label', 'label')}{role('low', 'low', true)}{role('high', 'high', true)}{role('chromosome', 'chromosome')}{role('position', 'position', true)}{role('p', 'pValue', true)}
        <div className="data-actions plot-import-actions"><button type="button" onClick={() => onImport()}>{d(locale, 'importData')}</button><button type="button" onClick={() => onImport(true)}>{d(locale, 'typeValues')}</button></div>
      </section><section className="plot-live"><div className="plot-panel-heading"><h3>{d(locale, 'preview')}</h3><span className="plot-preview-status" role="status">{d(locale, preview.busy ? 'updatingPreview' : scene && !scene.error ? 'livePreview' : 'checkSettings')}</span></div><ComparisonStatus spec={spec} scene={scene} dataset={dataset} locale={locale} update={update} /><div className="plot-preview-stage">{scene ? <PlotPreview scene={scene} locale={locale} family={spec.appearance.fontFamily} label={spec.appearance.title || d(locale, spec.type)} /> : <div className="plot-empty-preview"><ChartNoAxesCombined aria-hidden="true" /><p>{d(locale, preview.busy ? 'updatingPreview' : 'checkSettings')}</p></div>}</div>{scene && <>{scene.error && <p role="alert">{d(locale, scene.error)}</p>}<ul className="plot-notices">{scene.notices.map((notice, index) => <li key={index}>{d(locale, notice)}</li>)}</ul>{arrangement === 'columns' && !scene.error && <ColumnSummary groups={preview.value?.groups ?? []} locale={locale} decimal={spec.appearance.decimal} />}<StatisticsTable result={scene.result} config={spec.analysis} name={dataset?.name ?? spec.appearance.title} locale={locale} /></>}{preview.error && <p role="alert">{d(locale, preview.error)}</p>}<p className="plot-preview-caption">{d(locale, 'previewHint')}</p></section>
      <section className="plot-panel plot-settings">{suggestions}<div className="plot-panel-heading"><h3>{d(locale, 'plotSettings')}</h3><span className="plot-panel-index">02</span></div><p className="plot-panel-description">{d(locale, 'settingsHint')}</p>{select('plotType', spec.type, PLOT_TYPES, value => changeType(value as PlotType))}
        {select('aggregate', spec.aggregate, ['none', 'mean', 'median', 'sum', 'count'], value => update({ aggregate: value as PlotSpec['aggregate'] }))}{select('errorBars', spec.error, ['none', 'sd', 'sem', 'ci95', 'range', 'iqr'], value => update({ error: value as PlotSpec['error'] }))}
        <StatisticsControls key={mappingKey} spec={spec} dataset={dataset} groups={currentGroups} locale={locale} update={analysis => update({ analysis, result: null })} />
        <h3 className="plot-subheading">{d(locale, 'appearance')}</h3>{(['title', 'xLabel', 'yLabel', 'fontFamily'] as const).map(key => <label key={key}>{d(locale, key)}<input value={spec.appearance[key]} maxLength={key === 'fontFamily' ? 128 : 1000} onChange={event => appearance({ [key]: event.target.value })} /></label>)}
        <label>{d(locale, 'fontSize')}<input type="number" min={6} max={60} value={spec.appearance.fontSize} onChange={event => appearance({ fontSize: event.target.valueAsNumber })} /></label>
        <label>{d(locale, 'palette')}<select aria-label={d(locale, 'palette')} value={JSON.stringify(spec.appearance.palette) === JSON.stringify(CHART_PALETTE) ? 'chart' : 'okabe'} onChange={event => appearance({ palette: event.target.value === 'chart' ? CHART_PALETTE : OKABE_ITO })}><option value="okabe">Okabe–Ito</option><option value="chart">OpenRender</option></select></label>
        <fieldset><legend>{d(locale, 'groupColors')}</legend>{preview.value?.groups.map(group => <label key={group.key}>{group.label}<input type="color" value={spec.appearance.groupColors.find(color => color.level === group.key)?.color ?? spec.appearance.palette[group.paletteIndex % spec.appearance.palette.length]!} onChange={event => appearance({ groupColors: [...spec.appearance.groupColors.filter(color => color.level !== group.key), { level: group.key, color: event.target.value }] })} /></label>)}</fieldset>
        {(['legend', 'showN'] as const).map(key => <label key={key}><input type="checkbox" checked={spec.appearance[key]} onChange={event => appearance({ [key]: event.target.checked })} />{d(locale, key)}</label>)}
        <label><input type="checkbox" checked={spec.appearance.points.show} onChange={event => appearance({ points: { ...spec.appearance.points, show: event.target.checked } })} />{d(locale, 'showPoints')}</label>
        {(['size', 'jitter', 'opacity'] as const).map(key => <label key={key}>{d(locale, key === 'size' ? 'pointSize' : key)}<input type="number" step={key === 'size' ? 0.5 : 0.1} min={key === 'size' ? 0.5 : 0} max={key === 'size' ? 10 : 1} value={spec.appearance.points[key]} onChange={event => appearance({ points: { ...spec.appearance.points, [key]: event.target.valueAsNumber } })} /></label>)}
        {select('yScale', spec.appearance.yScale, ['linear', 'log10'], value => appearance({ yScale: value as PlotSpec['appearance']['yScale'] }))}
        {(['yMin', 'yMax'] as const).map(key => <label key={key}>{d(locale, key)}<input type="number" value={spec.appearance[key] ?? ''} onChange={event => appearance({ [key]: event.target.value === '' ? null : event.target.valueAsNumber })} /></label>)}
        {select('decimal', spec.appearance.decimal, ['.', ','], value => appearance({ decimal: value as '.' | ',' }))}
        {spec.type === 'box' && select('whiskers', spec.options.whisker, ['tukey', 'min-max'], value => update({ options: { whisker: value as 'tukey' | 'min-max' } }))}
        {spec.type === 'violin' && <>{select('density', spec.options.normalize, ['width', 'area'], value => update({ options: { ...spec.options, normalize: value as 'width' | 'area' } }))}<label><input type="checkbox" checked={spec.options.trim} onChange={event => update({ options: { ...spec.options, trim: event.target.checked } })} />{d(locale, 'trimDensity')}</label></>}
        {spec.type === 'heatmap' && <label><input type="checkbox" checked={spec.options.diverging} onChange={event => update({ options: { diverging: event.target.checked } })} />{d(locale, 'diverging')}</label>}
        {spec.type === 'range' && <label><input type="checkbox" checked={spec.options.midpoint} onChange={event => update({ options: { midpoint: event.target.checked } })} />{d(locale, 'midpoint')}</label>}
        {spec.type === 'manhattan' && <>{select('pMode', spec.options.pMode, ['raw', 'log10'], value => update({ options: { ...spec.options, pMode: value as 'raw' | 'log10' } }))}<label><input type="checkbox" checked={spec.options.genomeLines} onChange={event => update({ options: { ...spec.options, genomeLines: event.target.checked } })} />{d(locale, 'genomeLines')}</label></>}
      </section>
    </div>
    {error && <p role="alert">{d(locale, error)}</p>}</div>
    <PlotDialogFooter locale={locale} onClose={onClose} navigation={navigation} busy={busy} hint={d(locale, 'applyHint')} primary={<button type="button" className="button primary" disabled={busy || preview.busy || !scene || !!scene.error} onClick={() => void apply()}>{d(locale, 'apply')}</button>} />
  </>;
}
