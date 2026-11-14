import type { SelectionSnapshot } from '../../editor/FabricEditor';
import { dataText as d, type Locale } from '../../i18n/messages';
import { StatisticsTable } from './StatisticsTable';
import { OKABE_ITO, CHART_PALETTE } from '../../domain/plots/spec';
export function PlotInspectorSection({ selection, locale, onEdit, onUpdate }: { selection: SelectionSnapshot; locale: Locale; onEdit: () => void; onUpdate: (plot: NonNullable<SelectionSnapshot['plot']>) => void }) {
  const plot = selection.plot;
  if (!plot) return null;
  return <section className="inspector-section"><h3>{d(locale, 'plotSettings')}</h3><button type="button" className="button primary" onClick={onEdit}>{d(locale, 'editPlot')}</button>
    {(['title', 'xLabel', 'yLabel'] as const).map(key => <label key={key}>{d(locale, key)}<input key={`${selection.id}:${key}:${plot.appearance[key]}`} defaultValue={plot.appearance[key]} onBlur={event => { if (event.target.value !== plot.appearance[key]) onUpdate({ ...plot, appearance: { ...plot.appearance, [key]: event.target.value } }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} maxLength={1000} /></label>)}
    <label>{d(locale, 'fontSize')}<input key={`${selection.id}:${plot.appearance.fontSize}`} type="number" defaultValue={plot.appearance.fontSize} min={6} max={60} onBlur={event => { if (event.target.validity.valid && event.target.valueAsNumber !== plot.appearance.fontSize) onUpdate({ ...plot, appearance: { ...plot.appearance, fontSize: event.target.valueAsNumber } }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label>{d(locale, 'errorBars')}<select value={plot.error} onChange={event => onUpdate({ ...plot, error: event.target.value as typeof plot.error })}>{['none', 'sd', 'sem', 'ci95', 'range', 'iqr'].map(value => <option key={value} value={value}>{d(locale, value)}</option>)}</select></label>
    <label>{d(locale, 'palette')}<select value={JSON.stringify(plot.appearance.palette) === JSON.stringify(CHART_PALETTE) ? 'chart' : 'okabe'} onChange={event => onUpdate({ ...plot, appearance: { ...plot.appearance, palette: event.target.value === 'chart' ? CHART_PALETTE : OKABE_ITO } })}><option value="okabe">Okabe–Ito</option><option value="chart">OpenRender</option></select></label>
    {plot.analysis && <><label>{d(locale, 'labelStyle')}<select value={plot.analysis.label} onChange={event => onUpdate({ ...plot, analysis: plot.analysis ? { ...plot.analysis, label: event.target.value as 'stars' | 'p' | 'scientific' } : null })}>{['stars', 'p', 'scientific'].map(value => <option key={value} value={value}>{d(locale, value)}</option>)}</select></label><label><input type="checkbox" checked={plot.analysis.hideNs} onChange={event => onUpdate({ ...plot, analysis: plot.analysis ? { ...plot.analysis, hideNs: event.target.checked } : null })} />{d(locale, 'hideNs')}</label></>}
    {(['showN'] as const).map(key => <label key={key}><input type="checkbox" checked={plot.appearance[key]} onChange={event => onUpdate({ ...plot, appearance: { ...plot.appearance, [key]: event.target.checked } })} />{d(locale, key)}</label>)}
    <label><input type="checkbox" checked={plot.appearance.points.show} onChange={event => onUpdate({ ...plot, appearance: { ...plot.appearance, points: { ...plot.appearance.points, show: event.target.checked } } })} />{d(locale, 'showPoints')}</label>
    {selection.plotNotices?.length ? <div role="status"><strong>{d(locale, selection.plotNotices.some(notice => notice.startsWith('Statistics recomputed')) ? 'recomputed' : 'diagnostics')}</strong><ul>{selection.plotNotices.map((notice, index) => <li key={index}>{d(locale, notice)}</li>)}</ul></div> : null}
    {selection.plotError && <p role="alert">{d(locale, selection.plotError)}</p>}
    <StatisticsTable result={selection.plotError ? null : plot.result} config={plot.analysis} name={plot.appearance.title} locale={locale} />
  </section>;
}
